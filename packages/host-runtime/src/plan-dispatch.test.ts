import { describe, expect, it, vi } from "vitest";
import type { PlanExecution } from "@pi-desktop/shared";
import type { LaunchResolver } from "./launch-resolver.js";
import { PlanExecutionDispatcher } from "./plan-dispatch.js";
import { RuntimeService, type RuntimeHostLink, type RuntimeSidecarLink } from "./runtime-service.js";

const execution: PlanExecution = {
  id: "execution", proposalId: "proposal", sessionId: "lead", kind: "plan",
  state: "queued", plan: "# Plan", title: "Plan", question: "Proceed?",
  targetPermissionMode: "ask",
  artifact: { relativePath: ".pi/plan/proposal.md", sha256: "hash", sizeBytes: 6, workspaceKind: "project" },
};

function fixture(failBinding = false, kind: "plan" | "goal" = "plan") {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let notification: ((method: string, params: unknown) => void) | undefined;
  const host: RuntimeHostLink = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params });
      switch (method) {
        case "plans.claimExecution": return { execution: { ...execution, kind, state: "running" } } as T;
        case "settings.get": return {} as T;
        case "session.get": return { session: { id: "lead", mode: "agent", executionProfile: "team" } } as T;
        case "session.beginTurn": return { turnId: "approved-turn" } as T;
        case "plans.bindExecutionTurn":
        case "goalReports.bindExecutionTurn":
          if (failBinding) throw Object.assign(new Error("stale execution"), { errorCode: "PLAN_EXECUTION_STALE" });
          return { ok: true } as T;
        case "session.endTurn":
        case "plans.finishExecution":
        case "goalExecutions.settle": return { ok: true } as T;
        default: throw new Error(`unexpected host method ${method}`);
      }
    },
    isAvailable: () => true, onNotification: () => () => {}, onExit: () => () => {},
  };
  const sidecar: RuntimeSidecarLink = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params });
      if (method === "agent.stop") return { requested: true } as T;
      if (method !== "agent.executeApprovedPlan") throw new Error(`unexpected sidecar method ${method}`);
      return { accepted: true } as T;
    },
    onNotification: (listener) => { notification = listener; return () => {}; }, onExit: () => () => {},
    setProjectInstructionRoot: () => {}, clearProjectInstructionRoot: () => {}, clearVendorAuthBindings: () => {},
  };
  const launch: LaunchResolver = {
    async resolve(sessionId) {
      return { providerId: "fixture", modelId: "fixture", sidecarParams: {
        sessionId, mode: "agent", provider: { id: "fixture", name: "Fixture", modelId: "fixture" },
      } };
    },
  };
  const service = new RuntimeService({ getHost: () => host, getSidecar: () => sidecar, launch, log: () => {} });
  service.attachSidecar(sidecar);
  const dispatcher = new PlanExecutionDispatcher({ getHost: () => host, getSidecar: () => sidecar,
    runtime: service, launch, log: () => {} });
  return { calls, host, sidecar, service, dispatcher, notify: (params: unknown) => notification?.("agent.event", params) };
}

describe("approved Plan dispatch turn binding", () => {
  it.each(["plan", "goal"] as const)("binds the original Host %s turn before the sidecar starts execution", async (kind) => {
    const f = fixture(false, kind);
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind });
      const methods = f.calls.map((call) => call.method);
      const binding = kind === "plan" ? "plans.bindExecutionTurn" : "goalReports.bindExecutionTurn";
      expect(methods.indexOf("session.beginTurn")).toBeLessThan(methods.indexOf(binding));
      expect(methods.indexOf(binding)).toBeLessThan(methods.indexOf("agent.executeApprovedPlan"));
      expect(f.calls.find((call) => call.method === binding)?.params)
        .toEqual({ executionId: "execution", ...(kind === "plan" ? { sessionId: "lead" } : {}), turnId: "approved-turn" });
      expect(f.service.activeTurnId("lead")).toBe("approved-turn");
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });

  it.each(["plan", "goal"] as const)("interrupts the owned Host %s turn and execution when binding fails without launching the model", async (kind) => {
    const f = fixture(true, kind);
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind });
      expect(f.calls.some((call) => call.method === "agent.executeApprovedPlan")).toBe(false);
      expect(f.service.activeTurnId("lead")).toBeUndefined();
      expect(f.calls.find((call) => call.method === "session.endTurn")?.params)
        .toMatchObject({ turnId: "approved-turn", status: "error", errorCode: "PLAN_EXECUTION_STALE" });
      const finishMethod = kind === "goal" ? "goalExecutions.settle" : "plans.finishExecution";
      await vi.waitFor(() => expect(f.calls.find((call) => call.method === finishMethod)?.params)
        .toEqual(kind === "goal"
          ? { sessionId: "lead", executionId: "execution", ended: "errored", errorCode: "PLAN_EXECUTION_STALE", persistenceBarrierFailed: false }
          : { executionId: "execution", status: "interrupted", errorCode: "PLAN_EXECUTION_STALE" }));
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });
});


describe("approved Goal terminal settlement", () => {
  it("settles a completed Goal through Host acceptance after transcript durability", async () => {
    const f = fixture(false, "goal");
    const originalCall = f.host.call.bind(f.host);
    let releaseWrite: () => void = () => {};
    const pendingWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    f.host.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "session.appendMessage") { await pendingWrite; return {} as T; }
      if (method === "session.saveInflightMessage") return {} as T;
      return originalCall(method, params);
    };
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind: "goal" });
      f.notify({ sessionId: "lead", turnId: "approved-turn", ts: 1,
        event: { type: "message_end", message: { id: "answer", role: "assistant", content: "done", createdAt: "2026-10-13" } } });
      f.notify({ sessionId: "lead", turnId: "approved-turn", ts: 2,
        event: { type: "agent_end", messageIds: ["answer"], stopHint: "team_unsettled" } });
      await vi.waitFor(() => expect(f.calls.some((c) => c.method === "session.endTurn")).toBe(true));
      expect(f.calls.some((c) => c.method === "goalExecutions.settle")).toBe(false);
      releaseWrite();
      await vi.waitFor(() => expect(f.calls.find((c) => c.method === "goalExecutions.settle")?.params)
        .toEqual({ sessionId: "lead", executionId: "execution", ended: "agent_stopped", stopHint: "team_unsettled", persistenceBarrierFailed: false }));
      expect(f.calls.some((c) => c.method === "plans.finishExecution" || c.method === "goalReports.finalizeReport")).toBe(false);
      expect(f.calls.find((c) => c.method === "agent.executeApprovedPlan")?.params).toMatchObject({ createNotification: false });
    } finally { releaseWrite(); f.dispatcher.dispose(); await f.service.dispose(); }
  });

  it("preserves explicit user cancellation as interrupted without Goal settlement", async () => {
    const f = fixture(false, "goal");
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind: "goal" });
      await f.service.finishTurn("lead", "aborted", "TURN_ABORTED", { turnId: "approved-turn" });
      await vi.waitFor(() => expect(f.calls.find((c) => c.method === "plans.finishExecution")?.params)
        .toEqual({ executionId: "execution", status: "interrupted", errorCode: "TURN_ABORTED" }));
      expect(f.calls.some((c) => c.method === "goalExecutions.settle")).toBe(false);
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });

  it("treats a sidecar crash as an errored Goal instead of user cancellation", async () => {
    const f = fixture(false, "goal");
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind: "goal" });
      await f.service.finishTurn("lead", "aborted", "AGENT_SIDECAR_CRASHED", { turnId: "approved-turn" });
      await vi.waitFor(() => expect(f.calls.find((c) => c.method === "goalExecutions.settle")?.params)
        .toMatchObject({ ended: "errored", errorCode: "AGENT_SIDECAR_CRASHED" }));
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });
});


describe("approved Goal stop and failure distinctions", () => {
  it.each(["goal", "plan"] as const)("preserves graceful Stop behavior for %s", async (kind) => {
    const f = fixture(false, kind);
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind });
      await f.service.stop("lead");
      f.notify({ sessionId: "lead", turnId: "approved-turn", ts: 1,
        event: { type: "agent_end", messageIds: [] } });
      await vi.waitFor(() => expect(f.calls.find((c) => c.method === "plans.finishExecution")?.params)
        .toEqual({ executionId: "execution", status: kind === "goal" ? "interrupted" : "completed",
          ...(kind === "goal" ? { errorCode: "TURN_ABORTED" } : {}) }));
      expect(f.calls.some((c) => c.method === "goalExecutions.settle")).toBe(false);
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });

  it("passes failed transcript durability to Host settlement", async () => {
    const f = fixture(false, "goal");
    const originalCall = f.host.call.bind(f.host);
    f.host.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "session.appendMessage") throw Object.assign(new Error("disk full"), { errorCode: "INTERNAL" });
      if (method === "session.saveInflightMessage") return {} as T;
      return originalCall(method, params);
    };
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind: "goal" });
      f.notify({ sessionId: "lead", turnId: "approved-turn", ts: 1,
        event: { type: "message_end", message: { id: "answer", role: "assistant", content: "done", createdAt: "2026-10-13" } } });
      f.notify({ sessionId: "lead", turnId: "approved-turn", ts: 2, event: { type: "agent_end", messageIds: ["answer"] } });
      await vi.waitFor(() => expect(f.calls.find((c) => c.method === "goalExecutions.settle")?.params)
        .toMatchObject({ ended: "agent_stopped", persistenceBarrierFailed: true }));
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });

  it("marks the barrier failed when Host turn finalization was not acknowledged", async () => {
    const f = fixture(false, "goal");
    const originalCall = f.host.call.bind(f.host);
    f.host.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "session.endTurn") throw new Error("turn settlement unavailable");
      return originalCall(method, params);
    };
    try {
      await f.dispatcher.dispatchApprovedPlan({ ...execution, kind: "goal" });
      f.notify({ sessionId: "lead", turnId: "approved-turn", ts: 1, event: { type: "agent_end", messageIds: [] } });
      await vi.waitFor(() => expect(f.calls.find((c) => c.method === "goalExecutions.settle")?.params)
        .toMatchObject({ persistenceBarrierFailed: true }));
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });

  it("does not replay a blocked Goal returned during startup drain", async () => {
    const f = fixture(false, "goal");
    const originalCall = f.host.call.bind(f.host);
    f.host.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "plans.queuedExecutions") return { executions: [{ ...execution, kind: "goal", state: "interrupted",
        errorCode: "GOAL_BLOCKED", hold: { state: "blocked" } }] } as T;
      return originalCall(method, params);
    };
    try {
      await f.dispatcher.drainApprovedPlanExecutions();
      expect(f.calls.some((c) => c.method === "plans.claimExecution" || c.method === "agent.executeApprovedPlan")).toBe(false);
      expect(f.service.activeTurnId("lead")).toBeUndefined();
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });
});
