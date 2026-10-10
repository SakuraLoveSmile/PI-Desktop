import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { type UiMessage } from "@pi-desktop/shared";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime tool history restore (D120)", () => {

  const toolRow = (overrides: Partial<UiMessage> = {}): UiMessage => ({
    id: "tool-1",
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    status: "complete",
    toolName: "Grep",
    toolCallId: "call-1",
    toolStatus: "success",
    toolArgs: { pattern: "renderFormContent" },
    toolResult: {
      content: [{ type: "text", text: "index.html:2924 match" }],
      details: { count: 1 },
    },
    ...overrides,
  });

  it("restores tool call/result pairs adjacent to their assistant turn", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "optimize the form",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Let me find the render code.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow(),
        {
          id: "assistant-2",
          role: "assistant",
          content: "Found it.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const messages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");

    expect(messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(messages[1].stopReason).toBe("toolUse");
    expect(messages[1].content).toEqual([
      { type: "text", text: "Let me find the render code." },
      {
        type: "toolCall",
        id: "call-1",
        name: "Grep",
        arguments: { pattern: "renderFormContent" },
      },
    ]);
    expect(messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "Grep",
      content: [{ type: "text", text: "index.html:2924 match" }],
      details: { count: 1 },
      isError: false,
    });
    expect(messages[3].stopReason).toBe("stop");

    await runtime.dispose();
  });

  it("keeps one tool call when the transcript carries the same call id twice", async () => {
    // A retried append can leave the same call on two rows (the file is
    // append-only), and a provider rejects the whole request with `tool_use ids
    // must be unique` (issue #718). The first occurrence wins; the later row is
    // dropped, because that call already has its result.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "optimize the form",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Let me find the render code.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ id: "tool-1", toolCallId: "call-1" }),
        // The same call again, under the row id a re-persist would have left.
        toolRow({ id: "tool-1-retry", toolCallId: "call-1" }),
        {
          id: "assistant-2",
          role: "assistant",
          content: "Found it.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const context = (runtime as any).liveSessionContext().messages;
    // The rebuilt context still carries both snapshots; the request view is
    // where the provider's rule is enforced, because that is the last place
    // both a resumed and a live-appended history pass through.
    const outgoing = (runtime as any).dropDuplicateToolCalls(context);

    const toolCalls = outgoing
      .filter((message: any) => message.role === "assistant")
      .flatMap((message: any) =>
        (message.content as any[]).filter((block) => block.type === "toolCall"),
      );
    expect(toolCalls.map((call: any) => call.id)).toEqual(["call-1"]);
    expect(
      outgoing.filter((message: any) => message.role === "toolResult"),
    ).toHaveLength(1);
    // The result the kept call belongs to is the one that survives.
    expect(
      outgoing.find((message: any) => message.role === "toolResult").toolCallId,
    ).toBe("call-1");

    const line = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(line).toContain("dropped 2 duplicate tool call entries");
    expect(line).toContain("session=session-1");
    expect(line).toContain("ids=call-1");
    stderr.mockRestore();

    await runtime.dispose();
  });

  it("leaves a request with unique tool calls untouched", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Two reads.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ id: "tool-a", toolCallId: "call-a" }),
        toolRow({ id: "tool-b", toolCallId: "call-b" }),
      ],
    });
    const context = (runtime as any).liveSessionContext().messages;
    // Identity, not a copy: the common path pays nothing and logs nothing.
    expect((runtime as any).dropDuplicateToolCalls(context)).toBe(context);
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
    await runtime.dispose();
  });

  it("keeps call-only assistant turns as carriers and drops truly empty ones", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-empty-with-tools",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ id: "tool-a", toolCallId: "call-a" }),
        toolRow({ id: "tool-b", toolCallId: "call-b" }),
        {
          id: "assistant-empty",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const messages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");

    expect(messages.map((m: any) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
    ]);
    expect(messages[0].content.map((b: any) => b.id)).toEqual([
      "call-a",
      "call-b",
    ]);

    await runtime.dispose();
  });

  it("synthesizes a carrier for tool rows whose assistant row was lost", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow(),
      ],
    });
    const messages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");

    expect(messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(messages[1].content).toEqual([
      {
        type: "toolCall",
        id: "call-1",
        name: "Grep",
        arguments: { pattern: "renderFormContent" },
      },
    ]);
    expect(messages[1].stopReason).toBe("toolUse");

    await runtime.dispose();
  });

  it("restores interrupted tool rows as errored results", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Running it now.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({
          toolStatus: "running",
          toolResult: undefined,
        }),
      ],
    });
    const messages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [
        {
          type: "text",
          text: "[tool call was interrupted before a result was recorded]",
        },
      ],
    });

    await runtime.dispose();
  });

  it("restores deferred tool activation markers from persisted results", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Loading the preview tool.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({
          toolName: "ToolSearch",
          toolResult: {
            content: [{ type: "text", text: "Activated BrowserPreview." }],
            details: { activated: ["BrowserPreview"] },
            addedToolNames: ["BrowserPreview"],
          },
        }),
      ],
    });
    const messages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      details: { activated: ["BrowserPreview"] },
    });

    await runtime.dispose();
  });

  it("skips tool rows without a call id and keeps plain restores unchanged", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "answer",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ toolCallId: undefined }),
      ],
    });
    const messages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");

    expect(messages.map((m: any) => m.role)).toEqual(["assistant"]);
    expect(messages[0].content).toEqual([{ type: "text", text: "answer" }]);
    expect(messages[0].stopReason).toBe("stop");

    await runtime.dispose();
  });
});
