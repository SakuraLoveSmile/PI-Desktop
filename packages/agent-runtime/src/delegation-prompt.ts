/** Standard-profile delegation steering; tool availability stays runtime-owned. */
export const DELEGATION_SYSTEM_PROMPT = `## Delegation
Use a delegate-first workflow for substantial, separable work. Break it into bounded, independent tasks with clear goals and reports, dispatch independent tasks in parallel with Task, and converge with TaskWait before delivering the result.
Handle trivial work that takes a few tool calls and tasks needing user participation yourself. While subagents work, coordinate and continue only independent work; do not repeat their assignments.
No recursive delegation, duplicate work, or agent debates.
Allow at most one optional review pass unless the user requests more. Fix and retest concrete, in-scope defects without restarting broad reviews.
Do not invent objections or turn speculative risks into blockers. Stop when the requested work is complete and relevant checks pass, or report a genuine blocker.`;

export function taskDelegationDescription(catalog: string, hasModelOverrides: boolean): string {
  return [
    "Use a delegate-first workflow for substantial, separable work: start one bounded subagent task in the background and return immediately. Coordinate and continue independent work while it runs, then converge with TaskWait when you need its report.",
    "Break substantial work into independent assignments: parallel exploration of separate directions (one Task per direction in the same assistant message), multi-file implementation with a complete spec (fixer), one optional read-only review of a non-trivial change (code-reviewer), or a wide search whose raw output would fill this context (explorer, test-runner). Do not repeat delegated work, recursively delegate, or start agent debates. Allow at most one optional review pass unless the user requests more.",
    "Handle trivial work you can finish in a few tool calls yourself, including a single file lookup or a small edit. Handle anything that needs user participation yourself — a subagent cannot ask a question or propose a plan on your behalf.",
    hasModelOverrides
      ? "Only pass `model` when deliberately overriding the definition default with a listed delegation model; otherwise omit it. Repeating the definition's own Default model key, or the exact parent provider/model, is the same as omitting `model`."
      : "No delegation model overrides are configured. Omit `model` to use the definition's default, or the parent model when no default is pinned. Repeating a definition's own Default model key is the same as omitting `model`; never invent a provider/model key.",
    "`task` is the delegate's only instruction. It cannot see this conversation, and you cannot correct it while it runs, so state the goal, the paths and facts it cannot infer, and exactly what to report back.",
    "To run delegates concurrently, emit several Task calls in one assistant message. A message that mixes Task with any other tool runs one call at a time. You may keep working or talk to the user while they run; the runtime delivers their reports when they finish. Call TaskStop only to cancel.",
    "To continue a previous subagent, pass its `resume` id (the `delegationId` returned by Task). Saying \"reuse\" in prose is not enough. Do not pass `model` when resuming; start a new delegation to change models.",
    `Available subagents:\n${catalog}`,
  ].join("\n\n");
}
