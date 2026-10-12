import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type Agent } from "@earendil-works/pi-agent-core";
import { type RuntimeProviderConfig } from "../runtime.js";
import { type ProjectInstructions } from "../project-instructions.js";
import { subagentRuns, provider, createRuntime, runtimeMatches } from "./runtime-test-harness.js";
import { explorer, pinned, taskTool } from "./subagent-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  it("keeps a private definition pin out of the override catalog and other delegates (#286)", async () => {
    const remote = { ...provider, id: "remote", name: "Remote", modelId: "remote-model", modelConfig: undefined };
    const host = { call: vi.fn().mockRejectedValue(new Error("not enabled for delegation")) };
    const runtime = createRuntime({
      subagents: [explorer, pinned],
      subagentProviders: { "remote/remote-model": remote },
      subagentModelKeys: [],
      host,
    });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    subagentRuns.result = undefined;
    expect((runtime as any).subagentModelSummary()).not.toContain("remote/remote-model");
    const result = await taskTool(runtime).execute("cross-pin", {
      agent: "explorer", task: "Search.", model: "remote/remote-model",
    });
    expect(result.details.error).toContain("not available for delegation");
    expect(subagentRuns.calls).toHaveLength(0);
    expect(host.call).toHaveBeenCalledWith("provider.resolveSubagentModel", { key: "remote/remote-model" });
    await taskTool(runtime).execute("own-pin", { agent: "reviewer", task: "Review." });
    expect(subagentRuns.calls[0].provider).toBe(remote);
    expect(taskTool(runtime).description).toContain("Default model: remote/remote-model");
    const echoed = await taskTool(runtime).execute("own-pin-echo", {
      agent: "reviewer", task: "Review.", model: "remote/remote-model",
    });
    expect(echoed.details.error).toBeUndefined();
    expect(subagentRuns.calls[1].provider).toBe(remote);
    expect(host.call).toHaveBeenCalledTimes(1);
  });

  it("allows an opted-in model to override a definition pin without changing D278", async () => {
    const pinnedProvider = { ...provider, modelId: "remote-model", modelConfig: undefined };
    const selected = { ...provider, modelId: "selected-model", modelConfig: undefined };
    const runtime = createRuntime({
      subagents: [pinned],
      subagentProviders: { "remote/remote-model": pinnedProvider, "allowed/selected-model": selected },
      subagentModelKeys: ["allowed/selected-model"],
    });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    expect((runtime as any).subagentModelSummary()).toContain("allowed/selected-model");
    expect((runtime as any).subagentModelSummary()).not.toContain("remote/remote-model");
    await taskTool(runtime).execute("allowed", { agent: "reviewer", task: "Review.", model: "allowed/selected-model" });
    expect(subagentRuns.calls[0].provider).toBe(selected);
    expect(runtimeMatches(runtime)).toBe(true);
    expect(runtimeMatches(runtime, { subagentModelKeys: [] })).toBe(false);
    await runtime.dispose();
  });

  it("caches only successfully authorized on-demand overrides", async () => {
    const selected = { ...provider, modelId: "new-model", modelConfig: undefined };
    const host = { call: vi.fn().mockResolvedValue(selected) };
    const runtime = createRuntime({ subagents: [explorer], host });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    for (const id of ["first", "cached"]) {
      await taskTool(runtime).execute(id, { agent: "explorer", task: "Search.", model: "new/new-model" });
    }
    expect(subagentRuns.calls).toHaveLength(2);
    expect(host.call).toHaveBeenCalledTimes(1);
    expect((runtime as any).availableSubagentModelKeys()).toEqual(["new/new-model"]);
    expect((runtime as any).subagentModelKeys.has("new/new-model")).toBe(false);
    expect(runtimeMatches(runtime)).toBe(true);
    await runtime.dispose();
  });

  it("does not replace a private pin with another account's on-demand binding (#286)", async () => {
    const pin = { ...provider, id: "account-a", name: "A", modelId: "remote-model", modelConfig: undefined };
    const other = { ...provider, id: "account-b", name: "B", modelId: "remote-model", modelConfig: undefined };
    const host = { call: vi.fn().mockResolvedValue(other) };
    const runtime = createRuntime({
      subagents: [explorer, pinned],
      subagentProviders: { "remote/remote-model": pin },
      subagentModelKeys: [],
      host,
    });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    subagentRuns.result = undefined;
    const denied = await taskTool(runtime).execute("cross", {
      agent: "explorer", task: "Search.", model: "remote/remote-model",
    });
    expect(denied.details.error).toContain("not available for delegation");
    expect(subagentRuns.calls).toHaveLength(0);
    await taskTool(runtime).execute("own", { agent: "reviewer", task: "Review." });
    expect(subagentRuns.calls[0].provider).toBe(pin);
    expect((runtime as any).subagentProviders["remote/remote-model"]).toBe(pin);
    expect(runtimeMatches(runtime)).toBe(true);
    await runtime.dispose();
  });

  it("rechecks an on-demand grant after revocation on the next prompt (#841)", async () => {
    const selected = { ...provider, modelId: "new-model", modelConfig: undefined };
    const host = { call: vi.fn().mockResolvedValue(selected) };
    const runtime = createRuntime({ subagents: [explorer], host });
    const agent = (runtime as unknown as { agent: Agent }).agent;
    vi.spyOn(agent, "prompt").mockResolvedValue();
    vi.spyOn(agent, "waitForIdle").mockResolvedValue();
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    try {
      await taskTool(runtime).execute("granted", { agent: "explorer", task: "Search.", model: "new/new-model" });
      expect(subagentRuns.calls).toHaveLength(1);
      host.call.mockRejectedValue(new Error("model is not enabled for delegation"));
      expect(runtimeMatches(runtime)).toBe(true);
      await runtime.prompt("Search again.");
      const denied = await taskTool(runtime).execute("revoked", { agent: "explorer", task: "Search.", model: "new/new-model" });
      expect(denied.details.error).toContain("not available for delegation");
      expect(subagentRuns.calls).toHaveLength(1);
      expect(host.call).toHaveBeenLastCalledWith("provider.resolveSubagentModel", { key: "new/new-model" });
    } finally { await runtime.dispose(); }
  });

  it("discards an on-demand grant returned after its prompt ended (#841)", async () => {
    let resolveGrant: (value: RuntimeProviderConfig) => void = () => {};
    const host = { call: vi.fn().mockImplementation(() => new Promise<RuntimeProviderConfig>((resolve) => { resolveGrant = resolve; })) };
    const runtime = createRuntime({ subagents: [explorer], host });
    const agent = (runtime as unknown as { agent: Agent }).agent;
    vi.spyOn(agent, "prompt").mockResolvedValue();
    vi.spyOn(agent, "waitForIdle").mockResolvedValue();
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    try {
      const pending = taskTool(runtime).execute("pending", { agent: "explorer", task: "Search.", model: "new/new-model" });
      await runtime.prompt("A new turn.");
      resolveGrant({ ...provider, modelId: "new-model", modelConfig: undefined });
      const expired = await pending;
      expect(expired.details.error).toContain("not available for delegation");
      host.call.mockRejectedValue(new Error("model is not enabled for delegation"));
      const denied = await taskTool(runtime).execute("revoked", { agent: "explorer", task: "Search.", model: "new/new-model" });
      expect(denied.details.error).toContain("not available for delegation");
      expect(subagentRuns.calls).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it("is the only tool allowed to run in parallel", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    const catalog = (runtime as any).toolCatalog as Map<string, any>;

    expect(catalog.get("Task").executionMode).toBe("parallel");
    for (const [name, tool] of catalog) {
      if (name === "Task") continue;
      expect(tool.executionMode).toBe("sequential");
    }

    await runtime.dispose();
  });

  it("withholds undefined delegates but rejects all declared Task tools in contract modes", async () => {
    const withoutDefinitions = createRuntime();
    expect(taskTool(withoutDefinitions)).toBeUndefined();
    await withoutDefinitions.dispose();

    // Plan and Goal are read-only contract negotiations (D198): a delegate
    // with Bash or Edit would drive straight through them.
    for (const mode of ["plan", "goal"] as const) {
      const runtime = createRuntime({ mode, subagents: [explorer] });
      const previousRuns = subagentRuns.calls.length;
      try {
        const agent = (runtime as unknown as { agent: Agent }).agent;
        for (const name of ["Task", "TaskWait", "TaskList", "TaskStop"]) {
          const tool = agent.state.tools.find((entry) => entry.name === name);
          expect(tool).toBeDefined();
          expect(tool?.description).toContain(`not allowed in ${mode}`);
          await expect(tool?.execute(`blocked-${name}`, { agent: "explorer", task: "Inspect." }))
            .rejects.toThrow(`not allowed in ${mode}`);
        }
        expect(subagentRuns.calls).toHaveLength(previousRuns);
      } finally {
        await runtime.dispose();
      }
    }
  });

  it("rebuilds the Task catalog on a mode switch", async () => {
    const runtime = createRuntime({ subagents: [explorer] });

    const staleTask = taskTool(runtime);
    runtime.setMode("plan");
    expect(taskTool(runtime)).toBeDefined();
    await expect(staleTask.execute("stale-task", { agent: "explorer", task: "Inspect." }))
      .rejects.toThrow("not allowed in plan");
    runtime.setMode("agent");
    expect(taskTool(runtime)).toBeDefined();

    await runtime.dispose();
  });

  it("treats a differing definition set as a different configuration", async () => {
    const runtime = createRuntime({ subagents: [explorer] });

    expect(runtimeMatches(runtime)).toBe(true);
    expect(runtimeMatches(runtime, { subagents: [] })).toBe(false);
    // Definitions are compared by value, body included.
    expect(
      runtimeMatches(runtime, {
        subagents: [{ ...explorer, description: "Search other things." }],
      }),
    ).toBe(false);
    expect(
      runtimeMatches(runtime, {
        subagentProviders: { "remote/remote-model": provider },
      }),
    ).toBe(false);

    await runtime.dispose();
  });

  it("rejects an unknown agent and an empty brief as tool errors", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    const agent = (runtime as any).agent;
    const tool = taskTool(runtime);

    const unknown = await tool.execute("task-1", {
      agent: "Researcher",
      task: "Find it.",
    });
    expect(unknown.content[0].text).toContain('Unknown subagent "Researcher"');
    expect(unknown.content[0].text).toContain("explorer");
    await expect(
      agent.afterToolCall({ toolCall: { id: "task-1" } }),
    ).resolves.toEqual({ isError: true });

    const empty = await tool.execute("task-2", { agent: "explorer", task: "  " });
    expect(empty.content[0].text).toContain("needs a non-empty `task` brief");
    await expect(
      agent.afterToolCall({ toolCall: { id: "task-2" } }),
    ).resolves.toEqual({ isError: true });

    await runtime.dispose();
  });

  it("inherits the session model when the parent echoes it as an override", async () => {
    const current = { ...provider, vendorKey: "openai", modelId: "gpt-4o-mini" };
    const runtime = createRuntime({ provider: current, subagents: [explorer] });
    const tool = taskTool(runtime);
    subagentRuns.calls.length = 0;
    subagentRuns.result = undefined;

    expect((runtime as any).agent.state.systemPrompt).toContain(
      "Omit the `model` parameter on Task to use the definition's default model, or inherit the parent conversation's selected model when no default is pinned.",
    );
    const result = await tool.execute("task-1", {
      agent: "explorer",
      task: "Inspect the project.",
      model: "openai/gpt-4o-mini",
    });

    expect(subagentRuns.calls).toHaveLength(1);
    expect(subagentRuns.calls[0].provider).toBe(current);
    expect(result.content[0].text).toContain("in the background");
    await runtime.dispose();
  });

  it("refuses to silently downgrade an unresolved pinned model", async () => {
    const runtime = createRuntime({ subagents: [pinned] });
    const tool = taskTool(runtime);

    const result = await tool.execute("task-1", {
      agent: "reviewer",
      task: "Review src/app.ts.",
    });

    expect(result.content[0].text).toContain("pins remote/remote-model");
    expect(result.content[0].text).toContain("not configured");
    await expect(
      (runtime as any).agent.afterToolCall({ toolCall: { id: "task-1" } }),
    ).resolves.toEqual({ isError: true });

    await runtime.dispose();
  });

  it("resolves the provider and guidance each definition asks for", async () => {
    const remote: RuntimeProviderConfig = {
      ...provider,
      id: "remote",
      name: "Remote",
      modelId: "remote-model",
      modelConfig: undefined,
    };
    const runtime = createRuntime({
      subagents: [explorer, pinned],
      subagentProviders: { "remote/remote-model": remote },
      scratchDir: "/scratch/session-1",
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Use project rules." }],
      } as ProjectInstructions,
    });

    // No pin means the session's own provider; a pin means exactly that model.
    expect((runtime as any).subagentProvider(explorer).modelId).toBe("local-model");
    expect((runtime as any).subagentProvider(pinned).modelId).toBe("remote-model");

    const readOnly = ((runtime as any).subagentGuidance(explorer) as string[]).join(
      "\n\n",
    );
    expect(readOnly).toContain("prefer Read, Grep, and Glob");
    expect(readOnly).toContain(
      "Read accepts only an existing regular text file, never a directory",
    );
    expect(readOnly).toContain("Grep takes a file-or-directory `path`");
    expect(readOnly).not.toContain("use Edit for one small unique replacement");
    expect(readOnly).toContain("Use project rules.");

    const withShell = ((runtime as any).subagentGuidance(pinned) as string[]).join(
      "\n\n",
    );
    expect(withShell).toContain("bash");
    expect(withShell).toContain("/scratch/session-1");

    await runtime.dispose();
  });

  it("preserves a definition's no-pass thinking selection", async () => {
    const remote: RuntimeProviderConfig = {
      ...provider,
      id: "remote",
      name: "Remote",
      modelId: "remote-model",
      modelConfig: undefined,
    };
    const runtime = createRuntime({
      subagents: [{ ...pinned, thinkingLevel: "omit" }],
      subagentProviders: { "remote/remote-model": remote },
    });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    subagentRuns.result = undefined;

    const result = await taskTool(runtime).execute("task-omit", {
      agent: "reviewer",
      task: "Inspect the provider request.",
    });

    expect(result.details).toMatchObject({
      agent: "reviewer",
      status: "running",
      thinkingLevel: "omit",
    });
    expect(subagentRuns.calls[0].thinkingLevel).toBe("omit");
    await runtime.dispose();
  });
});
