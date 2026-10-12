import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { createRuntime, runtimeMatches } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime plugin skills (D174)", () => {

  const pluginSkills = [
    {
      id: "demo.hello/release-notes",
      name: "Release notes",
      description: "Draft release notes from the changelog.",
    },
  ];

  it("advertises the catalog and ships the Skill tool with the first request (D404)", async () => {
    const runtime = createRuntime({
      pluginSkills,
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Run unit tests." }],
      },
    });
    const agent = (runtime as any).agent;
    const prompt = agent.state.systemPrompt as string;

    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("`demo.hello/release-notes`");
    expect(prompt).toContain("Run unit tests.");
    // Only the catalog line travels up front; the body loads on demand.
    expect(prompt).not.toContain("Skill: Release notes");
    // The catalog is useless behind a search: the tool is callable on turn one.
    expect(agent.state.tools.some((tool: any) => tool.name === "Skill")).toBe(true);
    // The user's own instructions come last, so they keep the final word.
    expect(prompt.indexOf("# Skills")).toBeLessThan(
      prompt.indexOf("# Project instructions"),
    );

    await runtime.dispose();
  });

  it("omits the Skill tool and section when no plugin taught a skill", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;

    expect(agent.state.systemPrompt).not.toContain("# Skills");
    expect(agent.state.tools.some((tool: any) => tool.name === "Skill")).toBe(false);

    await runtime.dispose();
  });

  it("keeps the catalog through a nested instruction reload", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({
        entries: [{ source: "src/AGENTS.md", content: "Use tabs." }],
      }),
    };
    const runtime = createRuntime({ pluginSkills, host });

    await (runtime as any).loadPathInstructions("Read", { path: "src/a.ts" });

    const prompt = (runtime as any).agent.state.systemPrompt;
    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("Use tabs.");

    await runtime.dispose();
  });

  it("reuses an idle runtime when the skill catalog changes", async () => {
    const runtime = createRuntime({ pluginSkills });

    expect(runtimeMatches(runtime, { pluginSkills })).toBe(true);
    // Revoking agent.prompt.inject empties the catalog.
    expect(runtimeMatches(runtime, { pluginSkills: [] })).toBe(true);
    expect(
      runtimeMatches(runtime, {
        pluginSkills: [...pluginSkills, { id: "demo.hello/other", name: "Other" }],
      }),
    ).toBe(true);
    // A renamed skill rewrites the catalog line the model reads.
    expect(
      runtimeMatches(runtime, {
        pluginSkills: [{ ...pluginSkills[0], name: "Renamed" }],
      }),
    ).toBe(true);

    await runtime.dispose();
  });

  it("routes a Skill call to the host tool bridge", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({ ok: true, content: "# Skill: Release notes" }),
    };
    const runtime = createRuntime({ pluginSkills, host });
    const tool = (runtime as any).agent.state.tools.find(
      (entry: any) => entry.name === "Skill",
    );

    const result = await tool.execute("call-1", { id: "demo.hello/release-notes" });

    expect(host.call).toHaveBeenCalledWith(
      "tools.execute",
      expect.objectContaining({
        toolName: "Skill",
        args: { id: "demo.hello/release-notes" },
      }),
    );
    expect(result.content).toEqual([
      { type: "text", text: "# Skill: Release notes" },
    ]);

    await runtime.dispose();
  });
});
