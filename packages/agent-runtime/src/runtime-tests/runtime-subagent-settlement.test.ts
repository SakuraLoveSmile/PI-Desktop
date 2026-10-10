import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { type SubagentDefinition } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import { subagentRuns, createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime delegation wait settlement safety", () => {

  const explorer: SubagentDefinition = {
    name: "explorer",
    description: "Search the workspace and report findings.",
    tools: ["Read", "Glob", "Grep"],
    prompt: "Report file paths and line numbers.",
    source: "builtin",
  };

  function taskTool(runtime: DesktopAgentRuntime) {
    return (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Task",
    );
  }

  it("does not register a running delegation when SubagentRun initialization throws", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.constructorError = new Error("agent initialization failed");
    try {
      const started = await taskTool(runtime).execute("task-init-failed", {
        agent: "explorer",
        task: "Find it.",
      });

      expect(String((started.details as any)?.error)).toMatch(/initialize/i);
      expect((runtime as any).runningDelegations()).toHaveLength(0);
      await expect((runtime as any).resumeAfterDelegations()).resolves.toBeUndefined();
    } finally {
      subagentRuns.constructorError = undefined;
      await runtime.dispose();
    }
  });

  it("wakes the parent even when settlement publication throws", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const prompt = vi.fn(async () => undefined);
    (runtime as any).agent.prompt = prompt;
    (runtime as any).agent.waitForIdle = vi.fn(async () => undefined);
    try {
      const started = await taskTool(runtime).execute("task-publish-failed", {
        agent: "explorer",
        task: "Find it.",
      });
      const delegationId = (started.details as any).delegationId as string;
      vi.spyOn(runtime as any, "publishDelegationSettlement").mockImplementation(() => {
        throw new Error("event publication failed");
      });

      const resume = (runtime as any).resumeAfterDelegations();
      subagentRuns.resolveRun!({
        agentName: "explorer",
        status: "completed",
        report: "Found it in src/app.ts:12.",
        turns: 1,
        toolCalls: 1,
      });
      await resume;

      expect((runtime as any).delegations.get(delegationId).status).toBe("completed");
      expect(prompt).toHaveBeenCalledOnce();
    } finally {
      subagentRuns.deferred = false;
      await runtime.dispose();
    }
  });

  it("lets user Stop interrupt auto-resume even if a delegate ignores abort", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.ignoreAbort = true;
    subagentRuns.resolveRun = undefined;
    try {
      await taskTool(runtime).execute("task-stop-wait", {
        agent: "explorer",
        task: "Find it.",
      });
      const resume = (runtime as any).resumeAfterDelegations();
      await Promise.resolve();

      await runtime.abort();
      await resume;
    } finally {
      subagentRuns.ignoreAbort = false;
      subagentRuns.deferred = false;
      await runtime.dispose();
    }
  }, 1_000);
});
