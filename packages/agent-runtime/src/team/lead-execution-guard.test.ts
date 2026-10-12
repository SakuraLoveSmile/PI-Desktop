import { expect, it, vi } from "vitest";
import type { RuntimeHost } from "../host-client.js";
import { TeamLeadExecutionGuard } from "./lead-execution-guard.js";

it.each(["direct", "rpc"])("gives a confirmed roster three reason-specific nudges then preserves the %s Host error", async transport => {
  const reason = `${transport === "rpc" ? "team.authorizeLeadTool: " : ""}TEAM_APPROVAL_REQUIRED: pending dispatch dispatch-1 for expert (tasks task-1); 1 unconsumed expert result; use wait_for_updates`;
  const host: RuntimeHost = { call: async <T>(method: string) => {
    if (method === "team.getLaunchReview") return { review: { teamSessionId: "lead", leadTurnId: "turn", status: "confirmed", members: [{ name: "expert" }] } } as T;
    throw Object.assign(new Error(reason), { [transport === "rpc" ? "errorCode" : "code"]: "TEAM_APPROVAL_REQUIRED" });
  } };
  const guard = new TeamLeadExecutionGuard();
  const state = () => ({ turnId: "turn", epoch: 1, mode: "agent" as const, inactive: false });
  const team = { teamSessionId: "lead", callerSessionId: "lead" };
  let prompt = "approved execution";
  const nudges: string[] = [];
  for (let i = 0; i < 3; i++) {
    expect(await guard.authorizeCompletion(host, team, state)).toEqual({ kind: "recover" });
    await guard.recover({ host, team, state, abort: () => { throw new Error("unexpected abort"); },
      prepare: () => {}, getPrompt: () => prompt, setPrompt: value => { prompt = value; },
      start: () => {}, continue: async () => { nudges.push(prompt); }, restore: () => {},
    });
  }
  expect(nudges).toHaveLength(3);
  for (const nudge of nudges) expect(nudge).toContain(reason);
  const terminal = await guard.authorizeCompletion(host, team, state);
  expect(terminal).toMatchObject({ kind: "error", error: { code: "TEAM_APPROVAL_REQUIRED", message: reason, details: { stage: "team_completion" } } });
  guard.reset();
  expect(await guard.authorizeCompletion(host, team, state)).toEqual({ kind: "recover" });
});

it("preserves every member in a long Host denial while redacting secrets", async () => {
  const reason = "TEAM_APPROVAL_REQUIRED: " + Array.from({ length: 8 }, (_, i) => `dispatch-${i} running: expert-${i} (tasks verify-many-contract-criteria-${i})`).join("; ") + "; password=secret-value final-expert-identity";
  expect(reason.length).toBeGreaterThan(600);
  const safeReason = reason.replace("secret-value", "[REDACTED]");
  const host: RuntimeHost = { call: async <T>(method: string) => {
    if (method === "team.getLaunchReview") return { review: { teamSessionId: "lead", leadTurnId: "turn", status: "confirmed", members: [{ name: "expert" }] } } as T;
    throw Object.assign(new Error(reason), { code: "TEAM_APPROVAL_REQUIRED" });
  } };
  const guard = new TeamLeadExecutionGuard();
  const state = () => ({ turnId: "turn", epoch: 1, mode: "agent" as const, inactive: false });
  const team = { teamSessionId: "lead", callerSessionId: "lead" };
  let prompt = "approved";
  for (let i = 0; i < 3; i++) {
    expect(await guard.authorizeCompletion(host, team, state)).toEqual({ kind: "recover" });
    await guard.recover({ host, team, state, abort: () => { throw new Error("unexpected abort"); },
      prepare: () => {}, getPrompt: () => prompt, setPrompt: value => { prompt = value; }, start: () => {},
      continue: async () => { expect(prompt).toContain(safeReason); expect(prompt).not.toContain("secret-value"); }, restore: () => {},
    });
  }
  expect(await guard.authorizeCompletion(host, team, state)).toMatchObject({ kind: "error", error: { message: safeReason } });
});

it.each(["cancelled", "interrupted"])("interrupts an approved execution if its roster is %s before completion waiting begins", async reviewStatus => {
  vi.useFakeTimers();
  try {
  const notifications = vi.fn(() => () => {});
  const calls: string[] = [];
  const host: RuntimeHost = { onNotification: notifications, call: async <T>(method: string) => {
    calls.push(method);
    if (method === "team.getLaunchReview") return { review: { teamSessionId: "lead", leadTurnId: "turn", status: reviewStatus, members: [{ name: "expert" }] } } as T;
    if (method === "team.getLeadExecutionState") return { active: true, reviewStatus } as T;
    throw Object.assign(new Error("TEAM_APPROVAL_REQUIRED: roster is not confirmed"), { code: "TEAM_APPROVAL_REQUIRED" });
  } };
  const guard = new TeamLeadExecutionGuard();
  const outcome = await guard.authorizeCompletion(host, { teamSessionId: "lead", callerSessionId: "lead" },
    () => ({ turnId: "turn", epoch: 1, mode: "agent", inactive: false }), true);
  expect(outcome).toMatchObject({ kind: "error", error: { code: "TURN_ABORTED", details: { stage: "team_completion" } } });
  expect(guard.pending).toBeUndefined();
  expect(guard.suppressRunEnd).toBe(false);
  expect(notifications).not.toHaveBeenCalled();
  expect(calls).toEqual(["team.getLaunchReview", "team.getLeadExecutionState"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("retains terminal-event ownership when a continuation arms the next completion recovery", async () => {
  const guard = new TeamLeadExecutionGuard();
  const state = () => ({ turnId: "turn", epoch: 1, mode: "agent" as const, inactive: false });
  const team = { teamSessionId: "lead", callerSessionId: "lead" };
  let holdReview = false;
  let resolveReviewRead!: () => void;
  const reviewRead = new Promise<void>(resolve => { resolveReviewRead = resolve; });
  let releaseReview!: () => void;
  const heldReview = new Promise<void>(resolve => { releaseReview = resolve; });
  const host: RuntimeHost = { call: async <T>(method: string) => {
    if (method === "team.getLaunchReview") {
      if (holdReview) { resolveReviewRead(); await heldReview; }
      return { review: { teamSessionId: "lead", leadTurnId: "turn", status: "confirmed", members: [{ name: "expert" }] } } as T;
    }
    throw Object.assign(new Error("TEAM_APPROVAL_REQUIRED: the expert result is still pending"), { code: "TEAM_APPROVAL_REQUIRED" });
  } };
  let prompt = "approved execution";
  let continuations = 0;
  const callbacks = { host, team, state,
    abort: () => { throw new Error("unexpected abort"); },
    refreshDeclaration: () => {},
    prepare: () => {}, getPrompt: () => prompt, setPrompt: (value: string) => { prompt = value; },
    start: () => {}, restore: () => {},
    continue: async () => {
      continuations += 1;
      if (continuations === 1) {
        expect(await guard.authorizeCompletion(host, team, state)).toEqual({ kind: "recover" });
      }
    },
  };
  let secondRecovery: Promise<void> | undefined;
  try {
    expect(await guard.authorizeCompletion(host, team, state)).toEqual({ kind: "recover" });
    await guard.recover(callbacks);
    expect(guard.pending).toBeDefined();
    expect(guard.suppressRunEnd).toBe(true);
    holdReview = true;
    secondRecovery = guard.recover(callbacks);
    await reviewRead;
    expect(guard.pending).toBeUndefined();
    expect(guard.suppressRunEnd).toBe(true);
    releaseReview();
    await secondRecovery;
    expect(continuations).toBe(2);
    expect(guard.suppressRunEnd).toBe(false);
  } finally {
    releaseReview();
    await secondRecovery;
    guard.reset();
  }
});
