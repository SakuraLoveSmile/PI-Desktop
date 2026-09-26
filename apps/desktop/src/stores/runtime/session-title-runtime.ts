import i18n from "i18next";
import type { AppState } from "../app-state";
import type { SessionRuntime } from "./session-runtime";
import type { StoreAccess } from "../slices/types";
import { markSessionAutoTitleAttempted, type SessionMeta } from "../../lib/sidebar-preferences";
import { api } from "../../lib/api";

const LEGACY_DEFAULT_TITLES = new Set(["new task", "new chat", "新建任务", "新对话"]);
const SESSION_TITLE_FALLBACK_LENGTH = 48;

export function untitledTaskTitle(): string {
  return i18n.t("chat.untitledTask");
}

export function promptFallbackSessionTitle(
  userPrompt: string,
  emptyTitle: string,
): string {
  return (
    userPrompt.trim().replace(/\s+/g, " ").slice(0, SESSION_TITLE_FALLBACK_LENGTH) ||
    emptyTitle
  );
}

export function isDefaultSessionTitle(title?: string | null): boolean {
  const trimmed = (title || "").trim().toLowerCase();
  return (
    !trimmed ||
    LEGACY_DEFAULT_TITLES.has(trimmed) ||
    trimmed === untitledTaskTitle().toLowerCase() ||
    trimmed === i18n.t("nav.newChat").toLowerCase()
  );
}

export type SessionTitleRuntime = {
  manualSessionTitles: Set<string>;
  triggerAutoTitleSummarization: (sessionId: string) => Promise<void>;
};
export type CreateSessionTitleRuntimeOptions = StoreAccess & {
  sessionRuntime: SessionRuntime;
  initialSessionMeta: AppState["sessionMeta"];
  persistSessionMeta?: (sessionId: string, meta: SessionMeta) => void;
};

export function createSessionTitleRuntime({
  get,
  set,
  sessionRuntime,
  initialSessionMeta,
  persistSessionMeta,
}: CreateSessionTitleRuntimeOptions): SessionTitleRuntime {
  const manualSessionTitles = new Set<string>();
  const summarizedSessionIds = new Set<string>();
  for (const [sessionId, meta] of Object.entries(initialSessionMeta)) {
    if (meta.manualTitle) manualSessionTitles.add(sessionId);
    if (meta.autoTitleAttempted) summarizedSessionIds.add(sessionId);
  }

  async function triggerAutoTitleSummarization(sessionId: string): Promise<void> {
    if (!sessionId) return;
    if (manualSessionTitles.has(sessionId)) return;
    if (summarizedSessionIds.has(sessionId)) return;

    const state = get();
    // Setting toggle check: absent defaults to true; explicit false disables summarization
    if (state.settings?.autoGenerateSessionTitles === false) return;
    if (state.sessionMeta[sessionId]?.manualTitle) return;
    if (state.sessionMeta[sessionId]?.autoTitleAttempted) return;

    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const messages =
      sessionId === state.activeSessionId
        ? state.messages
        : sessionRuntime.sessionTranscriptCache.get(sessionId) ?? [];
    const firstUser = messages.find((message) => message.role === "user");
    if (!firstUser?.content) return;
    const fallbackTitle = promptFallbackSessionTitle(firstUser.content, "");
    if (
      !isDefaultSessionTitle(session.title) &&
      session.title.trim() !== fallbackTitle
    ) {
      return;
    }
    const firstAssistant = messages.find(
      (message) =>
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.trim(),
    );

    // Coalesce simultaneous triggers in memory and mark attempted
    summarizedSessionIds.add(sessionId);

    // Persist attempt marker before firing the IPC request to avoid repeat attempts on failure/restart
    try {
      if (persistSessionMeta) {
        persistSessionMeta(sessionId, {
          ...(state.sessionMeta[sessionId] || {}),
          autoTitleAttempted: true,
        });
      } else {
        markSessionAutoTitleAttempted(sessionId);
      }
      if (typeof set === "function") {
        set((curr) => ({
          sessionMeta: {
            ...curr.sessionMeta,
            [sessionId]: {
              ...(curr.sessionMeta[sessionId] || {}),
              autoTitleAttempted: true,
            },
          },
        }));
      }
    } catch {
      // Best-effort persistence: in-memory summarizedSessionIds prevents retry during this run
    }

    try {
      const result = await api.summarizeSessionTitle({
        sessionId,
        userPrompt: firstUser.content,
        assistantReply:
          typeof firstAssistant?.content === "string"
            ? firstAssistant.content
            : undefined,
      });
      // Guard in-flight state changes
      const latestState = get();
      if (latestState.settings?.autoGenerateSessionTitles === false) return;
      if (manualSessionTitles.has(sessionId)) return;
      if (latestState.sessionMeta[sessionId]?.manualTitle) return;

      const nextTitle = result?.title?.trim();
      if (
        nextTitle &&
        nextTitle !== fallbackTitle &&
        !manualSessionTitles.has(sessionId)
      ) {
        await api.renameSession(sessionId, nextTitle);
        await get().refreshSessions();
      }
    } catch {
      // Non-fatal: keep the current truncated prompt title as fallback.
    }
  }

  return { manualSessionTitles, triggerAutoTitleSummarization };
}
