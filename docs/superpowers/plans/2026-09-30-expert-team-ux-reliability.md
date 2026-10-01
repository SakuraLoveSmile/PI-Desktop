# Expert Team UX and Live-State Repair Plan

Status: planning delivered; product tasks T1-T9 are **未开始**. Revision: `team-ux-v1`, 2026-10-01, Asia/Taipei.

## Integration baseline — 2026-10-01

- Historical planning baseline: `aef7aad669bb12357d58d899516aeec5473e40e4`. The original source inspection and defect classifications below describe that snapshot; they are not a claim that every finding remains current after later merges.
- Current main at integration: `12cfb84134fdfac58ba148c023e81f864a2f1e19` (PR #22). Recheck each implementation task against this source before execution. Some adjacent Team and workpanel changes are now present, but this plan's T1-T9 have not thereby been implemented or accepted.
- The plan and its 27 files under `assets/expert-team-ux/` are planning/reference artifacts only. The previews are disconnected sample UI and the artwork is not product integration. No T1-T9 runtime, native UI, or user-path acceptance is claimed here.

This is the execution handoff for the user's eleven screenshots and follow-up issues. Repository documentation is English under root `AGENTS.md` section 0; user communication and the preview's example UI are Chinese. This round saves planning documents, UI reference code, original SVG artwork, and a design preview only. It does not implement product behavior, migrate user data, publish, or call a real provider. After explicit implementation authorization, execute this plan continuously within that authorization; the planning-only boundary does not persist as a refusal to implement.

## Review the intended experience

- The queue folds into a single count/next-message row. Expert Team Overview becomes the reference's task-progress list: status, task, pixel portrait, and a readable role/name, with a direct panorama link.
- The panorama uses the supplied person/task/status card hierarchy. Moving the canvas or receiving live updates preserves the chosen zoom and position. Team members show actual execution activity, while task completion and dependency readiness remain separate.
- One parent task contains its member sessions in the sidebar. The approved execution gets a bounded, model-generated Lead title when automatic titles are enabled. The board shows compact task rows and opens full content on demand. Overview updates from live Host state, with visible stale/error handling.

Review the [interactive design preview source](https://github.com/SakuraLoveSmile/PI-Desktop/blob/main/docs/superpowers/plans/assets/expert-team-ux/preview.html) (`assets/expert-team-ux/preview.html` in this repository). It includes the queue disclosure, parent/member sidebar, task progress, panorama, a filtered task list, and click-through detail. The preview's state-update button changes sample data; it is not connected to Desktop, Host, a model, or live task data. The production geometry, primitives, adapters, and refresh contract below are authoritative; the preview's reduced shell and example controls are illustrative.

The original artwork is already available: [Lead](assets/expert-team-ux/lead.svg), [Alex](assets/expert-team-ux/alex.svg), [Sam](assets/expert-team-ux/sam.svg), [Tina](assets/expert-team-ux/tina.svg), [Noah](assets/expert-team-ux/noah.svg), [Maya](assets/expert-team-ux/maya.svg), [Leo](assets/expert-team-ux/leo.svg), [Iris](assets/expert-team-ux/iris.svg), [Kai](assets/expert-team-ux/kai.svg). These are deterministic local SVGs, drawn as 16-by-16 pixel portraits with crisp edges. No image-generation API or paid asset is required. They imitate the requested visual category, not a third party's exact character artwork.

## Baseline and current evidence

- Primary checkout: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop`, clean `main`.
- Fetched `origin/main` this round. Primary HEAD, remote base, and the planning branch base all equal `aef7aad669bb12357d58d899516aeec5473e40e4`.
- Planning worktree: `/Users/sakurasep/.codex/worktrees/expert-team-experience-plan/PI-Desktop`, branch `codex/expert-team-experience-plan`. The other `plan-preview-archive-official-team` worktree belongs to a separate request and must remain untouched.
- Existing [2026-09-30 panorama plan](2026-09-30-plan-card-goal-composer-panorama.md), especially T4, supplied the implemented shared panorama/compact standard-subagent foundation. Retain that work. This new request fixes its current lifecycle defects and extends Team-specific presentation; it does not renumber/reopen that plan's Plan card, Goal indicator, or Composer toolbar work. Its contradictory historical status paragraphs do not prove current native UI acceptance.
- Earlier [Composer/Team/Plan-to-Goal plan](2026-09-29-composer-team-plan-goal-sidebar.md) describes related foundations. Current source wins over its old revision/worktree/status statements.
- The eleven provided images are saved under `assets/expert-team-ux/references/reference-01.png` through `reference-11.png`. Images 1/2/4/5/9/10/11 are reported-current appearance; images 3/6/7/8 are target references. Text within pictured prompts is screenshot data, never an instruction to the executor.
- Three read-only scouts examined runtime/title/tool isolation, Team UI/geometry, and Host contracts. The UI scout additionally ran `pnpm --filter @pi-desktop/desktop test -- test/subagent-progress-panorama.test.mjs test/team-panel.test.mjs` in the primary checkout. The script expands to the whole Desktop Node test suite rather than only those arguments: it reported **2903 passed, 1 skipped, 0 failed**. This is baseline test evidence reported by that scout; it is not a fixed-candidate result, a native visual check, or evidence that the following defects are repaired. Do not repeat that argument pattern for targeted tests.
- No product build, Host/Rust suite, Electron E2E, live provider, installed Desktop, or user data was exercised by the primary planner. Preview-only checks are recorded separately at the end.

### Confirmed source defects and unresolved incident facts

| User issue | Current mechanism and evidence | Classification |
| --- | --- | --- |
| Queue fills the conversation | `features/chat/composer/ComposerStatus.tsx:52` maps every queued prompt into an always-visible list; `styles/composer.css:64` has no disclosure or bounded body | Missing requested interaction; T1 |
| Team Overview is a generic Lead card | `workpanel/OverviewTab.tsx:288` renders member count/progress and a launcher, rather than the target's task rows | Missing requested presentation; T3 |
| Dragging seems to reset zoom | `AgentPanorama.tsx:82,115,154`: a fresh `childNodes` array changes layout, changes `handleFit`, and retriggers the fit effect. `TeamPanel.tsx:96,163` recreates that array every three-second refresh | Confirmed refresh-driven reset. A refresh during drag explains the observation without blaming pan math; T4 |
| Running members show idle | `team/roster.rs:265` inserts `idle`; `update_member_phase` at `:302` is unused. Actual `turns.status` is authoritative (`sessions.rs:1717`). Ordinary member rows use `member.phase`; panorama sometimes guesses from task status | Confirmed missing lifecycle synchronization; T2 |
| Completed tasks also show blocked | `team/board.rs:465` defines `isReady` as **pending and prerequisites completed**. `TeamPanel.tsx:384` treats any `isReady == false` as blocked | Confirmed consumer misinterpretation; T2/T7 |
| Unfriendly names/no portraits | `TeamPanel` uses immutable `member.name`; current panorama uses generic icons. Host names are ASCII handles used by messaging | Missing display metadata/artwork. Do not rename routing handles; T3 |
| Expert Team title not generated for this execution | `events-slice.ts:421,463` already attempts ordinary first-prompt titles on `agent_end`. `runtime/plans.ts:427` starts approved execution; `runtime.ts:7993,8085` deliberately adds no visible user turn. Existing `manualTitle/autoTitleAttempted/default-or-fallback` guards suppress subsequent attempts | Confirmed absence of an execution-specific title source. Whether the pictured Lead's original title attempt failed, succeeded, or was skipped is **not reproduced**; T6 includes a controlled repro |
| Sidebar becomes cluttered | Members are real durable sessions. `Sidebar.tsx:734,1676` lists them individually. `SessionSummary` lacks a Team relationship, though `team_members` already stores it | Confirmed missing relationship projection/grouping; T5 |
| Overview becomes stale | `OverviewTab.tsx:139-174` fetches only when Team/session changes, drops revision/readiness, and swallows errors. `TeamPanel` independently polls. `IPC.event.teamChanged` is declared but has no publisher/subscriber | Confirmed incomplete refresh path; T2/T3 |
| Task board too verbose | `TeamPanel.tsx:294-417` renders full member descriptions and task descriptions/dependencies/scopes in the aggregate. Existing `TeamTaskDetail` already supports drill-down | Confirmed excessive aggregate density; T7 |
| Whole page moves horizontally | Overview uses `overflow:auto`; TeamPanel only constrains vertical overflow. Long content/intrinsic flex widths are credible causes | Source candidates; precise overflowing element is **not reproduced in the actual app**. T8 must locate it before applying containment |
| Subagent vs Team conflict | `runtime.ts:3528-3553,3651-3664` hides `Task*` and plugin `SessionTask` for Team. Members launch with the Team profile; only Lead can spawn. Standard subagents are transient transcript delegates; Team members are durable sessions | No direct tool-catalog conflict found. Preserve isolation; guard UI history/counts/approved-execution paths in T9 |

Read before implementation: root/scoped `AGENTS.md`, `packages/README.md` and any package README that actually exists; `docs/spec/00-baseline.md`; ADR 0062/0186/0307/0309; `docs/spec/03-runtime/{02-agent-runtime,03-tools-and-permissions,04-data-storage,06-host-rpc-protocol,10-session-state-machine}.md`; `docs/spec/04-ux/{01-ui-ia,07-ui-design-system,08-component-spec}.md`; and the three delivery documents `docs/spec/06-delivery/{03-ai-development-workflow,04-e2e-test-plan,05-change-checklist}.md`. Some scoped/README paths mentioned in root policy are absent at this base; find actual files rather than inventing contents. Root `AGENTS.md` overrides stale delivery prose that requires automatic commits or different main/worktree integration. Commit/push/merge only under the user's corresponding authorization.

## Frozen shared decisions

### C1. Activity, tasks, and dependency readiness

Rust Host remains the only authority. A member's `phase` describes its current/last real turn, not the task board's state and not a renderer inference:

| Durable transition | Member phase | Notes |
| --- | --- | --- |
| Created, no admitted turn | `idle` | Creating/assigning a task or putting a message in a mailbox is not execution |
| Actual Host turn started | `running` | Update with the successful turn admission, not before it |
| Current turn durably settled successfully | `completed` | Means that member turn finished; it does **not** automatically complete its tasks |
| Current turn durably settled with error | `failed` | Preserve bounded diagnostic error without secrets |
| Current turn aborted/interrupted | `idle` | Team pause is a separate overlay; abort is not successful completion |
| Startup recovers an interrupted running turn | `idle` | No stale running badge; preserve mailbox hold/restart rules |

A late settlement for turn A cannot set idle/completed/failed when turn B already owns the member. Update only after the matching durable transition actually occurred; repeated terminal notifications with `updated:false` do not create revisions or notifications. A rejected admission cannot mark a member running. Keep turn, phase, and Team revision transactionally consistent, including collaboration admission's existing outer transaction.

Use a small `team/activity.rs` helper over the caller's connection/transaction, with typed turn transitions. Do not add a renderer-callable phase mutation API. Integrate the actual `sessions::begin_turn`, `end_turn_settling`, collaboration `begin_turn`, and startup recovery boundaries. If transaction-aware extraction is needed, first extract the existing turn insert into `begin_turn_on_connection` and let collaboration call it within its own transaction; never open nested SQLite transactions or leave an admitted turn behind after a phase-write failure. Only this relevant extraction is in scope; do not refactor all of `sessions.rs`.

Task rendering rule, shared by progress/list/detail:

```ts
const blocked = task.status === "pending"
  && (readiness?.unresolvedBlockedBy.length ?? 0) > 0;
```

`isReady === false` means “not eligible to start”; completed/in-progress/failed/cancelled tasks are not necessarily blocked. Task status remains explicitly controlled by the existing tools/CAS contract. A completed member turn cannot auto-complete a task or erase its owner. A task marked `in_progress` alone cannot pretend an idle/offline member is executing; show task status and member activity separately. Error/paused/provisioning states must remain distinguishable.

The atomic `queuedMessageCount` participates in aggregate completion: a settled Lead with unclaimed mail is waiting for messages to be processed, not a completed Team.

The Lead node reads Host turn activity too. Replace `paused ? paused : running`. Its subtitle is `Coordinating expert tasks`. Lead idle while members run is labelled waiting for members; show completed only when Lead is settled and all active tasks are completed (or Lead-only work finished with `queuedMessageCount === 0` and no member activity). A paused Team is labelled paused, never active merely because pause is false. Team aggregate status checks Lead and member activity; an idle Lead does not imply an idle Team.

### C2. One coherent read model and live refresh

Add the following additive shared read contracts in `packages/shared/src/team.ts`; retain the existing roster/board methods and their contracts for old consumers:

```ts
export type TeamMemberRole = "researcher" | "executor" | "reviewer" | "planner" | "collaborator";
export type TeamMemberPresentation = { role: TeamMemberRole; displayName: string };
// Optional addition to TeamMemberRecord:
// presentation?: TeamMemberPresentation;
// Optional addition to SpawnTeammateArgs: presentation?: TeamMemberPresentation;

export type TeamSnapshot = TeamRosterProjection
  & Pick<TeamBoardProjection, "tasks" | "readiness" | "scopeOverlaps">
  & { leadPhase: TeamMemberPhase; queuedMessageCount: number };

export type TeamChangedEvent = {
  teamSessionId: string;
  revision: number;
  reason: "member" | "presentation" | "task" | "activity" | "mailbox" | "pause" | "resume" | "dissolved";
};

export type SessionTeamRelation = {
  teamSessionId: string;
  role: "lead" | "member";
  memberName?: string;
};
// Optional addition to SessionSummary: team?: SessionTeamRelation;
```

- New Host `team.getSnapshot({teamSessionId, callerSessionId}) -> TeamSnapshot` reads roster, board, pause, Lead phase, presentation, and the real unclaimed queued Team-mailbox count under one Host state lock/database read boundary. Reuse the existing Team mailbox selector for `queuedMessageCount` (queued ledger records for this Team, excluding settled/deleted records); never count ordinary Composer prompts or infer it from task status. The one `revision` covers that complete snapshot, including activity transitions. Reuse existing authorization and projection helpers. Error: invalid input -> existing invalid-argument semantics; missing Team -> `TEAM_NOT_FOUND`; foreign caller -> `TEAM_UNAUTHORIZED`; read/transport failures are errors, not an empty successful Team.
- Add `IPC.invoke.teamGetSnapshot = "pi-desktop/team/getSnapshot"` and a typed `api.getTeamSnapshot`. Keep Main thin, validate the IPC input as the other Team handlers do, and retain Host participant validation. Update actual preload allowlists and shared schema/exports. The current Team IPC is local-Host-only; do not silently enable remote Team control. Old roster/board clients continue working. Bundled Main/Host must advance together; do not conceal unsupported Host methods with an empty snapshot.
- Publish Host `team.changed` **after** committed relevant mutations and forward to existing `IPC.event.teamChanged`. Add typed `api.onTeamChanged(listener) -> unsubscribe`. Notifications contain IDs/revision/reason, not prompts or transcripts. Emit after create/update/pause/resume/current-turn transitions, committed mailbox enqueue/claim/settle/cancel changes that affect `queuedMessageCount`, and dissolution; no event for rolled-back/no-op changes. Dissolution may carry the final known revision; invalidate the cache/relationships and refresh sessions rather than fabricate an empty active Team.
- Resolve the canonical Team identity before reading: for a Host-projected member session use `session.team.teamSessionId`; for a projected Lead use its own ID. A newly configured Team Lead without members uses its validated Lead context. Do not pass a selected member's Session ID as the Team ID simply because its profile is `team`. Overview header remains about the selected session while the Team section explicitly identifies its parent Team.
- One renderer Team runtime module, `stores/runtime/team-runtime.ts`, owns read requests, per-Host/Team snapshots, loading/error/last-success timestamps, event subscriptions and the existing three-second recovery cadence. A small `hooks/useTeamSnapshot.ts` exposes it. Overview, TeamPanel, and panorama adapters consume this same state. Do not copy the polling workflow into `app-store.ts` or leave the old independent Overview fetch and TeamPanel timer active.
- Acquire a scoped reader only for mounted visible Team surfaces; subscribe **before** the initial fetch. Coalesce an event burst into one refresh within 200ms of its first event. If a read is in flight, mark it dirty and run one following read. Recover from missed events every three seconds while the surface is visible; window focus and Host-ready/reconnect trigger one immediate refresh. Hidden surfaces release the timer/listeners; no background title/provider request is involved in read refreshes.
- Scope every request by Host identity and Team ID; use request generation to ignore obsolete results. A prior Team/Host's response cannot overwrite the current scope. Ignore lower-revision results. Keep the last good snapshot on failure, visibly mark it stale, and provide Retry. Never swallow errors or label failed refreshes current. On Team/session switch, select only the new scope's snapshot or loading state immediately; do not briefly show the former roster.
- Session title/project/model/mode/count continue to come from renderer/Host session and planning state. `api.getSession(sessionId,{messageLimit:1})` is a bounded metadata refresh source for a visible Overview when `sessionsChanged`, planning changes, persisted agent events, focus, or the shared three-second recovery tick invalidate metadata. Update summary metadata only; do not replace the active transcript with that one-message page. Stream text comes from existing events, not a second transcript polling loop. `messageCount` is the canonical total, never `messages.length` from a paginated page.
- Artifacts/references continue to derive from the real Plan/Goal checkpoints, Goal report events, and explicit message attachments. Do not invent artifacts merely to populate the preview. Effective Goal/Plan display reuses the current active checkpoint's `executionKind ?? kind` while running; the actual runtime/configured mode remains unchanged.

The new DTO/notification boundary needs a short ADR amending 0307 and matching runtime/UX/E2E specs when implemented. No process/data ownership/security boundary changes are proposed. Database schema remains unchanged for relationship projection and snapshot reads.

### C3. Display identity and original pixel artwork

- Preserve the existing immutable ASCII `member.name`, message targets, member Session IDs, model bindings and transcripts. Display identity is `{localized role} {displayName}`; examples: `调研员 Alex`, `执行者 Sam`, `审查员 Tina`. Lead is localized `主导 Agent`, with the task line `协调专家任务`.
- Extend `spawn_teammate` with optional `presentation:{role,displayName}`. The Team prompt tells Lead to choose the real role and a short readable alias when it creates a member. This is metadata on the existing call, **not** a separate model-generated avatar/name request. Validate enum and `displayName` at the Host boundary: trim, 1-32 Unicode code points, no control characters/newlines. Treat text as plain text. Only authorized Lead creation sets it.
- Store optional presentation in existing Host `kv`, namespace `team-member-presentation`, key `memberSessionId`, through verified `Database::kv_get/kv_set/kv_delete` in `db/repositories.rs`. Include creation/presentation persistence in the creation transaction and increment Team revision once. Hydrate in snapshot/roster reads; no schema/version change, no SQL mutation of old names or titles. Clean only this metadata when its Team is actually dissolved under the existing authorized deletion workflow.
- Legacy members receive a display projection without changing stored records. Exact legacy machine patterns `V<number>_*_scout` map to researcher; exact `researcher`/`executor`/`reviewer`/`planner` handles map to that explicit role. Do not infer roles from arbitrary prompt prose. Unknown handles use collaborator (`成员`). Keep a readable custom handle as its display alias. For the legacy `V<number>_*_scout` handles, use roster creation-order aliases `Alex, Sam, Tina, Noah, Maya, Leo, Iris, Kai` (maximum eight existing members); expose the original handle in member detail. Creation order is the existing `created_at ASC, name ASC` roster order and stays stable across refresh/restart; members are not renumbered by task status.
- Portrait choice is a deterministic hash of the real member Session ID among the eight local originals; Lead uses `lead.svg`. Same member keeps its portrait across refresh, tab/session switch, and restart. No remote URLs, random-on-render images, hard-coded fake experts, or data URLs containing private prompts. Names/role labels identify the member, so the adjacent decorative image has `alt=""`, `aria-hidden`, and `draggable={false}`.
- Use the same identity/portrait in task progress, member roster, panorama, task owner, and expanded sidebar member row. The raw handle remains visible/copyable in read-only member detail.

### C4. Visual baseline and precise target

Retain the existing chat shell, theme, fonts, sidebar actions, Work Panel tabs/resizing/maximization, Composer editor/toolbar, transcript tools/results, permissions, Plan/Goal approval and Stop/Resume semantics. Change only the named surfaces.

Verified token source is `apps/desktop/src/styles/tokens.css`: dark base `--ds-bg-primary = #181818`, secondary `#212121`, tertiary `#282828`; light primary `#fff`, secondary `#f9f9f9`. Use `--ds-text-primary/secondary/muted`, `--ds-border-default/strong`, `--ds-success/warning/error`, `--ds-focus`, `--radius-xs` (8px), `--radius-full`, and actual `--font-weight-normal/medium/semibold`. Do not copy undefined historical `--font-medium`/`--font-semibold` spellings. Type tokens: `--text-xs` 11px, `--text-sm` 12px, `--text-sm-plus` 12.5px, `--text-base` 14px, `--text-base-plus` 15px, multiplied by `--font-scale`; line height `--leading-body` 1.45. Portrait colors are contained in artwork, not new global theme tokens.

| Surface | Target and fixed density | States and narrow behavior |
| --- | --- | --- |
| Queue (image 1) | Single 32px-ish disclosure row: chevron, `消息队列`, count, truncated next-message preview. Body keeps existing five actions and rows, with 6px gaps and at most 168px vertical height | First nonempty queue with 1-3 items starts expanded; 4+ starts collapsed. User choice is session-scoped and preserved while items arrive/leave; crossing 3/4 never forcibly toggles. When empty, remove the region and reset only that session's initial-choice marker. Folded queue keeps sending normally |
| Team Overview (images 2 -> 3/6) | Replace Lead card with `任务进展`, completed/total, right-aligned `在专家团全景图查看 ↗`, independent disclosure. Task row: 18px status glyph, 10px gap, 14px title, below it 20px portrait + 12px role/name. No giant box, descriptions or redundant launcher | Expanded by default. Show at most five tasks; priority: failed, running, blocked, pending, then completed/cancelled, with stable creation-order ordinal. `查看全部 N 项` opens the compact board. An empty Team says Lead is working/no delegated tasks; no invented members. Existing real standard-subagent history may remain in a collapsed separate section; omit its empty block for Team |
| Panorama (images 7/8) | Same top-root/real-child structure and connectors. New node geometry is **304 x 140px**, 24px horizontal gap, 80px root-child separation, 32px row gap, at most three columns. 48px portrait, secondary 12.5px role/name, primary 15px semibold task (two lines max), footer divider + 12px state. Root uses the same card hierarchy | Match actual card height in layout math and SVG attachment points. Long task/name truncates with full detail on click/tooltip. Keep the bounded 50%-150% zoom range and 10-point controls. Fit/Reset/Back remain shared primitives. In narrow panels the world may exceed the viewport and intentionally pan **inside the canvas**; the page itself cannot scroll sideways |
| Board (image 11) | Default is a compact list, not a multi-column Kanban: current Work Panel is narrow and task descriptions are long. Header: completed/total and small member strip. Filter buttons (`全部/进行中/受阻/已完成/失败`) + existing Input search. Each row has glyph, one-line subject, one status badge, second-line portrait/owner | Full descriptions, dependencies, write scopes, timestamps, errors/results and member transcript live in existing in-panel detail. Filters/search stay scoped to the Team and show an empty match state. No collapsed element inside a nested row button. All tasks (up to Host's 256) remain reachable; do not build new virtualization infrastructure without evidence |
| Sidebar (image 9) | Keep one ordinary Lead row with existing status/actions, add a 24px sibling chevron and small member count. Children indent 12px with a subtle vertical line, show role/name/portrait/status | Collapsed by default; local `teamExpanded` preference per Lead. Explicit selection/search of a child expands its visible parent. Full compatibility rules are C6 below; do not delete/auto-archive sessions |
| Overview metadata (image 10) | Current title/project/model/effective mode/message count; live progress, real artifacts and explicit references. Quiet last-success indicator; stale/error + Retry only when applicable | Never replace a failed load with “0 members” or clear the last good data. No auto-tab stealing, no fabricated percentage, no falsely completed Lead |

Use `Button`, `TooltipButton`, `Badge`, `Input` and the existing icons as required by `apps/desktop/src/AGENTS.md`. Do not add a library or alter global tokens. Appendix A provides concrete component/adapter code, CSS, and artwork import mapping, and Appendix B provides viewport code. The executor must use those visual structures and contracts; local names/splitting can follow repo conventions.

### C5. Viewport ownership

Add a scope key `team:<hostBinding>:<leadSessionId>` or `subagents:<hostBinding>:<sessionId>` to the shared panorama adapter. Scope is real identity, never task title/revision.

1. First entry without saved viewport fits once after the canvas has nonzero size. Store the viewport in the owning Work Panel/TeamPanel runtime context so detail/back and switching to another session do not share/reset the active view. This is UI memory only; no database migration or permanent localStorage cache is required.
2. Manual `+/-`, pan, or Reset sets viewport mode to manual. State/name/task refresh, a new array identity, container resizing/maximization, new members, or partial data updates cannot overwrite it. New nodes outside the chosen view are reachable by pan or the existing Fit button.
3. Explicit Fit returns to fit mode. While still in fit mode, real topology or container-size changes may recalculate fit. Topology key contains ordered node IDs/positions/geometry only; display statuses/text are excluded.
4. Explicit Reset returns to centered 100% with the root below the toolbar and sets manual mode. Preserve current zoom when panning; zoom around viewport center; never refit on mouse movement.
5. Use pointer capture for background pan, release on up/cancel/lost capture/unmount, and ignore node/toolbar targets. Scope changes invalidate the drag; no delayed old-session callback can write the new viewport. Remove the existing 50ms transform transition during drag. Keep node click/focus and text selection intact. No new hard-coded global shortcut; use the existing configurable Work Panel navigation bindings.
6. Keep standard Task delegates and Team adapters separate while sharing this read-only renderer. Member detail opens inside TeamPanel; only the explicit existing “Open in main conversation” action selects another main Session.

### C6. Sidebar grouping and title generation

**Grouping:** hydrate optional `SessionSummary.team` on Host `session.list` in one joined/batched relationship read using actual `teams/team_members`, and on `session.get`/creation results for a single session. Do not make a RPC per sidebar row, parse `Teammate:` titles, or group all `executionProfile:team` rows indiscriminately.

An expanded sidebar group acquires one shared C2 snapshot reader for that Team to get optional presentation/activity; it releases the reader on collapse. This is one reader per visible Team, not one request per member, and shares the existing cache with Overview/TeamPanel. Collapsed counts/grouping still use the batched summary relationship.

Group visible members under their visible Lead after existing project/archive/pin filtering and before limiting top-level history rows. The visible Lead plus children is one top-level row for load-more/time grouping. Parent sorting uses the most recent real activity among its visible children and Lead; name/manual ordering uses the existing Lead order. Keep child order stable by creation order, not moving names every status refresh.

- Existing individual pin/archive preferences survive. A pinned member appears once in the global pinned section with parent context; omit that duplicate from the ordinary group's child rows, but total member count still covers the full roster. A pinned Lead group moves as one top-level unit and its unpinned visible children are not duplicated in the project history.
- If the Lead is filtered out/archived/not loaded, its visible children remain reachable as ordinary rows with parent context. Do not hide an unarchived member because its Lead is archived. “Show archived” can restore normal grouping. Search results and explicit member selection reveal the parent/child when the parent is visible.
- Group disclosure affects display only. Parent archive/pin/select/delete and batch selection retain their existing individual-session semantics; no implicit cascading action or expanded deletion permission. Child actions continue to invoke the current handlers; keyboard navigation uses the visible flattened rows only. Drag/move restrictions remain Host-authoritative.
- Legacy Host omitting `team` uses the existing flat session list. Deleting Lead already dissolves Team and resets members to standard without deleting their transcripts (`team/lifecycle.rs:92`); follow that existing relationship removal. Member deletion remains denied. Do not invent a database parent column or migration.

**Lead execution title:** keep ordinary first-prompt title generation, and add a source for the actual approved Plan/Goal execution. Do not state that all ordinary Team titles currently lack a model call.

- On the first committed `plansChanged` event for that Lead with `executionState:"running"` and an `executionId`, schedule one nonblocking title-summary request using the approved proposal's `title` and `question`. This uses existing `SessionSummarizeTitleRequest.userPrompt/assistantReply` and the existing Main-owned summarizer with thinking off, not a new visible transcript message. A scheduled execution is titled only when it actually starts. The summarized input is bounded metadata (max 6,000 Unicode code points), not the whole task board, private member transcripts, or arbitrary artifact traversal.
- Reuse `autoGenerateSessionTitles`; explicit false causes zero title calls. Persist `SessionMeta.autoTitleExecutionId` before the call; same execution and renderer restart cannot repeat it. A normal first-prompt failure does not permanently prevent this distinct approved-execution source. Do not create one request per teammate, per mailbox event, or per task update.
- Add `SessionMeta.lastAutoTitle` for new successful automatic titles. Eligibility: no `manualTitle`, and current title is recognized default, deterministic first-prompt/approved-title fallback, or equals `lastAutoTitle`. A pre-marker custom legacy title stays authoritative. A previously known generated title may be replaced by this execution's title; manual/legacy custom titles may not. Record a machine-readable skipped/attempted/succeeded/failed reason without prompt content, credentials, or raw provider responses.
- Before applying a result, check settings/manual-title/session existence again and ensure the same execution is still current. An old execution result cannot rename a newer task. Use optional rename guards `{expectedTitle: string, expectedExecutionId?: string | null}` as a third IPC argument, forwarded as optional Host `session.rename` fields. Absent guards retain existing two-argument behavior. Host compares the current title and, when supplied, the latest assigned execution ID in the **same** rename write boundary: a string must match that session's current execution, and explicit null requires no assigned execution. A mismatch returns existing conflict semantics without writing. This protects both manual rename and the race where execution B starts with the same title before delayed execution A's rename commits. In addition, the local Team title coordinator uses a per-session request generation: a newer approved-execution source invalidates an older first-prompt result, even before the title changes. This guarded automatic Team path is local-Host-only; remote/native adapters must reject unsupported guards rather than discard them. Do not add RACP Team/title behavior to this request.
- Title generation runs independently of runtime admission/finalization. It cannot delay approval, start/abort an agent, produce a Team message, alter task completion, block mailbox acknowledgements, or change execution success on failure. On failure keep the current fallback and record the title error. No automatic retry. A current no-provider/offline session uses the fallback. Amend ADR 0186 for the execution source and guarded persistence, not by pretending current behavior already has it.
- Members are identified by C3 display aliases; do not generate model titles for the system-created `Teammate:` sessions. Explicit user rename still survives grouping.

### C7. Overflow containment

First reproduce the actual excess `scrollWidth` in the affected Team/Overview/board at the existing supported widths and inspect the intrinsic-width offender. Apply `min-width:0`, `minmax(0,1fr)`, label ellipsis, bounded controls, and `overflow-wrap:anywhere` to descriptions/long handles/paths as appropriate. Then set the content scroll owner to vertical-only (`overflow-y:auto; overflow-x:clip`), preserving keyboard-focus visibility.

Keep the Work Panel tab strip's deliberate horizontal scroll (`work-panel.css:426-438`), Markdown code/table inner scrolling, and canvas world panning. Do not set global `html/body overflow-x:hidden` to mask a wide flex/grid item. At narrow widths and 150% UI font scale, toolbar/filter labels wrap or shorten with localized tooltips; Send/Stop and all queue actions remain reachable. This plan does not change the product's minimum chat width or replace its resizable shell with the preview's mobile shell.

## Execution tasks and ownership

Each task is 未开始. Within the one authorized implementation request, use one dedicated request branch/worktree, refresh against current `origin/main`, and actually launch independently executable workers in parallel. All planning scouts stay read-only; implementation workers write only their assigned files. Shared files have one owner, even when multiple tasks consume them.

| Worker | Independent goal and exclusive write ownership | Inputs, dependencies, delivery and acceptance |
| --- | --- | --- |
| A — Host/contracts | T2 authoritative activity, snapshot/events; C3 optional metadata storage; T5 relationship projection. Own `packages/shared/src/team.ts`, `types/sessions.ts`, `protocol.ts`, relevant shared schemas/exports/tests; runtime `packages/agent-runtime/src/team/team-tools.ts`, `team-prompt.ts`, and their metadata/schema tests; `crates/host-core/src/team/*`, relevant `sessions.rs` transition/summary changes, collaboration admission/recovery changes, Host RPC handlers/tests | Read C1-C3/C6 and Host rules. First deliver exact DTO/schema fixtures to root/C/D/E/F. Then transaction/lifecycle tests, snapshot authorization tests and old-data grouping fixtures. No Electron/renderer/i18n edits. Completion: real admitted member turn changes phase, stale settlement cannot reset a new turn, snapshot is atomic, old handles/transcripts survive |
| B — Queue | T1. Own `features/chat/composer/ComposerStatus.tsx`, new queue-disclosure helper/component and its interaction tests, **queue-only section** of `styles/composer.css` | Can start immediately; C4 queue contract. Keep five existing actions and pending/promoted/approval locks. Root owns the single `Composer.tsx` scope-prop wiring edit; B does not edit that file or queue dispatch/slice. Deliver normal/large/empty/session-switch/focus checks and no-logic-changing diff |
| C — Team presentation/board | T3 leaf progress/identity/pixel artwork; T7 compact aggregate board. Own new `components/workpanel/team/*`, `lib/team-presentation.ts`, TeamPanel, `styles/team-panel.css`, new `src/assets/team-avatars/*.svg`, relevant Team presentation/interaction tests | Can build pure view-model/primitives against C2 fixtures in parallel; integrate only after A's DTO and root's shared read hook are ready. Does not edit Overview, panorama, sidebar, globals, locales or API. Deliver exact reference hierarchy, click-through detail, zero completed+blocked badges, owner identity and error states |
| D — Panorama | T4. Own `AgentPanorama.tsx`, `styles/agent-panorama.css`, viewport geometry/controller helper and its behavior tests | Can implement view ownership/drag against current geometry immediately; final persona cards use C's shared `PixelAvatar`/card exports and frozen 304x140 geometry. Inputs C4/C5 and Appendix B. Do not edit TeamPanel/Overview or shared global styles. Completion: real snapshot refresh during drag keeps zoom/pan; Fit/Reset work; node/toolbar clicking does not start pan |
| E — Sidebar | T5 renderer aggregation. Own `Sidebar.tsx`, new `features/sessions/TeamSessionGroup.tsx` and pure grouping helper, `styles/sessions.css` Team-group block and its grouping/interaction tests | Pure grouping fixtures can start before A; integration needs optional `SessionSummary.team` and root-owned metadata persistence API. Keep existing session row handlers/actions. Do not edit Host, title runtime, sidebar-preferences or event slice. Deliver flat legacy/archived-parent/pinned-child/search/reveal/dissolution coverage |
| F — Titles | T6. Own `stores/runtime/session-title-runtime.ts`, title helper/tests, Main `apps/desktop/electron/main/ipc/agent-ipc.ts` title-summary integration and `apps/desktop/electron/main/ipc/session-ipc.ts` guarded rename handler and related tests; runtime `session-title-summarize` only if the existing helper actually needs input changes | Read C6; ordinary Team first-title repro before changing it. A provides Host optional expectedTitle/expectedExecutionId and types; root supplies event hook/meta fields. No Team tools/runtime.ts edits unless required by verified behavior. Deliver one approved Lead request, zero member/disabled/duplicate requests, guarded manual/stale-title scenarios, failure fallback |
| Root integrator | T2 renderer coordinator/API wiring, T3 Overview integration, T8 containment, T9 shared acceptance. Sole owner of `stores/runtime/team-runtime.ts`, `hooks/useTeamSnapshot.ts`, `lib/api.ts`, preload/event wiring, `stores/app-state.ts`, `app-store.ts` minimal registration, `slices/events-slice.ts`, `lib/sidebar-preferences.ts` for **all** new preference fields, `OverviewTab.tsx`, the one `Composer.tsx` queue-scope prop wiring edit, `styles/work-panel.css`, locales, docs/spec/ADRs, shared E2E harness `scripts/e2e-team.mjs` | Freeze/share C1-C7 before workers edit; do independent integration, not only coordination. Add local `teamExpanded`, `autoTitleExecutionId`, `lastAutoTitle` persistence/cleaning and API once, then expose helpers to E/F. Coordinate no simultaneous writers of sessions/IPC/protocol/locale/harness files. Review all diffs and personally run native candidate/user-path verification |

T1 can finish independently. T2 contract/state delivery gates integrated T3/T5. T4 state controller and T7 compact view can progress from frozen fixtures before T2, but their final validation uses the real snapshot. T6 never blocks unrelated queue/canvas/board work. T8/T9 integrate the resulting candidate. Reuse compatible primary node_modules/toolchains/Cargo targets by link/reference; no reinstall solely for E2E and no shared mutable profiles/build output races.

### T1 — Fold the message queue

Read ComposerStatus, `lib/queued-prompts.ts`, queue-pending/priority tests and ADR 0213/0265. Add `queueScopeKey: string` to `ComposerStatusProps`; root passes the active Host/session identity from `Composer.tsx` (draft scope only when there is no active session). The disclosure owns initial/manual expanded choices keyed by that prop and derives a unique DOM region ID with `useId`. Add it around the existing list per C4; scope changes never read the preceding session's expanded choice. Keep Host queue persistence, ordering, promotion/send-now, removal, editing, attachments and all disabled-state rules. Fold/unfold is display-only: no queue mutation, provider request, stop, or implicit send. Limit expanded height while keeping the input and transcript usable. Add a meaningful interaction test: eight waiting messages, fold/unfold, execute each existing row action after expand, enqueue/dequeue while folded, switch to another queue, and return with the user's choice intact. Zero/1/3/4/8 cases establish the initial-choice boundary. Focus returns to the disclosure when user folds it; an automatic count update never steals focus.

### T2 — Repair truthful activity and live snapshot delivery

A establishes a failing lifecycle/readiness baseline in real Host fixtures, implements C1/C2, then covers accepted/failed admission, successful/error/aborted turn, queued/paused mailbox, startup recovery, stale A-settlement while B runs, and revision/no-op semantics. Root implements one shared reader with subscription-before-load, bounded event coalescing, current Host/Team generation guards and visible stale recovery, and removes replaced duplicated fetch/timer paths. Tests must enter through the real Host/RPC lifecycle and renderer coordinator, mocking only transport/time boundaries. One atomic response eliminates current mixed roster/board revisions; retain old methods/tests for compatibility. Render pending and completed/in-progress readiness correctly without changing Host `isReady` meaning.

### T3 — Reproduce task progress and shared member identity

C implements the literal Appendix A leaf components and copied original assets and the explicit legacy projection from C3. A alone adds optional spawn presentation/schema/Team prompt and its Host metadata persistence; C consumes those frozen fields. Root replaces only Overview's generic Team card with progress rows and panorama/board/task routes, uses the shared snapshot, and derives truthful metadata/effective mode per C2. Retain actual artifact/reference opening and standard Task detail; omit meaningless empty subagent block for Team. Clicking a Team progress row opens the existing in-panel task detail without changing the main session. Clicking its owner inside detail opens member detail; only explicit Open-in-main changes the main session. Test the row-to-task-to-member-to-back user sequence and the five-row overflow case. All added labels, statuses, accessible names and tooltips go through i18n in every shipped locale.

### T4 — Reproduce panorama cards and preserve user zoom

D first writes a regression that reproduces the current reset: zoom to 80%, pan, resolve a Team snapshot with new member objects and updated statuses, and assert the transform does not change. The current array-driven fit should fail that assertion. Integrate Appendix B and C5 into the shared renderer; stable topology keys supplement, rather than replace, explicit manual viewport ownership. Update geometry constants, node markup, connector attachment points and CSS together. Preserve standard/Team adapters and scopes. Test first fit, explicit Fit/Reset, resize in fit/manual modes, topology changes, a snapshot and topology-size change during active pointer drag (subsequent movement must continue), pointer cancel/outside release, detail/back, session/Host switching, long task names and all states. Use real component events, not only source regex or a duplicate test-only viewport function.

### T5 — Aggregate member sessions without losing their data

A adds the actual optional relationship to session summaries by existing tables, batching list hydration without N+1. E builds a pure grouped-visible-row model then inserts sibling chevrons and original session rows; root adds scoped local expansion metadata normalization/persistence. Keep sessions, transcripts, IDs, actions and permissions. Cover grouping across projects, pinned Lead/pinned member, hidden/archived parent, archived child, default flat legacy input, result selection and active child reveal, collapsed load-more counts, batch selection and existing Lead dissolution. Assert one top-level visible Lead group for five ordinary members, and no data deletion/automatic archive side effects. Search and deliberate member navigation must still find the real member session.

### T6 — Generate the approved Lead task title once

F reproduces ordinary first-title and approved Team execution separately with a fake one-shot title provider; records which guard applies to the pictured behavior rather than guessing from the screenshot. Implement C6 using existing title-summary API; root hooks committed execution-running events and owns persisted marker fields; A adds optional guarded rename. Update normal successful auto generation to retain `lastAutoTitle`, preserve unknown legacy custom titles, and explicitly skip Team members. Test settings off, success, empty/failure, previously attempted first-title failure, known auto title, legacy custom title, manual rename while request is pending, newer execution while old request resolves, renderer restart, duplicate plansChanged, an old first-prompt result racing the approved source, and delayed execution A rename while Host starts B without changing the title. The lead model run/mailbox continues normally when the title provider fails. Fake provider counts actual title requests; an invocation-spy-only test is insufficient.

### T7 — Make the task board readable

C replaces full descriptions in aggregate with the compact filter/list pattern. Reuse existing member/task detail and its Markdown/tool/result/error rendering. Default show all active (not deleted) tasks, preserve stable task ordinals and creation-order rows; filters/search only adjust visible rows, not stored status. Show only one status badge per row: pending blocked becomes Waiting for dependencies; completed cannot also be blocked. Error/write-overlap warnings stay visible as a short section-level indicator that links/opens the real details. Completed tasks stay accessible through All/Completed; cancelled tasks remain accessible through All. Test selecting/filtering/searching a long task, detail/back (preserve filter/query/scroll), owner navigation, failed/cancelled/unassigned states, 0 tasks and 256 lightweight fixture tasks. No task mutation authority is added.

### T8 — Contain horizontal overflow at the actual offender

Root measures Overview/Team aggregate/details and the three-column shell in the actual isolated candidate. Start with the user's long task text, long unbroken path/token, narrow Work Panel (320/450/620px), chat at the existing minimum, and font scale 100/150%, light/dark, zh-CN/en. Record offending element's `clientWidth/scrollWidth` and layout before change. Fix intrinsic widths and local wrap/truncation, then vertical-only containment per C7. Verify top-level and ordinary content `scrollWidth <= clientWidth + 1`, no page horizontal scrollbar/rubber-band content offset, visible focus and controls. Prove deliberate tab-strip/table/code scroll and canvas pan still work. Do not alter the overall minimum-width/product shell specification to make a narrow screenshot test pass.

### T9 — Validate coexistence and the integrated user journey

Root preserves the existing runtime profile isolation and documents the result, rather than adding arbitrary prohibition switches. Extend existing Team fake-provider E2E and relevant Subagent/Plan checks:

- Standard `agent/plan/goal` runs expose only the existing standard delegate path where allowed; Task/TaskWait/TaskList/TaskStop lifecycle does not create Team session rows.
- Team Lead `agent/plan/goal`, including approved Plan-as-Goal execution, exposes the nine authorized Team tools, not `Task*` or plugin `SessionTask`. Team members cannot spawn further members; same Team messaging/permissions/model ceilings remain enforced.
- Scope changes/reload/Stop/pause/Resume/restart do not mix Team and standard histories, counters, cache entries or pending operations. A Session that previously used Task may show historical delegates in a distinct collapsed history; they are not current Team members/tasks.
- Real user sequence in isolated Electron: create Team Lead, approve a Plan, generate one title, start several owned tasks, see live member activity, fold queue, inspect Overview progress, open panorama, zoom/pan while a controlled member update arrives, open task/member detail and return, see compact board/filter, expand member sidebar, Stop/Resume and restart. Assert durable IDs/transcripts remain intact and ordinary queue/mailbox/Plan/Goal semantics unchanged.

Completion requires root's actual native UI and process-boundary evidence on the tested candidate, not scouts' source summaries or the standalone design preview. A missing real provider test does not block this fake/local maintenance validation; do not call real/paid providers without explicit separate test authorization.

## Verification commands and evidence

Run from the **implementation request worktree**, after refreshing against latest remote main. These are future gates, not this planner's test results. Test failures must be classified/fixed and the affected checks rerun; after required gates pass, do not repeat unrelated full suites for ceremony.

```bash
# Inspect/preserve state, then prepare this request's candidate.
git status --short --branch
git fetch origin main
# Rebase only a private branch; use non-destructive integration if shared.
git rebase origin/main
git merge-base --is-ancestor origin/main HEAD
pnpm check:pr-base

# Build changed TS packages and candidate Desktop; reuse the host environment.
pnpm build:js
pnpm --filter @pi-desktop/desktop typecheck
pnpm lint
pnpm --filter @pi-desktop/shared test
pnpm --filter @pi-desktop/agent-runtime test
pnpm --filter @pi-desktop/agent-host test

# Target existing Desktop boundaries. Add new behavior-test file paths here
# once created; use node directly rather than passing filenames to pnpm test.
node --test apps/desktop/test/team-panel.test.mjs apps/desktop/test/overview-and-team-drilldown.test.mjs apps/desktop/test/subagent-progress-panorama.test.mjs apps/desktop/test/session-auto-title.test.mjs apps/desktop/test/queue-pending-actions.test.mjs

cargo fmt --check
cargo test -p host-core --locked
cargo clippy -p host-core --all-targets

# Existing isolated process/UI suites, extended with the above regressions.
pnpm test:e2e:team
pnpm test:e2e:subagent-models
pnpm test:e2e:subagents
pnpm test:e2e:plan-ui
pnpm test:e2e:layout
```

Select the relevant union as required by root policy. The existing Desktop static-source tests are maintenance checks only; add real component/coordinator tests and extend existing Electron harness where lower layers cannot prove zoom/focus/layout/session integration. Do not consider a source-regex assertion equivalent to a user path.

`test:e2e:team` uses isolated data/profile and a loopback fixture provider. Extend its fixture to recognize title-summary requests and controlled task/member states; it currently rejects unexpected fake-model prompts. The existing `test:e2e:subagent-models` uses `127.0.0.1` fixture providers and temporary data. `test:e2e:subagents` reads/edits isolated registry docs without provider calls, but explicitly refuses Windows because known-folder discovery does not honor HOME isolation. Record that platform limitation instead of running it against a real Windows user profile. `test:e2e:plan-ui` was inspected: it creates a temporary root/data directory and a loopback model fixture. `test:e2e:layout` creates temporary project/data/profile directories and starts its own candidate; neither command was run this round. Read their actual isolation/build requirements before running; if its current harness does not provide this task's new interaction path, extend the existing Team harness rather than assume a static preview command validates Host behavior.

Never run `verify:ui:*` for this request without an explicit current user request: root policy reserves those scripts for a running Desktop. Native acceptance uses a separately launched isolated fake-provider candidate, never the user's installed/running instance or its profile. Reuse Node/pnpm/Electron/Cargo caches and compatible dependency trees by reference. Never install a second environment merely because this is a worktree.

For the tested candidate record:

```text
Task candidate commit:
Base origin/main commit:
Suites and results:
Native window/panel sizes, locale/theme/font scale:
Profile/data directory and loopback fixture identity:
Observed user path and screenshots:
NOT RUN items, exact reason, alternative evidence and residual risk:
```

Commit only when asked. If no commit is authorized, record HEAD plus the reviewed working-diff fingerprint for local checks and leave them as an uncommitted local-candidate result. Commit-based task/PR validation remains pending until an authorized commit exists. A later requested PR/push must use the exact tested commit/latest-main candidate and actual PR integration gate; never merge code into local main just to run E2E. No automatic push, release, main merge, worktree removal, or paid provider call is authorized by this planning request.

### Observable acceptance checklist

| Task | Required result |
| --- | --- |
| T1 | Eight queued messages occupy one folded header; count/next update; expand yields original working actions and bounded scroll; queuing/sending/order unaffected |
| T2 | Controlled running member displays running in roster/overview/panorama; success/error/abort/restart are truthful; completed tasks do not show blocked; paused queued mail does not start |
| T3 | Reference's two-line task/role/portrait list replaces generic card; shared identity stable; task/member drill-down keeps main Lead selected; all labels localized |
| T4 | At 80%, repeated Host updates during/after drag leave zoom 80%; pan delta matches drag; manual viewport survives resize/detail/back; only explicit Fit/Reset changes its mode/scale |
| T5 | One parent with five foldable member sessions, no duplicate ordinary rows; pin/archive/search/navigation preserved; exact IDs/transcripts still exist after grouping/restart |
| T6 | One actual fake-model title request for approved Lead execution, zero per-member/disabled/duplicate requests; manual/newer-task title wins; failure does not affect execution |
| T7 | Aggregate rows omit long instructions; filtering/search and full detail remain usable; all tasks reachable; no complete+blocked contradiction |
| T8 | No whole-page horizontal scrolling at supported shell/panel/font conditions; long content remains accessible in detail; intended local scroll/pan still works |
| T9 | Standard and Team tools/delegates/members/counts/lifecycles stay distinct through modes and approval/reload/recovery; isolated native user sequence passes |

Implementation with a required gate unrun or blocked is **实现中**. After all applicable checks/native paths pass it is **待体验**. Only explicit user confirmation establishes **已验收**. Do not turn a design preview or this planning delivery into product acceptance.

## Specifications to update during implementation

Root synchronizes existing related sections, not a new duplicate specification set:

- ADR 0307: presentation metadata, atomic snapshot/notification, derived session relationships, truthful activity. Record the additive boundary decision with context/tradeoffs; retain durable sessions/tool isolation/security.
- ADR 0186: approved-execution source, once-per-execution guard and optional compare-and-set rename. Keep existing settings/fallback/manual-title policy.
- `03-runtime/02-agent-runtime`: title inputs and Team vs Task tool/mode invariants; `03-tools-and-permissions`: optional spawn metadata validation; `04-data-storage`: kv metadata and relationship projections, no schema bump; `06-host-rpc-protocol`: new snapshot/notification, optional summary fields and rename guard; `10-session-state-machine`: real turn/phase/paused semantics.
- `04-ux/01-ui-ia` and `08-component-spec`: queue disclosure, task progress, compact board/detail, group row behaviors, viewport/overflow. Update `07-ui-design-system` only if documenting the new domain-specific pixel avatar is useful; do not reclassify every Team leaf as a new global primitive.
- `06-delivery/04-e2e-test-plan`: extend existing Team runtime/mailbox/panel, queue row, sidebar, title, panorama and approved execution scenarios with exact fixtures/expected outcomes. Specs and code remain English; all shipped UI locales receive new keys. Changelog updates for the released user-facing surface follow repository convention, without a version bump/release unless requested.
- Where execution touches conflicting automatic-commit/local-main delivery paragraphs, root follows AGENTS and corrects that relevant workflow prose within authorized implementation documentation scope. Do not rewrite unrelated policy files or claim an ADR alone changes runtime behavior.

## Boundaries and remaining evidence gaps

The decisions C1-C7 and artifact/code direction are frozen for implementation of this proposed plan; they are not described as user-accepted visual results. No required design choice is deferred to a worker. Local module naming/test placement can follow repository conventions while respecting ownership and contracts.

Two incident details remain bounded reproduction work, not unresolved product choices: the pictured Lead's ordinary auto-title history (T6), and the exact actual-app horizontal overflow offender (T8). Both have specified repro conditions, independent work, and stop rules. If two materially different evidence-based attempts cannot reproduce/resolve the same blocker, stop blind retries, report expected/actual/commands/evidence, and continue independent tasks. Do not “fix” a guessed live-data incident by clearing profile data, resetting schema markers, or rerunning paid tasks.

Data protection: preserve every existing member session/handle/transcript, queue/mailbox entry, task revision, archived/pinned/manual-title preference and Plan/Goal artifact. Grouping is presentation, not data deletion. C3 stores optional bounded metadata in existing kv; C6 changes local preference metadata and additive guarded rename. No SQLite schema change is planned. Never use production configs/secrets/logs/user profiles as fixtures. If current-main drift makes a data/protocol decision materially different, root investigates and revises only that affected contract before workers proceed; do not silently lower acceptance.

## Appendix A — Concrete UI reproduction code

The following is a complete component reference, split by the ownership table during implementation. Imports assume the new domain component directory `apps/desktop/src/components/workpanel/team/`; the queue and sidebar components move to their existing owning features with adjusted relative imports. Copy the nine SVGs to `src/assets/team-avatars/`, preserve the frozen shape/size hierarchy, and use real C1/C2 view-model data. This reference has not been typechecked as integrated product source; planning syntax/reference checks and preview browser results are separate. Do not drop it wholesale into one large production module.

```tsx
// Planning reference: split into the component modules named in the plan.
// Import paths below assume apps/desktop/src/components/workpanel/team/.
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TeamMemberPhase, TeamMemberRole, TeamTaskRecord, TeamBoardProjection } from "@pi-desktop/shared";
import { Button, Badge, Input, TooltipButton } from "../../ui";
import { IconCheck, IconChevronDown, IconChevronRight, IconExternal, IconRefresh } from "../../icons";

export type TeamRole = TeamMemberRole;
export type MemberView = {
  sessionId: string;
  handle: string;
  displayName: string;
  role: TeamRole;
  phase: TeamMemberPhase;
  paused: boolean;
};
export type TaskVisualState = TeamTaskRecord["status"] | "blocked";
export type TaskRow = {
  task: TeamTaskRecord;
  ordinal: number;
  state: TaskVisualState;
  owner?: MemberView;
};
export function taskVisualState(
  task: TeamTaskRecord,
  readiness: TeamBoardProjection["readiness"][number] | undefined,
): TaskVisualState {
  if (task.status === "pending" && (readiness?.unresolvedBlockedBy.length ?? 0) > 0) {
    return "blocked";
  }
  return task.status;
}

// Copy the reviewed SVG assets into src/assets/team-avatars/. Use literal
// bundler imports for these paths in the production module, as below.
import leadPortrait from "../../../assets/team-avatars/lead.svg";
import alexPortrait from "../../../assets/team-avatars/alex.svg";
import samPortrait from "../../../assets/team-avatars/sam.svg";
import tinaPortrait from "../../../assets/team-avatars/tina.svg";
import noahPortrait from "../../../assets/team-avatars/noah.svg";
import mayaPortrait from "../../../assets/team-avatars/maya.svg";
import leoPortrait from "../../../assets/team-avatars/leo.svg";
import irisPortrait from "../../../assets/team-avatars/iris.svg";
import kaiPortrait from "../../../assets/team-avatars/kai.svg";
const portraits = [alexPortrait, samPortrait, tinaPortrait, noahPortrait,
  mayaPortrait, leoPortrait, irisPortrait, kaiPortrait];
function avatarIndex(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % portraits.length;
}
export function PixelAvatar({ seed, lead = false, size = 20 }: {
  seed: string;
  lead?: boolean;
  size?: 20 | 24 | 32 | 48;
}) {
  return <img className="team-pixel-avatar" src={lead ? leadPortrait : portraits[avatarIndex(seed)]}
    alt="" aria-hidden="true" width={size} height={size} draggable={false} />;
}
export function MemberIdentity({ member }: { member: MemberView }) {
  const { t } = useTranslation();
  return <span className="team-person">
    <PixelAvatar seed={member.sessionId} />
    <span className="team-person-name">{t(`team.roles.${member.role}`)} {member.displayName}</span>
  </span>;
}
function statusTone(state: TaskVisualState): "neutral" | "success" | "warning" | "error" {
  return state === "completed" ? "success" : state === "blocked" ? "warning"
    : state === "failed" ? "error" : "neutral";
}
function TaskStateIcon({ state }: { state: TaskVisualState }) {
  return <span className={`team-task-state team-task-state-${state}`} aria-hidden="true">
    {state === "completed" ? <IconCheck size={12} />
      : state === "in_progress" ? <IconRefresh size={13} className="team-task-spinner" />
      : state === "blocked" ? "!" : state === "failed" ? "×" : "·"}
  </span>;
}

export function TeamTaskProgress({ rows, completed, total, expanded, onToggle,
  onOpenTask, onOpenPanorama, onOpenBoard }: {
  rows: TaskRow[];
  completed: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenPanorama: () => void;
  onOpenBoard: () => void;
}) {
  const { t } = useTranslation();
  const rowsId = useId();
  return <section className="team-progress" aria-label={t("team.taskProgress")}>
    <header className="team-progress-header">
      <Button variant="ghost" size="sm" className="team-progress-disclosure"
        aria-expanded={expanded} aria-controls={rowsId} onClick={onToggle}>
        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span>{t("team.taskProgress")}</span>
        <span className="team-progress-count">{completed}/{total}</span>
      </Button>
      <TooltipButton className="team-progress-panorama" tooltip={t("team.viewInPanorama")}
        ariaLabel={t("team.viewInPanorama")} onClick={onOpenPanorama}>
        <span>{t("team.viewInPanorama")}</span><IconExternal size={13} />
      </TooltipButton>
    </header>
    <ol id={rowsId} className="team-progress-rows" hidden={!expanded}>
      {rows.map(({ task, ordinal, state, owner }) => <li key={task.taskId}>
        <Button variant="ghost" className="team-progress-row"
          aria-label={t("team.openTaskWithStatus", { subject: task.subject, status: t(`team.taskStatus.${state}`) })}
          onClick={() => onOpenTask(task.taskId)}>
          <TaskStateIcon state={state} />
          <span className="team-progress-copy">
            <span className="team-progress-task" title={task.subject}>
              {t("team.numberedTask", { number: ordinal, subject: task.subject })}
            </span>
            {owner ? <MemberIdentity member={owner} /> : <span className="team-person">{t("team.unassigned")}</span>}
          </span>
        </Button>
      </li>)}
    </ol>
    {expanded && total > rows.length && <Button variant="ghost" size="sm"
      onClick={onOpenBoard}>{t("team.viewAllTasks", { count: total })}</Button>}
    {expanded && total === 0 && <p className="team-empty-copy">{t("team.noTasks")}</p>}
  </section>;
}

export function PanoramaPersonCard({ name, seed, task, status, statusLabel, lead,
  progress, onSelect }: {
  name: string;
  seed: string;
  task: string;
  status: "idle" | "running" | "completed" | "failed" | "paused" | "provisioning";
  statusLabel: string;
  lead?: boolean;
  progress?: string;
  onSelect: () => void;
}) {
  return <Button variant="ghost" className={`team-panorama-person team-panorama-person-${status}`}
    aria-label={`${name}: ${task}; ${statusLabel}`} onClick={onSelect}>
    <span className="team-panorama-person-head">
      <PixelAvatar seed={seed} lead={lead} size={48} />
      <span className="team-panorama-person-copy">
        <span className="team-panorama-person-name" title={name}>{name}</span>
        <span className="team-panorama-person-task" title={task}>{task}</span>
      </span>
    </span>
    <span className="team-panorama-person-footer">
      <span className="team-panorama-status-icon" aria-hidden="true">
        {status === "completed" ? <IconCheck size={13} />
          : status === "running" ? <IconRefresh size={13} className="team-task-spinner" /> : "·"}
      </span>
      <span>{statusLabel}</span>{progress && <small>{progress}</small>}
    </span>
  </Button>;
}

export type BoardFilter = "all" | "in_progress" | "blocked" | "completed" | "failed";
const filters: BoardFilter[] = ["all", "in_progress", "blocked", "completed", "failed"];
export function CompactTeamBoard({ rows, filter, query, onFilter, onQuery,
  onOpenTask }: {
  rows: TaskRow[];
  filter: BoardFilter;
  query: string;
  onFilter: (filter: BoardFilter) => void;
  onQuery: (query: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const matching = rows.filter(row => (filter === "all" || row.state === filter) &&
    `${row.task.subject} ${row.owner?.displayName ?? ""}`.toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()));
  return <section className="team-compact-board" aria-label={t("team.taskBoard")}>
    <header className="team-board-filters">
      <div className="team-board-filter-buttons">
        {filters.map(value => <Button key={value} variant="ghost" size="sm"
          aria-pressed={filter === value} onClick={() => onFilter(value)}>
          {t(`team.boardFilters.${value}`)}
        </Button>)}
      </div>
      <Input type="search" value={query} aria-label={t("team.searchTasks")}
        placeholder={t("team.searchTasks")} onChange={event => onQuery(event.currentTarget.value)} />
    </header>
    <ol className="team-board-rows">
      {matching.map(({ task, state, owner }) => <li key={task.taskId}>
        <Button variant="ghost" className="team-board-row" onClick={() => onOpenTask(task.taskId)}>
          <TaskStateIcon state={state} />
          <span className="team-board-task" title={task.subject}>{task.subject}</span>
          <Badge tone={statusTone(state)}>{t(`team.taskStatus.${state}`)}</Badge>
          <span className="team-board-owner">{owner ? <MemberIdentity member={owner} /> : t("team.unassigned")}</span>
        </Button>
      </li>)}
    </ol>
    {matching.length === 0 && <p className="team-empty-copy">{t("team.noMatchingTasks")}</p>}
  </section>;
}

// Put this component in the existing ComposerStatus feature, rather than
// reproducing its Host-owned move/edit/promote/cancel actions.
export function QueueDisclosure({ panelId, count, nextLabel, expanded, onToggle, children }: {
  panelId: string;
  count: number;
  nextLabel: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return <section className="composer-queue-disclosure">
    <Button variant="ghost" className="composer-queue-heading" aria-expanded={expanded}
      aria-controls={panelId} onClick={onToggle}>
      {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
      <span>{t("chat.queuedPrompts")}</span><Badge>{count}</Badge>
      <span className="composer-queue-next">{t("chat.queueNext", { message: nextLabel })}</span>
    </Button>
    <div id={panelId} className="composer-queue-body" hidden={!expanded}>{children}</div>
  </section>;
}

export function TeamSessionGroup({ panelId, parentRow, memberCount, expanded,
  onToggle, childRows }: {
  panelId: string;
  parentRow: ReactNode;
  memberCount: number;
  expanded: boolean;
  onToggle: () => void;
  childRows: ReactNode[];
}) {
  const { t } = useTranslation();
  return <div className="sidebar-team-group">
    <div className="sidebar-team-parent">
      <TooltipButton className="sidebar-team-chevron" aria-expanded={expanded}
        aria-controls={panelId} tooltip={t(expanded ? "team.collapseMembers" : "team.expandMembers")}
        ariaLabel={t(expanded ? "team.collapseMembers" : "team.expandMembers")} onClick={onToggle}>
        {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
      </TooltipButton>
      <div className="sidebar-team-parent-row">{parentRow}</div>
      <span className="sidebar-team-count">{memberCount}</span>
    </div>
    <div id={panelId} className="sidebar-team-children" hidden={!expanded}>{childRows}</div>
  </div>;
}
```

Put the CSS blocks in their uniquely owned feature files. Production uses the verified semantic tokens, not the preview's standalone palette.

```css
/* Planning reference: put each block in its owning existing feature stylesheet. */
.team-pixel-avatar { flex: 0 0 auto; border-radius: var(--radius-xs); image-rendering: pixelated; }
.team-person { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--ds-text-secondary); font-size: var(--text-sm); }
.team-person-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.team-progress, .team-compact-board { min-width: 0; max-width: 100%; }
.team-progress-header { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 0 0 8px; }
.team-progress-disclosure.btn { display: inline-flex; min-width: 0; align-items: center; gap: 6px; padding: 0; font-size: var(--text-base); }
.team-progress-count { font-size: var(--text-xs); color: var(--ds-text-muted); font-variant-numeric: tabular-nums; }
.team-progress-panorama { display: inline-flex; min-width: 0; align-items: center; gap: 4px; margin-left: auto; padding: 4px; color: var(--ds-text-secondary); font-size: var(--text-sm); }
.team-progress-panorama > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.team-progress-panorama > svg { flex-shrink: 0; }
.team-progress-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.team-progress-rows[hidden], .composer-queue-body[hidden], .sidebar-team-children[hidden] { display: none; }
.team-progress-row.btn { display: grid; width: 100%; min-width: 0; grid-template-columns: 20px minmax(0,1fr); align-items: start; gap: 10px; padding: 8px 4px; text-align: left; border-radius: var(--radius-xs); }
.team-progress-copy { display: grid; min-width: 0; gap: 6px; }
.team-progress-task { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-base); line-height: var(--leading-body); font-weight: var(--font-weight-medium); }
.team-task-state { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; margin-top: 2px; border: 1px solid var(--ds-border-strong); border-radius: var(--radius-full); color: var(--ds-text-muted); }
.team-task-state-completed { border-color: transparent; background: var(--ds-success); color: var(--ds-bg-primary); }
.team-task-state-in_progress { color: var(--ds-success); border-color: transparent; }
.team-task-state-blocked { color: var(--ds-warning); border-color: var(--ds-warning); }
.team-task-state-failed { color: var(--ds-error); border-color: var(--ds-error); }
.team-task-spinner { animation: team-spin 1.2s linear infinite; }
@keyframes team-spin { to { transform: rotate(360deg); } }

/* AgentPanorama keeps the absolute coordinates and real Lead-to-child edges. */
.team-panorama-person.btn { display: flex; flex-direction: column; width: 304px; height: 140px; padding: 0; border: 1px solid var(--ds-border-strong); border-radius: var(--radius-xs); background: var(--ds-bg-secondary); text-align: left; overflow: hidden; }
.team-panorama-person-head { display: flex; align-items: flex-start; flex: 1; min-width: 0; gap: 12px; padding: 16px 16px 12px; }
.team-panorama-person-copy { flex: 1; min-width: 0; }
.team-panorama-person-name { display: block; margin-bottom: 4px; font-size: var(--text-sm-plus); line-height: var(--leading-body); font-weight: var(--font-weight-normal); color: var(--ds-text-secondary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.team-panorama-person-task { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-size: var(--text-base-plus); font-weight: var(--font-weight-semibold); line-height: var(--leading-body); color: var(--ds-text-primary); }
.team-panorama-person-footer { display: flex; height: 37px; flex: 0 0 37px; align-items: center; gap: 8px; padding: 0 16px; border-top: 1px solid var(--ds-border-default); font-size: var(--text-sm); color: var(--ds-text-secondary); }
.team-panorama-person-completed .team-panorama-person-footer { color: var(--ds-success); }
.team-panorama-person-running .team-panorama-person-footer { color: var(--ds-success); }
.team-panorama-person-failed .team-panorama-person-footer { color: var(--ds-error); }
.team-panorama-person-footer small { margin-left: auto; color: var(--ds-text-muted); font-size: var(--text-xs); }
.agent-panorama-stage { transition: none; }

.team-board-filters { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.team-board-filter-buttons { display: flex; min-width: 0; flex-wrap: wrap; gap: 4px; }
.team-board-filter-buttons [aria-pressed="true"] { background: var(--ds-bg-hover); }
.team-board-filters input { width: 148px; max-width: 100%; min-width: 0; margin-left: auto; }
.team-board-rows { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.team-board-row.btn { display: grid; grid-template-columns: 20px minmax(0,1fr) auto; width: 100%; min-width: 0; column-gap: 10px; row-gap: 6px; padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--ds-border-default); border-radius: var(--radius-xs); }
.team-board-task { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--text-base); line-height: var(--leading-body); }
.team-board-owner { grid-column: 2; min-width: 0; }
.team-empty-copy { font-size: var(--text-sm); color: var(--ds-text-muted); }
.composer-queue-heading.btn { display: flex; width: 100%; min-width: 0; align-items: center; gap: 8px; padding: 7px 10px; background: var(--ds-bg-composer); text-align: left; font-size: var(--text-sm); }
.composer-queue-next { min-width: 0; max-width: 55%; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ds-text-secondary); }
.composer-queue-body { max-height: 168px; overflow-y: auto; overflow-x: clip; padding-top: 6px; }
.sidebar-team-parent { display: flex; min-width: 0; align-items: center; gap: 2px; }
.sidebar-team-chevron { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; flex-shrink: 0; }
.sidebar-team-parent-row { flex: 1; min-width: 0; }
.sidebar-team-count { color: var(--ds-text-muted); font-size: var(--text-xs); flex-shrink: 0; }
.sidebar-team-children { margin-left: 13px; padding-left: 12px; border-left: 1px solid var(--ds-border-default); }

/* Diagnose intrinsic width before adding containment. Preserve tabs, code,
   and tables' own horizontal scrolling; do not clip the whole application. */
.team-panel, .work-panel-overview, .work-panel-main { min-width: 0; max-width: 100%; }
.team-panel, .work-panel-overview-scroll { overflow-y: auto; overflow-x: clip; }
.team-task-description, .team-member-description { min-width: 0; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) { .team-task-spinner { animation: none; } }
```

Append the corresponding localized keys to every shipped catalog: `team.taskProgress`, `team.viewInPanorama`, `team.numberedTask`, `team.openTaskWithStatus`, `team.viewAllTasks`, `team.roles.{researcher,executor,reviewer,planner,collaborator}`, `team.boardFilters.{all,in_progress,blocked,completed,failed}`, `team.taskStatus.{pending,in_progress,blocked,completed,failed,cancelled}`, `team.searchTasks`, `team.noMatchingTasks`, `team.expandMembers`, `team.collapseMembers`, `chat.queueNext`, and refresh/stale/retry/accessibility labels. Reuse current equivalent keys where their meaning matches. Do not render raw protocol status strings or rely on `defaultValue` to conceal missing locales.

## Appendix B — Concrete viewport repair code

Use this controller in the existing shared AgentPanorama with its real geometry. Parent `TeamPanel`/`OverviewTab` owns a `Map<scopeKey,Viewport>` in its session-scoped runtime context; pass a stable `onSave` callback and the matching scope's saved value. Apply `translate(x,y) scale(zoom)` with origin `0 0`. The canvas wires the returned pointer handlers; node/toolbar wrappers have `data-panorama-node`/`data-panorama-toolbar` attributes. No effect depending on refreshed child objects unconditionally calls Fit.

```ts
// Planning reference: integrate into AgentPanorama, with memory owned by its
// parent TeamPanel/OverviewTab. No persisted product data is written here.
import { useCallback, useEffect, useLayoutEffect, useRef, useState,
  type RefObject, type PointerEvent as ReactPointerEvent } from "react";

export type Viewport = { zoom: number; x: number; y: number; mode: "fit" | "manual" };
export type Geometry = { width: number; height: number };
const clampZoom = (value: number) => Math.max(0.5, Math.min(1.5, value));
export function fittedViewport(width: number, height: number, geometry: Geometry): Viewport {
  const zoom = clampZoom(Math.min((width - 48) / geometry.width, (height - 84) / geometry.height));
  return { zoom, x: (width - geometry.width * zoom) / 2,
    y: Math.max(64, (height - geometry.height * zoom) / 2), mode: "fit" };
}
export function zoomedViewport(value: Viewport, nextZoom: number, cx: number, cy: number): Viewport {
  const zoom = clampZoom(nextZoom);
  return { zoom, x: cx - (cx - value.x) * zoom / value.zoom,
    y: cy - (cy - value.y) * zoom / value.zoom, mode: "manual" };
}
export function usePanoramaViewport({ scopeKey, geometryKey, geometry, containerRef,
  savedViewport, onSave }: {
  scopeKey: string;
  geometryKey: string;
  geometry: Geometry;
  containerRef: RefObject<HTMLDivElement | null>;
  savedViewport?: Viewport;
  onSave: (scopeKey: string, value: Viewport) => void;
}) {
  const [viewport, setViewport] = useState<Viewport>(savedViewport ?? { zoom: 1, x: 0, y: 0, mode: "fit" });
  const [isPanning, setPanning] = useState(false);
  const current = useRef(viewport);
  const initializedScope = useRef<string | null>(null);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: Viewport } | null>(null);
  const commit = useCallback((value: Viewport) => {
    current.current = value;
    setViewport(value);
    onSave(scopeKey, value);
  }, [onSave, scopeKey]);
  const makeFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || container.clientWidth <= 0 || container.clientHeight <= 0) return undefined;
    return fittedViewport(container.clientWidth, container.clientHeight, geometry);
  }, [containerRef, geometry.width, geometry.height]);

  // Changing status, callback identity or the parent snapshot never resets a
  // scope already initialized. A saved manual view survives detail/back.
  useLayoutEffect(() => {
    if (initializedScope.current === scopeKey) return;
    const active = drag.current;
    drag.current = null;
    const container = containerRef.current;
    if (active && container?.hasPointerCapture(active.pointerId)) {
      container.releasePointerCapture(active.pointerId);
    }
    setPanning(false);
    const initial = savedViewport ?? makeFit();
    if (!initial) return;
    initializedScope.current = scopeKey;
    commit(initial);
  }, [scopeKey, savedViewport, makeFit, commit]);

  // geometryKey includes ordered node IDs and coordinates, never status text.
  // After manual zoom/pan, new nodes and container resizing preserve the view.
  useLayoutEffect(() => {
    if (current.current.mode !== "fit") return;
    const next = makeFit();
    if (next) commit(next);
  }, [geometryKey, makeFit, commit]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (current.current.mode !== "fit") return;
      const next = makeFit();
      if (next) commit(next);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, makeFit, commit]);
  // Observer reinstallation on a real geometry change must not cancel an
  // active drag. Only disposal or a different scope releases its capture.
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      const active = drag.current;
      drag.current = null;
      if (active && container?.hasPointerCapture(active.pointerId)) {
        container.releasePointerCapture(active.pointerId);
      }
    };
  }, [containerRef, scopeKey]);

  const fit = () => { const next = makeFit(); if (next) commit(next); };
  const reset = () => {
    const width = containerRef.current?.clientWidth ?? geometry.width;
    commit({ zoom: 1, x: (width - geometry.width) / 2, y: 64, mode: "manual" });
  };
  const zoomBy = (delta: number) => {
    const container = containerRef.current;
    if (!container) return;
    const next = Math.round((current.current.zoom + delta) * 100) / 100;
    commit(zoomedViewport(current.current, next, container.clientWidth / 2, container.clientHeight / 2));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element &&
      event.target.closest("[data-panorama-node], [data-panorama-toolbar]"))) return;
    const start = { ...current.current, mode: "manual" as const };
    commit(start);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    commit({ ...active.start, x: active.start.x + event.clientX - active.clientX,
      y: active.start.y + event.clientY - active.clientY });
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { viewport, isPanning, fit, reset, zoomBy, onPointerDown, onPointerMove,
    onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onLostPointerCapture: () => { drag.current = null; setPanning(false); } };
}
```

## Planning-artifact verification record

Completed this round, on planning base `aef7aad669bb12357d58d899516aeec5473e40e4`:

- Saved and reread this complete plan; preserved the earlier plan and the clean primary checkout. An independent read-only reviewer found and root corrected the viewport observer/drag cleanup, the execution/title rename race, and exclusive runtime/Main file ownership. Recheck found those three points resolved; this was static review, not product execution.
- Parsed `ui-reference.tsx` and `viewport-reference.ts` with the primary checkout's TypeScript compiler using `transpileModule`; parsed the HTML script with Node `vm.Script`. All syntax checks passed. Imports, proposed shared types, production styles and React integration are **not** typechecked/built product code.
- Browser-tested the independent preview at the default 1280x720: all portrait images rendered, page `scrollWidth == clientWidth`, and no warning/error logs were captured. Queue expanded to eight rows with a 168px scroll body; folding retained the count. Sidebar expanded five sample member rows. Board showed five compact rows without full descriptions; clicking detail exposed the description, Back returned, and completed-filter plus keyword search yielded the expected one row.
- Set preview zoom to 85%, dragged background by (-40,+30), and triggered the sample status refresh: zoom stayed 0.85, pan stayed (-79,27.036435331230336), all five Overview tasks updated to completed, and the execution indicator updated. This verifies the **preview's** behavior, not the future React/Host implementation.
- Preview-only light-theme checks at 450x850 and 320x850 produced zero page/board horizontal overflow. Temporary viewport override was reset to the browser's 1280x720 default; the dark panorama preview remains open for review. These reduced-shell checks do not prove the actual Electron shell's supported panel widths/font-scale behavior.
- Saved [panorama preview](assets/expert-team-ux/preview-panorama-dark.png), [compact board preview](assets/expert-team-ux/preview-board-dark.png), and [narrow light preview](assets/expert-team-ux/preview-board-light-narrow.png). They are design-preview screenshots, not installed-app acceptance images.
- Checked local document links/artwork, all referenced existing test commands/files, code-block parity, defined CSS tokens, new-file whitespace and `git diff --check`.

Product T1-T9 remain **未开始**. Rust/build/typecheck/process E2E/live model and real installed-app visual acceptance were not run because this request is planning; they remain the specified implementation gates. No user data or business source was changed, and nothing was committed/pushed/released.
