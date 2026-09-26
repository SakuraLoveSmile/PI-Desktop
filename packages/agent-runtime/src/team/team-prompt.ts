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
      "- Use `spawn_teammate` to spawn specialized teammates with distinct names (max 64 chars) and either fresh or fork context.",
      "- Use `task_create` and `task_update` to manage the shared task board. Note that task updates require `expectedRevision` for optimistic concurrency control (CAS).",
      "- Use `send_message` to send work items and context to teammates.",
      "- Use `wait_for_updates` to pause and await replies or task completion from teammates.",
      "- Use `interrupt_agent` if a teammate turn needs to be cancelled.",
      "- You are responsible for delivering the final unified answer to the user.",
      "- Small, indivisible tasks may be executed directly by you without spawning teammates.",
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
