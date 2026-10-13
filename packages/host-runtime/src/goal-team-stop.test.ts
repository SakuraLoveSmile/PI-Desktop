import { describe, expect, it } from "vitest";
import { RuntimeService, type RuntimeHostLink, type RuntimeSidecarLink } from "./runtime-service.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let notify: ((method: string, params: unknown) => void) | undefined;
  let turnCount = 0;
  const roster = { paused: true, members: [{ memberSessionId: "expert" }, { memberSessionId: "idle" }, { memberSessionId: "lead" }] };
  const host: RuntimeHostLink = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params });
      if (method === "session.get") return { session: { id: params.id, executionProfile: params.id === "solo" ? "single" : "team" } } as T;
      if (method === "session.beginTurn") return { turnId: `turn-${++turnCount}` } as T;
      if (method === "session.endTurn") return { ok: true } as T;
      if (method === "team.getRoster") return roster as T;
      throw new Error(`unexpected Host call: ${method}`);
    },
    isAvailable: () => true,
    onNotification: (listener) => { notify = listener; return () => {}; },
    onExit: () => () => {},
  };
  const sidecar: RuntimeSidecarLink = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params });
      return { ok: true } as T;
    },
    onNotification: () => () => {}, onExit: () => () => {},
    setProjectInstructionRoot: () => {}, clearProjectInstructionRoot: () => {}, clearVendorAuthBindings: () => {},
  };
  const runtime = new RuntimeService({ getHost: () => host, getSidecar: () => sidecar,
    launch: { resolve: async (sessionId) => ({ providerId: "p", modelId: "m", sidecarParams: { sessionId, mode: "agent", provider: { id: "p", name: "Fixture", modelId: "m" } } }) }, log: () => {} });
  runtime.attachHost(host);
  return { calls, host, sidecar, roster, runtime, notify: (params: unknown) => notify?.("goalExecutions.changed", params) };
}

describe("blocked Goal member cancellation", () => {
  it("waits for owned member cancellation, preserves the settled lead and unrelated sessions", async () => {
    const f = fixture();
    const abortStarted = deferred<void>();
    const abortFinished = deferred<void>();
    const original = f.sidecar.call.bind(f.sidecar);
    f.sidecar.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "agent.abort") {
        abortStarted.resolve();
        await abortFinished.promise;
      }
      return original(method, params);
    };
    try {
      await f.runtime.beginTurn("lead", "p", "m");
      await f.runtime.beginTurn("expert", "p", "m");
      await f.runtime.beginTurn("unrelated", "p", "m");
      await f.runtime.finishTurn("lead", "completed", undefined, { turnId: "turn-1" });
      f.notify({ sessionId: "lead", executionId: "goal", hold: { state: "blocked", pausedTeam: true } });
      let done = false;
      const pause = f.runtime.pauseGoalTeam("lead").then(() => { done = true; });
      await abortStarted.promise;
      expect(done).toBe(false);
      expect(f.runtime.activeTurnId("expert")).toBe("turn-2");
      abortFinished.resolve();
      await pause;
      expect(f.calls.filter((c) => c.method === "agent.abort").map((c) => c.params))
        .toEqual([{ sessionId: "expert", turnId: "turn-2" }]);
      expect(f.runtime.activeTurnId("expert")).toBeUndefined();
      expect(f.runtime.activeTurnId("lead")).toBeUndefined();
      expect(f.runtime.activeTurnId("unrelated")).toBe("turn-3");
      expect(f.calls.filter((c) => c.method === "session.endTurn").map((c) => c.params.status))
        .toEqual(["completed", "aborted"]);
    } finally { abortFinished.resolve(); await f.runtime.dispose(); }
  });

  it("cancels active members when the Team was already paused outside the Goal hold", async () => {
    const f = fixture();
    try {
      await f.runtime.beginTurn("expert", "p", "m");
      f.notify({ sessionId: "lead", executionId: "goal", hold: { state: "blocked", pausedTeam: false } });
      // A sync point after Host notification delivery, without invoking the pause manually.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.calls.filter((c) => c.method === "agent.abort").map((c) => c.params))
        .toEqual([{ sessionId: "expert", turnId: "turn-1" }]);
      expect(f.runtime.activeTurnId("expert")).toBeUndefined();
    } finally { await f.runtime.dispose(); }
  });

  it("ignores a delayed block after the Team resumed", async () => {
    const f = fixture();
    try {
      await f.runtime.beginTurn("expert", "p", "m");
      f.roster.paused = false;
      f.notify({ sessionId: "lead", executionId: "goal", hold: { state: "blocked", pausedTeam: true } });
      await f.runtime.pauseGoalTeam("lead");
      expect(f.calls.some((c) => c.method === "agent.abort")).toBe(false);
      expect(f.runtime.activeTurnId("expert")).toBe("turn-1");
    } finally { await f.runtime.dispose(); }
  });

  it("cannot abort a replacement member turn while the roster read is pending", async () => {
    const f = fixture();
    const rosterRead = deferred<typeof f.roster>();
    const rosterStarted = deferred<void>();
    const original = f.host.call.bind(f.host);
    f.host.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "team.getRoster") {
        rosterStarted.resolve();
        return await rosterRead.promise as T;
      }
      return original(method, params);
    };
    try {
      await f.runtime.beginTurn("expert", "p", "m");
      const pause = f.runtime.pauseGoalTeam("lead");
      await rosterStarted.promise;
      await f.runtime.finishTurn("expert", "completed", undefined, { turnId: "turn-1" });
      await f.runtime.beginTurn("expert", "p", "m");
      rosterRead.resolve(f.roster);
      await pause;
      expect(f.calls.some((c) => c.method === "agent.abort")).toBe(false);
      expect(f.runtime.activeTurnId("expert")).toBe("turn-2");
    } finally { rosterRead.resolve(f.roster); await f.runtime.dispose(); }
  });

  it("cannot dispatch a member prompt cancelled while its user message was being persisted", async () => {
    const f = fixture();
    const appendStarted = deferred<void>();
    const appendFinished = deferred<void>();
    const original = f.host.call.bind(f.host);
    f.host.call = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "settings.get") return {} as T;
      if (method === "session.get") return { session: { id: "expert", mode: "agent", permissionMode: "ask", executionProfile: "team" } } as T;
      if (method === "session.appendMessage") {
        appendStarted.resolve();
        await appendFinished.promise;
        return {} as T;
      }
      return original(method, params);
    };
    try {
      const prompt = f.runtime.prompt({ sessionId: "expert", content: "continue task", effectivePermissionMode: "ask",
        principal: { subject: "fixture", roles: ["owner"], pairedDevice: true } });
      const rejection = expect(prompt).rejects.toMatchObject({ errorCode: "TURN_ABORTED" });
      await appendStarted.promise;
      f.notify({ sessionId: "lead", executionId: "goal", hold: { state: "blocked", pausedTeam: true } });
      await f.runtime.pauseGoalTeam("lead");
      appendFinished.resolve();
      await rejection;
      expect(f.calls.some((c) => c.method === "agent.prompt")).toBe(false);
      expect(f.runtime.activeTurnId("expert")).toBeUndefined();
    } finally { appendFinished.resolve(); await f.runtime.dispose(); }
  });

  it("does not query a Team for a solo blocked Goal", async () => {
    const f = fixture();
    try {
      f.notify({ sessionId: "solo", executionId: "goal", hold: { state: "blocked", pausedTeam: false } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.calls.some((c) => c.method === "team.getRoster" || c.method === "agent.abort")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });
});
