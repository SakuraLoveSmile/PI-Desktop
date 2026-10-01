import i18n from "i18next";
import type { AppState } from "../app-state";
import type { SessionRuntime } from "./session-runtime";
import type { StoreAccess } from "../slices/types";
import {
  loadSidebarPreferences,
  saveSidebarPreferences,
  type SessionMeta,
} from "../../lib/sidebar-preferences";
import { api } from "../../lib/api";
import {
  approvedExecutionFallbackTitle,
  approvedExecutionTitleInput,
  canReplaceAutomaticSessionTitle,
  isSameTitleExecution,
} from "./session-title-policy";
import type { SessionRenameGuard } from "@pi-desktop/shared";

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
  triggerAutoTitleSummarization: (
    sessionId: string,
    options?: ApprovedExecutionTitleSource,
  ) => Promise<void>;
};
export type ApprovedExecutionTitleSource = {
  executionId: string;
  proposalTitle: string;
  proposalQuestion?: string;
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
  const attemptedExecutionIds = new Map<string, string>();
  const requestGenerations = new Map<string, number>();
  for (const [sessionId, meta] of Object.entries(initialSessionMeta)) {
    if (meta.manualTitle) manualSessionTitles.add(sessionId);
    if (meta.autoTitleAttempted) summarizedSessionIds.add(sessionId);
    if (meta.autoTitleExecutionId) {
      attemptedExecutionIds.set(sessionId, meta.autoTitleExecutionId);
    }
  }

  function saveMeta(sessionId: string, patch: Partial<SessionMeta>): void {
    const current = get().sessionMeta[sessionId] || {};
    const next = { ...current, ...patch };
    if (persistSessionMeta) persistSessionMeta(sessionId, next);
    else {
      const preferences = loadSidebarPreferences();
      preferences.sessionMeta[sessionId] = {
        ...(preferences.sessionMeta[sessionId] || {}),
        ...patch,
      };
      saveSidebarPreferences(preferences);
    }
    set((state) => ({
      sessionMeta: {
        ...state.sessionMeta,
        [sessionId]: { ...(state.sessionMeta[sessionId] || {}), ...patch },
      },
    }));
  }

  function logTitleEvent(
    stage: "attempt" | "skipped" | "succeeded" | "failed",
    sessionId: string,
    source: "first-turn" | "approved-execution",
    reason: string,
    error?: unknown,
  ): void {
    const code =
      error && typeof error === "object" && "errorCode" in error &&
      typeof Reflect.get(error, "errorCode") === "string"
        ? Reflect.get(error, "errorCode")
        : undefined;
    console.info("[session-title]", {
      stage,
      sessionId,
      source,
      reason,
      ...(code ? { errorCode: code } : {}),
    });
  }

  async function triggerAutoTitleSummarization(
    sessionId: string,
    approvedSource?: ApprovedExecutionTitleSource,
  ): Promise<void> {
    if (!sessionId) return;
    const state = get();
    const source = approvedSource ? "approved-execution" : "first-turn";
    if (manualSessionTitles.has(sessionId)) {
      logTitleEvent("skipped", sessionId, source, "manual-title");
      return;
    }
    // Setting toggle check: absent defaults to true; explicit false disables summarization
    if (state.settings?.autoGenerateSessionTitles === false) {
      logTitleEvent("skipped", sessionId, source, "setting-disabled");
      return;
    }
    if (state.sessionMeta[sessionId]?.manualTitle) {
      logTitleEvent("skipped", sessionId, source, "manual-title");
      return;
    }

    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      logTitleEvent("skipped", sessionId, source, "session-missing");
      return;
    }
    if (approvedSource && (session.team?.role === "member" || session.source === "remote" || session.source === "pi-native" || session.id.startsWith("remote:") || session.id.startsWith("native-pi:"))) {
      logTitleEvent("skipped", sessionId, source, "unsupported-session-source");
      return;
    }

    let userPrompt: string;
    let assistantReply: string | undefined;
    let fallbackTitle: string;
    let eligibleFallbackTitles: string[];
    let expectedExecutionId: string | null = null;
    if (approvedSource) {
      if (!approvedSource.executionId.trim()) {
        logTitleEvent("skipped", sessionId, source, "execution-id-missing");
        return;
      }
      const checkpoint = state.planCheckpoints[sessionId];
      if (
        checkpoint?.executionState !== "running" ||
        checkpoint.executionId !== approvedSource.executionId
      ) {
        logTitleEvent("skipped", sessionId, source, "execution-not-current");
        return;
      }
      if (attemptedExecutionIds.get(sessionId) === approvedSource.executionId ||
        state.sessionMeta[sessionId]?.autoTitleExecutionId === approvedSource.executionId) {
        logTitleEvent("skipped", sessionId, source, "execution-already-attempted");
        return;
      }
      userPrompt = approvedExecutionTitleInput(
        approvedSource.proposalTitle,
        approvedSource.proposalQuestion,
      );
      fallbackTitle = approvedExecutionFallbackTitle(approvedSource.proposalTitle);
      // The first prompt is only an eligibility marker; approved proposal text
      // remains the sole model input for this source.
      const transcript = sessionId === state.activeSessionId
        ? state.messages
        : sessionRuntime.sessionTranscriptCache.get(sessionId) ?? [];
      const firstUser = transcript.find((message) => message.role === "user");
      eligibleFallbackTitles = [
        fallbackTitle,
        ...(firstUser?.content
          ? [promptFallbackSessionTitle(firstUser.content, "")]
          : []),
      ];
      expectedExecutionId = approvedSource.executionId;
    } else {
      if (session.team?.role === "member") {
        logTitleEvent("skipped", sessionId, source, "team-member");
        return;
      }
      if (
        summarizedSessionIds.has(sessionId) ||
        state.sessionMeta[sessionId]?.autoTitleAttempted
      ) {
        logTitleEvent("skipped", sessionId, source, "first-turn-already-attempted");
        return;
      }
      const messages = sessionId === state.activeSessionId
        ? state.messages
        : sessionRuntime.sessionTranscriptCache.get(sessionId) ?? [];
      const firstUser = messages.find((message) => message.role === "user");
      if (!firstUser?.content) {
        logTitleEvent("skipped", sessionId, source, "first-user-message-missing");
        return;
      }
      userPrompt = firstUser.content;
      fallbackTitle = promptFallbackSessionTitle(firstUser.content, "");
      eligibleFallbackTitles = [fallbackTitle];
      const firstAssistant = messages.find(
        (message) => message.role === "assistant" &&
          typeof message.content === "string" && message.content.trim(),
      );
      assistantReply = typeof firstAssistant?.content === "string"
        ? firstAssistant.content
        : undefined;
    }

    if (!fallbackTitle || !canReplaceAutomaticSessionTitle(
      session.title,
      eligibleFallbackTitles,
      state.sessionMeta[sessionId]?.lastAutoTitle,
      isDefaultSessionTitle(session.title),
    )) {
      logTitleEvent("skipped", sessionId, source, "custom-title");
      return;
    }

    const generation = (requestGenerations.get(sessionId) ?? 0) + 1;
    requestGenerations.set(sessionId, generation);
    const expectedTitle = session.title;
    const renameGuard: SessionRenameGuard | undefined = approvedSource
      ? { expectedTitle, expectedExecutionId }
      : undefined;

    try {
      if (approvedSource) {
        attemptedExecutionIds.set(sessionId, approvedSource.executionId);
        saveMeta(sessionId, { autoTitleExecutionId: approvedSource.executionId });
      } else {
        summarizedSessionIds.add(sessionId);
        saveMeta(sessionId, { autoTitleAttempted: true });
      }
    } catch (error) {
      logTitleEvent("failed", sessionId, source, "attempt-marker-persist-failed", error);
      return;
    }
    logTitleEvent("attempt", sessionId, source, "started");

    try {
      const result = await api.summarizeSessionTitle({
        sessionId,
        userPrompt,
        assistantReply,
      });
      const latestState = get();
      const latestSession = latestState.sessions.find((item) => item.id === sessionId);
      const latestCheckpoint = latestState.planCheckpoints[sessionId];
      const validCurrentSource = approvedSource
        ? isSameTitleExecution(latestCheckpoint, approvedSource.executionId)
        : true;
      if (
        !latestSession ||
        !validCurrentSource ||
        (requestGenerations.get(sessionId) ?? 0) !== generation ||
        latestState.settings?.autoGenerateSessionTitles === false ||
        manualSessionTitles.has(sessionId) ||
        latestState.sessionMeta[sessionId]?.manualTitle ||
        latestSession.title !== expectedTitle
      ) {
        logTitleEvent("skipped", sessionId, source, "result-became-stale");
        return;
      }

      const nextTitle = result?.title?.trim();
      if (!nextTitle || nextTitle === fallbackTitle) {
        logTitleEvent("skipped", sessionId, source, "empty-or-fallback-result");
        return;
      }
      const renameResult = await api.renameSession(sessionId, nextTitle, renameGuard);
      if (!renameResult?.ok) throw new Error("Session title rename was rejected");
      const afterRename = get();
      const renamedSession = afterRename.sessions.find((item) => item.id === sessionId);
      if (
        renamedSession?.title === expectedTitle &&
        (requestGenerations.get(sessionId) ?? 0) === generation &&
        !manualSessionTitles.has(sessionId)
      ) {
        set((current) => ({
          sessions: current.sessions.map((item) =>
            item.id === sessionId ? { ...item, title: nextTitle } : item,
          ),
        }));
      }
      const finalState = get();
      if (
        (requestGenerations.get(sessionId) ?? 0) === generation &&
        !manualSessionTitles.has(sessionId) &&
        !finalState.sessionMeta[sessionId]?.manualTitle
      ) {
        saveMeta(sessionId, { lastAutoTitle: nextTitle });
        await get().refreshSessions();
        logTitleEvent("succeeded", sessionId, source, "renamed");
      }
    } catch (error) {
      logTitleEvent("failed", sessionId, source, "summarize-or-rename-failed", error);
    }
  }

  return { manualSessionTitles, triggerAutoTitleSummarization };
}
