import "./runtime-test-harness.js";
import { type SubagentDefinition } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import { type SubagentRunOptions } from "../subagent.js";
import { subagentRuns } from "./runtime-test-harness.js";

export const explorer: SubagentDefinition = {
  name: "explorer",
  description: "Search the workspace and report findings.",
  tools: ["Read", "Glob", "Grep"],
  prompt: "Report file paths and line numbers.",
  source: "builtin",
};

export const pinned: SubagentDefinition = {
  name: "reviewer",
  description: "Review a diff.",
  tools: ["Read", "Bash"],
  model: { providerId: "remote", modelId: "remote-model" },
  prompt: "Review the change.",
  source: "user",
  filePath: "/home/.agents/subagents/reviewer.md",
};

export function taskTool(runtime: DesktopAgentRuntime) {
  return (runtime as any).agent.state.tools.find(
    (tool: any) => tool.name === "Task",
  );
}

export function latestDelegate(): SubagentRunOptions { return subagentRuns.calls.at(-1) as SubagentRunOptions; }

export function delegateTool(owner: SubagentRunOptions, name: string) {
  const tool = owner.tools.find(tool => tool.name === name);
  if (!tool) throw new Error(`Missing ${name}`);
  return tool;
}

export function holdDelegates() {
  subagentRuns.calls.length = 0; subagentRuns.instances.length = 0;
  subagentRuns.deferred = true; subagentRuns.ignoreAbort = false;
}
