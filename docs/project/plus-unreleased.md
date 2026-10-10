# Plus unreleased changes

Upstream v0.15.6 → v0.16.1 has been merged.

- Team Goal reports wait for running/queued experts and unconsumed results before
  accepting a draft. Settlement denials name the experts, dispatches and open tasks;
  confirmed teams receive three bounded completion reminders and terminal errors
  preserve the Host reason instead of incorrectly blaming a missing roster.
  Trusted roster cancellation also stops execution before review waiting begins.

- Edit accepts legacy `old_string` / `new_string` alongside a supplied `tag` when
  `ops` is absent. Unique-match safety and the three-failure retry budget remain;
  anchored `ops` still takes precedence. Missing-operation/body errors show a
  correct PUT example and explain which parameters are used.

- Expert member errors now reach the Lead through one durable Host-authored
  notice with a sanitized error code, affected tasks and explicit retry guidance.
  Existing Team delivery wakes waiting or idle Leads; approved execution must
  consume failures before completion. User stops and duplicate terminal events
  do not generate duplicate failure notices.

- Overview adds actionable attention for approvals, failures, timeouts and
  degraded reports, separates live status from artifacts, and groups Team members
  independently. Loaded-history notices and paging are per group. Repeated file
  changes and source domains are combined with recorded counts; complete Host
  review evidence supplies line totals. Lists have a five-row preview, independent
  file actions, and direct recommendation Ignore with recorded rationale.

- Overview activity groups now show counts and status summaries, remember each
  session's disclosure choices, and reopen for new active/error records. Agent
  identity/status and task/timing use separate lines. Background commands have
  readable titles and a terminal-record group with view-only Clear; timeout is
  distinct from failure. Goal rows share the Composer's authoritative progress
  and show report readiness/degradation with direct report navigation.

- The right work-panel launcher uses a centered compass and rounded tool cards.
  Existing tool destinations and plugin availability are preserved; long labels
  wrap and short panels scroll without clipping the cards.

- Context Insights brings a cross-session usage overview, a session work-panel
  dashboard, and `/context` inspection. Captured model requests expose prompt
  composition, tool schemas, messages, usage, changes and file activity. Earlier
  uncaptured requests remain explicitly unavailable; conversation data and
  compaction policy are unchanged.

- Expert Team confirmation during the Lead's declaration reply keeps one
  recovery budget of three reminders to dispatch and settle the approved experts, even if the initial
  no-tool answer already needed correction. Actual expert participation is
  still required before a successful final answer.

- Added a Memory destination in Settings to list project groups and open their
  existing shared memory editor.

- Expert Team uses the same compact capability rows, glyphs, badges and edit
  actions as Subagents, with shared scope controls and consistent form spacing.

- Successful and failed task notifications both appear in the durable inbox.
  The bell badge now counts every unread persisted task notification, matching
  the Dock/taskbar badge; selection, mark-all-read, and clear stay synchronized
  with Host persistence across reloads.
- The input footer exposes a clickable context progress track with the existing
  used/remaining preference, actual usage detail and guarded manual compaction.
  Missing usage is marked unavailable instead of showing a fabricated percent.

- The Composer adopts a neutral outlined four-line input, separated execution
  profile options and an upward Send button. Model selection opens directly to
  real configured model rows with provider/capability metadata, retains reasoning
  controls, and links to existing model Settings. Subagent progress and read-only
  execution details reuse the existing task and work-panel components.

- A session activity rail groups real plans, agents, background commands,
  outputs and sources. Narrow chats use the same controls in the work panel.
  Detailed/Compact now lives only in Settings. Quick Notes UI is removed, with
  existing saved data retained for compatibility. Bash can launch approved managed
  background commands whose output and stop controls remain available across
  turns; Host restart marks unfinished jobs interrupted without replay.


- Compact conversations emphasize readable progress and answers with larger
  prose and clearer spacing. Tool segments, including single calls, collapse
  into localized read/edit/command/search counts with visible issue counts;
  original details, search reveal and Detailed mode remain available.
- Goal reports survive bookkeeping and known read-only tools after submission.
  Successful executions missing a valid draft request one bounded report-only
  continuation. Completion claims must agree with Goal progress; fallback
  reports retain the last checklist without inventing completed work.

- Expert Team launch review offers runnable provider/model routes and compatible
  thinking choices. Route changes adjust unsupported effort, and individual
  expert edits no longer resend another expert's stale route. Host approval
  ignores obsolete provider thinking overrides and accepts omit consistently
  while retaining provider/model availability and explicit binding checks.

- Ordinary Expert Team task completion waits for its associated execution turn
  to finish successfully. Failed or aborted attempts update only their exact
  tasks, preserving earlier completed work. Retry, stale events and restart
  recovery cannot leave premature completion claims green; structured Plan
  research submissions retain their existing result contract.

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

- Standard agents and execution experts actively delegate separable work.
  Their subagents can delegate again within Settings → Subagents depth and
  running-count limits. Branch-scoped controls and cancellation preserve
  ancestor permissions and expert tool restrictions; Team Leads and research
  keep their existing orchestration boundaries.

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

- Project memory supports opt-in Agent recording and updates, with safe concurrent
  editing and per-turn refresh. Saved notes remain readable when recording is off.
- ProjectHistory recalls source-linked discussions from saved chats in the same
  logical project. CodeSearch provides local literal code search and a disposable
  persistent text cache, with live file reconciliation and explicit partial coverage.
  Neither feature adds background model or embedding calls.
- OpenCode Zen Muse Spark 1.3 Contributor Free now uses its Responses API instead of falling back to Chat Completions. Other publishers, explicit API metadata and client identity are preserved.
### Composer metadata and compact agent rows

The composer footer shows the current session's project, local/remote host, and known local Git branch. Unavailable project/branch metadata is omitted; remote sessions never borrow a local branch. Model menus list all models without a search field. Generation speed, full-turn token totals, cache metrics and context details are available from the bottom-right context meter. Subagent entries use transparent gradient-avatar rows with name, task, localized status and measured elapsed time; clicking a row opens read-only details, with no panorama entry. Validate model keyboard selection, footer metadata, context details and agent navigation in the isolated composer/transcript fixtures, including narrow layouts.

### Recorded outputs, delegate details and project Skill suggestions

Output rows display file basenames with a file-type icon plate and a full-path tooltip. They retain existing file navigation, omit status badges and use the current neutral theme. Delegate details show the recorded agent identity/state, bounded expandable task prompts, and collapsed contiguous thinking/tool groups with real counts. Follow-up turns, Markdown, search and scroll remain available; delegate errors/reviews have no Continue, dismiss or rollback mutation controls.

Self-evolution suggestions are generated only through an explicit action in an idle, local, writable project conversation. The normal session send workflow requests evidence-based reusable lessons as a bounded `skill-suggestions` JSON fence. Only settled top-level assistant responses are accepted; malformed, oversized, nested and untrusted-role blocks do not become suggestions. Suggestions remain transcript-backed across reloads. Each draft opens the existing Skill editor for review before using `skills.create` at the captured owning project path; it is disabled by default, may be enabled by the reviewer, and never overwrites an existing skill. No project, partial loaded history, running/queued execution, approvals, imported/remote/read-only conversations and Team members disable generation/creation. Session/project changes close the editor and prevent stale saves. Generation uses the configured model when the user explicitly requests it; no background generation occurs.

Acceptance covers file names/navigation, delegate prompt/group disclosure and absence of mutation actions, generation through the real send workflow, review edits, duplicate-save locking, failed-save draft preservation, late generation/save during session switches, parser validation and isolated Host project-Skill creation/list/read/no-overwrite. The reference pinned card is a progress-summary example; it does not imply automatic memory generation. Quick Notes is not exposed in the current UI; previously stored data is retained.

### Skills and MCP sidebar with suggestion dialog

The sidebar uses a flat Skills & MCP heading and a title-only icon list of recorded Skill/MCP references plus pending suggestions. References are removed from the separate Sources list; web sources remain there. Same-kind/name references are deduplicated, and a pending same-name Skill uses one row. The pending count is a compact rectangular action opening an opaque, viewport-bounded anchored dialog headed Self-evolution suggestions. Rows show a name and a two-line description; hover, keyboard focus and touch reveal Create/Ignore actions. Create opens the existing project Skill review editor before saving. Ignore hides only that recorded suggestion in the sidebar/count/dialog.

Ignore preferences are renderer-owned UI preferences under an independent version-1 key, identified by owning session, source message, name and content fingerprint. They survive remount/reload, do not alter task messages or Skill files, and keep only the latest 200 identities. A regenerated source or revised content is independent. Invalid/unavailable storage is visible and failed writes do not remove a row. Escape/outside pointer closes the dialog; Escape returns focus to its count; changing sessions closes it without opening another owner's editor.

Validate count-to-dialog, keyboard/hover actions, project review/save, Ignore/count/list updates, remount persistence, session/content isolation, recorded references and viewport bounds. Preview examples are synthetic.

- Added composer project, local/Worktree and local-branch menus with search,
  current selection, safe branch creation/switching and managed linked worktrees.
  Existing sessions and source checkout changes remain available after navigation.
