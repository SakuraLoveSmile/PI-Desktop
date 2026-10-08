# Plus unreleased changes

Upstream v0.15.6 → v0.16.1 has been merged.

- AskTool questions keep paragraphs and wide tables readable instead of
  squeezing them into vertical strips. Tables scroll inside the card and long
  questions leave answer choices and submission controls available.

- Goal completion reports adopt the Canvas reference layout with visible metrics,
  a step timeline, compact delivery/verification tables, full screenshots, and
  conclusion callouts. Existing Host report data and retry behavior are retained;
  missing evidence remains unknown and Host contradictions stay visible.

- Permission cards wrap long workspace paths inside their bounds and retain
  readable controls in narrow columns. The outside-workspace reason follows
  the UI language; actual permission decisions and scope remain unchanged.

- Expert Team startup skips ordinary Task subagent configuration and delegate
  model/auth catalogs. Changing ordinary subagent settings no longer rebuilds
  an idle Team runtime; standard delegation and Team policy refresh remain
  unchanged.

- Expert Team settings configure six built-in expert presets at user or project
  scope. Newly confirmed experts snapshot their model, thinking, tool subset
  and additional instructions; existing members retain their prior policy.
- Team Overview groups recorded tasks, Specs, changed paths and references;
  its panorama shows individual tasks and their real dependency stages with
  repeated expert identities instead of only each member's current task.

- Composer progress identifies independent Goal progress and the session
  checklist. Goal counts and titles share one expandable row instead of a
  detached capsule; the session checklist moves to Overview as an expanded,
  read-only task list with live statuses. The Composer footer no longer displays
  a second checklist progress count.

- Expert Team research tasks require an explicit researcher assignment before
  dispatch, preventing completed research from getting stuck on an unassigned
  task. Failed assignments are reported as tool errors; existing unassigned
  tasks can still be repaired by the Lead without losing their content.

- Standard Agent sessions with enabled subagents are prompted to delegate
  substantial separable work first. Standard Agent keeps its small-task and
  user-participation exceptions; this guidance is unchanged by the Team policy.

- Expert Team panorama cards contain long task titles without overlap. New
  task titles are guided to stay concise and match the user's language; Chinese
  task labels and groups no longer use English workflow prefixes. Existing
  stored titles and full hover text are preserved.

- Compact conversations keep concise progress in chronological order, with
  Chinese tool actions and technical output behind expandable details. Team
  launch reviews show readable roles/names and request brief localized reasons
  and responsibilities. Plan/Goal approval asks the same Agent for a concise
  overview, keeps full contracts in their artifacts, and allows long legacy
  descriptions to expand without changing stored approval data.
- Goal results appear only after execution completes. Interrupted Goals no longer
  publish fallback reports or leave progress waiting for one, and report Retry
  cannot manufacture a result for an incomplete execution. Existing interruption
  records and artifacts are retained without showing completion cards.

- Waiting Team Plan Leads automatically release their turn when expert reports
  are queued, so authenticated messages drain in order without manual Send now.
  Full reports and user follow-ups are retained; approved Plan/Goal execution
  keeps its original turn. Overview progress continues to refresh in place.

- Expert Team planning consumes supplementary expert messages before publishing
  the plan, preventing research reports from remaining in the composer queue.
  User-queued requests are retained; structured results need no duplicate report.

- Expert Team now requires actual expert delegation, including simple requests.
  Models cannot choose lead_only or authorize work through old solo approvals;
  an approved expert turn must actually start before substantive Lead execution.
  This gate does not itself require task ownership or a completed contribution. Planning
  automatically launches read-only experts; roster confirmation is required only
  when executing the plan.
  Resuming a Team also restarts ordinary queued requests when no Team mail is pending.

- Approved Team Plan/Goal executions stay in their original running turn through
  execution-roster confirmation and expert results. Full authenticated updates
  are consumed there; Goal progress and its unique completion report retain
  their execution identity. Cancelling roster review interrupts that execution
  without publishing a completed report or replaying expert work.

- Expert Team work is easier to follow: queued prompts can be folded, team
  progress and a searchable compact task board show stable member identities,
  live activity refreshes from Host state, and panorama zoom survives updates.
  Member sessions are grouped under their Lead, and approved Plan/Goal runs can
  receive one concise automatic title without changing execution on failure.

- Temporary Goal sessions now own their Host scratch workspace: negotiate,
  approve, and execute Goals without a pre-bound project. Proposals and execution
  outputs remain isolated to the owning session scratch directory and survive age
  sweeps for the lifetime of the session. Persisted origin markers preserve
  artifact resolution even after moving to a project. Failed submissions visibly
  terminate with structured errors rather than reporting false completions.

- Goal Completion Reports stay failed when their session's final transcript
  cannot be persisted. A late draft can no longer replace a ready or failed
  report, and another session's pending transcript does not block publication.

- Skills now discovers installed pi CLI npm skill packages and offers explicit
  import with a source and executable-extension confirmation. Imported packages
  remain managed in Plugins; discovery never enables code automatically.

- One-time Plan/Goal schedules allow up to two minutes of delay while the app
  stays running, including sleep/resume. Longer delays are marked missed and
  require Run now confirmation; restarting the app still never catches up.
