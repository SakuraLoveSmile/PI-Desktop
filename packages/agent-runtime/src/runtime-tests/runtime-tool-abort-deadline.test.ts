import "./runtime-test-harness.js";
import { expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function waitUntil(condition: () => boolean) {
  for (let step = 0; step < 100 && !condition(); step += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

function createTurn() {
  const execute = deferred<unknown>();
  const abort = deferred<unknown>();
  const events: AgentEventEnvelope["event"][] = [];
  const host = { call: vi.fn((method: string) => {
    if (method === "tools.execute") return execute.promise;
    if (method === "tools.abort") return abort.promise;
    return Promise.resolve(undefined);
  }) };
  const runtime = createRuntime({ host, onEvent: (envelope) => events.push((envelope as AgentEventEnvelope).event) });
  const view = runtime as unknown as { models: Pick<Models, "streamSimple"> };
  let requests = 0;
  let finishNext = () => {};
  view.models = { streamSimple: () => {
    requests += 1;
    const first = requests === 1;
    const message = assistantMessage({ stopReason: first ? "toolUse" : "stop", content: first
      ? [{ type: "toolCall", id: "blocked-bash", name: "Bash", arguments: { command: "sleep 600" } }]
      : [{ type: "text", text: "The next turn completed." }] }) as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    const finish = () => {
      stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
      stream.end(message);
    };
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      if (first) finish();
    });
    if (!first) finishNext = finish;
    return stream;
  } };
  return { runtime, host, execute, abort, events,
    get requests() { return requests; }, finishNext: () => finishNext() };
}

const terminalEvents = (events: AgentEventEnvelope["event"][]) => events
  .filter((event) => event.type === "turn_end" || event.type === "agent_end")
  .map((event) => event.type);

// Immediate abort finalizes the tool batch, then an aborted assistant iteration.
// Both pi turns end before the single public agent run ends.
const stoppedEvents = ["turn_end", "turn_end", "agent_end"];

it.each(["resolve", "reject"] as const)(
  "Stop shares its deadline with a hanging abort RPC and isolates its late %s", async (late) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const turn = createTurn();
    let ended = false;
    const first = turn.runtime.prompt("Run the command", "user", "first-turn").then(() => { ended = true; });
    try {
      await waitUntil(() => turn.host.call.mock.calls.some(([method]) => method === "tools.execute"));
      await turn.runtime.abort();
      await turn.runtime.abort();
      expect(turn.host.call.mock.calls.filter(([method]) => method === "tools.abort")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(ended).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(ended, "the abort acknowledgement must not extend the ten-second deadline").toBe(true);
      await first;
      expect(turn.runtime.getStatus().isRunning).toBe(false);
      expect(terminalEvents(turn.events)).toEqual(stoppedEvents);
      expect(turn.events.filter((event) => event.type === "message_end").map((event) => event.message.status))
        .toEqual(["complete", "aborted"]);
      expect(turn.events.filter((event) => event.type === "tool_end")).toHaveLength(1);

      const next = turn.runtime.prompt("Continue with a new turn", "user", "next-turn");
      await waitUntil(() => turn.requests === 2);
      expect(turn.runtime.getStatus().currentTurnId).toBe("next-turn");
      turn.execute.resolve({ ok: true, content: { output: "LATE_FIRST_TOOL", exitCode: 0 } });
      if (late === "reject") turn.abort.reject(new Error("late abort transport failure"));
      else turn.abort.resolve({ ok: true });
      await Promise.allSettled([turn.execute.promise, turn.abort.promise]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(turn.runtime.getStatus().isRunning).toBe(true);
      expect(JSON.stringify(turn.events)).not.toContain("LATE_FIRST_TOOL");
      expect(turn.events.filter((event) => event.type === "tool_end")).toHaveLength(1);
      expect(terminalEvents(turn.events)).toEqual(stoppedEvents);
      if (late === "reject") {
        expect(stderr.mock.calls.map(([text]) => String(text)).join("\n"))
          .toContain("tool abort acknowledgement failed after deadline (session=session-1 turn=first-turn toolCall=blocked-bash)");
      }
      turn.finishNext();
      await next;
      expect(turn.runtime.getStatus().isRunning).toBe(false);
      expect(terminalEvents(turn.events)).toEqual([...stoppedEvents, "turn_end", "agent_end"]);
    } finally {
      turn.execute.resolve({ ok: false, isError: true, errorCode: "TOOL_ABORTED", content: { output: "" } });
      turn.abort.resolve({ ok: true });
      turn.finishNext();
      await first;
      await turn.runtime.dispose();
      vi.useRealTimers();
      stderr.mockRestore();
    }
  },
);

it("keeps partial tool output while a missing abort acknowledgement consumes only the original grace", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const turn = createTurn();
  let ended = false;
  const running = turn.runtime.prompt("Run the command", "user", "partial-turn").then(() => { ended = true; });
  try {
    await waitUntil(() => turn.host.call.mock.calls.some(([method]) => method === "tools.execute"));
    await turn.runtime.abort();
    await vi.advanceTimersByTimeAsync(4_000);
    turn.execute.resolve({ ok: false, isError: true, errorCode: "TOOL_ABORTED",
      content: { output: "Partial output before cancellation", exitCode: 143 } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ended, "a settled execute must not start a second abort grace window").toBe(true);
    await running;
    expect(JSON.stringify(turn.events.filter((event) => event.type === "tool_end")))
      .toContain("Partial output before cancellation");
    expect(terminalEvents(turn.events)).toEqual(stoppedEvents);
  } finally {
    turn.execute.resolve({ ok: false, content: {} });
    turn.abort.resolve({ ok: true });
    await running;
    await turn.runtime.dispose();
    vi.useRealTimers();
  }
});
