import "./runtime-test-harness.js";
import { it, expect, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";
import type { TeamLeadExecutionGuard } from "../team/lead-execution-guard.js";
import type { GoalReportRecovery } from "../goal-report-recovery.js";

it.each(["team", "goal"] as const)("hard Team pause safely settles a foreground tool with %s recovery pending", async (recovery) => {
  let started!: () => void;
  let release!: () => void;
  const toolStarted = new Promise<void>((resolve) => { started = resolve; });
  const toolResult = new Promise<{ ok: boolean; content: string }>((resolve) => { release = () => resolve({ ok: true, content: "validation completed" }); });
  const calls: string[] = [];
  const host = { call: vi.fn(async (method: string) => {
    calls.push(method);
    if (method === "tools.execute") { started(); return toolResult; }
    return undefined;
  }) };
  const runtime = createRuntime({ host, executionProfile: "team",
    teamContext: { teamSessionId: "lead", callerSessionId: "session-1", isLead: false, memberName: "validator" } });
  const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple">;
    teamLeadExecution: TeamLeadExecutionGuard; goalReportRecovery: GoalReportRecovery };
  let requests = 0;
  view.models = { streamSimple: () => {
    requests++;
    const message = assistantMessage({ content: [
      { type: "toolCall", id: `loop-${requests}`, name: "Bash", arguments: { command: "printf validation" } },
      { type: "toolCall", id: `batch-second-${requests}`, name: "Bash", arguments: { command: "printf batch-tail" } },
    ], stopReason: "toolUse" }) as unknown as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "toolUse", message }); stream.end(message); });
    return stream;
  } };
  const running = runtime.prompt("Repeat validate, discover a defect, fix, and validate again.", "limit-turn");
  try {
    await toolStarted;
    // A recovery can be armed while the next tool batch is already streaming.
    if (recovery === "team") view.teamLeadExecution.suppressRunEnd = true;
    else view.goalReportRecovery.arm();
    const abort = vi.spyOn(view.agent, "abort");
    expect(runtime.requestGracefulStop(true)).toEqual({ requested: true });
    expect(abort).not.toHaveBeenCalled();
    expect(calls).not.toContain("tools.cancel");
    release();
    await running;
    expect(requests).toBe(1);
    expect(calls.filter((method) => method === "tools.execute")).toHaveLength(2);
    expect(runtime.getStatus().isRunning).toBe(false);
    expect(view.teamLeadExecution.suppressRunEnd).toBe(false);
    expect(view.goalReportRecovery.suppressRunEnd).toBe(false);
    expect(abort).not.toHaveBeenCalled();
  } finally { release(); await runtime.dispose(); }
});

it.each(["request", "stream"] as const)("hard pause fences infinite %s retries during Retry-After backoff", async (phase) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let retrying!: () => void;
  const ready = new Promise<void>((resolve) => { retrying = resolve; });
  const events: import("@pi-desktop/shared").AgentEventEnvelope["event"][] = [];
  const runtime = createRuntime({ onEvent: (input) => {
    const event = (input as import("@pi-desktop/shared").AgentEventEnvelope).event;
    events.push(event);
    if (event.type === "status" && event.status.activity?.phase === "retrying") retrying();
  } });
  runtime.setInfiniteProviderRetry(true);
  const view = runtime as unknown as { models: Pick<Models, "streamSimple">; providerRetryHeaders: Record<string, string> };
  let requests = 0;
  view.models = { streamSimple: () => {
    requests++;
    view.providerRetryHeaders = { "retry-after": "60" };
    const message = { ...assistantMessage({ content: [], stopReason: requests === 1 ? "error" : "stop" }),
      ...(requests === 1 ? { errorMessage: "429: too many requests" } : {}) } as unknown as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      if (phase === "stream" || requests > 1) stream.push({ type: "start", partial: message });
      if (requests === 1) stream.push({ type: "error", reason: "error", error: message });
      else stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    });
    return stream;
  } };
  const running = runtime.prompt("Verify the task", "retry-limit-turn");
  try {
    await ready;
    await Promise.resolve();
    expect(runtime.requestGracefulStop(true)).toEqual({ requested: true });
    await vi.advanceTimersByTimeAsync(61_000);
    await running;
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "error" && event.error.code === "TURN_ABORTED")).toHaveLength(1);
    expect(requests).toBe(1);
    expect(runtime.getStatus().isRunning).toBe(false);
  } finally { await runtime.dispose(); await running.catch(() => undefined); vi.useRealTimers(); }
});

it("hard pause before a delayed model reply refuses the new Bash batch", async () => {
  let providerStarted!: () => void;
  const ready = new Promise<void>((resolve) => { providerStarted = resolve; });
  let release!: () => void;
  const calls: string[] = [];
  const host = { call: vi.fn(async (method: string) => { calls.push(method); return { ok: true, content: "must not execute" }; }) };
  const runtime = createRuntime({ host });
  const view = runtime as unknown as { models: Pick<Models, "streamSimple"> };
  view.models = { streamSimple: () => {
    const stream = createAssistantMessageEventStream();
    release = () => {
      const message = assistantMessage({ content: [{ type: "toolCall", id: "late-bash", name: "Bash", arguments: { command: "printf new-work" } }], stopReason: "toolUse" }) as unknown as AssistantMessage;
      stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "toolUse", message }); stream.end(message);
    };
    providerStarted();
    return stream;
  } };
  const running = runtime.prompt("Wait for the model", "model-limit-turn");
  try {
    await ready;
    expect(runtime.requestGracefulStop(true)).toEqual({ requested: true });
    release();
    await running;
    expect(calls).not.toContain("tools.execute");
    expect(runtime.getStatus().isRunning).toBe(false);
  } finally { release(); await runtime.dispose(); }
});
