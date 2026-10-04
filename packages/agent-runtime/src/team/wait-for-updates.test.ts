import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeamTools } from "./team-tools.js";
import { createWaitForUpdatesTool } from "./wait-for-updates.js";
import type { HostNotificationHandler, RuntimeHost } from "../host-client.js";

afterEach(() => vi.useRealTimers());

function harness(notifications = true) {
  vi.useFakeTimers();
  let revision = 7;
  let count = 0;
  let reader: ((method: string) => Promise<unknown>) | undefined;
  const listeners = new Set<HostNotificationHandler>();
  const unsubscribe = vi.fn();
  const rpc = vi.fn(async (method: string) => {
    if (reader) return reader(method);
    return method === "team.getBoard" ? { revision } : { messages: Array(count).fill({}) };
  });
  const host: RuntimeHost = {
    async call<T>(method: string, params?: unknown): Promise<T> {
      expect(params).toMatchObject({ teamSessionId: "team-1", callerSessionId: "member-1" });
      return await rpc(method) as T;
    },
  };
  if (notifications) host.onNotification = (handler) => {
    listeners.add(handler);
    return () => { listeners.delete(handler); unsubscribe(); };
  };
  return {
    host, rpc, unsubscribe, listeners,
    tool: createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host }),
    setBoard: (value: number) => { revision = value; },
    setCount: (value: number) => { count = value; },
    setReader: (value?: typeof reader) => { reader = value; },
    emit: (method: string, payload: unknown = { teamSessionId: "team-1" }) => {
      for (const listener of listeners) listener(method, payload);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("wait_for_updates", () => {
  it.each([1, 5, 10])("returns timeout for a healthy idle %s-second wait with RPC latency", async (timeoutSeconds) => {
    const h = harness();
    h.setReader(async (method) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return method === "team.getBoard" ? { revision: 7 } : { messages: [] };
    });
    const pending = h.tool.execute("wait", { timeoutSeconds });
    await vi.advanceTimersByTimeAsync(timeoutSeconds * 1000);
    expect((await pending).details).toEqual({ updated: false, reason: "timeout" });
    expect(h.rpc).toHaveBeenCalledTimes(timeoutSeconds === 10 ? 6 : 4);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["baseline", "recheck"])("bounds a hanging %s by the total deadline and ignores late completion", async (phase) => {
    const h = harness();
    const blocked = deferred<unknown>();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    if (phase === "baseline") h.setReader(async () => blocked.promise);
    let completed = false;
    const pending = h.tool.execute("wait", { timeoutSeconds: 1 }, controller.signal)
      .then((value) => { completed = true; return value; });
    await vi.advanceTimersByTimeAsync(0);
    if (phase === "recheck") {
      h.setReader(async () => blocked.promise);
      h.emit("team.changed");
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(phase === "baseline" ? 1000 : 900);
    expect(completed).toBe(true);
    expect((await pending).details).toEqual({ error: phase === "baseline"
      ? "Timed out reading team update baseline" : "Timed out checking team updates" });
    expect(h.listeners.size).toBe(0);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    const calls = h.rpc.mock.calls.length;
    blocked.resolve({ revision: 8, messages: [{}] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.rpc).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a normal timeout when a later RPC hangs after a successful recheck", async () => {
    const h = harness(false);
    const pending = h.tool.execute("wait", { timeoutSeconds: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    const blocked = deferred<unknown>();
    h.setReader(async () => blocked.promise);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).details).toEqual({ updated: false, reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
    blocked.resolve({ revision: 8, messages: [{}] });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a baseline failure instead of mistaking the recovered board for an update", async () => {
    vi.useFakeTimers();
    let boardCalls = 0;
    const host: RuntimeHost = {
      async call<T>(method: string): Promise<T> {
        if (method === "team.getBoard") {
          if (++boardCalls === 1) throw new Error("Board unavailable");
          return { revision: 7 } as T;
        }
        return { messages: [] } as T;
      },
    };
    const tool = createTeamTools({
      teamSessionId: "team-1", callerSessionId: "member-1", isLead: false, host,
    }).find((entry) => entry.name === "wait_for_updates")!;
    const pending = tool.execute("wait", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).details).toEqual({ error: "Board unavailable" });
  });

  it("uses only six RPCs during an idle ten-second notification-backed wait", async () => {
    const h = harness();
    const pending = h.tool.execute("wait", { timeoutSeconds: 10 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).details).toEqual({ updated: false, reason: "timeout" });
    expect(h.rpc).toHaveBeenCalledTimes(6);
    expect(h.listeners.size).toBe(0);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["team.changed", "task_board_changed"],
    ["team.messageQueued", "new_mailbox_messages"],
  ])("wakes on %s after the notification debounce with reason %s", async (method, reason) => {
    const h = harness();
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    if (method === "team.changed") h.setBoard(8);
    else h.setCount(1);
    h.emit(method);
    await vi.advanceTimersByTimeAsync(99);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).details).toMatchObject({ updated: true, reason });
    expect(h.rpc).toHaveBeenCalledTimes(4);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores notifications for another team, unrelated methods and malformed payloads", async () => {
    const h = harness();
    const pending = h.tool.execute("wait", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(0);
    h.emit("team.changed", { teamSessionId: "team-2" });
    h.emit("tools.output");
    h.emit("team.changed", null);
    h.emit("team.changed", "team-1");
    h.emit("team.changed", {});
    await vi.advanceTimersByTimeAsync(100);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(900);
    expect((await pending).details).toEqual({ updated: false, reason: "timeout" });
  });

  it("retains the one-second fallback when the host has no notifications", async () => {
    const h = harness(false);
    const pending = h.tool.execute("wait", { timeoutSeconds: 3 });
    await vi.advanceTimersByTimeAsync(999);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.rpc).toHaveBeenCalledTimes(4);
    h.setCount(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).details).toEqual({ updated: true, reason: "new_mailbox_messages", count: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports sustained recheck failures instead of a timeout", async () => {
    const h = harness(false);
    const pending = h.tool.execute("wait", { timeoutSeconds: 3 });
    await vi.advanceTimersByTimeAsync(0);
    h.setReader(async () => { throw new Error("Host disconnected"); });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pending).details).toEqual({ error: "Host disconnected" });
    expect(h.rpc).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient recheck failure and still returns an observed update", async () => {
    const h = harness();
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    h.setReader(async () => { throw new Error("Temporary failure"); });
    h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    h.setReader();
    h.setBoard(8);
    h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).details).toEqual({ updated: true, reason: "task_board_changed", revision: 8 });
  });

  it("returns timeout after a successful unchanged recheck following an error", async () => {
    const h = harness(false);
    const pending = h.tool.execute("wait", { timeoutSeconds: 3 });
    await vi.advanceTimersByTimeAsync(0);
    h.setReader(async () => { throw new Error("Temporary failure"); });
    await vi.advanceTimersByTimeAsync(1000);
    h.setReader();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).details).toEqual({ updated: false, reason: "timeout" });
  });

  it("subscribes before the baseline and rechecks a notification received during it", async () => {
    const h = harness();
    const board = deferred<unknown>();
    h.setReader(async (method) => {
      expect(h.listeners.size).toBe(1);
      return method === "team.getBoard" ? board.promise : { messages: [] };
    });
    const pending = h.tool.execute("wait", {});
    h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    h.setReader();
    h.setBoard(8);
    board.resolve({ revision: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual({ updated: true, reason: "task_board_changed", revision: 8 });
  });

  it("coalesces notification bursts and performs one follow-up after an in-flight recheck", async () => {
    const h = harness();
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    const board = deferred<unknown>();
    h.setReader(async (method) => method === "team.getBoard" ? board.promise : { messages: [] });
    for (let i = 0; i < 5; i++) h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.rpc).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 5; i++) h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.rpc).toHaveBeenCalledTimes(4);
    h.setReader();
    h.setBoard(8);
    board.resolve({ revision: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual({ updated: true, reason: "task_board_changed", revision: 8 });
    expect(h.rpc).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a failed recheck single-flight until both RPCs settle", async () => {
    const h = harness();
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    const mailbox = deferred<unknown>();
    h.setReader(async (method) => {
      if (method === "team.getBoard") throw new Error("Board unavailable");
      return mailbox.promise;
    });
    h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    h.emit("team.changed");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.rpc).toHaveBeenCalledTimes(4);
    h.setReader();
    h.setBoard(8);
    mailbox.resolve({ messages: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual({ updated: true, reason: "task_board_changed", revision: 8 });
    expect(h.rpc).toHaveBeenCalledTimes(6);
  });

  it.each(["idle", "baseline", "recheck"])("aborts immediately during %s and ignores late RPC completion", async (phase) => {
    const h = harness();
    const blocked = deferred<unknown>();
    if (phase === "baseline") h.setReader(async () => blocked.promise);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const pending = h.tool.execute("wait", {}, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    if (phase === "recheck") h.setReader(async () => blocked.promise);
    h.emit("team.changed");
    if (phase === "recheck") await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect((await pending).details).toEqual({ updated: false, reason: "aborted" });
    expect(h.listeners.size).toBe(0);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    const calls = h.rpc.mock.calls.length;
    blocked.resolve({ revision: 8, messages: [{}] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.rpc).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not read or subscribe for an already aborted signal", async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    expect((await h.tool.execute("wait", {}, controller.signal)).details).toEqual({ updated: false, reason: "aborted" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["team.getBoard", "team.listMessages"])("cleans up after a failed %s baseline", async (failure) => {
    const h = harness();
    h.setReader(async (method) => {
      if (method === failure) throw new Error("Baseline unavailable");
      return method === "team.getBoard" ? { revision: 7 } : { messages: [] };
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    expect((await h.tool.execute("wait", {}, controller.signal)).details).toEqual({ error: "Baseline unavailable" });
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
