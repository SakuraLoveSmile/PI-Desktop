import type { ExecutionProfile, Mode } from "@pi-desktop/shared";

interface MailboxContext {
  turnId: string | undefined;
  epoch: number;
  team: object | undefined;
  isLead: boolean;
  profile: ExecutionProfile;
  mode: Mode;
  approvedExecution: boolean;
  inactive: boolean;
}

/** Share context ownership without granting ordinary Agent inbox consumption. */
export function createTeamMailboxGuards(
  read: () => MailboxContext,
  yieldTurn: (toolCallId: string, current: () => boolean) => void,
) {
  const captureMailboxGuard = () => {
    const captured = read();
    return () => {
      const current = read();
      return !current.inactive && current.turnId === captured.turnId &&
        current.epoch === captured.epoch && current.team === captured.team &&
        current.mode === captured.mode && current.profile === captured.profile;
    };
  };
  const captureInboxYield = () => {
    const ownsContext = captureMailboxGuard();
    const current = () => {
      const state = read();
      return ownsContext() && Boolean(state.turnId) && state.isLead &&
        state.profile === "team" && state.mode === "plan" && !state.approvedExecution;
    };
    if (!current()) return undefined;
    return (toolCallId: string) => {
      if (!current()) return false;
      yieldTurn(toolCallId, current);
      return true;
    };
  };
  return { captureMailboxGuard, captureInboxYield };
}
