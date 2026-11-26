import {
  ErrorCodes,
  IPC,
  OAUTH_AUTH_KIND,
  isSessionSummaryNote,
  isSessionSummaryState,
  type SessionSummaryNote,
  type SessionSummaryRefreshResult,
  type SessionSummarySkipReason,
  type SessionSummaryState,
} from "@pi-desktop/shared";
import {
  SESSION_SUMMARY_TIMEOUT_MS,
  summarizeSession,
  type RuntimeProviderConfig,
  type SessionSummaryInput,
  type SessionSummaryMessage,
  type SessionSummaryOptions,
  type SessionSummaryResult,
} from "@pi-desktop/agent-runtime";
import type { HostProcess } from "../host-process";
import type { Logger } from "../logger";
import type { VendorOAuth } from "../oauth";
import type { IpcRegistrar } from "./types";

/** A refresh needs this many messages since the stored note (one finished exchange). */
const MIN_NEW_MESSAGES = 2;
/** At most one automatic model call per session in this window. */
const MIN_INTERVAL_MS = 60_000;
/** Transcript rows read for one summary; tool rows count, so text can be far fewer. */
const WINDOW_ROWS = 60;
const WINDOW_ROW_CHARS = 1_200;
const REMEMBERED_SESSIONS = 256;

export type SessionSummaryIpcDependencies = {
  handle: IpcRegistrar["handle"];
  getHost: () => HostProcess | null;
  logger: Pick<Logger, "app">;
  vendorOAuth: Pick<VendorOAuth, "resolveAuth">;
  resolveAgentRuntimeLaunch: (...args: any[]) => Promise<any>;
  /** Test seams; production uses the runtime summarizer, the wall clock and the 45 s limit. */
  summarize?: (
    provider: RuntimeProviderConfig,
    input: SessionSummaryInput,
    options?: SessionSummaryOptions,
  ) => Promise<SessionSummaryResult | null>;
  now?: () => number;
  timeoutMs?: number;
};

type SessionRead = {
  messageCount?: unknown;
  title?: unknown;
  providerId?: unknown;
  modelId?: unknown;
  permissionMode?: unknown;
  team?: { role?: unknown } | null;
  messages?: unknown;
};

function fail(errorCode: string, message: string): Error & { errorCode: string } {
  return Object.assign(new Error(message), { errorCode });
}

function errorCodeOf(error: unknown): string {
  const record = (error ?? {}) as { errorCode?: unknown; data?: { errorCode?: unknown } };
  if (typeof record.errorCode === "string") return record.errorCode;
  return typeof record.data?.errorCode === "string" ? record.data.errorCode : ErrorCodes.INTERNAL;
}

function parseRequest(value: unknown): { sessionId: string; force: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail(ErrorCodes.INVALID_ARGUMENT, "session summary input required");
  }
  const { sessionId, force } = value as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw fail(ErrorCodes.INVALID_ARGUMENT, "sessionId required");
  }
  if (sessionId.startsWith("remote:") || sessionId.startsWith("native-pi:")) {
    throw fail(
      ErrorCodes.SESSION_SUMMARY_UNSUPPORTED,
      "session summaries are available for local Desktop sessions only",
    );
  }
  if (force !== undefined && typeof force !== "boolean") {
    throw fail(ErrorCodes.INVALID_ARGUMENT, "force must be a boolean");
  }
  return { sessionId, force: force === true };
}

/** User and assistant text of the top-level conversation; tool rows and nested agent rows never qualify. */
function conversationText(rows: unknown): SessionSummaryMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): SessionSummaryMessage[] => {
    if (!row || typeof row !== "object") return [];
    const { role, content, toolName, parentToolCallId } = row as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    if (typeof toolName === "string" || typeof parentToolCallId === "string") return [];
    return [{ role, content }];
  });
}

/** Rejects with the signal's reason, so a provider that ignores the signal still ends on time. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Pinned session summary of the activity rail. Electron main reads the canonical
 * transcript tail from the Host, asks the session's own model through the Node
 * runtime, and stores the answer in the Host. The renderer supplies a session id
 * and nothing else, so it can neither inject text nor choose the input.
 */
export function registerSessionSummaryIpc(deps: SessionSummaryIpcDependencies): void {
  const { handle, getHost, logger, vendorOAuth, resolveAgentRuntimeLaunch } = deps;
  const summarize = deps.summarize ?? summarizeSession;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? SESSION_SUMMARY_TIMEOUT_MS;
  const inflight = new Map<string, Promise<SessionSummaryRefreshResult>>();
  const lastRunAt = new Map<string, number>();

  const host = (): HostProcess => {
    const current = getHost();
    if (!current) throw fail(ErrorCodes.HOST_UNAVAILABLE, "host unavailable");
    return current;
  };

  const readState = async (sessionId: string): Promise<SessionSummaryState> => {
    const state = await host().call("sessionSummary.get", { sessionId });
    if (!isSessionSummaryState(state)) {
      throw fail(ErrorCodes.INTERNAL, "session summary response is invalid");
    }
    return state;
  };

  const remember = (sessionId: string, at: number): void => {
    lastRunAt.delete(sessionId);
    lastRunAt.set(sessionId, at);
    if (lastRunAt.size > REMEMBERED_SESSIONS) {
      const oldest = lastRunAt.keys().next().value;
      if (oldest !== undefined) lastRunAt.delete(oldest);
    }
  };

  const skipped = (
    reason: SessionSummarySkipReason,
    summary: SessionSummaryNote | null,
  ): SessionSummaryRefreshResult => ({ outcome: "skipped", reason, summary });

  const refresh = async (sessionId: string, force: boolean): Promise<SessionSummaryRefreshResult> => {
    const settings = await host().call<Record<string, unknown>>("settings.get");
    if (settings?.autoSummarizeSessions === false) return skipped("disabled", null);
    const { summary: stored, messageCount } = await readState(sessionId);
    if (messageCount === 0) return skipped("no-content", stored);
    // After a rewind the stored note describes messages that are gone.
    const current = stored && !stored.diverged ? stored : null;
    if (!force) {
      if ((current ? current.behind : messageCount) < MIN_NEW_MESSAGES) {
        return skipped("not-behind", stored);
      }
      const previous = lastRunAt.get(sessionId);
      if (previous !== undefined && now() - previous < MIN_INTERVAL_MS) {
        return skipped("too-soon", stored);
      }
    }
    const detail = await host().call<{ session?: SessionRead }>("session.get", {
      id: sessionId,
      messageLimit: WINDOW_ROWS,
      contentLimit: WINDOW_ROW_CHARS,
    });
    const session = detail.session;
    if (!session) throw fail(ErrorCodes.NOT_FOUND, "Session not found");
    if (session.team?.role === "member") {
      throw fail(
        ErrorCodes.SESSION_SUMMARY_UNSUPPORTED,
        "Team member sessions do not have a summary",
      );
    }
    const providerId = typeof session.providerId === "string" ? session.providerId : undefined;
    const modelId = typeof session.modelId === "string" ? session.modelId : undefined;
    const launchId = `session-summary:${sessionId}`;
    // A synthetic id resolves a tool-free one-shot provider; it never launches an agent or a Team.
    const launch = await resolveAgentRuntimeLaunch(
      launchId,
      {
        id: launchId,
        title: typeof session.title === "string" ? session.title : "",
        ...(providerId ? { providerId } : {}),
        ...(modelId ? { modelId } : {}),
        mode: "agent",
        thinkingLevel: "off",
        permissionMode: session.permissionMode,
      },
      settings,
      {
        mode: "agent",
        executionProfile: "standard",
        ...(providerId ? { providerId } : {}),
        ...(modelId ? { modelId } : {}),
        thinkingLevel: "off",
      },
    );
    const provider = {
      ...launch.sidecarParams.provider,
      ...(launch.sidecarParams.provider.authKind === OAUTH_AUTH_KIND
        ? { resolveAuth: () => vendorOAuth.resolveAuth(launch.providerId) }
        : {}),
    } as RuntimeProviderConfig;
    const basedOnMessageCount = Number.isSafeInteger(session.messageCount)
      ? (session.messageCount as number)
      : messageCount;

    // A failed or timed-out call counts too: a broken provider is not retried every turn.
    remember(sessionId, now());
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(fail(ErrorCodes.TIMEOUT, "Session summary timed out")),
      timeoutMs,
    );
    let result: SessionSummaryResult | null;
    try {
      result = await raceAbort(
        summarize(
          provider,
          {
            messages: conversationText(session.messages),
            ...(current ? { previousSummary: current.text } : {}),
          },
          { signal: controller.signal, sessionId },
        ),
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!result) return skipped("no-content", stored);
    try {
      const written = await host().call<{ summary?: unknown }>("sessionSummary.set", {
        sessionId,
        text: result.text,
        basedOnMessageCount,
        expectedRevision: stored?.revision ?? 0,
      });
      if (!isSessionSummaryNote(written.summary)) {
        throw fail(ErrorCodes.INTERNAL, "session summary response is invalid");
      }
      logger.app("session", "info", "session summary updated", {
        sessionId,
        data: { providerId: launch.providerId, modelId: launch.modelId, messages: result.included },
      });
      return { outcome: "updated", summary: written.summary };
    } catch (error) {
      if (errorCodeOf(error) !== ErrorCodes.SUMMARY_CONFLICT) throw error;
      // Another window stored a note first; show theirs instead of overwriting it.
      const winner = (error as { data?: { summary?: unknown } }).data?.summary;
      return skipped("conflict", isSessionSummaryNote(winner) ? winner : null);
    }
  };

  handle(IPC.invoke.sessionSummaryGet, async (value: unknown) => {
    const { sessionId } = parseRequest(value);
    return readState(sessionId);
  });

  handle(IPC.invoke.sessionSummaryRefresh, async (value: unknown) => {
    const { sessionId, force } = parseRequest(value);
    // One flight per session: a second ask, manual or automatic, joins the first.
    const running = inflight.get(sessionId);
    if (running) return running;
    const flight: Promise<SessionSummaryRefreshResult> = refresh(sessionId, force)
      .catch((error: unknown) => {
        logger.app("session", "warn", "session summary failed", {
          sessionId,
          data: { errorCode: errorCodeOf(error) },
        });
        throw error;
      })
      .finally(() => {
        if (inflight.get(sessionId) === flight) inflight.delete(sessionId);
      });
    inflight.set(sessionId, flight);
    return flight;
  });
}
