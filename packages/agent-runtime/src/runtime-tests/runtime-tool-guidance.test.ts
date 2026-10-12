import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { looksLikePseudoToolCall } from "../runtime.js";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime configuration matching", () => {

  it("guides mutation tools away from patch repair loops", async () => {
    const runtime = createRuntime();
    const prompt = (runtime as any).agent.state.systemPrompt as string;

    expect(prompt).toContain("hand-edited unified-diff files");
    expect(prompt).toContain("Do not use shell apply_patch, git apply, patch");
    expect(prompt).toContain("Never modify the same path concurrently");
    expect(prompt).toContain("After three failed edit attempts on the same path");

    const edit = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Edit",
    );
    expect(edit.description).toContain("never old_string");
    expect(edit.description).toContain("same path concurrently");
    expect(edit.description).toContain("PUT N.=M:");
    expect(edit.description).toContain("PUT 48.=48:");
    expect(edit.description).toContain("followed by + rows is invalid");
    expect(edit.description).toContain("classify the error");
    expect(edit.parameters.properties.ops.description).toContain(
      "PUT 48.=48:",
    );
    expect(edit.parameters.properties).toEqual(
      expect.objectContaining({
        tag: expect.any(Object),
        ops: expect.any(Object),
      }),
    );

    await runtime.dispose();
  });

  it("requires visible progress updates and the user's language", async () => {
    const runtime = createRuntime();
    const prompt = (runtime as any).agent.state.systemPrompt as string;

    expect(prompt).toContain("Answer in the user's language");
    expect(prompt).toContain("Keep the user informed during long work");
    expect(prompt).toContain(
      "The final response must state the outcome, verification, and remaining blockers",
    );
    expect(prompt).toContain("Resolve recoverable blockers yourself");

    await runtime.dispose();
  });

  it("provides ToolSearch so deferred tools can be activated on demand", async () => {
    const runtime = createRuntime();
    const tools = (runtime as any).agent.state.tools as Array<any>;
    const toolSearch = tools.find((tool: any) => tool.name === "ToolSearch");

    expect(toolSearch).toBeDefined();
    expect(toolSearch.description).toContain("on-demand tool");

    await runtime.dispose();
  });

  it("exposes bounded, scopeable search parameters to the model", async () => {
    const runtime = createRuntime({ mode: "chat" });
    const tools = (runtime as any).agent.state.tools as Array<any>;
    const byName = (name: string) => tools.find((tool) => tool.name === name);

    expect(byName("Read").parameters.properties).toEqual(
      expect.objectContaining({ offset: expect.any(Object), limit: expect.any(Object) }),
    );
    expect(byName("Glob").parameters.properties).toEqual(
      expect.objectContaining({ path: expect.any(Object), limit: expect.any(Object) }),
    );
    expect(byName("Grep").parameters.properties).toEqual(
      expect.objectContaining({
        path: expect.any(Object),
        include: expect.any(Object),
        outputMode: expect.any(Object),
        headLimit: expect.any(Object),
      }),
    );
    expect(byName("Grep").parameters.properties.outputMode.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ const: "filesWithMatches" }),
        expect.objectContaining({ const: "count" }),
      ]),
    );
    expect(byName("Read").description).toContain("never a directory");
    expect(byName("Read").description).toContain(
      "truncated` is true only when this window was cut short",
    );
    expect(byName("Read").parameters.properties.limit.description).toContain(
      "defaults to 2000",
    );
    expect(byName("Read").parameters.properties.path.description).toContain(
      "Existing regular file only",
    );
    expect(byName("Glob").parameters.properties.path.description).toContain(
      "Directory to search",
    );
    expect(byName("Grep").description).toContain(
      "one file or a directory tree",
    );
    expect(byName("Grep").parameters.properties.path.description).toContain(
      "File or directory to search",
    );

    await runtime.dispose();
  });

  it("recognizes a tool call leaked into assistant text", () => {
    expect(
      looksLikePseudoToolCall(
        'to=multi_tool_use.parallel code:{"tool_uses":[{"recipient_name":"functions.Read"}]}',
      ),
    ).toBe(true);
    expect(looksLikePseudoToolCall('{"tool_uses": [{"recipient_name": "x"}]}')).toBe(
      true,
    );
    expect(
      looksLikePseudoToolCall("I will read the file and then run the tests."),
    ).toBe(false);
  });

  it("preserves host failure diagnostics while marking the agent tool result", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({
        ok: false,
        isError: true,
        errorCode: "TOOL_FAILED",
        content: { exitCode: 7, stderr: "diagnostic" },
      }),
    };
    const runtime = createRuntime({ host });
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );

    const result = await bash.execute("tool-failed", { command: "exit 7" });

    expect(result.details).toEqual({ exitCode: 7, stderr: "diagnostic" });
    expect(result.content[0].text).toContain('"exitCode": 7');
    await expect(
      (runtime as any).agent.afterToolCall({ toolCall: { id: "tool-failed" } }),
    ).resolves.toEqual({ isError: true });
    expect((runtime as any).failedHostToolCalls.size).toBe(0);

    await runtime.dispose();
  });
});
