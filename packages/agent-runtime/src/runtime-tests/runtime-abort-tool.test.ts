import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

async function waitUntil(condition: () => boolean) {
  for (let turn = 0; turn < 100 && !condition(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

function endEvents(events: AgentEventEnvelope["event"][]) {
  return events
    .filter((event) => event.type === "turn_end" || event.type === "agent_end")
    .map((event) => event.type);
}

describe("DesktopAgentRuntime queued send-now tool abort", () => {
  it("requests the graceful stop before killing a running Bash call", async () => {
    const calls: string[] = [];
    let stopRequestedAtKill: boolean | undefined;
    let failExecute: ((error: Error) => void) | undefined;
    let runtime!: ReturnType<typeof createRuntime>;
    const host = {
      call: vi.fn((method: string) => {
        calls.push(method);
        if (method === "tools.execute") {
          return new Promise((_resolve, reject) => {
            failExecute = reject;
          });
        }
        if (method === "tools.abort") {
          // The host settles the pending Bash call with TOOL_ABORTED.
          stopRequestedAtKill = (runtime as any).gracefulStopRequested;
          failExecute?.(Object.assign(new Error("bash aborted"), { errorCode: "TOOL_ABORTED" }));
          return Promise.resolve({ ok: true, found: true, queued: false, aborted: true });
        }
        return Promise.resolve({ ok: true });
      }),
    };
    runtime = createRuntime({ host });
    (runtime as any).agent.state.isStreaming = true;
    const bash = (runtime as any).agent.state.tools.find((tool: any) => tool.name === "Bash");

    const running = bash.execute("bash-1", { command: "sleep 600" });
    await waitUntil(() => calls.includes("tools.execute"));

    expect(runtime.abortRunningBash("bash-1")).toEqual({ found: true, requested: true });
    await expect(running).rejects.toThrow("bash aborted");
    expect(stopRequestedAtKill).toBe(true);
    expect(calls.filter((method) => method === "tools.abort")).toHaveLength(1);
    expect(runtime.abortRunningBash("bash-1")).toEqual({ found: false, requested: false });

    await runtime.dispose();
  });

  /**
   * One real turn. The model asks for one Bash call per id in `bashIds`, all in
   * one batch. The host settles each call only when it is aborted, and the test
   * aborts each one in turn, the way a user would. `requestStopFirst` mirrors a
   * send-now whose graceful stop already went out. `suppressRunEnd` arms the
   * Goal report recovery, which turns a graceful stop into a hard abort.
   */
  async function runBashAbortTurn(
    options: { bashIds?: string[]; requestStopFirst?: boolean; suppressRunEnd?: boolean } = {},
  ) {
    const bashIds = options.bashIds ?? ["bash-1"];
    const events: AgentEventEnvelope["event"][] = [];
    const order: string[] = [];
    const failExecute = new Map<string, (error: Error) => void>();
    const host = {
      call: vi.fn((method: string, params?: { toolCallId?: string }) => {
        if (method === "tools.execute") {
          order.push(`execute ${params?.toolCallId}`);
          return new Promise((_resolve, reject) => {
            failExecute.set(String(params?.toolCallId), reject);
          });
        }
        if (method === "tools.abort") {
          const toolCallId = String(params?.toolCallId);
          order.push(`abort ${toolCallId}`);
          // The host settles the pending Bash call with TOOL_ABORTED.
          failExecute.get(toolCallId)?.(Object.assign(new Error("bash aborted"), { errorCode: "TOOL_ABORTED" }));
          return Promise.resolve({ ok: true, found: true, queued: false, aborted: true });
        }
        return Promise.resolve(undefined);
      }),
    };
    const runtime = createRuntime({
      host,
      onEvent: (envelope) => {
        events.push((envelope as AgentEventEnvelope).event);
      },
    });
    let requests = 0;
    (runtime as any).models = {
      streamSimple: () => {
        requests += 1;
        const askForTools = requests === 1;
        const message = assistantMessage({
          stopReason: askForTools ? "toolUse" : "stop",
          content: askForTools
            ? bashIds.map((id) => ({ type: "toolCall", id, name: "Bash", arguments: { command: "sleep 600" } }))
            : [{ type: "text", text: "Next reply" }],
        }) as unknown as AssistantMessage;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: askForTools ? "toolUse" : "stop", message });
          stream.end(message);
        });
        return stream;
      },
    };

    const running = runtime.prompt("Clean up the build", "user", "turn-1");
    for (const [index, toolCallId] of bashIds.entries()) {
      await waitUntil(() => order.includes(`execute ${toolCallId}`));
      if (index === 0) {
        // Armed the way a Goal without a report arms it: pending recovery and suppressed run end.
        if (options.suppressRunEnd) (runtime as any).goalReportRecovery.arm();
        if (options.requestStopFirst) {
          expect(runtime.requestGracefulStop()).toEqual({ requested: true });
          // Alone, the stop cannot reach its boundary while the Bash call blocks the batch.
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(runtime.getStatus().isRunning).toBe(true);
          expect(requests).toBe(1);
        }
      }
      expect(runtime.abortRunningBash(toolCallId)).toEqual({ found: true, requested: true });
      await waitUntil(() => order.includes(`abort ${toolCallId}`));
    }
    await running;

    const result = {
      order,
      requests,
      isRunning: runtime.getStatus().isRunning,
      endEvents: endEvents(events),
      messageStatuses: events
        .filter((event) => event.type === "message_end")
        .map((event) => event.message.status),
    };
    await runtime.dispose();
    return result;
  }

  it("ends the turn at the batch boundary after a send-now that stopped first aborts Bash", async () => {
    const run = await runBashAbortTurn({ requestStopFirst: true });

    expect(run.order).toEqual(["execute bash-1", "abort bash-1"]);
    // The stop ends the turn after the aborted batch, so the model is not asked again.
    expect(run.requests).toBe(1);
    expect(run.isRunning).toBe(false);
    expect(run.endEvents).toEqual(["turn_end", "agent_end"]);
  });

  it("requests the stop itself, so an abort alone still ends the turn at the boundary", async () => {
    const run = await runBashAbortTurn({ requestStopFirst: false });

    expect(run.order).toEqual(["execute bash-1", "abort bash-1"]);
    expect(run.requests).toBe(1);
    expect(run.isRunning).toBe(false);
    expect(run.endEvents).toEqual(["turn_end", "agent_end"]);
  });

  it("keeps the rest of the batch running after a Bash abort, and each Bash needs its own abort", async () => {
    const run = await runBashAbortTurn({ bashIds: ["bash-1", "bash-2"], requestStopFirst: true });

    // Tools in a batch run in order: the second Bash starts once the first has settled,
    // and it runs until it is aborted too.
    expect(run.order).toEqual(["execute bash-1", "abort bash-1", "execute bash-2", "abort bash-2"]);
    expect(run.requests).toBe(1);
    expect(run.isRunning).toBe(false);
    expect(run.endEvents).toEqual(["turn_end", "agent_end"]);
  });

  it("hard-aborts the run when Goal report recovery suppresses run end", async () => {
    const run = await runBashAbortTurn({ suppressRunEnd: true });

    expect(run.order).toEqual(["execute bash-1", "abort bash-1"]);
    // The hard abort fences the Goal report recovery: no second model request.
    expect(run.requests).toBe(1);
    expect(run.isRunning).toBe(false);
    expect(run.endEvents).toEqual(["turn_end", "agent_end"]);
    expect(run.messageStatuses).toEqual(["complete", "aborted"]);
  });

  it("reports nothing to abort for an unknown or settled Bash call", async () => {
    const host = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const runtime = createRuntime({ host });

    expect(runtime.abortRunningBash("missing")).toEqual({ found: false, requested: false });
    expect(host.call.mock.calls.map(([method]) => method)).not.toContain("tools.abort");

    await runtime.dispose();
  });

  it("leaves a Bash call running when no graceful stop can be requested", async () => {
    const calls: string[] = [];
    let failExecute: ((error: Error) => void) | undefined;
    const host = {
      call: vi.fn((method: string) => {
        calls.push(method);
        if (method === "tools.execute") {
          return new Promise((_resolve, reject) => {
            failExecute = reject;
          });
        }
        return Promise.resolve({ ok: true });
      }),
    };
    const runtime = createRuntime({ host });
    (runtime as any).agent.state.isStreaming = false;
    const bash = (runtime as any).agent.state.tools.find((tool: any) => tool.name === "Bash");

    const running = bash.execute("bash-2", { command: "sleep 600" });
    await waitUntil(() => calls.includes("tools.execute"));

    expect(runtime.abortRunningBash("bash-2")).toEqual({ found: true, requested: false });
    expect(calls).not.toContain("tools.abort");

    failExecute?.(new Error("test cleanup"));
    await expect(running).rejects.toThrow("test cleanup");
    await runtime.dispose();
  });
});
