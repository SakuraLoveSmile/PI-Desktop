import { describe, expect, it, vi } from "vitest";
import { declarationPayload, execution, rosterResumeFixture } from "./runtime-team-roster-resume-fixture.js";

async function waitForParked(f: ReturnType<typeof rosterResumeFixture>) {
  await vi.waitFor(() => expect(f.host.call.mock.calls.filter(([method]) => method === "team.getLeadExecutionState").length).toBeGreaterThanOrEqual(2));
  expect(f.requests).toHaveLength(2);
  expect(f.runtime.getStatus().isRunning).toBe(true);
  expect(f.events.filter(event => event.type === "agent_end")).toHaveLength(0);
}

function assertSingleDispatch(f: ReturnType<typeof rosterResumeFixture>) {
  expect(f.host.call.mock.calls.filter(([method]) => method === "team.createTask")).toHaveLength(1);
  expect(f.host.call.mock.calls.filter(([method]) => method === "team.sendMessage")).toHaveLength(1);
  expect(f.host.call).toHaveBeenCalledWith("team.createTask", expect.objectContaining({ ownerMemberName: "researcher" }));
  expect(f.host.call).toHaveBeenCalledWith("team.sendMessage", expect.objectContaining({ target: "researcher", taskDispatch: { taskId: "research-task", expectedRevision: 1 } }));
  expect(f.areResultsConsumed()).toBe(true);
}

describe("DesktopAgentRuntime weak-model roster resume", () => {
  it("R1 resumes the same approved Goal from a confirmed declaration while retaining pending UI evidence", async () => {
    const f = rosterResumeFixture();
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      const original = f.getMessages().find(message => message.role === "toolResult" && message.toolName === "declare_team_strategy");
      const pendingUi = structuredClone(f.events.filter(event => event.type === "tool_end"));
      f.changeReview("confirmed");
      await expect(running).resolves.toEqual({ turnId: "team-turn" });
      const resumed = f.requests.slice(2);
      expect(resumed.length).toBeGreaterThanOrEqual(3);
      expect(resumed.map(request => declarationPayload(request)?.awaitingUserApproval)).toEqual(resumed.map(() => false));
      for (const request of resumed) {
        expect(declarationPayload(request)).toMatchObject({ reviewId: "review-1", status: "confirmed", awaitingUserApproval: false });
        expect(declarationPayload(request)?.memberSessionIds).toBeUndefined();
        expect(declarationPayload(request)?.nextStep).toEqual(expect.stringContaining("The user confirmed the execution roster"));
      }
      expect(declarationPayload(resumed[0])?.members).toEqual([{ name: "researcher", modelId: "approved-model", providerId: "local" }]);
      expect(declarationPayload(resumed[0])?.memberSessionIds).toBeUndefined();
      assertSingleDispatch(f);
      expect(f.requests.every(request => request.turnId === "team-turn")).toBe(true);
      expect(f.host.call).toHaveBeenCalledWith("goalProgress.issueToken", { sessionId: "session-1", executionId: execution.id, turnId: "team-turn" });
      expect(f.host.call.mock.calls.filter(([method]) => method === "goalProgress.issueToken")).toHaveLength(1);
      expect(f.host.call).toHaveBeenCalledWith("goalReports.submitDraft", expect.objectContaining({ executionId: execution.id,
        draft: expect.objectContaining({ verdict: "met" }) }));
      expect(f.events.some(event => event.type === "error")).toBe(false);
      expect(f.events.some(event => event.type === "message_end" && event.message.status === "aborted")).toBe(false);
      expect(f.events.filter(event => event.type === "agent_end")).toHaveLength(1);
      expect(f.runtime.getStatus().isRunning).toBe(false);
      expect(original?.role === "toolResult" ? original.content : []).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('"awaitingUserApproval":true') })]));
      expect(f.events.filter(event => event.type === "tool_end").slice(0, pendingUi.length)).toEqual(pendingUi);
      expect(pendingUi).toEqual([expect.objectContaining({ type: "tool_end", result: expect.objectContaining({
        details: expect.objectContaining({ review: expect.objectContaining({ reviewId: "review-1", status: "pending" }) }),
      }) })]);
      const live = f.getLiveMessages().find(message => message.role === "toolResult" && message.toolName === "declare_team_strategy");
      expect(live?.role === "toolResult" ? live.content : []).toEqual(original?.role === "toolResult" ? original.content : []);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["cancelled", "interrupted"] as const)("R3 %s during parking does not rewrite or dispatch and exposes interruption", async status => {
    const f = rosterResumeFixture();
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview(status);
      await running;
      expect(f.requests).toHaveLength(2);
      expect(f.host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
      const declaration = f.getMessages().find(message => message.role === "toolResult" && message.toolName === "declare_team_strategy");
      expect(declaration?.role === "toolResult" ? declaration.content : []).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('"awaitingUserApproval":true') })]));
      expect(f.events.some(event => event.type === "error" && event.error.code === "TURN_ABORTED")).toBe(true);
    } finally { await f.runtime.dispose(); }
  });

  it("R4 Stop while parked does not call the model again after late confirmation", async () => {
    const f = rosterResumeFixture();
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      expect(f.runtime.requestGracefulStop().requested).toBe(true);
      await running;
      f.changeReview("confirmed");
      expect(f.requests).toHaveLength(2);
      expect(f.host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
      expect(f.runtime.getStatus().isRunning).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it("R5 confirmation between Host reads rewrites once and dispatches once", async () => {
    const f = rosterResumeFixture({ confirmationBetweenReads: true });
    try {
      await f.runtime.executeApprovedPlan(execution, "team-turn");
      const resumed = f.requests.slice(2);
      expect(resumed.length).toBeGreaterThanOrEqual(3);
      expect(declarationPayload(resumed[0])?.status).toBe("confirmed");
      expect(resumed.every(request => declarationPayload(request)?.awaitingUserApproval === false)).toBe(true);
      assertSingleDispatch(f);
      expect(f.events.some(event => event.type === "error")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it("R4 Stop during the confirmed review read ignores its late response", async () => {
    const f = rosterResumeFixture({ holdRecoveryReview: true });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed");
      await vi.waitFor(() => expect(f.isReviewReadHeld()).toBe(true));
      expect(f.runtime.requestGracefulStop().requested).toBe(true);
      await running;
      f.releaseReviewRead();
      await Promise.resolve();
      expect(f.requests).toHaveLength(2);
      expect(f.host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
      const declaration = f.getMessages().find(message => message.role === "toolResult" && message.toolName === "declare_team_strategy");
      expect(declaration?.role === "toolResult" ? declaration.content : []).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('"awaitingUserApproval":true') })]));
    } finally { f.releaseReviewRead(); await f.runtime.dispose(); }
  });

  it.each(["cancelled", "interrupted"] as const)("R3 %s during the fresh confirmation read cannot resume the model", async status => {
    const f = rosterResumeFixture({ holdRecoveryReview: true });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed");
      await vi.waitFor(() => expect(f.isReviewReadHeld()).toBe(true));
      f.changeReview(status);
      f.releaseReviewRead();
      await running;
      expect(f.requests).toHaveLength(2);
      expect(f.host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
      expect(f.events.some(event => event.type === "error" && event.error.code === "TURN_ABORTED")).toBe(true);
    } finally { f.releaseReviewRead(); await f.runtime.dispose(); }
  });

  it("R6 unmatched Goal declaration retains three completion retries then blocks", async () => {
    const f = rosterResumeFixture({ declarationReviewId: "legacy-review" });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed");
      await running;
      expect(f.requests.slice(2)).toHaveLength(4);
      expect(f.requests.slice(2).every(request => declarationPayload(request)?.status === "pending")).toBe(true);
      expect(f.events.some(event => event.type === "error")).toBe(false);
      expect(f.events.filter(event => event.type === "agent_end")).toEqual([
        expect.objectContaining({ stopHint: "team_unsettled" }),
      ]);
      expect(f.host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it("keeps every actual recovery/retry request confirmed in the same execution", async () => {
    const f = rosterResumeFixture({ retryAfterRecovery: true });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed");
      await running;
      const resumed = f.requests.slice(2);
      expect(resumed.length).toBeGreaterThanOrEqual(6);
      expect(resumed.every(request => declarationPayload(request)?.awaitingUserApproval === false)).toBe(true);
      expect(resumed.every(request => request.turnId === "team-turn")).toBe(true);
      assertSingleDispatch(f);
    } finally { await f.runtime.dispose(); }
  }, 15_000);

  it("keeps a complete confirmed call/result batch after real runtime compaction without persisting it", async () => {
    const f = rosterResumeFixture({ compactAfterRecovery: true });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed");
      await running;
      expect(f.host.call.mock.calls.some(([method]) => method === "session.appendCompaction")).toBe(true);
      expect(f.getLiveMessages().some(message => message.role === "toolResult" && message.toolName === "declare_team_strategy")).toBe(false);
      const resumed = f.requests.slice(2);
      expect(resumed.length).toBeGreaterThanOrEqual(3);
      expect(resumed.every(request => declarationPayload(request)?.awaitingUserApproval === false)).toBe(true);
      for (const request of resumed) {
        const declaration = request.context.messages.find(message => message.role === "toolResult" && message.toolName === "declare_team_strategy");
        expect(request.context.messages.some(message => message.role === "assistant" && message.content.some(block =>
          block.type === "toolCall" && declaration?.role === "toolResult" && block.id === declaration.toolCallId))).toBe(true);
      }
      const durable = f.getEntries().filter(entry => entry.message.role === "toolResult" && entry.message.toolName === "declare_team_strategy");
      expect(durable).toHaveLength(1);
      expect(durable[0].message).toMatchObject({ details: { review: { status: "pending" } } });
      const compactions = f.host.call.mock.calls.filter(([method]) => method === "session.appendCompaction");
      expect(compactions.every(([, params]) => !JSON.stringify(params).includes('"awaitingUserApproval":false'))).toBe(true);
      assertSingleDispatch(f);
    } finally { await f.runtime.dispose(); }
  });

  it("registers from the execution's original entries when declaration was compacted before confirmation", async () => {
    const f = rosterResumeFixture({ compactBeforeRecovery: true });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      expect(declarationPayload(f.requests[1])).toBeUndefined();
      expect(f.getLiveMessages().some(message => message.role === "toolResult" && message.toolName === "declare_team_strategy")).toBe(false);
      f.changeReview("confirmed"); await running;
      expect(f.requests.slice(2).every(request => declarationPayload(request)?.awaitingUserApproval === false)).toBe(true);
      assertSingleDispatch(f);
      const declaration = f.getEntries().find(entry => entry.message.role === "toolResult" && entry.message.toolName === "declare_team_strategy");
      expect(declaration?.message).toMatchObject({ details: { review: { status: "pending" } } });
    } finally { await f.runtime.dispose(); }
  });

  it("leaves complete persisted entries identical to the original single-request A-prime replay", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    const baseline = rosterResumeFixture({ legacySingleRequestView: true });
    const candidate = rosterResumeFixture();
    try {
      for (const f of [baseline, candidate]) {
        vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
        const running = f.runtime.executeApprovedPlan(execution, "team-turn");
        await waitForParked(f);
        f.changeReview("confirmed");
        await running;
      }
      expect(baseline.requests.slice(2).map(request => declarationPayload(request)?.awaitingUserApproval)).toEqual([false, true, true, true, true]);
      expect(candidate.requests.slice(2).map(request => declarationPayload(request)?.awaitingUserApproval)).toEqual([false, false, false, false, false]);
      // Fresh runtimes allocate different physical request IDs/timestamps.
      // Compare all persisted message fields and sequence/parent topology
      // after normalizing only those observational identities.
      const entries = (f: ReturnType<typeof rosterResumeFixture>) => {
        const rows = f.getEntries();
        return rows.map(entry => ({ type: entry.type, seq: entry.seq,
          message: JSON.parse(JSON.stringify(entry.message, (key, value: unknown) =>
            key === "operationId" ? "physical-request-id" : key === "timestamp" ? 0 : value)) as unknown,
          parentIndex: rows.findIndex(previous => previous.id === entry.parentId) }));
      };
      expect(entries(candidate)).toEqual(entries(baseline));
    } finally {
      await baseline.runtime.dispose(); await candidate.runtime.dispose(); vi.useRealTimers();
    }
  });

  it("does not reuse confirmation in an ordinary turn or a second approved execution", async () => {
    const f = rosterResumeFixture();
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed"); await running;
      const beforeOrdinary = f.requests.length;
      await f.runtime.prompt("An ordinary follow-up");
      expect(f.requests.slice(beforeOrdinary).every(request => declarationPayload(request)?.awaitingUserApproval === true)).toBe(true);
      const beforeSecond = f.requests.length;
      await f.runtime.executeApprovedPlan({ ...execution, id: "approved-goal-2" }, "second-turn");
      expect(f.requests.length).toBeGreaterThan(beforeSecond);
      expect(f.requests.slice(beforeSecond).every(request => declarationPayload(request) === undefined)).toBe(true);
    } finally { await f.runtime.dispose(); }
  });

  it("Stop after registration revokes the view before an ordinary follow-up", async () => {
    const f = rosterResumeFixture({ holdAfterRecovery: true });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f); f.changeReview("confirmed");
      await vi.waitFor(() => expect(f.requests).toHaveLength(4));
      f.runtime.abort(); await running;
      expect(f.runtime.getStatus().isRunning).toBe(false);
      const stoppedAt = f.requests.length;
      await f.runtime.prompt("Follow up after Stop");
      expect(f.requests.length).toBeGreaterThan(stoppedAt);
      expect(f.requests.slice(stoppedAt).every(request => declarationPayload(request)?.awaitingUserApproval === true)).toBe(true);
    } finally { await f.runtime.dispose(); }
  });
});
