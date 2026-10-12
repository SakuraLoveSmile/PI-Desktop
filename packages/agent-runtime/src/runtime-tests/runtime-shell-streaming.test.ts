import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime configuration matching", () => {

  it("routes matching Bash output through throttled progress and aborts", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Set<(method: string, params: unknown) => void>();
      let finishExecution!: (value: unknown) => void;
      const execution = new Promise((resolve) => {
        finishExecution = resolve;
      });
      const host = {
        call: vi.fn((method: string) =>
          method === "tools.execute"
            ? execution
            : Promise.resolve({ ok: true, content: "abort requested" }),
        ),
        onNotification: vi.fn((handler: (method: string, params: unknown) => void) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        }),
      };
      const updates: unknown[] = [];
      const runtime = createRuntime({ host });
      const bash = (runtime as any).agent.state.tools.find(
        (tool: any) => tool.name === "Bash",
      );
      const controller = new AbortController();
      const pending = bash.execute(
        "bash-progress",
        { command: "printf progress" },
        controller.signal,
        (update: unknown) => updates.push(update),
      );
      await vi.advanceTimersByTimeAsync(0);

      for (const listener of listeners) {
        listener("tools.output", {
          sessionId: "other-session",
          toolCallId: "bash-progress",
          commandShellId: "bash",
          stream: "stdout",
          chunk: "ignored",
        });
        listener("tools.output", {
          sessionId: "session-1",
          toolCallId: "bash-progress",
          commandShellId: "bash",
          stream: "stdout",
          chunk: "progress ",
        });
        listener("tools.output", {
          sessionId: "session-1",
          toolCallId: "bash-progress",
          commandShellId: "bash",
          stream: "stderr",
          chunk: "warning",
        });
      }
      expect(updates).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(99);
      expect(updates).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(updates).toHaveLength(1);
      expect((updates[0] as any).content[0].text).toBe("progress warning");

      controller.abort();
      expect(host.call).toHaveBeenCalledWith("tools.abort", {
        sessionId: "session-1",
        toolCallId: "bash-progress",
      });
      expect(listeners.size).toBe(0);
      finishExecution({
        ok: false,
        isError: true,
        errorCode: "TOOL_ABORTED",
        content: { code: "TOOL_ABORTED" },
      });
      await expect(pending).resolves.toMatchObject({
        isError: true,
        details: { code: "TOOL_ABORTED" },
      });
      expect(listeners.size).toBe(0);

      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes streamed-output resources when the host dies or runtime is disposed", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Set<(method: string, params: unknown) => void>();
      let closeHost!: () => void;
      let finishExecution!: (value: unknown) => void;
      const execution = new Promise((resolve) => {
        finishExecution = resolve;
      });
      const host = {
        call: vi.fn((method: string) =>
          method === "tools.execute"
            ? execution
            : Promise.resolve({ ok: true, content: "done" }),
        ),
        onNotification: vi.fn((handler: (method: string, params: unknown) => void) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        }),
        onClose: vi.fn((handler: () => void) => {
          closeHost = handler;
          return () => undefined;
        }),
      };
      const updates: unknown[] = [];
      const runtime = createRuntime({ host });
      const bash = (runtime as any).agent.state.tools.find(
        (tool: any) => tool.name === "Bash",
      );
      const pending = bash.execute(
        "bash-host-death",
        { command: "printf progress" },
        undefined,
        (update: unknown) => updates.push(update),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(listeners.size).toBe(1);
      closeHost();
      expect(listeners.size).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(updates).toHaveLength(0);
      finishExecution({ ok: true, content: "done" });
      await pending;

      await runtime.dispose();
      expect((runtime as any).activeToolProgressCleanups.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates a tools.abort protocol error instead of hiding it", async () => {
    let finishExecution!: (value: { ok: boolean; content: unknown }) => void;
    const execution = new Promise<{ ok: boolean; content: unknown }>((resolve) => {
      finishExecution = resolve;
    });
    const host = {
      call: vi.fn((method: string) =>
        method === "tools.execute"
          ? execution
          : Promise.reject(new Error("tools.abort protocol failure")),
      ),
      onNotification: vi.fn(() => () => undefined),
    };
    const runtime = createRuntime({ host });
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );
    const controller = new AbortController();
    const pending = bash.execute(
      "bash-abort-error",
      { command: "printf progress" },
      controller.signal,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    finishExecution({ ok: false, content: { code: "TOOL_ABORTED" } });
      await expect(pending).rejects.toThrow("tools.abort protocol failure");
    await runtime.dispose();
  });
});
