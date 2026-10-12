import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import type { ConfirmedDeclarationModelView } from "../team/confirmed-declaration-model-view.js";
import type { TeamLeadExecutionGuard } from "../team/lead-execution-guard.js";
import { assistantMessage } from "./runtime-test-harness.js";
import { declarationPayload, execution, rosterResumeFixture } from "./runtime-team-roster-resume-fixture.js";

type StopOrder = "user" | "budget-user" | "user-budget" | "budget-read";

function interactionFixture(recovery: "goal" | "team", order: StopOrder = "user") {
  const f = rosterResumeFixture();
  const view = f.runtime as unknown as {
    agent: Agent; models: Pick<Models, "streamSimple">; turnId: string;
    autonomousExecution: boolean; goalReportRecovery: { pending: boolean };
    teamLeadExecution: TeamLeadExecutionGuard;
    resetRunRecoveryState: () => void;
    onEvent: (envelope: AgentEventEnvelope) => void;
    confirmedDeclarationView: ConfirmedDeclarationModelView;
  };
  const register = vi.spyOn(view.confirmedDeclarationView, "register");
  const clear = vi.spyOn(view.confirmedDeclarationView, "clear");
  const recover = vi.spyOn(view.teamLeadExecution, "recover");
  const reset = vi.spyOn(view, "resetRunRecoveryState");
  let step = 0;
  let stopped = false;
  let ordinary = false;
  let reviewStatus: "pending" | "confirmed" = "pending";
  let executionReads = 0;
  let resolvePark!: () => void;
  let parked = new Promise<void>(resolve => { resolvePark = resolve; });
  let requestsAtStop = 0;
  let registrationsAtStop = 0;
  let clearsAtStop = 0;
  let eventsAtStop = 0;
  let resetsAtStop = 0;
  let recoveryWindowObserved = false;
  let resolveFreshReviewRead!: () => void;
  const freshReviewRead = new Promise<void>(resolve => { resolveFreshReviewRead = resolve; });
  let releaseFreshReviewRead!: () => void;
  const heldFreshReviewRead = new Promise<void>(resolve => { releaseFreshReviewRead = resolve; });

  const recordStop = () => {
    stopped = true;
    requestsAtStop = f.requests.length;
    registrationsAtStop = register.mock.calls.length;
    clearsAtStop = clear.mock.calls.length;
    eventsAtStop = f.events.length;
    resetsAtStop = reset.mock.calls.length;
    expect(registrationsAtStop).toBeGreaterThan(0);
    expect(declarationPayload(f.requests.at(-1)!)?.status).toBe("confirmed");
    expect(f.events.filter(event => event.type === "agent_end")).toEqual([]);
  };
  const stop = () => {
    recordStop();
    if (order === "budget-user") expect(f.runtime.requestGracefulStop(true).requested).toBe(true);
    void f.runtime.abort();
    if (order === "user-budget") expect(f.runtime.requestGracefulStop(true).requested).toBe(true);
  };

  const hostCall = f.host.call.getMockImplementation()!;
  f.host.call.mockImplementation(async (method, params) => {
    const hostReviewStatus = reviewStatus;
    // This is the fresh review read inside guard.recover(), after pending was
    // consumed, not an active provider stream. Stop aborts that owned Host
    // read; the guard's abort callback then resets recovery and registration.
    if (recovery === "team" && !stopped && f.requests.length === 3 &&
        method === "team.getLaunchReview" && recover.mock.calls.length === 2 && !view.teamLeadExecution.pending) {
      if (order === "user") {
        recoveryWindowObserved = true;
        stop();
      } else if (order === "budget-read") {
        recoveryWindowObserved = true;
        resolveFreshReviewRead();
        await heldFreshReviewRead;
      }
    }
    const result = await hostCall(method, params);
    if (method === "team.getLeadExecutionState") {
      executionReads += 1;
      return { active: true, turnId: view.turnId, reviewStatus: hostReviewStatus };
    }
    if (method === "team.getBoard" && result?.revision !== undefined && result.tasks) {
      return { ...result, revision: hostReviewStatus === "pending" ? 2 : 3 };
    }
    if (result && "review" in result && result.review) {
      return { ...result, review: { ...result.review, leadTurnId: view.turnId } };
    }
    if (method === "team.readExecutionInbox" && result?.turnId && result.messages) {
      return { ...result, turnId: view.turnId };
    }
    return result;
  });
  const subscribe = f.host.onNotification.getMockImplementation()!;
  f.host.onNotification.mockImplementation(listener => {
    const unsubscribe = subscribe(listener);
    // A review wait subscribes before its baseline. Confirm only once that
    // real park listener exists, so no timer or polling selects the window.
    if (reviewStatus === "pending" && executionReads >= 2) resolvePark();
    return unsubscribe;
  });
  const onEvent = view.onEvent;
  view.onEvent = envelope => {
    onEvent(envelope);
    if (recovery === "team" && (order === "budget-user" || order === "user-budget") && !stopped &&
        recover.mock.calls.length === 2 && envelope.event.type === "status" &&
        envelope.event.status.activity?.phase === "recovering") {
      recoveryWindowObserved = true;
      stop();
    }
  };

  view.models = { streamSimple: (_model, context) => {
    if (stopped) throw new Error("Stop must fence subsequent recovery requests");
    f.requests.push({ turnId: view.turnId, context: structuredClone(context) });
    step += 1;
    let tool: { name: string; arguments: Record<string, unknown> } | undefined;
    if (!ordinary) {
      if (step === 1) tool = { name: "declare_team_strategy", arguments: {
        strategy: "delegate", reason: "Required experts", members: [{ name: "researcher" }],
      } };
      else if (recovery === "goal" && step === 3) tool = { name: "task_create", arguments: {
        subject: "Implement approved task", ownerMemberName: "researcher",
      } };
      else if (recovery === "goal" && step === 4) tool = { name: "send_message", arguments: {
        targetMemberName: "researcher", content: "Complete research-task and return the result.",
        taskDispatch: { taskId: "research-task", expectedRevision: 1 },
      } };
      else if (recovery === "goal" && step === 5) tool = { name: "wait_for_updates", arguments: { timeoutSeconds: 1 } };
    }
    const reason = tool ? "toolUse" : "stop";
    const message = assistantMessage({ stopReason: reason, content: tool
      ? [{ type: "toolCall", id: `interaction-${f.requests.length}`, ...tool }]
      : [{ type: "text", text: step === 2 && !ordinary
        ? "The proposed expert is researcher. Please confirm the roster."
        : "The approved experts completed the work." }],
    }) as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason, message });
      stream.end(message);
    });
    return stream;
  } };
  const idle = view.agent.waitForIdle.bind(view.agent);
  vi.spyOn(view.agent, "waitForIdle").mockImplementation(async () => {
    await idle();
    if (recovery === "goal" && !ordinary && !stopped && view.goalReportRecovery.pending) {
      expect(f.areResultsConsumed()).toBe(true);
      recoveryWindowObserved = true;
      stop();
    }
  });

  return { ...f, view, register, clear,
    parked: () => parked,
    freshReviewRead: () => freshReviewRead,
    releaseFreshReviewRead,
    recordBudgetStop: recordStop,
    confirm: () => { reviewStatus = "confirmed"; f.changeReview("confirmed"); },
    nextOrdinary: () => { stopped = false; ordinary = true; step = 0; },
    nextExecution: () => {
      stopped = false; ordinary = false; step = 0; executionReads = 0; reviewStatus = "pending";
      parked = new Promise<void>(resolve => { resolvePark = resolve; });
      f.events.length = 0;
    },
    assertStopped: () => {
      expect(recoveryWindowObserved).toBe(true);
      expect(f.events.slice(eventsAtStop).filter(event => event.type === "turn_end" || event.type === "agent_end").map(event => event.type))
        .toEqual(["turn_end", "agent_end"]);
      expect(f.events.filter(event => event.type === "message_end").at(-1)).toMatchObject({ message: { status: "aborted" } });
      expect(f.requests).toHaveLength(requestsAtStop);
      expect(register).toHaveBeenCalledTimes(registrationsAtStop);
      expect(clear.mock.calls.length).toBeGreaterThan(clearsAtStop);
      expect(reset.mock.calls.length).toBeGreaterThan(resetsAtStop);
      expect((view.confirmedDeclarationView as unknown as { confirmation?: unknown }).confirmation).toBeUndefined();
      expect(view.autonomousExecution).toBe(false);
      expect(f.runtime.getStatus().isRunning).toBe(false);
    },
  };
}

async function confirmParked(f: ReturnType<typeof interactionFixture>) {
  await f.parked();
  expect(f.requests).toHaveLength(2);
  expect(f.runtime.getStatus().isRunning).toBe(true);
  expect(f.events.some(event => event.type === "agent_end")).toBe(false);
  f.confirm();
}

describe("parked roster, confirmed declaration and stopped recovery integration", () => {
  it("I1 closes the armed Goal report recovery once and clears its registered declaration", async () => {
    const f = interactionFixture("goal");
    try {
      const running = f.runtime.executeApprovedPlan(execution, "team-turn");
      await confirmParked(f);
      await expect(running).resolves.toEqual({ turnId: "team-turn" });
      f.assertStopped();
    } finally { await f.runtime.dispose(); }
  });

  it("I2 closes the prepared Team recovery after its abort callback resets registration", async () => {
    const f = interactionFixture("team");
    try {
      const running = f.runtime.executeApprovedPlan(execution, "team-turn");
      await confirmParked(f);
      await expect(running).resolves.toEqual({ turnId: "team-turn" });
      f.assertStopped();
    } finally { await f.runtime.dispose(); }
  });

  it("I3 fences the ordinary follow-up and registers a fresh approved execution in the same session", async () => {
    const f = interactionFixture("goal");
    try {
      const first = f.runtime.executeApprovedPlan(execution, "team-turn");
      await confirmParked(f); await first; f.assertStopped();
      const ordinaryStart = f.requests.length;
      f.nextOrdinary();
      await f.runtime.prompt("Follow up after Stop", "user", "ordinary-turn");
      const ordinary = f.requests.slice(ordinaryStart);
      expect(ordinary.length).toBeGreaterThan(0);
      expect(ordinary.every(request => declarationPayload(request)?.status !== "confirmed")).toBe(true);
      const nextStart = f.requests.length;
      const registrationsBefore = f.register.mock.calls.length;
      f.nextExecution();
      const second = f.runtime.executeApprovedPlan({ ...execution, id: "approved-goal-2" }, "second-team-turn");
      await f.parked(); f.confirm();
      await expect(second).resolves.toEqual({ turnId: "second-team-turn" });
      const next = f.requests.slice(nextStart);
      expect(next.slice(0, 2).every(request => declarationPayload(request)?.status !== "confirmed")).toBe(true);
      expect(next.slice(2).length).toBeGreaterThan(0);
      expect(next.slice(2).every(request => declarationPayload(request)?.status === "confirmed")).toBe(true);
      expect(f.register.mock.calls.length).toBeGreaterThan(registrationsBefore);
      expect(f.register.mock.calls.at(-1)?.[0].leadTurnId).toBe("second-team-turn");
      f.assertStopped();
    } finally { await f.runtime.dispose(); }
  });

  it.each(["budget-user", "user-budget"] as const)("I4 settles the parked-path budget once with budget precedence (%s)", async order => {
    const f = interactionFixture("team", order);
    try {
      const running = f.runtime.executeApprovedPlan(execution, "team-turn");
      await confirmParked(f);
      await expect(running).resolves.toEqual({ turnId: "team-turn" });
      f.assertStopped();
      expect(f.events.filter(event => event.type === "error")).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ code: "TURN_ABORTED", message: "Team paused at its hard run limit." }) }),
      ]);
    } finally { await f.runtime.dispose(); }
  });

  it("I4 accepts and settles a budget-only stop during the fresh recovery review read", async () => {
    const f = interactionFixture("team", "budget-read");
    const running = f.runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await confirmParked(f);
      await f.freshReviewRead();
      f.recordBudgetStop();
      // Keep the admission assertion outside the Host callback: a rejected
      // request is the product failure, not a provider error to classify.
      expect(f.runtime.requestGracefulStop(true).requested).toBe(true);
      f.releaseFreshReviewRead();
      await expect(running).resolves.toEqual({ turnId: "team-turn" });
      f.assertStopped();
      expect(f.events.filter(event => event.type === "error")).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ code: "TURN_ABORTED", message: "Team paused at its hard run limit." }) }),
      ]);
    } finally {
      f.releaseFreshReviewRead();
      await f.runtime.abort();
      await running;
      await f.runtime.dispose();
    }
  });
});
