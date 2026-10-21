import { useCallback, useMemo, useSyncExternalStore } from "react";
import i18n from "i18next";
import { api } from "../lib/api";
import { createBlockedGoalReader, type BlockedGoalState } from "../features/chat/goal/blocked-goal-runtime";
import { useAppStore } from "../stores/app-store";
import { blockedGoalMessage } from "../features/chat/goal/blocked-composer-submission";
import type { ComposerDraftSnapshot } from "../lib/composer-smart-stop";
import type { GoalModelOverride } from "../features/chat/goal/blocked-goal-runtime";
import { resumeGoalAndRefreshSessions } from "../features/chat/goal/goal-resume-session";

const readers = new Map<string, ReturnType<typeof createBlockedGoalReader>>();
const empty: BlockedGoalState = { loading: false, busy: false, error: null, optedOut: false };

export function useBlockedGoalResume(sessionId: string | null | undefined) {
  const source = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.source);
  const readOnly = source === "remote" || Boolean(sessionId?.startsWith("remote:") || sessionId?.startsWith("native-pi:"));
  const reader = useMemo(() => {
    if (!sessionId || source === "pi-native" || sessionId.startsWith("native-pi:")) return null;
    const key = `${sessionId}:${readOnly}`;
    let value = readers.get(key);
    if (!value) {
      value = createBlockedGoalReader(sessionId, { read: readOnly ? async ({ sessionId: owningSessionId }) => {
        const { reports } = await api.listGoalReports({ sessionId: owningSessionId });
        const report = reports.find((item) => item.hold?.state === "blocked");
        return { hold: report?.hold, title: report?.goalTitle };
      } : api.goalExecutionGet,
        resume: (input) => resumeGoalAndRefreshSessions(input, {
          resume: api.goalResume,
          refreshSessions: () => useAppStore.getState().refreshSessions(),
          onRefreshFailed: () => useAppStore.getState().showToast(i18n.t("goal.blocked.sessionRefreshFailed"), { variant: "warning" }),
        }), close: api.goalClose,
        onChanged: api.onGoalExecutionChanged,
        onRestart: (listener) => api.onHostStatus((event) => { if (event.ok && event.restarted) listener(); }),
        onIdle: (isIdle) => queueMicrotask(() => { if (isIdle() && readers.get(key) === value) readers.delete(key); }),
      }, readOnly);
      readers.set(key, value);
    }
    return value;
  }, [sessionId, readOnly, source]);
  const subscribe = useCallback((listener: () => void) => reader?.subscribe(listener) ?? (() => undefined), [reader]);
  const getState = useCallback(() => reader?.getState() ?? empty, [reader]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  return { ...state, readOnly, shouldResume: reader?.shouldResume() ?? false,
    dismiss: () => reader?.dismiss(), refresh: () => reader?.refresh(),
    resume: reader?.resume, close: reader?.close,
    submit: reader ? (content: string, draft: ComposerDraftSnapshot | undefined, model: GoalModelOverride) =>
      reader.resume(blockedGoalMessage(content, draft), model) : undefined };
}
