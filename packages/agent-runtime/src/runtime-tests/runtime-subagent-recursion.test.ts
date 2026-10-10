import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { type Agent } from "@earendil-works/pi-agent-core";
import {
  type SubagentDefinition,
  type AgentEventEnvelope,
  type UiMessage,
} from "@pi-desktop/shared";
import { subagentRuns, provider, createRuntime, runtimeMatches } from "./runtime-test-harness.js";
import {
  explorer,
  taskTool,
  latestDelegate,
  delegateTool,
  holdDelegates,
} from "./subagent-fixtures.js";
import { toolResult } from "./context-protection-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  it("lets an Agent expert delegate separable work within its Host work tools", async () => {
    const runtime = createRuntime({ executionProfile: "team", subagents: [explorer],
      teamContext: { teamSessionId: "team-1", callerSessionId: "session-1", isLead: false,
        expertConfig: { presetId: "qa", tools: ["Read"] } } });
    try {
      expect(taskTool(runtime)).toBeDefined();
      expect((runtime as unknown as { agent: Agent }).agent.state.systemPrompt).toContain("## Delegation");
      await taskTool(runtime).execute("expert-child", { agent: "explorer", task: "Inspect parser." });
      expect(subagentRuns.calls.at(-1).tools.map((tool: { name: string }) => tool.name)).toEqual(["Read"]);
    } finally { await runtime.dispose(); }
  });

  it("gives a depth-one delegate owner-scoped Task tools when maxDepth is two", async () => {
    const runtime = createRuntime({ subagents: [explorer], subagentMaxDepth: 2 });
    try {
      await taskTool(runtime).execute("parent-child", { agent: "explorer", task: "Inspect parser." });
      expect(subagentRuns.calls.at(-1).tools.map((tool: { name: string }) => tool.name)).toContain("Task");
    } finally { await runtime.dispose(); }
  });

  it("enforces zero depth and refreshes configuration when limits change", async () => {
    const runtime = createRuntime({ subagents: [explorer], subagentMaxDepth: 0 });
    try {
      expect(taskTool(runtime)).toBeUndefined();
      expect((runtime as unknown as { agent: Agent }).agent.state.systemPrompt).not.toContain("## Delegation");
      expect(runtimeMatches(runtime, { subagentMaxDepth: 2 })).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it("runs a parent and grandchild within one shared capacity without queued deadlock", async () => {
    holdDelegates();
    const runtime = createRuntime({ subagents: [explorer], subagentMaxDepth: 3, subagentMaxConcurrency: 2 });
    try {
      const parent = await taskTool(runtime).execute("branch", { agent: "explorer", task: "Inspect parser." });
      const grandchild = await delegateTool(latestDelegate(), "Task").execute("nested-task", { agent: "explorer", task: "Inspect lexer." });
      expect(grandchild.details).toMatchObject({ ownerId: parent.details.delegationId, depth: 2 });
      expect(latestDelegate().parentToolCallId).toBe("nested-task");
      const rejected = await delegateTool(latestDelegate(), "Task").execute("overflow", { agent: "explorer", task: "Inspect token." });
      expect(rejected.details.error).toContain("2 subagents are already running");
      expect(subagentRuns.calls).toHaveLength(2);
    } finally { await runtime.dispose(); subagentRuns.deferred = false; }
  });

  it("isolates nested list, wait, stop and resume from siblings and the root", async () => {
    holdDelegates();
    const runtime = createRuntime({ subagents: [explorer], subagentMaxDepth: 2 });
    try {
      await taskTool(runtime).execute("left", { agent: "explorer", task: "Inspect left." });
      const leftOptions = latestDelegate();
      await taskTool(runtime).execute("right", { agent: "explorer", task: "Inspect right." });
      const rightOptions = latestDelegate();
      const child = await delegateTool(leftOptions, "Task").execute("left-child", { agent: "explorer", task: "Inspect nested." });
      expect(latestDelegate().tools.map(tool => tool.name)).not.toContain("Task");
      expect((await delegateTool(rightOptions, "TaskList").execute("list", {})).details).toEqual({ delegations: [] });
      expect((await delegateTool(rightOptions, "TaskWait").execute("wait", { delegationIds: [child.details.delegationId] })).details).toEqual({ delegations: [] });
      expect((await delegateTool(rightOptions, "TaskStop").execute("stop", { delegationIds: [child.details.delegationId] })).details).toEqual({ stopped: [] });
      expect(latestDelegate().signal?.aborted).toBe(false);
      const resumed = await taskTool(runtime).execute("resume-root", { agent: "explorer", task: "Continue.", resume: child.details.delegationId });
      expect(resumed.details.error.toLowerCase()).toContain("unknown");
    } finally { await runtime.dispose(); subagentRuns.deferred = false; }
  });

  it("converges nested reports into their owner and cancels the complete subtree", async () => {
    holdDelegates();
    const runtime = createRuntime({ subagents: [explorer], subagentMaxDepth: 2 });
    try {
      const parent = await taskTool(runtime).execute("parent", { agent: "explorer", task: "Inspect." });
      const options = latestDelegate();
      await delegateTool(options, "Task").execute("child", { agent: "explorer", task: "Inspect nested." });
      const reports = options.collectDelegationReports!();
      subagentRuns.instances[1].settled = true;
      subagentRuns.instances[1].resolve({ agentName: "explorer", status: "completed", report: "Nested result.", turns: 1, toolCalls: 0 });
      expect(await reports).toContain("Nested result.");
      expect(await options.collectDelegationReports!()).toBeUndefined();
      await delegateTool(options, "Task").execute("child-two", { agent: "explorer", task: "Inspect second." });
      const nestedSignal = latestDelegate().signal;
      const root = (runtime as unknown as { agent: Agent }).agent;
      const stop = root.state.tools.find(tool => tool.name === "TaskStop")!;
      const stopped = await stop.execute("stop-root", { delegationIds: [parent.details.delegationId] });
      expect(nestedSignal?.aborted).toBe(true);
      expect(stopped.details).toMatchObject({ stopped: [expect.objectContaining({ delegationId: parent.details.delegationId })] });
    } finally { await runtime.dispose(); subagentRuns.deferred = false; }
  });

  it("narrows nested work tools and permission to its ancestor and inherits the current model", async () => {
    holdDelegates();
    const writer: SubagentDefinition = { ...explorer, name: "writer", tools: ["Read", "Write"], permission: "auto" };
    const host = { call: vi.fn(async (method: string) => method === "tools.execute" ? { ok: true, content: "File contents." } : undefined) };
    const runtime = createRuntime({ subagents: [{ ...explorer, permission: "ask" }, writer], subagentMaxDepth: 2, host });
    try {
      await taskTool(runtime).execute("reader", { agent: "explorer", task: "Inspect." });
      const options = latestDelegate();
      options.onModelChange?.({ ...provider, modelId: "changed-model" }, "off");
      await delegateTool(options, "Task").execute("nested-writer", { agent: "writer", task: "Inspect without editing." });
      const child = latestDelegate();
      expect(child.tools.map(tool => tool.name)).toEqual(["Read"]);
      expect(child.provider.modelId).toBe("changed-model");
      const echoed = await delegateTool(options, "Task").execute("nested-model-echo", { agent: "writer", task: "Inspect again.", model: `${provider.id}/changed-model` });
      expect(echoed.details).toMatchObject({ status: "running", modelId: "changed-model" });
      await delegateTool(child, "Read").execute("nested-read", { path: "src/a.ts" });
      expect(host.call).toHaveBeenCalledWith("tools.execute", expect.objectContaining({ permissionScope: "ask" }));
    } finally { await runtime.dispose(); subagentRuns.deferred = false; }
  });

  it("refreshes a nested Task snapshot using the original persisted message identity", async () => {
    holdDelegates();
    const onEvent = vi.fn();
    const runtime = createRuntime({ subagents: [explorer], subagentMaxDepth: 2, onEvent });
    try {
      await taskTool(runtime).execute("parent-id", { agent: "explorer", task: "Inspect." });
      const parent = latestDelegate();
      const params = { agent: "explorer", task: "Inspect nested." };
      const result = await delegateTool(parent, "Task").execute("nested-id", params);
      parent.onEvent({ sessionId: "session-1", ts: 1, parentToolCallId: "parent-id", agentName: "explorer", event: { type: "tool_start", toolCallId: "nested-id", toolName: "Task", args: params } });
      // Settle before tool_end to exercise the fast-run publication order.
      subagentRuns.instances[1].settled = true;
      subagentRuns.instances[1].resolve({ agentName: "explorer", status: "completed", report: "Nested findings.", turns: 1, toolCalls: 0 });
      await Promise.resolve(); await Promise.resolve();
      parent.onEvent({ sessionId: "session-1", ts: 2, parentToolCallId: "parent-id", agentName: "explorer", event: { type: "tool_end", toolCallId: "nested-id", result, isError: false } });
      const updates = onEvent.mock.calls.map(([envelope]) => envelope as import("@pi-desktop/shared").AgentEventEnvelope);
      const snapshot = updates.find(envelope => envelope.event.type === "message_end" && envelope.event.message.role === "tool");
      expect(snapshot?.event).toMatchObject({ type: "message_end", message: { id: "nested-id", parentToolCallId: "parent-id", toolResult: { details: { status: "completed", depth: 2 } } } });
      expect(updates.findIndex(envelope => envelope.event.type === "tool_end")).toBeLessThan(updates.indexOf(snapshot!));
      const history = (runtime as unknown as { transcriptHistory: UiMessage[] }).transcriptHistory;
      expect(history.filter(row => row.toolCallId === "nested-id")).toHaveLength(1);
      expect(history.find(row => row.id === "nested-id")?.toolResult).toMatchObject({ details: { status: "completed" } });
    } finally { await runtime.dispose(); subagentRuns.deferred = false; }
  });

  it("keeps inherited expert delegates out of durable Team controls", async () => {
    const inheritor: SubagentDefinition = { ...explorer, name: "worker", tools: [], inheritTools: true };
    const runtime = createRuntime({ executionProfile: "team", subagents: [inheritor], subagentMaxDepth: 2,
      teamContext: { teamSessionId: "team-1", callerSessionId: "session-1", isLead: false } });
    try {
      await taskTool(runtime).execute("expert-inherit", { agent: "worker", task: "Inspect." });
      const names = latestDelegate().tools.map(tool => tool.name);
      expect(names).toContain("Read"); expect(names).toContain("Task");
      for (const name of ["send_message", "wait_for_updates", "task_create", "task_update", "team_status", "EnterPlanMode", "SubmitGoalReport"]) expect(names).not.toContain(name);
    } finally { await runtime.dispose(); }
  });

  it("refreshes Agent experts for catalogs and limits but prohibits research delegation", async () => {
    const teamContext = { teamSessionId: "team-1", callerSessionId: "session-1", isLead: false };
    const runtime = createRuntime({ executionProfile: "team", teamContext, subagents: [explorer] });
    const research = createRuntime({ executionProfile: "team", subagents: [explorer], teamContext: { ...teamContext, workPurpose: "plan_research" } });
    try {
      expect(runtimeMatches(runtime, { executionProfile: "team", teamContext })).toBe(true);
      expect(runtimeMatches(runtime, { executionProfile: "team", teamContext, subagents: [] })).toBe(false);
      expect(runtimeMatches(runtime, { executionProfile: "team", teamContext, subagentMaxConcurrency: 2 })).toBe(false);
      expect(taskTool(research)).toBeUndefined();
    } finally { await runtime.dispose(); await research.dispose(); }
  });

  it("keeps a Team runtime reusable when ordinary subagent definitions and models change", async () => {
    const teamContext = { teamSessionId: "team-1", callerSessionId: "session-1", isLead: true };
    const runtime = createRuntime({ executionProfile: "team", teamContext, subagents: [explorer],
      subagentProviders: { "unused/old-model": provider }, subagentModelKeys: ["unused/old-model"] });
    try {
      const config = { executionProfile: "team" as const, teamContext };
      expect(runtimeMatches(runtime, config)).toBe(true);
      expect(runtimeMatches(runtime, { ...config, subagents: [] })).toBe(true);
      expect(runtimeMatches(runtime, { ...config, subagentProviders: { "unused/new-model": { ...provider, modelId: "new-model" } } })).toBe(true);
      expect(runtimeMatches(runtime, { ...config, subagentModelKeys: ["unused/new-model"] })).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it("still refreshes a standard runtime when ordinary subagent configuration changes", async () => {
    const runtime = createRuntime({ executionProfile: "standard", subagents: [explorer],
      subagentProviders: { "unused/old-model": provider }, subagentModelKeys: ["unused/old-model"] });
    try {
      expect(runtimeMatches(runtime)).toBe(true);
      expect(runtimeMatches(runtime, { subagents: [] })).toBe(false);
      expect(runtimeMatches(runtime, { subagentProviders: {} })).toBe(false);
      expect(runtimeMatches(runtime, { subagentModelKeys: [] })).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it("still refreshes Team runtime for its own profile, binding or Host expert policy changes", async () => {
    const teamContext = { teamSessionId: "team-1", callerSessionId: "session-1", isLead: false,
      memberName: "qa", expertConfig: { presetId: "qa" as const, tools: ["Read"], instructions: "Original" } };
    const runtime = createRuntime({ executionProfile: "team", teamContext, subagents: [explorer] });
    try {
      const config = { executionProfile: "team" as const, teamContext };
      expect(runtimeMatches(runtime, config)).toBe(true);
      expect(runtimeMatches(runtime, { ...config, executionProfile: "standard" })).toBe(false);
      expect(runtimeMatches(runtime, { ...config, provider: { ...provider, modelId: "changed-model" } })).toBe(false);
      expect(runtimeMatches(runtime, { ...config, teamContext: { ...teamContext,
        expertConfig: { ...teamContext.expertConfig, tools: ["Read", "Write"] } } })).toBe(false);
      expect(runtimeMatches(runtime, { ...config, teamContext: { ...teamContext,
        expertConfig: { ...teamContext.expertConfig, instructions: "Changed" } } })).toBe(false);
    } finally { await runtime.dispose(); }
  });
});
