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
      const resumed = f.requests.slice(2).filter(request => declarationPayload(request));
      expect(resumed).toHaveLength(1);
      expect(declarationPayload(resumed[0])).toMatchObject({ reviewId: "review-1", status: "confirmed", awaitingUserApproval: false });
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
      const resumed = f.requests.slice(2).filter(request => declarationPayload(request));
      expect(resumed).toHaveLength(1);
      expect(declarationPayload(resumed[0])?.status).toBe("confirmed");
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

  it("R6 unmatched declaration retains the existing three completion retries", async () => {
    const f = rosterResumeFixture({ declarationReviewId: "legacy-review" });
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await waitForParked(f);
      f.changeReview("confirmed");
      await running;
      expect(f.requests.slice(2)).toHaveLength(4);
      expect(f.requests.slice(2).every(request => declarationPayload(request)?.status === "pending")).toBe(true);
      expect(f.events.some(event => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
      expect(f.host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });
});
