import { BackgroundProcessUpdates } from "./background-process-updates.js";
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
      if (method === "backgroundProcesses.read") expect(params).toEqual({ sessionId: "member-1", id: "job-1" });
      else expect(params).toMatchObject({ teamSessionId: "team-1", callerSessionId: "member-1" });
      return await rpc(method) as T;
    },
  };
  if (notifications) host.onNotification = (handler) => {
    listeners.add(handler);
    return () => { listeners.delete(handler); unsubscribe(); };
  };
  const background = new BackgroundProcessUpdates(host, "member-1");
  return {
    registerProcess: () => background.captureReceipt()({ ok: true, content: { backgroundProcessId: "job-1" } }),
    host, rpc, unsubscribe, listeners, background,
    tool: createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host, backgroundProcesses: background }),
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
  function queuedMessage(id: string) {
    return { id, sourceSessionId: "researcher", targetSessionId: "member-1",
      status: "queued", deliveryStatus: "acknowledged", turnId: null };
  }

  function leadWait(h: ReturnType<typeof harness>, yieldInbox = vi.fn(() => true)) {
    const captureInboxYield = vi.fn(() => yieldInbox);
    const tool = createTeamTools({ teamSessionId: "team-1", callerSessionId: "member-1",
      host: h.host, isLead: true, mode: "plan", captureInboxYield }).find(tool => tool.name === "wait_for_updates");
    if (!tool) throw new Error("Missing wait_for_updates");
    return { tool, yieldInbox, captureInboxYield };
  }

  it("yields immediately for all queued unbound inbound mail, including ACKed receipts", async () => {
    const h = harness();
    const { tool, yieldInbox } = leadWait(h);
    h.setReader(async method => method === "team.getBoard" ? { revision: 7 } : { messages: [
      queuedMessage("a"), queuedMessage("b"), queuedMessage("c"), queuedMessage("d"),
      { ...queuedMessage("bound"), turnId: "delivered-turn" },
      { ...queuedMessage("settled"), status: "completed" },
      { ...queuedMessage("outbound"), sourceSessionId: "member-1", targetSessionId: "researcher" },
    ] });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const outcome = await tool.execute("wait-mail", {}, controller.signal);
    expect(outcome.details).toEqual({ updated: true, reason: "pending_mailbox_messages", count: 4, pendingMessagesCount: 4, pendingMessageSenders: [], oldestPendingMessageAgeSeconds: null });
    expect(outcome.terminate).toBe(true);
    expect(yieldInbox).toHaveBeenCalledExactlyOnceWith("wait-mail");
    expect(h.rpc.mock.calls.map(([method]) => method)).toEqual(["team.getBoard", "team.listMessages"]);
    expect(h.listeners.size).toBe(0);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("yields on recheck even when total mailbox count stays unchanged and the board changes", async () => {
    const h = harness();
    let queued = false;
    h.setReader(async method => method === "team.getBoard" ? { revision: queued ? 8 : 7 } : {
      messages: [{ ...queuedMessage("a"), status: queued ? "queued" : "completed" }],
    });
    const { tool, yieldInbox } = leadWait(h);
    const pending = tool.execute("wait-recheck", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(yieldInbox).not.toHaveBeenCalled();
    queued = true;
    h.emit("team.messageQueued");
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).details).toEqual({ updated: true, reason: "pending_mailbox_messages", count: 1, pendingMessagesCount: 1, pendingMessageSenders: [], oldestPendingMessageAgeSeconds: null });
    expect(yieldInbox).toHaveBeenCalledExactlyOnceWith("wait-recheck");
    expect(vi.getTimerCount()).toBe(0);
    expect(h.listeners.size).toBe(0);
  });

  it.each(["abort", "deadline"])("does not yield for a queued baseline completing after %s", async ending => {
    const h = harness();
    const blocked = deferred<unknown>();
    h.setReader(async method => method === "team.getBoard" ? { revision: 7 } : blocked.promise);
    const { tool, yieldInbox } = leadWait(h);
    const controller = new AbortController();
    const pending = tool.execute("late-wait", { timeoutSeconds: 1 }, controller.signal);
    if (ending === "abort") controller.abort();
    else await vi.advanceTimersByTimeAsync(1000);
    const outcome = await pending;
    expect(outcome.terminate).toBeUndefined();
    blocked.resolve({ messages: [queuedMessage("late")] });
    await vi.advanceTimersByTimeAsync(0);
    expect(yieldInbox).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ isLead: false, mode: "plan" }, { isLead: false, mode: "agent" }])(
    "preserves ordinary wait behavior for %j", async options => {
      const h = harness();
      h.setReader(async method => method === "team.getBoard" ? { revision: 7 } : { messages: [queuedMessage("a")] });
      const captureInboxYield = vi.fn(() => vi.fn(() => true));
      const tool = createTeamTools({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host,
        ...options, captureInboxYield }).find(tool => tool.name === "wait_for_updates");
      if (!tool) throw new Error("Missing wait_for_updates");
      const pending = tool.execute("ordinary-wait", { timeoutSeconds: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).details).toEqual({ updated: false, reason: "timeout" });
      expect(captureInboxYield).not.toHaveBeenCalled();
    },
  );

  it("shows existing ACKed reports to an ordinary Agent lead without ending or consuming the turn", async () => {
    const h = harness();
    vi.setSystemTime(1_800_000_000_000);
    h.setReader(async method => method === "team.getBoard" ? { revision: 7 } : { messages: [
      { ...queuedMessage("a"), sourceMemberName: "expert", createdAt: String(Date.now() - 229_900), content: "PRIVATE_REPORT_BODY" },
    ] });
    const captureInboxYield = vi.fn(() => vi.fn(() => true));
    const tool = createTeamTools({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host,
      isLead: true, mode: "agent", captureInboxYield }).find(tool => tool.name === "wait_for_updates")!;
    const pending = tool.execute("agent-wait", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await pending;
    expect(outcome.details).toMatchObject({ updated: true, reason: "pending_mailbox_messages", count: 1,
      pendingMessagesCount: 1, pendingMessageSenders: ["expert"], oldestPendingMessageAgeSeconds: 229 });
    expect(outcome.terminate).toBeUndefined();
    expect(JSON.stringify(outcome)).not.toContain("PRIVATE_REPORT_BODY");
    expect(captureInboxYield).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.map(([method]) => method)).toEqual(["team.getBoard", "team.listMessages"]);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a newly pending report even if total count is unchanged, including a notification during baseline", async () => {
    const h = harness();
    vi.setSystemTime(1_800_000_000_000);
    const initial = deferred<unknown>();
    let pending = false;
    h.setReader(async method => method === "team.getBoard" ? { revision: 7 } : initial.promise);
    const tool = createTeamTools({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host,
      isLead: true, mode: "agent" }).find(tool => tool.name === "wait_for_updates")!;
    const waiting = tool.execute("agent-race", { timeoutSeconds: 1 });
    h.emit("team.messageQueued");
    await vi.advanceTimersByTimeAsync(100);
    pending = true;
    h.setReader(async method => method === "team.getBoard" ? { revision: 7 } : { messages: [
      { ...queuedMessage("a"), status: pending ? "queued" : "completed", sourceMemberName: "expert", createdAt: String(Date.now() - 5100) },
      { ...queuedMessage("outbound"), sourceSessionId: "member-1", targetSessionId: "researcher" },
    ] });
    initial.resolve({ messages: [{ ...queuedMessage("a"), status: "completed" }, { ...queuedMessage("bound"), turnId: "previous" }] });
    await vi.advanceTimersByTimeAsync(900);
    expect((await waiting).details).toMatchObject({ reason: "pending_mailbox_messages", count: 1,
      pendingMessageSenders: ["expert"], oldestPendingMessageAgeSeconds: 5 });
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a background terminal outcome ahead of an Agent report and returns the report on the next wait", async () => {
    const h = harness();
    const terminal = { process: { id: "job-1", sessionId: "member-1", status: "timed_out" }, errorCode: "TOOL_TIMEOUT" };
    h.setReader(async method => method === "team.getBoard" ? { revision: 7 }
      : method === "backgroundProcesses.read" ? terminal : { messages: [queuedMessage("report")] });
    h.registerProcess();
    const tool = createTeamTools({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host, isLead: true,
      mode: "agent", backgroundProcesses: h.background }).find(tool => tool.name === "wait_for_updates")!;
    expect((await tool.execute("process-first", {})).details).toEqual({ updated: true, reason: "background_process_completed", backgroundProcess: terminal });
    const next = await tool.execute("mail-next", {});
    expect(next.details).toMatchObject({ reason: "pending_mailbox_messages", count: 1 });
    expect(next.terminate).toBeUndefined();
    expect(h.rpc.mock.calls.filter(([method]) => method === "backgroundProcesses.read")).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes on a Host failure notice and returns its complete structured body once", async () => {
    const h = harness();
    let failed = false;
    const content = JSON.stringify({ kind: "member_failed", memberName: "expert", errorCode: "MUTATION_RETRY_BUDGET_EXHAUSTED",
      retriable: false, taskIds: ["rewrite"], suggestedAction: "Inspect the failed attempt before retrying" });
    const messages = [{ id: "host-failure", content }];
    h.setReader(async method => method === "team.readExecutionInbox" ? { turnId: "approved-turn", messages: failed ? messages : [] }
      : method === "team.getBoard" ? { revision: failed ? 8 : 7 } : { messages: [] });
    const tool = createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host,
      approvedExecution: () => true, getTurnId: () => "approved-turn" });
    const waiting = tool.execute("failure-wait", { timeoutSeconds: 60 });
    await vi.advanceTimersByTimeAsync(0);
    failed = true;
    h.emit("team.messageQueued", { teamSessionId: "team-1", messageId: "host-failure" });
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await waiting;
    expect(outcome.details).toEqual({ updated: true, reason: "execution_inbox", messages });
    expect(outcome.content[0]).toEqual({ type: "text", text: JSON.stringify(outcome.details) });
    const repeated = tool.execute("failure-recheck", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await repeated).details).toEqual({ updated: false, reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
    expect(h.listeners.size).toBe(0);
  });

  it("keeps approved execution mail in the same turn without yielding or replaying consumed results", async () => {
    const h = harness();
    const messages = [{ id: "execution-mail", content: "Full approved expert report" }];
    h.setReader(async method => method === "team.readExecutionInbox" ? { turnId: "approved-turn", messages }
      : method === "team.getBoard" ? { revision: 7 } : { messages: [queuedMessage("execution-mail")] });
    const captureInboxYield = vi.fn(() => vi.fn(() => true));
    const tool = createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host,
      approvedExecution: () => true, getTurnId: () => "approved-turn", captureInboxYield });
    const outcome = await tool.execute("approved-wait", {});
    expect(outcome.details).toEqual({ updated: true, reason: "execution_inbox", messages });
    expect(outcome.terminate).toBeUndefined();
    const repeated = tool.execute("approved-recheck", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await repeated).details).toEqual({ updated: false, reason: "timeout" });
    expect(captureInboxYield).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

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

  it.each(["completed", "timed_out"])("wakes on a scoped background %s and reads the terminal result", async status => {
    const h = harness();
    const process = { id: "job-1", sessionId: "member-1", status };
    const detail = { process, errorCode: status === "timed_out" ? "TOOL_TIMEOUT" : undefined,
      errorMessage: status === "timed_out" ? "Background Bash timed out after the default 60 seconds." : undefined };
    h.setReader(async method => method === "backgroundProcesses.read" ? detail
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "other-session", id: "job-1", revision: 1 });
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 2 });
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await pending;
    expect(outcome.details).toEqual({ updated: true, reason: "background_process_completed", backgroundProcess: detail });
    expect(outcome.terminate).toBeUndefined();
    expect(h.rpc.mock.calls.filter(([method]) => method === "backgroundProcesses.read")).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reconciles a launched process already completed before the first wait without returning historical jobs", async () => {
    const h = harness();
    const background = new BackgroundProcessUpdates(h.host, "member-1");
    background.captureReceipt()({ ok: true, content: { backgroundProcessId: "job-1" } });
    const detail = { process: { id: "job-1", sessionId: "member-1", status: "completed" } };
    h.setReader(async method => method === "backgroundProcesses.read" ? detail
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const tool = createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host, backgroundProcesses: background });
    expect((await tool.execute("after-launch", {})).details).toEqual({ updated: true, reason: "background_process_completed", backgroundProcess: detail });
    expect(h.rpc.mock.calls.filter(([method]) => method.startsWith("backgroundProcesses."))).toEqual([["backgroundProcesses.read"]]);
    const repeated = tool.execute("next", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await repeated).details).toEqual({ updated: false, reason: "timeout" });
    expect(h.listeners.size).toBe(0);
  });

  it("reconciles a known running process completing between two waits", async () => {
    const h = harness();
    const background = new BackgroundProcessUpdates(h.host, "member-1");
    background.captureReceipt()({ ok: true, content: { backgroundProcessId: "job-1" } });
    let status = "running";
    h.setReader(async method => method === "backgroundProcesses.read" ? { process: { id: "job-1", sessionId: "member-1", status } }
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const tool = createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host, backgroundProcesses: background });
    const first = tool.execute("first", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await first).details).toEqual({ updated: false, reason: "timeout" });
    status = "completed";
    const rebuilt = createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host, backgroundProcesses: background });
    expect((await rebuilt.execute("second", {})).details).toMatchObject({ updated: true, reason: "background_process_completed", backgroundProcess: { process: { status } } });
    expect(h.rpc.mock.calls.filter(([method]) => method === "backgroundProcesses.read")).toHaveLength(2);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not register failed, aborted, replaced-turn or disposed launch receipts", () => {
    const h = harness();
    let scope = 1;
    const background = new BackgroundProcessUpdates(h.host, "member-1", () => scope);
    const accepted = { ok: true, content: { backgroundProcessId: "job-1" } };
    const late = background.captureReceipt();
    scope = 2;
    late(accepted);
    background.captureReceipt()({ ...accepted, ok: false });
    const controller = new AbortController();
    controller.abort();
    background.captureReceipt()(accepted, controller.signal);
    const afterDispose = background.captureReceipt();
    background.dispose();
    afterDispose(accepted);
    background.prime();
    expect(background.hasPending()).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
  });

  it("revokes an in-flight background read when its runtime tracker is disposed", async () => {
    const h = harness();
    const blocked = deferred<unknown>();
    h.setReader(async method => method === "backgroundProcesses.read" ? blocked.promise
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    h.background.dispose();
    blocked.resolve({ process: { id: "job-1", sessionId: "member-1", status: "completed" } });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual({ error: "Background process wait is no longer active" });
    expect(h.background.hasPending()).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not consume a background read after its deadline even before the timer callback runs", async () => {
    const h = harness();
    const blocked = deferred<unknown>();
    h.setReader(async method => method === "backgroundProcesses.read" ? blocked.promise
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const pending = h.tool.execute("wait", { timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(0);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    vi.setSystemTime(Date.now() + 2000);
    const detail = { process: { id: "job-1", sessionId: "member-1", status: "completed" } };
    blocked.resolve(detail);
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual({ error: "Timed out checking team updates" });
    expect((await h.tool.execute("next", {})).details).toEqual({ updated: true, reason: "background_process_completed", backgroundProcess: detail });
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains a terminal invalidation racing a running read and delivers the outcome once", async () => {
    const h = harness();
    const first = deferred<unknown>();
    let reads = 0;
    const detail = { process: { id: "job-1", sessionId: "member-1", status: "completed" } };
    h.setReader(async method => method === "backgroundProcesses.read" ? ++reads === 1 ? first.promise : detail
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 2 });
    await vi.advanceTimersByTimeAsync(100);
    first.resolve({ process: { ...detail.process, status: "running" } });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual({ updated: true, reason: "background_process_completed", backgroundProcess: detail });
    expect(reads).toBe(2);
    const repeated = h.tool.execute("next", { timeoutSeconds: 1 });
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await repeated).details).toEqual({ updated: false, reason: "timeout" });
    expect(reads).toBe(2);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores live background output and reports a read failure without hiding it as an idle timeout", async () => {
    const h = harness();
    let failure = false;
    h.setReader(async method => {
      if (method === "backgroundProcesses.read") {
        if (failure) throw new Error("Background read unavailable");
        return { process: { id: "job-1", sessionId: "member-1", status: "running" } };
      }
      return method === "team.getBoard" ? { revision: 7 } : { messages: [] };
    });
    const pending = h.tool.execute("wait", {});
    await vi.advanceTimersByTimeAsync(0);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.listeners.size).toBe(1);
    failure = true;
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).details).toEqual({ error: "Background read unavailable" });
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["abort", "turn change"])("does not deliver a stale background read after %s and retains the result for the next wait", async ending => {
    const h = harness();
    const blocked = deferred<unknown>();
    let turnId = "turn-1";
    h.setReader(async method => method === "backgroundProcesses.read" ? blocked.promise
      : method === "team.getBoard" ? { revision: 7 } : { messages: [] });
    const tool = createWaitForUpdatesTool({ teamSessionId: "team-1", callerSessionId: "member-1", host: h.host, getTurnId: () => turnId, backgroundProcesses: h.background });
    const controller = new AbortController();
    const pending = tool.execute("wait", {}, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    h.registerProcess();
    h.emit("backgroundProcesses.changed", { sessionId: "member-1", id: "job-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    if (ending === "abort") controller.abort();
    else turnId = "turn-2";
    const detail = { process: { id: "job-1", sessionId: "member-1", status: "completed" } };
    blocked.resolve(detail);
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).details).toEqual(ending === "abort" ? { updated: false, reason: "aborted" } : { error: "Background process wait is no longer active" });
    expect((await tool.execute("next", {})).details).toEqual({ updated: true, reason: "background_process_completed", backgroundProcess: detail });
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

  it.each(["abort", "deadline"])("retains replayable inbox results after a late %s response", async (ending) => {
    const h = harness();
    const blocked = deferred<unknown>();
    const messages = [{ id: "mail-1", content: "Verified expert result" }];
    h.setReader(async () => {
      expect(h.listeners.size).toBe(1);
      return blocked.promise;
    });
    const tool = createWaitForUpdatesTool({
      teamSessionId: "team-1", callerSessionId: "member-1", host: h.host,
      getTurnId: () => "turn-1", approvedExecution: () => true,
    });
    const controller = new AbortController();
    const pending = tool.execute("first", { timeoutSeconds: 1 }, controller.signal);
    expect(h.listeners.size).toBe(1);
    if (ending === "abort") {
      controller.abort();
      expect((await pending).details).toEqual({ updated: false, reason: "aborted" });
    } else {
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).details).toEqual({ error: "Timed out reading team update baseline" });
    }
    blocked.resolve({ turnId: "turn-1", messages });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.listeners.size).toBe(0);
    h.setReader(async () => ({ turnId: "turn-1", messages }));
    expect((await tool.execute("retry", {})).details).toEqual({
      updated: true, reason: "execution_inbox", messages,
    });
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
