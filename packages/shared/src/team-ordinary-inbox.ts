import type { UiMessage } from "./types.js";

/** Negotiated internal transport capability; never a model-provided authority. */
export const TEAM_ORDINARY_INBOX_CAPABILITY = "ordinary-team-inbox-v1" as const;
export type TeamOrdinaryInboxReadParams = {
  teamSessionId: string;
  callerSessionId: string;
  leadTurnId: string;
  boundaryId: string;
};
export type TeamOrdinaryInboxDelivery = {
  messageId: string;
  userMessageId: string;
  teamSessionId: string;
  leadTurnId: string;
  scopeTurnId: string;
  boundaryId: string;
  phase: "persisted";
  message: UiMessage;
};
/** Internal admission response. Bodies must never enter the tool result. */
export type TeamOrdinaryInboxReadResult = {
  capability: typeof TEAM_ORDINARY_INBOX_CAPABILITY;
  messages: TeamOrdinaryInboxDelivery[];
};
export type TeamOrdinaryInboxAckParams = TeamOrdinaryInboxReadParams & { messageIds: string[] };
export type TeamOrdinaryInboxAckResult = { ok: true; acknowledgedIds: string[] };
export type TeamOrdinaryInboxProof = Omit<TeamOrdinaryInboxDelivery, "message" | "phase"> & {
  phase: "prepared" | "persisted" | "acked";
};
export type TeamOrdinaryInboxProofResult = { proof: TeamOrdinaryInboxProof | null };
export type TeamOrdinaryInboxPersistedEvent = {
  teamSessionId: string;
  leadTurnId: string;
  messageIds: string[];
};
