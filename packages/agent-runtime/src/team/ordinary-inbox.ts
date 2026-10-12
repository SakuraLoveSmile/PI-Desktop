import {
  TEAM_ORDINARY_INBOX_CAPABILITY,
  type TeamOrdinaryInboxAckResult,
  type TeamOrdinaryInboxDelivery,
  type TeamOrdinaryInboxReadParams,
  type TeamOrdinaryInboxReadResult,
} from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";
import { isRecord } from "../agent-messages.js";
import { createHash } from "node:crypto";

export type OrdinaryInboxSummary = {
  updated: boolean;
  reason: "ordinary_inbox";
  count: number;
  messageIds: string[];
  pendingMessageSenders: string[];
  oldestPendingMessageAgeSeconds: number | null;
  ackPendingMessageIds: string[];
};

function unavailableMethod(error: unknown): boolean {
  return isRecord(error) && (error.code === -32601 || error.rpcCode === -32601);
}

/** Recognized transport loss leaves an ACK outstanding without granting admission. */
function lostAck(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (typeof error.errorCode === "string") return error.errorCode === "RPC_TIMEOUT";
  if (error.code === "ETIMEDOUT" ||
      error.code === "ECONNRESET" || error.code === "EPIPE") return true;
  return error instanceof Error && error.message === "parent host proxy timeout: team.ackOrdinaryInbox";
}

function validateDelivery(delivery: TeamOrdinaryInboxDelivery, params: TeamOrdinaryInboxReadParams): void {
  const message = delivery?.message;
  const origin = message?.sessionMessage;
  const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  if (!delivery || delivery.phase !== "persisted" || delivery.teamSessionId !== params.teamSessionId ||
      delivery.leadTurnId !== params.leadTurnId || !nonempty(delivery.scopeTurnId) || !nonempty(delivery.boundaryId) ||
      !nonempty(delivery.messageId) || !nonempty(delivery.userMessageId) || message?.id !== delivery.userMessageId ||
      message?.role !== "user" || message.steering === true || typeof message.content !== "string" || !origin ||
      origin.messageId !== delivery.messageId || origin.targetSessionId !== params.callerSessionId ||
      !nonempty(origin.sourceSessionId) || origin.sourceSessionId === params.callerSessionId ||
      !nonempty(origin.sourceTitle) || origin.kind !== "message" || message.attachments?.length) {
    throw new Error("TEAM_TURN_INVALID: ordinary inbox proof does not match the captured recipient and turn");
  }
}

/** Durable bodies travel only through this internal reader, never tool output. */
export class OrdinaryTeamInbox {
  private supported: boolean | undefined;
  private readonly admitted = new Map<string, string>();
  private readonly userMessageIds = new Map<string, string>();
  private readonly accepted = new Map<string, TeamOrdinaryInboxDelivery>();
  private owner?: { leadTurnId: string; epoch: number; team: object };

  constructor(private readonly host: RuntimeHost) {}

  async read(
    params: TeamOrdinaryInboxReadParams,
    owner: { epoch: number; team: object },
    assertCurrent: () => void,
    ingest: (messages: readonly TeamOrdinaryInboxDelivery[]) => void,
  ): Promise<OrdinaryInboxSummary | undefined> {
    assertCurrent();
    if (this.owner?.leadTurnId !== params.leadTurnId || this.owner.epoch !== owner.epoch || this.owner.team !== owner.team) {
      this.accepted.clear();
      this.owner = { leadTurnId: params.leadTurnId, ...owner };
    }
    if (this.supported === undefined) {
      try {
        const capability = await this.host.call<{ capability?: string } | null>("team.getOrdinaryInboxCapability");
        assertCurrent();
        this.supported = capability?.capability === TEAM_ORDINARY_INBOX_CAPABILITY;
      } catch (error) {
        assertCurrent();
        if (!unavailableMethod(error)) throw error;
        this.supported = false;
      }
    }
    if (!this.supported) return undefined;
    const inbox = await this.host.call<TeamOrdinaryInboxReadResult>("team.readOrdinaryInbox", params);
    assertCurrent();
    if (inbox?.capability !== TEAM_ORDINARY_INBOX_CAPABILITY || !Array.isArray(inbox.messages)) {
      throw new Error("TEAM_TURN_INVALID: ordinary inbox transport capability changed");
    }
    // A prior wait may have timed out after Host committed its ACK. Keep those
    // locally accepted bodies until this exact turn owns a new wait boundary.
    // The fresh read above and repeated ACK below still recheck Host authority.
    const candidates = [...this.accepted.values(), ...inbox.messages];
    const seen = new Map<string, string>();
    const userMessageIds = new Map<string, string>();
    for (const delivery of candidates) {
      validateDelivery(delivery, params);
      const identity = createHash("sha256").update(JSON.stringify(delivery.message)).digest("hex");
      if ((seen.has(delivery.messageId) && seen.get(delivery.messageId) !== identity) ||
          (this.admitted.has(delivery.messageId) && this.admitted.get(delivery.messageId) !== identity)) {
        throw new Error("TEAM_TURN_INVALID: ordinary inbox message identity changed");
      }
      const existingOwner = userMessageIds.get(delivery.userMessageId) ?? this.userMessageIds.get(delivery.userMessageId);
      if (existingOwner && existingOwner !== delivery.messageId) {
        throw new Error("TEAM_TURN_INVALID: ordinary inbox user message identity was reused");
      }
      seen.set(delivery.messageId, identity);
      userMessageIds.set(delivery.userMessageId, delivery.messageId);
    }
    const deliveries = candidates.filter((delivery, index, all) =>
      all.findIndex(other => other.messageId === delivery.messageId) === index);
    if (!deliveries.length) return undefined;
    for (const delivery of deliveries) {
      if (!this.admitted.has(delivery.messageId)) this.accepted.set(delivery.messageId, delivery);
    }
    const ackPendingMessageIds: string[] = [];
    const boundaries = new Map<string, TeamOrdinaryInboxDelivery[]>();
    for (const delivery of deliveries) {
      const group = boundaries.get(delivery.boundaryId) ?? [];
      group.push(delivery);
      boundaries.set(delivery.boundaryId, group);
    }
    // The verified buffer is accepted here; ACK is not proof of model consumption.
    // Do not expose it to pi's queue while an awaited ACK can invalidate ownership.
    for (const [boundaryId, messages] of boundaries) {
      assertCurrent();
      const messageIds = messages.map(message => message.messageId);
      try {
        const ack = await this.host.call<TeamOrdinaryInboxAckResult>("team.ackOrdinaryInbox", {
          ...params, boundaryId, messageIds,
        });
        assertCurrent();
        if (ack?.ok !== true || !Array.isArray(ack.acknowledgedIds) ||
            ack.acknowledgedIds.length !== messageIds.length ||
            !messageIds.every(id => ack.acknowledgedIds.includes(id))) {
          throw new Error("TEAM_TURN_INVALID: ordinary inbox ACK does not match its persisted boundary");
        }
      } catch (error) {
        assertCurrent();
        if (!lostAck(error)) throw error;
        ackPendingMessageIds.push(...messageIds);
      }
    }
    assertCurrent();
    if (ackPendingMessageIds.length) {
      // Even an ACK timeout can mean the request never reached the authority
      // check. Retain the whole FIFO batch; no buffered body is authorized by
      // transport loss. A later wait must obtain successful ACKs for every group.
      return { updated: false, reason: "ordinary_inbox", count: 0, messageIds: [],
        pendingMessageSenders: [], oldestPendingMessageAgeSeconds: null, ackPendingMessageIds };
    }
    const fresh = deliveries.filter(delivery => !this.admitted.has(delivery.messageId));
    ingest(fresh);
    for (const delivery of fresh) {
      this.admitted.set(delivery.messageId, seen.get(delivery.messageId)!);
      this.userMessageIds.set(delivery.userMessageId, delivery.messageId);
      this.accepted.delete(delivery.messageId);
    }
    if (!fresh.length && !ackPendingMessageIds.length) return undefined;
    // The UiMessage timestamp belongs to the new persistence proof. Queue age
    // must use the Host-owned original send time, never the read/commit time.
    const timestamps = fresh.map(delivery => {
      const sentAt = delivery.message.sessionMessage?.sentAt;
      return sentAt ? Date.parse(sentAt) : NaN;
    });
    return {
      updated: fresh.length > 0,
      reason: "ordinary_inbox",
      count: fresh.length,
      messageIds: fresh.map(delivery => delivery.messageId),
      pendingMessageSenders: [...new Set(fresh.map(delivery => delivery.message.sessionMessage!.sourceTitle))],
      oldestPendingMessageAgeSeconds: timestamps.length && timestamps.every(Number.isFinite)
        ? Math.max(0, Math.floor((Date.now() - Math.min(...timestamps)) / 1000)) : null,
      ackPendingMessageIds,
    };
  }
}
