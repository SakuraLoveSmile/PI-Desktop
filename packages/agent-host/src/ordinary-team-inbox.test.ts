import { describe, expect, it, vi } from "vitest";
import { TEAM_ORDINARY_INBOX_CAPABILITY, type TeamOrdinaryInboxReadResult } from "@pi-desktop/shared";
import { AgentHost } from "./agent-host.js";

const result: TeamOrdinaryInboxReadResult = {
  capability: TEAM_ORDINARY_INBOX_CAPABILITY,
  messages: [{ messageId: "report", userMessageId: "user-report", teamSessionId: "lead",
    leadTurnId: "live", scopeTurnId: "scope", boundaryId: "boundary", phase: "persisted",
    message: { id: "user-report", role: "user", content: "Expert report", createdAt: "2026-10-11T00:00:00Z" } }],
};

function fixture() {
  const prompt = vi.fn(async () => ({ turnId: "next" }));
  const host = new AgentHost({ runtime: { prompt, stop: async () => ({ requested: true }), abort: async () => {}, respondInput: async () => {} },
    sessions: { get: async () => null, history: async () => ({ items: [], hasMore: false }) },
    approvals: { resolveTool: async () => {}, resolveContract: async () => {}, listPendingTools: async () => [] } });
  host.ingest({ sessionId: "lead", turnId: "live", ts: 1, event: { type: "agent_start" } });
  const queue = async (messageId: string, priority?: number, key = `team-message:${messageId}`) => host.queue.push({
    id: `queue-${messageId}`, sessionId: "lead", principalSubject: "desktop", content: messageId,
    sessionMessageId: messageId, effectivePermissionMode: "ask", inputHash: messageId, idempotencyKey: key,
    createdAt: 1, ...(priority === undefined ? {} : { priority }),
  });
  return { host, prompt, queue };
}

describe("ordinary Team wait-boundary admission", () => {
  it("retires only committed Team mirrors, preserves other input and never starts another report turn", async () => {
    const { host, prompt, queue } = fixture();
    await queue("report");
    await queue("unrelated", undefined, "session-message:unrelated");
    expect(await host.readOrdinaryTeamInbox("lead", "live", async () => result)).toEqual(result);
    expect(host.queue.list("lead").map(entry => entry.sessionMessageId)).toEqual(["unrelated"]);
    await host.readOrdinaryTeamInbox("lead", "live", async () => result);
    expect(host.getTurn("queue-report").status).toBe("canceled");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("defers to promoted human input and refuses held or stale turns before Host persistence", async () => {
    const { host, queue } = fixture();
    const read = vi.fn(async () => result);
    await queue("human", 1, "session-message:human");
    expect(await host.readOrdinaryTeamInbox("lead", "live", read)).toBeNull();
    host.queue.retirePersisted("lead", "queue-human");
    host.queue.hold("lead", "team:lead");
    expect(await host.readOrdinaryTeamInbox("lead", "live", read)).toBeNull();
    host.queue.resume("lead", "team:lead");
    expect(await host.readOrdinaryTeamInbox("lead", "old", read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("clears committed mirrors even when the original turn was replaced during persistence", async () => {
    const { host, queue, prompt } = fixture();
    await queue("report");
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = host.readOrdinaryTeamInbox("lead", "live", async () => { entered(); await gate; return result; });
    await started;
    host.ingest({ sessionId: "lead", turnId: "replacement", ts: 2, event: { type: "agent_start" } });
    release();
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    expect(host.queue.size("lead")).toBe(0);
    expect(host.getTurn("replacement").status).toBe("running");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("serializes mailbox reads without changing report identity", async () => {
    const { host, queue } = fixture();
    await queue("report");
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = host.readOrdinaryTeamInbox("lead", "live", async () => { order.push(1); await gate; order.push(2); return result; });
    const second = host.readOrdinaryTeamInbox("lead", "live", async () => { order.push(3); return result; });
    release();
    const reads = await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    expect(reads[0]?.messages[0].userMessageId).toBe(reads[1]?.messages[0].userMessageId);
    expect(host.queue.size("lead")).toBe(0);
  });
});
