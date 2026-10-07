import { useEffect, useRef } from "react";
import type { SessionSummary, TeamLaunchReview } from "@pi-desktop/shared";
import { localTeamSessionId } from "../lib/team-presentation";
import { teamWorkPanelTab } from "../lib/work-panel-tabs";
import { useAppStore } from "../stores/app-store";
import { useTeamSnapshot } from "./useTeamSnapshot";

/** Automatic research is an audit record, never a user approval surface. */
export function userTeamLaunchReview(review: TeamLaunchReview | null | undefined) {
  return review?.launchPolicy !== "automatic_plan" ? review : undefined;
}

function executionTeamId(session: SessionSummary | undefined) {
  const teamId = localTeamSessionId(session);
  return session?.mode === "agent" && session.team?.role !== "member" &&
    teamId === session.id ? teamId : undefined;
}

/** Mounted by the shell so an execution review can reveal a closed panel. */
export function useTeamExecutionReview() {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activeSession = useAppStore((state) =>
    state.sessions.find((session) => session.id === state.activeSessionId));
  const enabled = useAppStore((state) =>
    state.ready && state.page === "chat" && !state.selectingSessionId);
  const teamId = enabled ? executionTeamId(activeSession) : undefined;
  const { snapshot } = useTeamSnapshot(teamId);
  const revealed = useRef<{ sessionId: string | undefined; reviews: Set<string> }>({
    sessionId: undefined,
    reviews: new Set(),
  });

  useEffect(() => {
    if (revealed.current.sessionId !== activeSessionId) {
      revealed.current = { sessionId: activeSessionId, reviews: new Set() };
    }
    const review = userTeamLaunchReview(snapshot?.review);
    if (!activeSessionId || !teamId || snapshot?.teamSessionId !== teamId ||
      review?.teamSessionId !== teamId || review.status !== "pending" ||
      (review.strategy ?? "delegate") !== "delegate" || review.members.length === 0 ||
      revealed.current.reviews.has(review.reviewId)) return;

    // Re-check authoritative view metadata before changing its panel context.
    const state = useAppStore.getState();
    const session = state.sessions.find((candidate) => candidate.id === state.activeSessionId);
    if (!state.ready || state.page !== "chat" || state.selectingSessionId ||
      state.activeSessionId !== activeSessionId || executionTeamId(session) !== teamId) return;
    revealed.current.reviews.add(review.reviewId);
    state.openWorkPanelTabForSession(activeSessionId, teamWorkPanelTab(teamId));
  }, [activeSessionId, teamId, snapshot]);
}
