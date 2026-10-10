import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import type { AppState } from "../stores/app-state";
import { Button } from "./ui";

type CompactionState = Pick<
  AppState,
  | "activeSessionId"
  | "sessions"
  | "isRunning"
  | "runningSessions"
  | "pendingPermissions"
  | "pendingAsks"
  | "pendingPlans"
  | "planCheckpoints"
>;

export function canCompactContext(
  state: CompactionState,
  sessionId: string | undefined,
  hasUsage: boolean,
): boolean {
  if (!sessionId || state.activeSessionId !== sessionId || !hasUsage) return false;
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  return Boolean(
    session &&
      (session.source === undefined || session.source === "desktop") &&
      !session.id.startsWith("native-pi:") &&
      !session.id.startsWith("remote:") &&
      !session.readOnlyReason &&
      session.capabilities?.canPrompt !== false &&
      session.team?.role !== "member" &&
      !state.isRunning &&
      !state.runningSessions[sessionId] &&
      !(state.pendingPermissions[sessionId]?.length) &&
      !(state.pendingAsks[sessionId]?.length) &&
      state.pendingPlans[sessionId]?.status !== "pending" &&
      state.planCheckpoints[sessionId]?.status !== "pending",
  );
}

export function ContextCompactionAction({
  sessionId,
  hasUsage,
  onStarted,
}: {
  sessionId: string | undefined;
  hasUsage: boolean;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const enabled = useAppStore((state) =>
    canCompactContext(state, sessionId, hasUsage),
  );
  return (
    <Button
      type="button"
      className="context-inspector-compact-action"
      disabled={!enabled}
      onClick={() => {
        // A retained popover must never compact a newly selected session.
        const state = useAppStore.getState();
        if (!canCompactContext(state, sessionId, hasUsage)) return;
        void state.compactContext();
        onStarted();
      }}
    >
      {t("chat.compactContext")}
    </Button>
  );
}
