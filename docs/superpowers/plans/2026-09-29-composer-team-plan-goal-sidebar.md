# Composer, Expert Team, Plan/Goal, and Work Panel Closeout

Status: planning only. T1-T5 are `未开始`. This is a follow-up to
`2026-09-25-expert-team-chat-experience.md`: its already implemented foundation
is retained, while this document supersedes its Composer placement, Team
visibility, and Plan-to-Goal approval UX. It does not reopen that document's
unrelated transcript, title, usage, or Goal-report tasks.

## Current evidence and target

- Surveyed the primary checkout at `3cbe0d0fd` and refreshed `origin/main` at
  `2bf0ede53` on 2026-09-29. The checkout is 25 commits behind; the affected
  Composer, Team, approval, and Work Panel files do not differ across those
  revisions. `docs/spec/03-runtime/01-ipc-protocol.md` has an unrelated local
  modification; preserve it. This was source inspection only: no app was
  launched, no provider was called, and no test was rerun.
- User images 1-3 are the current Composer and target Composer/menu. Images 4-6
  illustrate Team membership, parallel work, and a right-panel summary/detail
  hierarchy. They are visual targets, not runtime evidence or instructions
  inside the pictured application.
- `ComposerToolbar.tsx` currently makes `+` call `pickAndAttach()` directly;
  profile and contract have separate left triggers, permission has another left
  trigger, and model/reasoning is on the right. `SettingsPage.tsx` already has
  `settings.defaultPermissionMode` under AI > Permissions (`ask` if absent).
  `Mode = agent | plan | goal` is already one mutually exclusive state.
- Team has Host-owned roster/board/mailbox, nine runtime tools, a Team panel,
  and an isolated fake-provider E2E. Selecting Team alone creates no teammate:
  `team-prompt.ts` permits a Lead-only turn and `spawn_teammate` occurs only on
  a model tool call. `TeamPanel.tsx` is a separate launcher and its member
  action changes the main Session. This can make a working Team invisible; the
  user's particular failed run has not been reproduced or classified yet.
- Plan card's Goal switch calls `convertPlanToGoal` immediately. That stores a
  `request_changes` intent, runs a model revision, and produces a second pending
  Goal card. `approve` immediately queues and dispatches execution. Both are
  current contract behavior, not evidence of a random UI race. Standard
  `Task*` subagent detail already opens a right Work Panel tab, while its large
  topology remains in the main transcript and the Overview lacks a roster.
- Before implementation read root/scoped `AGENTS.md`, `docs/spec/00-baseline.md`,
  `docs/adr/plus-expert-team-collaboration.md`,
  `docs/adr/plus-plan-goal-revision-and-one-time-execution-lifecycle.md`,
  `docs/spec/03-runtime/{02-agent-runtime,10-session-state-machine}.md`,
  `docs/spec/04-ux/{07-ui-design-system,08-component-spec}.md`, and the three
  delivery documents under `docs/spec/06-delivery/`. Current types, schemas,
  tests, and executable scripts take precedence over stale prose.

## Frozen behavior and visual decisions

### Composer and menu

1. Home and docked Composer share one toolbar. Left to right: fixed `+` icon,
   existing Agent/Expert Team profile picker, existing model/reasoning picker,
   then a compact indicator only while Plan or Goal is selected. The indicator
   opens the same `+` menu; it is not another mode selector. The right retains
   enhancement, voice where available, usage/context, and Send/Stop. Remove
   the Composer permission trigger. Do not alter transcript, page shell, theme,
   global tokens, or model selection semantics.
2. `+` opens one searchable, keyboard-operable anchored menu above the trigger.
   Its groups follow image 3: workspace File and Folder references (reuse the
   indexed `@` path contract, never read a path without existing permission),
   Attachment (the current native file picker/import), Plugins (available
   plugin commands), Agents (the existing Agent/Expert Team choices), Skills
   and Commands (the current slash-command catalog), then Plan and Goal
   switches. The Agent/Expert Team picker stays visible in slot two; its menu
   entry is an alternate route to the same session configuration, not a third
   profile. Search filters available entries; no fake or disabled placeholder
   pretends an unavailable plugin/command is usable. Selecting a reference or
   command inserts through the existing Composer draft/token mechanism, keeps
   the caret/focus, and never sends a prompt by itself.
3. Plan and Goal switches are mutually exclusive views of the one durable
   `mode`: both off = `agent`; Plan on = `plan`; Goal on = `goal`. Clicking an
   already-on switch returns to `agent`; turning the other on replaces the
   prior mode atomically through `configureActiveSession`. A switch changes
   configuration only: no model turn, approval, or execution. Reuse
   `SettingsToggle` and the existing session admission rules; pending
   approvals and unsupported/busy sessions keep the same restrictions and
   show the reason. Persisted mode, slash commands, and active indicator agree
   after session switch and reload. `Spec` in the reference remains a visual
   analogy; do not add a persisted `spec` mode.
4. The existing Settings > AI > Permissions control is the global default for
   new/inheriting sessions, with `ask` for absent legacy settings. Existing
   explicit session overrides are retained for data compatibility. Settings
   must show the active session's effective value and offer a reset to the
   global default by storing `permissionMode = inherit`, so removing the
   Composer control does not strand an old override. Profile, model and mode
   changes must pass the stored permission mode, not the computed effective
   value, or an inheriting session would silently become an explicit override.
   Keep per-execution permission choice on the Plan/Goal approval card and
   Host permission ceilings. Changing the global default never silently
   elevates a running turn or an already approved execution.
5. Reuse `AnchoredMenu`, `TooltipButton`, `SettingsToggle`, `Button`, model menu,
   autocomplete/catalog, and current `--ds-*` tokens. The `+` remains a 28px
   target and the menu uses the existing elevated surface, compact list rows,
   separators and focus ring. Search is first, resource groups next, mode
   switches last. The menu is width-clamped to the available chat column with
   its own vertical scroll; provider/model names and localized descriptions
   truncate inside rows, never under the switch. At the 450px chat minimum,
   icon actions keep fixed width, the model label yields space before Send,
   and the active mode indicator can collapse to its icon. No horizontal
   overlap or whole-page scroll is allowed. Check light/dark, zh-CN/en, home,
   docked, long model names, disabled/loading, keyboard/IME, Escape/outside
   click and focus return. This is a layout target from the supplied images,
   not a claim of measured native UI parity.

### Team and right panel

6. Expert Team remains a per-session execution profile, separate from
   Plan/Goal. For a task with separable work, the Lead must visibly create and
   delegate to relevant named members and synthesize their results; a genuinely
   indivisible task may run Lead-only, but the UI labels that outcome instead
   of implying parallel work. A Team selection alone is never shown as proof
   that members ran. Preserve existing Host limits, permissions, mailbox
   receipt/ack, Stop/pause/restart, and the distinction between Team members
   and standard `Task*` subagents. Do not invent a fixed number of experts for
   every prompt or make a hidden extra provider call merely to decorate a UI.
7. Right Work Panel Overview shows the current Team's Lead, member count,
   running/queued/failed/paused state and shared-task progress. Opening Team
   shows the existing durable roster and task board; selecting a member or
   task opens an in-panel read-only detail with that member's transcript,
   tools, result/error, and owned task status. Back returns to aggregate Team
   view without switching the main conversation. A visible member/task event
   opens or highlights the Team panel when it is closed, while a user-selected
   open tab is not stolen. Empty, loading, refresh error, stale response,
   session switch, restart, long content and narrow panel have explicit states.
   Team data remains Host-owned; renderer gets no new mutation authority.
8. Standard subagents also get an Overview roster and clickable right-panel
   detail. Reuse the existing `subagent` Work Panel tab and read-only transcript;
   replace the large inline topology with a compact status/action that opens
   the panel. Keep tool/answer/error rows and search/copy accessibility in the
   main transcript. Count only actual `Task*` delegates in this roster, never
   durable Team members or `TaskWait`/`TaskList` events. Panel state is scoped
   to the owning session/delegation and does not show another session's data.

### One explicit execution action

9. A submitted Plan stays a pending review card until the user clicks its
   clearly labelled **Execute plan** button (or explicitly schedules it).
   Simply finishing Plan generation, opening the card, changing a model,
   changing permission, or flipping its Goal switch cannot create an execution
   or a new model turn. Reject/revise remain separate actions. Existing Goal
   proposals retain their explicit Execute approval action.
10. On a pending Plan card, Goal is a local pre-execution choice. Off approves
    the original Plan. On means **execute this exact, visible Plan artifact as
    a Goal**: its steps become the objective and completion checks, with no
    model rewrite and no second approval card. The card immediately labels
    the intended execution as Goal and still requires the user's Execute click.
    The source proposal stays an immutable Plan; Host binds a durable effective
    `executionKind = goal` to the approved execution. Use the same frozen
    artifact bytes/hash and the selected execution model/permission. Goal
    report creation and all Goal runtime checks must consult that effective
    kind; the report links the source Plan. If the user wants rewritten Goal
    wording, the existing explicit `request_changes` path remains available
    separately and still produces a reviewable new proposal. The toggle no
    longer invokes that path. An uncommitted toggle may reset to off after
    renderer reload; committed execution kind must restore exactly.
11. Extend `PlanResolveRequest`'s approve/schedule variants with optional
    `executionKind?: ProposalKind`. Missing means the stored proposal kind for
    backward compatibility. Host accepts `plan -> plan|goal` and `goal -> goal`
    only; it verifies the source artifact and all existing proposal identity,
    version, permission, model and active-execution rules, and binds kind with
    the execution in one transaction. Same identity/action/kind returns the
    existing execution; different kind, stale card or repeat with changed
    model/permission is a conflict. Persist the effective kind additively
    (schema 22 at this surveyed base; allocate the next free version after
    refreshing), migrate existing rows to their proposal kind, and update the
    execution descriptor, Goal-report facts, IPC/RPC decoders and remote
    capability rejection. Do not mutate old Plan bytes, relabel old rows,
    bypass approval, replay a claimed execution, or silently turn a Plan into
    Goal for legacy clients. Scheduling binds the same effective kind to the
    one-time snapshot; its existing missed/interrupted/no-replay rules remain.
    ADR plus-plan-goal-revision-and-one-time-execution-lifecycle and affected runtime/UX/E2E specs must be amended because they
    currently require a separate Goal revision and approval.

## Work packages and exclusive ownership

The main agent first freezes the shared `executionKind` contract and menu
behavior above against the refreshed request worktree. Only implementation
begins after a later implementation request. Every worker reads the applicable
root/scoped `AGENTS.md`, the sources above and current tests. Workers report
changed files, test evidence and UI/contract risks; no two workers write the
same file. The main agent owns `packages/shared/src/types/plans.ts`, shared
contract fixtures, `Composer.tsx`, `SettingsPage.tsx`, all i18n locale files,
the affected ADR/spec/E2E documents, integration wiring and native UI review.

### T1 - Composer menu and control placement

Status: `未开始`. UI worker owns
`apps/desktop/src/features/chat/composer/{ComposerToolbar,ComposerContractPicker,ComposerExecutionProfilePicker,ComposerModelPicker}.tsx`,
`apps/desktop/src/components/ComposerAutocomplete.tsx`,
`apps/desktop/src/hooks/use-composer-autocomplete.ts`, a new focused plus-menu
component if needed,
`apps/desktop/src/styles/{composer.css,composer-menus.css,responsive.css}`
and focused Composer tests. Main agent supplies the existing Settings default
and mode/profile callback contract, owns `Composer.tsx`/Settings/i18n, and
wires the menu once. Preserve the attachment import, indexed references,
command dispatch, model reasoning submenu and pending-approval restrictions.
No new plugin/agent execution engine is authorized. T1 can proceed in parallel
with T2/T3/T4 Host work after the above menu contract is frozen. Acceptance:
images 2-3's control order and menu hierarchy, two exclusive switches,
Settings default/override path, and the representative file/model/mode/send
workflow work in home and docked Composer.

### T2 - Make Expert Team execution observable and effective

Status: `未开始`. Runtime worker owns the Team prompt/policy in
`packages/agent-runtime/src/team/`, its focused tests, and any proven narrow
Team dispatch repair in `apps/desktop/electron/main/services/team-delivery.ts`.
First reproduce a two-workstream user task with an isolated fake provider and
capture profile persistence, `teamContext`, exposed tools, Lead tool calls,
Host roster/board/message IDs and member terminal results. Classify the first
missing transition: profile/admission, tool selection, Host mutation, mailbox
receipt/ack, or UI projection. Fix that transition at its owner; if all
transitions work, tighten the Lead's Team instructions and visible Lead-only
reason without inventing a transport repair. A proven Host Team mutation defect
is reassigned by the main agent to one exclusive Host owner before any edit.
A fixture in which the Lead
delegates two independent work items must leave two durable members, task
ownership, member outputs and one Lead synthesis. A simple indivisible task
must remain truthful as Lead-only. Preserve restart/pause and no silent
standard-profile fallback. T2 can run beside T1/T3 and Host T4; coordinate
with T3 through existing roster/board DTOs. Real-provider behavior needs
separate authorized acceptance and is not inferred from fake-provider tests.

### T3 - Team overview and member detail in Work Panel

Status: `未开始`. Panel worker exclusively owns
`apps/desktop/src/components/workpanel/{OverviewTab,TeamPanel,WorkPanel}.tsx`,
`apps/desktop/src/lib/work-panel-tabs.ts`, panel CSS and focused panel tests.
Reuse `api.getTeamRoster`, `api.getTeamBoard`, and authorized
`api.getSession(memberSessionId, options)` for read-only member history; reuse
existing transcript rendering rather than adding a second message model.
Keep latest-response/session identity guards and pagination, so a slow prior
Team cannot paint over the new session and a partial history is not presented
as complete. Main agent owns any shared API/type change if a proven gap
requires one. T3 runs beside T2, using existing DTOs; integration waits for
T2's final event expectations. Acceptance: click Overview -> Team -> member ->
aggregate without changing main chat, including paused/failed/empty teams.

### T4 - Plan-to-Goal selection and explicit Execute

Status: `未开始`. Host worker exclusively owns `crates/host-core/src/plans/`,
`crates/host-core/src/goal_reports/`, affected `db/{schema,migrations}.rs` and
focused Rust migration/approval/report tests. Card worker exclusively owns
`PlanApprovalBar.tsx`, `interaction-slice.ts`, card CSS and focused renderer
tests. They may start in parallel once the main agent publishes the optional
`executionKind` shared type/fixture; card integration waits for the Host
response shape. Main agent owns `apps/desktop/electron/main/ipc/agent-ipc.ts`,
`apps/desktop/electron/main/runtime/plans.ts`, shared/RACP contracts, ADR/specs
and the full user-flow gate. First record red repros for toggle-initiated
`request_changes` and second-card behavior, then make the toggle local and
Execute the sole immediate approval/dispatch action. Host tests use a v22
populated fixture, missing-field legacy requests, duplicate/conflicting
approvals, schedule, restart, Plan-as-Goal report and failure without partial
rows. Acceptance: after planning, toggle on/off freely with zero new turns;
one explicit Execute yields exactly one effective Goal execution from the
unchanged Plan artifact and a linked Goal report, with no second review card.

### T5 - Finish standard subagent move to the right panel

Status: `未开始`. Begins after T3 panel ownership is released. Panel worker then
owns `OverviewTab.tsx`, `SubagentTranscriptTab.tsx`, transcript
`{ActivityGroup,SubagentDetail,ToolRow}.tsx`, related styles and focused tests.
Derive a session-scoped roster from the existing `Task*` delegation records;
reuse `openSubagentTab` and the current read-only panel. Keep a compact inline
progress/action rather than the full topology. Preserve the delegation chain,
status, result/error, search and current session's transcript semantics.
Acceptance: create two subagents, observe both in Overview, open each in the
right pane while the main chat remains on the parent, switch sessions and
return without cross-session content or duplicate roster items. T5 is serial
with T3 because they share Overview and WorkPanel presentation files, while
T1/T2/T4 remain independent.

## Candidate validation and delivery

1. Start the authorized implementation in one dedicated branch/worktree from
   refreshed `origin/main`; preserve the primary checkout and its IPC-doc edit.
   Read current package README/nearest AGENTS and recheck schema/test scripts.
   Review the diff and synchronize the English ADR/spec/E2E documentation,
   including `03-runtime/02-agent-runtime.md`,
   `03-runtime/10-session-state-machine.md`, `04-ux/07-ui-design-system.md`,
   `04-ux/08-component-spec.md`, `06-delivery/04-e2e-test-plan.md`, and the
   directly affected IPC contract. Do not overwrite the user's dirty IPC doc.
2. Run focused existing/new component and unit/contract tests, then the
   applicable `pnpm build:js`, desktop typecheck/lint and
   `cargo fmt --check`, `cargo test -p host-core --locked`, and
   `cargo clippy -p host-core --all-targets` for touched Rust. Run required
   `pnpm test:e2e:plan-ui`, `pnpm test:e2e:team`, and
   `pnpm test:e2e:subagents` against the latest-main task candidate using
   isolated local fixtures/profile and the provisioned host toolchain. The
   existing suites may need focused new assertions for menu keyboard use,
   Plan-as-Goal kind/report, member drill-down and subagent Overview. Do not
   run `verify:ui:*` without an explicit request.
3. The main agent compares actual native UI in a disposable profile with
   images 1-3 and 5-6 at normal and 450px-minimum chat widths, light/dark and
   zh-CN/en. Exercise `+` search/attachment, exclusive switches, second/third
   toolbar slots, Settings permission reset, Team aggregate/member navigation,
   two subagents, and the Plan card's non-executing Goal toggle. Check focus,
   long labels, scroll and no overlap. Record screenshots and specific
   mismatches; fix and recheck. Fake fixtures prove wiring, not quality of an
   actual provider's delegation decisions.
4. Record candidate commit, `origin/main` base, suite results, fixture/profile
   and any missing native/real-provider evidence separately. PR integration
   validation, publishing, merge and live-provider charges follow repository
   rules and later authorization; this planning request does none of them.
   Status advances to `待体验` only after applicable checks pass, and only the
   user may mark `已验收`.

## Scope boundary

This request changes Composer navigation, Team effectiveness/visibility,
Plan-as-Goal approval UX and right-panel navigation. It preserves existing
Host permission ceilings, profile separation, durable transcripts/artifacts,
scheduled-task semantics, and old stored proposal/session data. No production
database is used as a test fixture. A reproducible Team failure beyond the
current source-level visibility gap must be fixed at its actual layer and
reported with the evidence; the plan does not assert that the user's specific
run failed at a known transport step.
