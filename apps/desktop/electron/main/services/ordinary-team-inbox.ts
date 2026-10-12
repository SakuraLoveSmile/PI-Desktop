import {
  TEAM_ORDINARY_INBOX_CAPABILITY,
  type TeamOrdinaryInboxReadParams,
  type TeamOrdinaryInboxReadResult,
  type TeamOrdinaryInboxProofResult,
} from "@pi-desktop/shared";
import type { TeamDeliveryDependencies } from "./team-delivery";

export function createOrdinaryTeamInbox(
  deps: TeamDeliveryDependencies,
  withTeamLock: <T>(team: string, operation: () => Promise<T>) => Promise<T>,
) {
  const recoverySessions = new Set<string>();
  const recoveryHold = "ordinary-inbox-recovery";
  let disposed = false;

  async function reconcile(team: string): Promise<void> {
    if (disposed) throw invalid("Ordinary inbox recovery is disposed");
    if (!recoverySessions.has(team)) return;
    const host = deps.getHost();
    const bridge = deps.getBridge();
    if (!host?.isAvailable() || !bridge) throw invalid("Ordinary inbox recovery backend unavailable");
    for (const entry of bridge.agentHost.queue.list(team)) {
      if (!entry.sessionMessageId || entry.idempotencyKey !== `team-message:${entry.sessionMessageId}`) continue;
      const response: TeamOrdinaryInboxProofResult = await host.call("team.getOrdinaryInboxProof", {
        teamSessionId: team, messageId: entry.sessionMessageId,
      });
      if (disposed || deps.getHost() !== host || deps.getBridge() !== bridge) throw invalid("Ordinary inbox recovery is disposed or its backend changed");
      const proof = response.proof;
      if (proof?.teamSessionId === team && proof.messageId === entry.sessionMessageId &&
        (proof.phase === "persisted" || proof.phase === "acked")) {
        bridge.agentHost.retireOrdinaryTeamInbox(team, proof.leadTurnId, [proof.messageId]);
      }
    }
    if (disposed) throw invalid("Ordinary inbox recovery is disposed");
    recoverySessions.delete(team);
    bridge.agentHost.queue.resume(team, recoveryHold);
  }

  function invalid(message: string): Error {
    return Object.assign(new Error(message), { errorCode: "TEAM_TURN_INVALID" });
  }

  async function request(method: string, input: Record<string, unknown>): Promise<unknown> {
    if (disposed) throw invalid("Ordinary inbox admission is disposed");
    const fields = ["teamSessionId", "callerSessionId", "leadTurnId", "boundaryId"] as const;
    for (const field of fields) {
      if (typeof input[field] !== "string" || !input[field].trim()) throw invalid(`${field} is required`);
    }
    const params = Object.fromEntries(fields.map(field => [field, input[field]])) as TeamOrdinaryInboxReadParams;
    if (params.teamSessionId !== params.callerSessionId) throw invalid("Only the Lead can read its ordinary inbox");
    const host = deps.getHost();
    const bridge = deps.getBridge();
    const runtime = deps.getRuntimeIdentity?.();
    const live = () => Boolean(!disposed && host?.isAvailable() && deps.getHost() === host && deps.getBridge() === bridge &&
      deps.activeTurns.get(params.teamSessionId) === params.leadTurnId &&
      (!deps.isTurnDispatchable || deps.isTurnDispatchable(params.teamSessionId, params.leadTurnId)) &&
      (!deps.getRuntimeIdentity || (runtime && deps.getRuntimeIdentity() === runtime)));
    if (!bridge || !host || !live()) throw invalid("Ordinary inbox requires the exact live Lead turn");
    return withTeamLock(params.teamSessionId, async () => {
      if (!live()) throw invalid("Ordinary inbox runtime changed before admission");
      if (method === "team.ackOrdinaryInbox") {
        if (!Array.isArray(input.messageIds) || input.messageIds.some(id => typeof id !== "string" || !id)) {
          throw invalid("messageIds must contain message identities");
        }
        const result = await host.call(method, { ...params, messageIds: input.messageIds });
        if (!live()) throw invalid("Ordinary inbox runtime changed during acknowledgment");
        return result;
      }
      if (method !== "team.readOrdinaryInbox") throw invalid("Unsupported ordinary inbox operation");
      const result = await bridge.agentHost.readOrdinaryTeamInbox(params.teamSessionId, params.leadTurnId, async () => {
        if (!live()) throw invalid("Ordinary inbox runtime changed before persistence");
        let response: TeamOrdinaryInboxReadResult;
        try {
          response = await host.call<TeamOrdinaryInboxReadResult>(method, params);
          if (response.capability !== TEAM_ORDINARY_INBOX_CAPABILITY || !Array.isArray(response.messages) ||
            response.messages.some(message => message.teamSessionId !== params.teamSessionId ||
              message.leadTurnId !== params.leadTurnId || message.phase !== "persisted" ||
              message.message.id !== message.userMessageId || message.message.role !== "user" ||
              message.message.sessionMessage?.messageId !== message.messageId || message.message.steering === true)) {
            throw invalid("Host ordinary inbox response does not match the admission proof");
          }
        } catch (error) {
          // A lost response may follow a successful durable commit. Fence dequeue
          // until proofs reconcile, inside the still-owned AgentHost admission gate.
          recoverySessions.add(params.teamSessionId);
          bridge.agentHost.queue.hold(params.teamSessionId, recoveryHold);
          try { await reconcile(params.teamSessionId); }
          catch (recoveryError) { deps.log("Ordinary inbox mirror recovery remains pending", {
            teamSessionId: params.teamSessionId, error: String(recoveryError),
          }); }
          throw error;
        }
        return response;
      });
      if (!live()) throw invalid("Ordinary inbox runtime changed during persistence");
      return result ?? { capability: TEAM_ORDINARY_INBOX_CAPABILITY, messages: [] };
    });
  }
  return { request, reconcile, dispose: () => {
    disposed = true;
    // Shutdown settlement emits terminal events which can drain AgentHost.
    // Keep its recovery fence until that owning queue is destroyed.
    recoverySessions.clear();
  } };
}
