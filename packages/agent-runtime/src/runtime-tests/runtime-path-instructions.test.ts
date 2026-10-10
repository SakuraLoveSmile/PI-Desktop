import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { PATH_INSTRUCTION_RESOLUTION_TIMEOUT_MS } from "../runtime.js";
import { createRuntime, runtimeMatches } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime configuration matching", () => {

  it("recreates the runtime when project instructions change", async () => {
    const projectInstructions = {
      entries: [{ source: "AGENTS.md", content: "Run unit tests." }],
    };
    const runtime = createRuntime({ projectInstructions });

    expect((runtime as any).agent.state.systemPrompt).toContain(
      "# Project instructions\n\n",
    );
    expect((runtime as any).agent.state.systemPrompt).toContain(
      "Run unit tests.",
    );
    expect(runtimeMatches(runtime)).toBe(true);
    expect(
      runtimeMatches(runtime, {
        projectInstructions: {
          entries: [{ source: "AGENTS.md", content: "Run lint." }],
        },
      }),
    ).toBe(false);

    await runtime.dispose();
  });

  it("loads newly discovered nested instructions before a file tool runs", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [
            {
              source: "packages/api/AGENTS.md",
              content: "Run API tests.",
            },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "file contents" }),
    };
    const runtime = createRuntime({ host });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-1", { path: "packages/api/handler.ts" });

    expect(host.call.mock.calls[0][0]).toBe("project.instructions.resolve");
    expect((runtime as any).agent.state.systemPrompt).toContain(
      "packages/api/AGENTS.md",
    );
    expect((runtime as any).agent.state.systemPrompt).toContain("Run API tests.");
    await runtime.dispose();
  });

  it.each([
    ["Read", { path: "packages/api/handler.ts" }],
    ["Write", { path: "packages/api/handler.ts", content: "export {};" }],
    ["Edit", {
      path: "packages/api/handler.ts",
      tag: "ABCD",
      ops: "PUT 1.=1:\n+after\n",
    }],
    ["BrowserPreview", { path: "packages/api/index.html" }],
  ])("resolves path-scoped instructions before %s", async (toolName, params) => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [{ source: "packages/api/AGENTS.md", content: "Use API rules." }],
        })
        .mockResolvedValueOnce({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host });
    let tool = (runtime as any).agent.state.tools.find(
      (candidate: any) => candidate.name === toolName,
    );
    if (!tool) {
      const search = (runtime as any).agent.state.tools.find(
        (candidate: any) => candidate.name === "ToolSearch",
      );
      await search.execute("search-1", { query: toolName });
      await (runtime as any).rebuiltAgentContext();
      tool = (runtime as any).agent.state.tools.find(
        (candidate: any) => candidate.name === toolName,
      );
    }

    await tool.execute(`tool-${toolName}`, params);

    expect(host.call.mock.calls[0][0]).toBe("project.instructions.resolve");
    expect((runtime as any).agent.state.systemPrompt).toContain("Use API rules.");
    await runtime.dispose();
  });

  it("replaces sibling-directory instructions for each file path", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [
            { source: "AGENTS.md", content: "Use root rules." },
            { source: "packages/a/AGENTS.md", content: "Use A rules." },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "A contents" })
        .mockResolvedValueOnce({
          entries: [
            { source: "AGENTS.md", content: "Use root rules." },
            { source: "packages/b/AGENTS.md", content: "Use B rules." },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "B contents" }),
    };
    const runtime = createRuntime({ host });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/a/file.ts" });
    expect((runtime as any).agent.state.systemPrompt).toContain("Use A rules.");

    await read.execute("tool-b", { path: "packages/b/file.ts" });
    expect((runtime as any).agent.state.systemPrompt).toContain("Use B rules.");
    expect((runtime as any).agent.state.systemPrompt).not.toContain("Use A rules.");
    await runtime.dispose();
  });

  it("claims one instruction chain per target directory within a prompt", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [{ source: "packages/api/AGENTS.md", content: "Use API rules." }],
        })
        .mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host, projectPath: "/workspace/project" });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/api/handler.ts" });
    await read.execute("tool-b", { path: "packages/api/routes.ts" });

    expect(
      host.call.mock.calls.filter(
        (call: unknown[]) => call[0] === "project.instructions.resolve",
      ),
    ).toHaveLength(1);
    expect(host.call.mock.calls[0][1]).toEqual({
      sessionId: "session-1",
      path: "packages/api/handler.ts",
      projectPath: "/workspace/project",
    });
    expect(host.call.mock.calls[1][0]).toBe("tools.execute");
    expect(host.call.mock.calls[2][0]).toBe("tools.execute");
    await runtime.dispose();
  });

  it("claims a fallback so one resolver failure cannot stall every sibling read", async () => {
    const host = {
      call: vi
        .fn()
        .mockRejectedValueOnce(new Error("resolver unavailable"))
        .mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({
      host,
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Use root rules." }],
      },
    });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/api/handler.ts" });
    await read.execute("tool-b", { path: "packages/api/routes.ts" });

    expect(
      host.call.mock.calls.filter(
        (call: unknown[]) => call[0] === "project.instructions.resolve",
      ),
    ).toHaveLength(1);
    expect((runtime as any).agent.state.systemPrompt).toContain("Use root rules.");
    await runtime.dispose();
  });

  it("keeps file tools moving when path instruction resolution times out", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [
            { source: "AGENTS.md", content: "Use root rules." },
            { source: "packages/a/AGENTS.md", content: "Use A rules." },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "A contents" })
        .mockRejectedValueOnce(new Error("parent host proxy timeout"))
        .mockResolvedValueOnce({ ok: true, content: "B contents" }),
    };
    const runtime = createRuntime({
      host,
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Use root rules." }],
      },
    });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/a/file.ts" });
    expect((runtime as any).agent.state.systemPrompt).toContain("Use A rules.");

    await read.execute("tool-b", { path: "packages/b/file.ts" });

    expect(host.call.mock.calls[2]).toEqual([
      "project.instructions.resolve",
      { sessionId: "session-1", path: "packages/b/file.ts" },
      PATH_INSTRUCTION_RESOLUTION_TIMEOUT_MS,
    ]);
    expect(host.call.mock.calls[3][0]).toBe("tools.execute");
    expect((runtime as any).agent.state.systemPrompt).toContain("Use root rules.");
    expect((runtime as any).agent.state.systemPrompt).not.toContain("Use A rules.");

  });
});
