import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

async function waitForCall(calls: string[], method: string) {
  for (let turn = 0; turn < 100 && !calls.includes(method); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(calls).toContain(method);
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
    await waitForCall(calls, "tools.execute");

    expect(runtime.abortRunningBash("bash-1")).toEqual({ found: true, requested: true });
    await expect(running).rejects.toThrow("bash aborted");
    expect(stopRequestedAtKill).toBe(true);
    expect(calls.filter((method) => method === "tools.abort")).toHaveLength(1);
    expect(runtime.abortRunningBash("bash-1")).toEqual({ found: false, requested: false });

    await runtime.dispose();
  });

  /**
   * One real turn: the model asks for a Bash call that the host settles only
   * when it is aborted. `requestStopFirst` mirrors a send-now whose graceful
   * stop already went out; without it, the abort itself must request the stop.
   */
  async function runBashAbortTurn(requestStopFirst: boolean) {
    const events: AgentEventEnvelope["event"][] = [];
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
        if (method === "tools.abort") {
          // The host settles the pending Bash call with TOOL_ABORTED.
          failExecute?.(Object.assign(new Error("bash aborted"), { errorCode: "TOOL_ABORTED" }));
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
        const askForBash = requests === 1;
        const message = assistantMessage({
          stopReason: askForBash ? "toolUse" : "stop",
          content: askForBash
            ? [{ type: "toolCall", id: "bash-1", name: "Bash", arguments: { command: "sleep 600" } }]
            : [{ type: "text", text: "Next reply" }],
        }) as unknown as AssistantMessage;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: askForBash ? "toolUse" : "stop", message });
          stream.end(message);
        });
        return stream;
      },
    };

    const running = runtime.prompt("Clean up the build", "user", "turn-1");
    await waitForCall(calls, "tools.execute");
    if (requestStopFirst) {
      expect(runtime.requestGracefulStop()).toEqual({ requested: true });
      // Alone, the stop cannot reach its boundary while the Bash call blocks the batch.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(runtime.getStatus().isRunning).toBe(true);
      expect(requests).toBe(1);
    }

    expect(runtime.abortRunningBash("bash-1")).toEqual({ found: true, requested: true });
    await waitForCall(calls, "tools.abort");
    await running;

    expect(calls.filter((method) => method === "tools.abort")).toHaveLength(1);
    // The stop ends the turn after the aborted batch, so the model is not asked again.
    expect(requests).toBe(1);
    expect(runtime.getStatus().isRunning).toBe(false);
    expect(
      events.filter((event) => event.type === "turn_end" || event.type === "agent_end").map((event) => event.type),
    ).toEqual(["turn_end", "agent_end"]);
    await runtime.dispose();
  }

  it("ends the turn at the batch boundary after a send-now that stopped first aborts Bash", () =>
    runBashAbortTurn(true));

  it("requests the stop itself, so an abort alone still ends the turn at the boundary", () =>
    runBashAbortTurn(false));

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
    await waitForCall(calls, "tools.execute");

    expect(runtime.abortRunningBash("bash-2")).toEqual({ found: true, requested: false });
    expect(calls).not.toContain("tools.abort");

    failExecute?.(new Error("test cleanup"));
    await expect(running).rejects.toThrow("test cleanup");
    await runtime.dispose();
  });
});
