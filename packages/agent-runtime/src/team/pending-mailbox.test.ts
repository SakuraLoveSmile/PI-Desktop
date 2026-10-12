import { describe, expect, it, vi } from "vitest";
import type { TeamMessageRecord } from "@pi-desktop/shared";
import { readPendingMailbox, summarizePendingMailbox } from "./pending-mailbox.js";

const now = 1_800_000_000_000;
function message(id: string, changes: Partial<TeamMessageRecord> = {}): TeamMessageRecord {
  return { id, teamSessionId: "lead", sourceSessionId: "expert-session", sourceMemberName: "expert", targetSessionId: "lead",
    targetMemberName: "Lead", content: "PRIVATE_REPORT", status: "queued", deliveryStatus: "acknowledged", turnId: null,
    createdAt: String(now - 229_999), updatedAt: String(now), ...changes };
}

describe("pending mailbox metadata", () => {
  it("counts only queued unbound inbound messages, including ACKed receipts", () => {
    const messages = [message("pending"), message("unacked", { deliveryStatus: "queued" }),
      message("outgoing", { sourceSessionId: "lead", targetSessionId: "expert-session" }),
      message("other-target", { targetSessionId: "other" }), message("self", { sourceSessionId: "lead" }),
      message("running", { status: "running" }), message("complete", { status: "completed" }), message("bound", { turnId: "old-turn" })];
    const summary = summarizePendingMailbox(messages, "lead", now);
    expect(summary).toEqual({ pendingMessagesCount: 2, pendingMessageSenders: ["expert"], oldestPendingMessageAgeSeconds: 229 });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_REPORT");
    expect(messages[0].status).toBe("queued");
  });

  it("orders by milliseconds then id and stably deduplicates Host member names", () => {
    const messages = [message("z", { sourceMemberName: "Z", createdAt: String(now - 1000) }),
      message("b", { sourceMemberName: "B", createdAt: String(now - 5000) }),
      message("a", { sourceMemberName: "A", createdAt: String(now - 5000) }),
      message("dup", { sourceMemberName: "A", createdAt: "bad" })];
    expect(summarizePendingMailbox(messages, "lead", now)).toEqual({ pendingMessagesCount: 4,
      pendingMessageSenders: ["A", "B", "Z"], oldestPendingMessageAgeSeconds: null });
    expect(messages.map(item => item.id)).toEqual(["z", "b", "a", "dup"]);
  });

  it.each(["bad", "", "2026-10-11T00:00:00Z", "Infinity", "-1"])("keeps unknown ages null for %s", createdAt => {
    expect(summarizePendingMailbox([message("unknown", { createdAt })], "lead", now).oldestPendingMessageAgeSeconds).toBeNull();
  });

  it("keeps mixed unknown/valid ages unknown and clamps fully dated future age to zero", () => {
    expect(summarizePendingMailbox([message("unknown", { createdAt: "bad" }), message("valid", { createdAt: String(now - 5100) })], "lead", now).oldestPendingMessageAgeSeconds).toBeNull();
    expect(summarizePendingMailbox([message("valid", { createdAt: String(now - 5100) })], "lead", now).oldestPendingMessageAgeSeconds).toBe(5);
    expect(summarizePendingMailbox([message("future", { createdAt: String(now + 100000) })], "lead", now).oldestPendingMessageAgeSeconds).toBe(0);
    expect(summarizePendingMailbox([], "lead", now)).toEqual({ pendingMessagesCount: 0, pendingMessageSenders: [], oldestPendingMessageAgeSeconds: null });
  });

  it("reads the participant-scoped mailbox once and samples the query clock once", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const call = vi.fn(async (_method: string, _params?: unknown) => ({ messages: [message("report")] }));
    const host = { async call<T>(method: string, params?: unknown): Promise<T> { return await call(method, params) as T; } };
    try {
      expect(await readPendingMailbox(host, "lead", "lead")).toEqual({ count: 1,
        summary: { pendingMessagesCount: 1, pendingMessageSenders: ["expert"], oldestPendingMessageAgeSeconds: 229 } });
      expect(call).toHaveBeenCalledExactlyOnceWith("team.listMessages", { teamSessionId: "lead", callerSessionId: "lead", sessionId: "lead" });
      expect(clock).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  });
});
