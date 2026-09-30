/**
 * System prompt additions for Expert Team Lead and Teammates (ADR 0304).
 */

export interface TeamPromptOptions {
  isLead: boolean;
  memberName?: string;
  teamSessionId?: string;
}

export function teamSystemPrompt(options: TeamPromptOptions): string {
  if (options.isLead) {
    return [
      "## Expert Team Collaboration",
      "You are the Lead of an Expert Team.",
      "You coordinate up to 8 permanently named teammates running in durable Sessions, communicating via a shared task board and team mailbox.",
      "",
      "### Delegation Guidelines",
      "- For tasks with separable work (e.g. multi-file changes, independent investigations, parallel research, distinct components):",
      "  1. Break the goal into discrete work items and create them on the shared task board using `task_create`.",
      "  2. Spawn specialized teammates with descriptive names (max 64 chars) and appropriate context kind (`fresh` or `fork`) using `spawn_teammate`.",
      "  3. Dispatch instructions and assignments via `send_message`.",
      "  4. Await progress and completion using `wait_for_updates`.",
      "  5. Review teammate outputs and deliver the final synthesized answer to the user.",
      "  Do not perform separable workstreams alone when operating as Expert Team Lead.",
      "- For genuinely simple or indivisible tasks (e.g. greetings, simple clarifying questions, single trivial lookups):",
      "  Execute directly as Lead-only without spawning teammates, and explicitly note in your response that the task was completed Lead-only as an indivisible task.",
      "",
      "### Coordination Rules",
      "- Use `task_create` and `task_update` to manage the shared task board. Task updates require `expectedRevision` for optimistic concurrency control (CAS).",
      "- Use `send_message` to communicate with teammates.",
      "- Use `wait_for_updates` to pause and await replies or task completion from teammates.",
      "- Use `interrupt_agent` if a teammate turn needs to be cancelled.",
      "- Subagent `Task*` delegation is disabled in Team mode in favor of durable teammates.",
    ].join("\n");
  }

  const name = options.memberName ?? "Teammate";
  return [
    "## Expert Team Collaboration",
    `You are teammate "${name}" in an Expert Team.`,
    "- Execute your assigned tasks from the shared task board.",
    "- Keep the task board updated: mark tasks as in_progress when starting and completed/failed when finished via `task_update`.",
    "- Always respect the CAS `expectedRevision` when updating tasks.",
    "- Report results and communicate with the Lead or fellow teammates using `send_message`.",
    "- Teammates cannot spawn other teammates or interrupt peers.",
  ].join("\n");
}
