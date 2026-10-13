import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GoalBlockedCard } from "../../../components/GoalBlockedCard";
import { useBlockedGoalResume } from "../../../hooks/useBlockedGoalResume";
import { useAppStore } from "../../../stores/app-store";

export function BlockedGoalSessionCard({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const goal = useBlockedGoalResume(sessionId);
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const isRunning = useAppStore((state) => state.activeSessionId === sessionId && state.isRunning);
  const loadReports = useAppStore((state) => state.refreshGoalReports);
  const [actionError, setActionError] = useState(false);
  const scope = `${sessionId}:${goal.hold?.executionId ?? ""}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => { setActionError(false); }, [scope]);
  if (goal.hold?.state !== "blocked") return null;
  const run = async (action: "resume" | "accept" | "abandon") => {
    const actionScope = scope;
    setActionError(false);
    try {
      if (action === "resume") {
        if (!session?.providerId || !session.modelId) throw new Error("MODEL_NOT_CONFIGURED");
        await goal.resume?.(undefined, { providerId: session.providerId, modelId: session.modelId });
      } else {
        await goal.close?.(action);
        if (action === "accept") await loadReports(sessionId);
      }
    } catch { if (scopeRef.current === actionScope) setActionError(true); }
  };
  return <GoalBlockedCard title={goal.execution?.title || goal.title || t("goal.untitled")} hold={goal.hold}
    busy={goal.busy || isRunning} readOnly={goal.readOnly} error={actionError}
    onResume={() => void run("resume")} onAccept={() => void run("accept")} onAbandon={() => void run("abandon")} />;
}
