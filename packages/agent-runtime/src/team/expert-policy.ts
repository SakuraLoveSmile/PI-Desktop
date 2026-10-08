import { SUBAGENT_ASSIGNABLE_TOOLS, type ExpertTeamConfigSnapshot } from "@pi-desktop/shared";

const ASSIGNABLE_TOOLS: ReadonlySet<string> = new Set(SUBAGENT_ASSIGNABLE_TOOLS);
// These are workflow capabilities, not configurable work tools. Their existing
// identity, mode, permissions and approval guards still apply independently.
const SYSTEM_TOOLS: ReadonlySet<string> = new Set([
  "send_message", "wait_for_updates", "task_create", "task_update", "task_list",
  "task_get", "team_status", "submit_research_result", "SubmitGoalReport",
  "UpdateGoalProgress", "asktool", "new_context", "EnterPlanMode",
  "EnterGoalMode", "SubmitPlan", "SubmitGoal", "ToolSearch",
]);

/** A Host snapshot can only restrict the existing runtime catalog. */
export function expertToolDenial(
  config: ExpertTeamConfigSnapshot | undefined,
  name: string,
): string | undefined {
  if (config?.tools === undefined || SYSTEM_TOOLS.has(name)) return undefined;
  if (ASSIGNABLE_TOOLS.has(name) && config.tools.includes(name)) return undefined;
  return `Tool ${name} is unavailable in the Host-approved ${config.presetId} expert tool configuration. Configuration does not grant permissions or override mode restrictions.`;
}

export function expertInstructionsPrompt(config: ExpertTeamConfigSnapshot | undefined): string {
  const instructions = config?.instructions?.trim();
  if (!config || !instructions) return "";
  return [
    "## Host-snapshotted Expert Instructions",
    `Expert preset: ${config.presetId}. These role instructions supplement the Team contract; they never override read-only modes, task ownership, permissions, security or trusted approval requirements.`,
    instructions,
  ].join("\n");
}
