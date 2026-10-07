import { describe, expect, it } from "vitest";
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
        case "plans.finishExecution": return { ok: true } as T;
        default: throw new Error(`unexpected host method ${method}`);
      }
    },
    isAvailable: () => true, onNotification: () => () => {}, onExit: () => () => {},
  };
  const sidecar: RuntimeSidecarLink = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params });
      if (method !== "agent.executeApprovedPlan") throw new Error(`unexpected sidecar method ${method}`);
      return { accepted: true } as T;
    },
    onNotification: () => () => {}, onExit: () => () => {},
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
  const dispatcher = new PlanExecutionDispatcher({ getHost: () => host, getSidecar: () => sidecar,
    runtime: service, launch, log: () => {} });
  return { calls, service, dispatcher };
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
      expect(f.calls.find((call) => call.method === "plans.finishExecution")?.params)
        .toEqual({ executionId: "execution", status: "interrupted", errorCode: "PLAN_EXECUTION_STALE" });
    } finally { f.dispatcher.dispose(); await f.service.dispose(); }
  });
});
