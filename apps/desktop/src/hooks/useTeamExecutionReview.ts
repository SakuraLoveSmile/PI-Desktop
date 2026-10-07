import { useEffect, useRef } from "react";
import type { PlanProposal, SessionSummary, TeamLaunchReview } from "@pi-desktop/shared";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { localTeamSessionId } from "../lib/team-presentation";
import { teamWorkPanelTab } from "../lib/work-panel-tabs";
import { useAppStore } from "../stores/app-store";
import { useTeamSnapshot } from "./useTeamSnapshot";

/** Automatic research is an audit record, never a user approval surface. */
export function userTeamLaunchReview(review: TeamLaunchReview | null | undefined) {
  return review?.launchPolicy !== "automatic_plan" ? review : undefined;
}

export function executionTeamId(session: SessionSummary | undefined, checkpoint?: PlanProposal) {
  const teamId = localTeamSessionId(session);
  return session && (session.mode === "agent" || isActivePlanExecution(checkpoint)) &&
    session.team?.role !== "member" &&
    teamId === session.id ? teamId : undefined;
}

/** Shares the Host review without confusing the displayed contract with execution mode. */
export function usePendingTeamExecutionReview(sessionId: string | undefined, enabled = true) {
  const session = useAppStore((state) => state.sessions.find((candidate) => candidate.id === sessionId));
  const checkpoint = useAppStore((state) => sessionId ? state.planCheckpoints[sessionId] : undefined);
  const teamId = enabled ? executionTeamId(session, checkpoint) : undefined;
  const { snapshot } = useTeamSnapshot(teamId);
  const review = userTeamLaunchReview(snapshot?.review);
  return teamId && snapshot?.teamSessionId === teamId && review?.teamSessionId === teamId &&
    review.status === "pending" && (review.strategy ?? "delegate") === "delegate" && review.members.length > 0
    ? review : undefined;
}

/** Mounted by the shell so an execution review can reveal a closed panel. */
export function useTeamExecutionReview() {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const enabled = useAppStore((state) =>
    state.ready && state.page === "chat" && !state.selectingSessionId);
  const review = usePendingTeamExecutionReview(activeSessionId, enabled);
  const revealed = useRef<{ sessionId: string | undefined; reviews: Set<string> }>({
    sessionId: undefined,
    reviews: new Set(),
  });

  useEffect(() => {
    if (revealed.current.sessionId !== activeSessionId) {
      revealed.current = { sessionId: activeSessionId, reviews: new Set() };
    }
    if (!activeSessionId || !review || revealed.current.reviews.has(review.reviewId)) return;
    const teamId = review.teamSessionId;

    // Re-check authoritative view metadata before changing its panel context.
    const state = useAppStore.getState();
    const session = state.sessions.find((candidate) => candidate.id === state.activeSessionId);
    if (!state.ready || state.page !== "chat" || state.selectingSessionId ||
      state.activeSessionId !== activeSessionId || executionTeamId(session, state.planCheckpoints[activeSessionId]) !== teamId) return;
    revealed.current.reviews.add(review.reviewId);
    state.openWorkPanelTabForSession(activeSessionId, teamWorkPanelTab(teamId));
  }, [activeSessionId, review]);
}
