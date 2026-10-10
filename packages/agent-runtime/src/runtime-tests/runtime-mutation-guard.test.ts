import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime configuration matching", () => {

  it("terminates a repeated Edit mismatch on the third failed attempt", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({
          ok: false,
          isError: true,
          errorCode: "TOOL_FAILED",
          content: { error: "tag does not hash the live file" },
        }),
    };
    const runtime = createRuntime({ host });
    const agent = (runtime as any).agent;
    const edit = agent.state.tools.find((tool: any) => tool.name === "Edit");
    const args = {
      path: "src/example.ts",
      tag: "ABCD",
      ops: "PUT 1.=1:\n+fresh\n",
    };

    const first = await edit.execute("edit-1", args);
    await expect(
      agent.afterToolCall({ toolCall: { id: "edit-1" } }),
    ).resolves.toEqual({ isError: true });
    expect(first.terminate).toBeUndefined();

    const second = await edit.execute("edit-2", args);
    expect(second.terminate).toBeUndefined();
    await expect(
      agent.afterToolCall({ toolCall: { id: "edit-2" } }),
    ).resolves.toEqual({ isError: true });

    const third = await edit.execute("edit-3", args);
    expect(third.terminate).toBe(true);
    await expect(
      agent.afterToolCall({ toolCall: { id: "edit-3" } }),
    ).resolves.toEqual({ isError: true, terminate: true });

    await runtime.dispose();
  });

  it("terminates repeated failed shell patch recovery", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({
        ok: false,
        isError: true,
        errorCode: "TOOL_FAILED",
        content: { exitCode: 128, stderr: "corrupt patch" },
      }),
    };
    const runtime = createRuntime({ host });
    const agent = (runtime as any).agent;
    const bash = agent.state.tools.find((tool: any) => tool.name === "Bash");
    const firstArgs = { command: "apply_patch <<'PATCH'\n*** Begin Patch\nPATCH" };
    const secondArgs = {
      command: "git -C /tmp/project apply --check /tmp/change.patch",
    };

    const first = await bash.execute("patch-1", firstArgs);
    await expect(
      agent.afterToolCall({ toolCall: { id: "patch-1" } }),
    ).resolves.toEqual({ isError: true });
    expect(first.terminate).toBeUndefined();

    const second = await bash.execute("patch-2", secondArgs);
    expect(second.terminate).toBeUndefined();
    await expect(
      agent.afterToolCall({ toolCall: { id: "patch-2" } }),
    ).resolves.toEqual({ isError: true });

    const third = await bash.execute("patch-3", secondArgs);
    expect(third.terminate).toBe(true);
    await expect(
      agent.afterToolCall({ toolCall: { id: "patch-3" } }),
    ).resolves.toEqual({ isError: true, terminate: true });

    await runtime.dispose();
  });

  it("spends one grace per recoverable Edit code before counting failures", async () => {
    const errorCodes = [
      "EDIT_TAG_MISMATCH",
      "EDIT_TAG_UNKNOWN",
      "EDIT_LINES_UNSEEN",
      "EDIT_TAG_MISMATCH",
      "EDIT_TAG_MISMATCH",
      "EDIT_TAG_MISMATCH",
    ];
    let editCall = 0;
    const host = {
      call: vi.fn(async (method: string) => {
        if (method !== "tools.execute") return undefined;
        return {
          ok: false,
          isError: true,
          errorCode: errorCodes[editCall++],
          content: { error: "stale tag" },
        };
      }),
    };
    const runtime = createRuntime({ host });
    const agent = (runtime as any).agent;
    const edit = agent.state.tools.find((tool: any) => tool.name === "Edit");
    const args = { path: "src/example.ts", tag: "A1B2", ops: "PUT 1.=1:\n+fresh" };

    // Each recoverable code answers itself: the error carries the live tag or
    // the unseen content, so one honest retry per code is the designed path.
    const mismatch = await edit.execute("edit-1", args);
    expect(mismatch.terminate).toBeUndefined();
    const unknown = await edit.execute("edit-2", args);
    expect(unknown.terminate).toBeUndefined();
    const unseen = await edit.execute("edit-3", args);
    expect(unseen.terminate).toBeUndefined();

    // The same code twice is the model ignoring what the first error said.
    const repeat = await edit.execute("edit-4", args);
    expect(repeat.terminate).toBeUndefined();
    const stillRecovering = await edit.execute("edit-5", args);
    expect(stillRecovering.terminate).toBeUndefined();
    const exhausted = await edit.execute("edit-6", args);
    expect(exhausted.terminate).toBe(true);

    await runtime.dispose();
  });

  it("clears the mutation strike once an edit on that path lands", async () => {
    const results = [
      { ok: false, isError: true, errorCode: "EDIT_PARSE_FAILED", content: {} },
      { ok: true, isError: false, content: { tag: "C3D4" } },
      { ok: false, isError: true, errorCode: "EDIT_PARSE_FAILED", content: {} },
    ];
    let editCall = 0;
    const host = {
      call: vi.fn(async (method: string) => {
        if (method !== "tools.execute") return undefined;
        return results[editCall++];
      }),
    };
    const runtime = createRuntime({ host });
    const agent = (runtime as any).agent;
    const edit = agent.state.tools.find((tool: any) => tool.name === "Edit");
    const args = { path: "src/example.ts", tag: "A1B2", ops: "PUT 1.=1:\n+fresh" };

    const failed = await edit.execute("edit-1", args);
    expect(failed.terminate).toBeUndefined();
    const landed = await edit.execute("edit-2", args);
    expect(landed.isError).toBe(false);

    // Without the reset this failure would be strike three and end the turn.
    const afterSuccess = await edit.execute("edit-3", args);
    expect(afterSuccess.terminate).toBeUndefined();
    expect((runtime as any).mutationFailureCounts.get("src/example.ts")).toBe(1);

    await runtime.dispose();
  });

  it("executes an edit with legacy old_string and new_string parameters", async () => {
    let capturedArgs: any;
    const host = {
      call: vi.fn(async (method: string, params: any) => {
        if (method !== "tools.execute") return undefined;
        capturedArgs = params.args;
        return {
          ok: true,
          isError: false,
          content: { path: "src/example.ts", tag: "C3D4" },
        };
      }),
    };
    const runtime = createRuntime({ host });
    const agent = (runtime as any).agent;
    const edit = agent.state.tools.find((tool: any) => tool.name === "Edit");
    const args = {
      path: "src/example.ts",
      old_string: "const a = 1;",
      new_string: "const a = 2;",
    };

    const result = await edit.execute("edit-legacy", args);
    expect(result.isError).toBe(false);
    expect(capturedArgs).toMatchObject({
      path: "src/example.ts",
      old_string: "const a = 1;",
      new_string: "const a = 2;",
    });

    await runtime.dispose();
  });

  it("reports a visible error row when the mutation guard ends the turn", async () => {
    const onEvent = vi.fn();
    const host = {
      call: vi.fn(async (method: string) => {
        if (method !== "tools.execute") return undefined;
        return {
          ok: false,
          isError: true,
          errorCode: "EDIT_PARSE_FAILED",
          content: { error: "missing body row" },
        };
      }),
    };
    const runtime = createRuntime({ host, onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const edit = agent.state.tools.find((tool: any) => tool.name === "Edit");
    const args = { path: "src/example.ts", tag: "A1B2", ops: "PUT 1.=1:" };

    await edit.execute("edit-1", args);
    const second = await edit.execute("edit-2", args);
    expect(second.terminate).toBeUndefined();
    const third = await edit.execute("edit-3", args);
    expect(third.terminate).toBe(true);
    // pi-agent-core stops the loop on a terminating batch, so agent_end is the
    // last chance to say why instead of completing the turn in silence.
    await handleAgentEvent({ type: "agent_end", messages: [] });

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "error",
          isError: true,
          error: expect.objectContaining({
            code: "MUTATION_RETRY_BUDGET_EXHAUSTED",
            retriable: true,
            details: expect.objectContaining({
              kind: "edit",
              lastErrorCode: "EDIT_PARSE_FAILED",
            }),
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          error: expect.objectContaining({
            message: expect.stringContaining(
              "A PUT with body rows must end its header with `:`",
            ),
            details: expect.objectContaining({
              recovery: expect.stringContaining("PUT 48.=48:"),
            }),
          }),
        }),
      }),
    );
    const visibleMessage = events.find(
      (event: any) => event.type === "message_end" && event.message?.error,
    )?.message?.error?.message;
    expect(visibleMessage).not.toContain("Re-read the file");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          code: "MUTATION_RETRY_BUDGET_EXHAUSTED",
        }),
      }),
    );
    expect((runtime as any).turnHadError).toBe(true);
    // One row per termination: a second agent_end must not repeat it.
    onEvent.mockClear();
    await handleAgentEvent({ type: "agent_end", messages: [] });
    const repeated = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(
      repeated.filter((event: any) => event.type === "error"),
    ).toHaveLength(0);

    await runtime.dispose();
  });
});
