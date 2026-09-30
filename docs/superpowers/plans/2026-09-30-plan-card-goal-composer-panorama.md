# Plan Card, Goal Indicator, Composer Density, and Agent Panorama

Status: T1 completed and verified; T2-T4 awaiting prerequisite `feat/composer-team-plan-goal-sidebar` landing on `origin/main`. The conversation
and final delivery to the user remain in Chinese; this repository's root
`AGENTS.md` section 0 requires repository documents and code to be in English.

## Evidence and execution baseline

- Surveyed `origin/main` at `2bf0ede53` on 2026-09-30. Image 1 shows a Plan
  approval title wrapping one character per line; image 2 is the target card
  hierarchy; image 3 shows the inline card during execution; images 4 and 5
  compare Composer control spacing; image 6 is the current standard Subagent
  topology; images 7 and 8 are the desired compact progress and panorama
  presentations. The images are user-provided visual references, not native UI
  verification of this source revision.
- A separate, dirty worktree at
  `PI-Desktop-worktrees/composer-team-plan-goal-sidebar` is implementing the
  earlier Composer/Team/Plan-to-Goal work. Its uncommitted changes and the
  primary checkout's untracked
  `docs/superpowers/plans/2026-09-29-composer-team-plan-goal-sidebar.md`
  belong to that work. Do not edit, copy, depend on, or overwrite its
  uncommitted files. Before implementation, refresh a dedicated request branch
  from `origin/main` and check whether that work has landed. Apply T1-T4 to
  the actual integrated code, preserving its new behavior. If it has not
  landed, independent T1 can proceed on this branch and be rebased after that
  work is integrated; T2-T4 wait for the corresponding
  Composer/Team/Plan-to-Goal foundation rather than duplicating it.
- Current baseline: `PlanApprovalBar.tsx` has the title, question, artifact
  opener, Goal toggle, Schedule, Reject, and approval controls. The card is
  rendered by `ChatTranscript.tsx` or `AssistantTurn.tsx`, outside
  `.composer-stack`. Its two-column CSS in `composer.css` lets the action
  column consume nearly all width, while its `@container composer-stack`
  narrow rules cannot apply there. This explains the vertical title in image 1.
- Approved Plan/Goal execution deliberately starts the runtime with
  `mode: "agent"` in `apps/desktop/electron/main/runtime/plans.ts`. The
  Composer currently labels its control from `activeSession.mode`, while the
  execution's effective kind is on the active Plan checkpoint. Displaying Goal
  during a Goal execution must not change the runtime mode or configuration.
- Standard `Task*` Subagents have an in-process one-level topology and a
  read-only `SubagentTranscriptTab`; Expert Team has a Host-owned revisioned
  roster/board and a Team panel. They are different execution profiles. No
  renderer write API, SQLite access, migration, or new protocol is needed for
  the panorama. `TaskWait`/`TaskList` are lifecycle events, not new agents.
- `/Users/sakurasep/Downloads/1` is a UTF-8 Qoder Canvas TSX report source.
  It uses `H1`, metadata, four `Stat` summaries, phase/file/evidence `Table`s,
  screenshot `Grid`, a warning `Callout`, and a final conclusion with a `Tag`.
  Its four relative PNGs are references from that report, not screenshots of
  PI-Desktop. The delivery format below adopts the hierarchy while requiring
  this task's real numbers and evidence.

Before code edits, read root and nearest scoped `AGENTS.md`, the affected
package README if present, `docs/spec/00-baseline.md`, ADR 0062/0226/0307/0309,
`docs/spec/04-ux/{07-ui-design-system,08-component-spec}.md`, and the three
delivery docs under `docs/spec/06-delivery/`. `apps/desktop/README.md` does not
exist on the surveyed base. The root `AGENTS.md` wins over old local-main or
commit workflow text in the delivery documents.

## Frozen visual and behavior contract

### T1: Plan approval card, images 1-3

The card is a compact full-width transcript surface, not a narrow text column
beside a fixed-width action rail. Its order is: title row with the existing file
icon and plan title; a naturally wrapped, readable question/summary; status if
present; footer with `View details` and truncated artifact path on the left,
then Goal, Schedule, Reject, and the existing approve/execute split control on
the right. The exact Plan artifact, approval permissions, execution model,
Schedule, reject, revision, disabled and error behavior remain unchanged.
Do not add inert copy/download icons merely to imitate image 2. Existing
functional actions remain visible. The pending Goal choice from the earlier
Plan-to-Goal work remains a local pre-execution choice, and Execute remains an
explicit action.

Use the following structural CSS target in `composer.css` after removing the
obsolete two-column/`composer-stack` rules. Numeric sizes here are design
choices from the supplied card reference; font/radius values use the existing
token scale. Move `.plan-approval-details` next to `.plan-approval-actions`
inside a new `.plan-approval-footer`; keep status/warning and non-pending
branches in their existing semantic order.

```css
.plan-approval-bar {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--radius-xs);
  background: var(--ds-bg-composer);
  box-shadow: var(--ds-shadow-composer);
}
.plan-approval-copy { width: 100%; min-width: 0; gap: 6px; }
.plan-approval-title {
  min-width: 0;
  font-size: var(--text-base-plus);
  line-height: var(--leading-compact);
  overflow-wrap: break-word;
}
.plan-approval-summary {
  width: 100%;
  min-width: 0;
  color: var(--ds-text-secondary);
  font-size: var(--text-base);
  line-height: var(--leading-body);
  overflow-wrap: break-word;
}
.plan-approval-footer {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.plan-approval-details { flex: 1 1 180px; min-width: 0; }
.plan-approval-actions {
  flex: 0 1 auto;
  max-width: 100%;
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.plan-approval-split { width: auto; min-width: 132px; flex: 0 0 auto; }
.plan-approval-artifact-path {
  max-width: min(36ch, 38vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

At card widths below 620px, the footer's action group occupies its own row
and remains right aligned; below 420px, the action group may wrap into two
rows, with the Execute control still easy to find and no button clipped. The
title has the full card width at every size. Use a `ResizeObserver` only if
ordinary wrapping cannot meet those widths; do not attach a container query to
an ancestor that does not contain this card. Long CJK titles wrap at phrase/
character boundaries across a normal line width, never at a forced one-character
column. A long Latin token may break only to avoid overflow.

### T2: Goal execution indicator, image 3

While an approved execution is active, display `Goal` below the conversation
when its effective execution kind is Goal, including a Plan artifact approved
with the local Goal choice. Display `Plan` for a Plan execution. Use the active
session's latest matching checkpoint (`executionKind ?? kind`) only when
`isActivePlanExecution(checkpoint)` and the checkpoint belongs to that session;
otherwise display the real configured `mode`. Never use a stale checkpoint from
a prior session. After completion the configured mode regains authority. The
indicator is a read-only display projection; menu callbacks and
`configureActiveSession` continue to receive the real session mode. Do not
change `runtime/plans.ts`'s `mode: "agent"`.

```ts
const displayMode: Mode =
  planCheckpoint?.sessionId === activeSessionId &&
  isActivePlanExecution(planCheckpoint)
    ? (planCheckpoint.executionKind ?? planCheckpoint.kind)
    : mode;
// ComposerToolbar receives both mode (configuration) and displayMode (label).
```

The eventual code must verify current `PlanProposal` types and the exact
`isActivePlanExecution` predicate after the earlier work lands. A scheduled
but not running Goal does not falsely look active. Goal's accessible name and
tooltip are localized in all shipped locales.

### T3: Dense Composer control row, images 4-5

Keep the existing Composer shell, draft height, menu, profile, model choice,
right-side enhancement/voice/Send or Stop controls, and minimum chat width.
Place `+`, profile, model/reasoning, then the Plan/Goal indicator in one tight
left-aligned cluster with 4-8px internal gaps. Keep enhancement/voice/Send at
the far right; the blank flexible space belongs only between these clusters.
The model label yields width first. Profile and Send/Stop never shrink below
their existing hit areas. The indicator is an icon plus `Goal`/`Plan` label at
normal width, icon-only with a localized tooltip at the existing narrow
breakpoint. There is no separate middle-floating mode chip or extra vertical
row. This follows the earlier worktree's proposed control order; check the
integrated result before changing CSS.

```css
.composer-toolbar { display: flex; align-items: center; gap: 8px; }
.composer-left { display: flex; min-width: 0; gap: 4px; flex: 0 1 auto; }
.composer-model-thinking { min-width: 0; flex: 0 1 auto; }
.composer-right {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  margin-left: auto;
}
```

Do not simply set `justify-content: flex-start` on the whole toolbar: that
would pull Send/Stop away from the right edge shown in image 5. Existing
`responsive.css` 560/480/450px container rules control what label collapses.
Check home and docked Composer, dark/light, zh-CN/en, long provider/model IDs,
running Stop, pending approval, and focus/tooltip behavior.

### T4: Subagent progress and shared panorama, images 6-8

Replace the large inline standard-Subagent topology with image 7's compact
progress presentation: a single row headed `Task progress`, a count and
completed/total plus elapsed status, a `View panorama` action on the right,
and one compact task line per actual `Task*` delegate with status icon, task
label, and agent name. Each line opens the existing read-only Subagent detail.
Keep tool, result, error, search and copy behavior in the main transcript.
Do not count `TaskWait`, `TaskList`, `TaskStop`, or an Expert Team member as a standard
Subagent. No task is marked complete merely because its tool call returned a
handle; use existing settled outcome records.

Add a `Panorama` view to both the standard-Subagent Overview and the Expert
Team panel. Reuse one read-only `AgentPanorama` renderer with separate adapters:
standard input is the owning session's existing delegation records/statuses;
Team input is a same-session, same-revision pair of
`TeamRosterProjection`/`TeamBoardProjection`. Root node is Main/Lead at top;
actual delegates/members are child nodes in rows of at most three. Connect
only real Lead-to-child relationships. Show task ownership and progress in
the member node, and actual `blockedBy` dependencies in the task detail rather
than drawing invented peer edges. Click a standard node to call the existing
`openSubagentTab(delegationId)`; click a Team node to open the current panel's
read-only member detail, without changing the main chat. Escape/back returns
to the prior Overview/Team aggregate view. Work Panel's existing maximize/
restore control provides the image 8 full-width canvas; do not build a second
app-wide window system. No new Host mutation API or persisted graph model.

Image 7/8 design choices: unframed dark/semantic canvas with 32px faint dot
grid; 260px node width; root centered above children; 20-24px gaps, 80px
vertical separation and thin muted connector strokes; 32px square identity
mark using the existing `IconBot`/`IconTarget` and per-member accent, since the
repo has no pixel-portrait assets to reuse. Node header carries name and
one-line task; footer carries localized status and semantic tint (running:
accent, completed: success, failed: danger, paused/queued: muted). No gradient
or decorative cards. Use existing `TooltipButton`, `Button`, `Badge`/`Panel`
where suitable; all visible/aria strings go through i18n. The controls at the
top right are Zoom out, percentage, Zoom in, Fit, Reset. Clamp zoom to
50%-150% in 10% steps, fit to available area on open and resize, and allow
background panning without moving nodes; wheel/pointer handling must not
steal text selection or node clicks. Reduced-motion disables animated zoom.

```css
.agent-panorama {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background-color: var(--ds-bg-primary);
  background-image: radial-gradient(var(--ds-border-strong) 1px, transparent 1px);
  background-size: 32px 32px;
}
.agent-panorama-toolbar {
  position: absolute;
  z-index: 2;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--ds-border-default);
  border-radius: var(--radius-xs);
  background: var(--ds-bg-elevated-opaque);
}
.agent-panorama-stage { position: absolute; transform-origin: 0 0; }
.agent-panorama-node {
  width: 260px;
  min-height: 88px;
  border: 1px solid var(--ds-border-default);
  border-radius: var(--radius-xs);
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
}
.agent-panorama-node-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
}
.agent-panorama-node-status {
  border-top: 1px solid var(--ds-border-subtle);
  padding: 8px 12px;
  color: var(--ds-text-secondary);
  font-size: var(--text-sm);
}
.agent-panorama-edge { fill: none; stroke: var(--ds-border-strong); stroke-width: 1.5; }
```

The SVG edge layer and nodes share the same transformed stage coordinates.
Use stable node IDs and measured node centers (or fixed grid geometry) for
connectors. Empty, loading, refresh failure, paused, multiple agents, long
names, session change, restart, and stale async response have explicit views.
The Team panel's existing paired revision checks remain authoritative. Fit
never makes text so small it cannot be inspected: below 50%, retain the 50%
floor and permit panning. At narrow panel widths, show the compact progress
list and an obvious Maximize action before the canvas.

## Subagent ownership and implementation order

Main agent owns base refresh, integration, `Composer.tsx`, any shared display
type/prop, i18n coordination, spec/E2E documentation, native UI comparison,
and the final report. Freeze the `mode`/`displayMode` split and the read-only
panorama inputs above before parallel edits. Each worker reads the root/scoped
rules and current sources/tests; no two workers write the same file.

| Task | Exclusive worker files/modules | Dependencies and acceptance |
| --- | --- | --- |
| T1 card | `PlanApprovalBar.tsx`, card rules in `composer.css`, focused Plan card tests | Independent on current `origin/main`; rebase onto the earlier Plan approval work after it lands. Prove title stays readable at 450/700/1000px, all existing actions remain reachable, and Goal/Schedule still require explicit Execute. |
| T2 Goal label | `ComposerContractPicker.tsx`, focused Goal display test; main agent owns `Composer.tsx` and toolbar prop wiring | Parallel with T1 once effective-kind semantics are frozen. Prove active Plan-as-Goal and native Goal executions show Goal; idle/scheduled/other sessions do not. Runtime still launches agent. |
| T3 density | `ComposerToolbar.tsx`, `composer-menus.css`, `responsive.css`, `theme-overrides.css`, focused Composer layout tests | Parallel with T1/T2 after toolbar prop shape is frozen. `composer.css` is T1-owned; T3 gives any needed edits there to T1. Prove left cluster stays compact and Send/Stop stays right at 450px minimum. |
| T4 panorama | `SubagentDetail.tsx`, `ActivityGroup.tsx`, `OverviewTab.tsx`, `TeamPanel.tsx`, new `AgentPanorama.tsx`, `messages.css`, `team-panel.css`, `work-panel.css`, focused panel/topology tests | Starts after prior T3/T5 Team/Overview work lands. Main agent owns any shared WorkPanel wiring and i18n. Prove truthful counts, both profile adapters, node click/detail/back, zoom/fit/pan, session isolation, and loading/error/restart states. |

T1 and T3 touch different CSS files except for `composer.css`; its sole owner
is T1. T4 is independent of the card/Composer files after base integration.
Main agent must inspect every worker diff and run the combined user paths; a
worker's self-report is not acceptance. The earlier worktree is not a worker
for this plan and cannot be edited by these workers.

## Verification and delivery

1. On the dedicated task candidate after latest `origin/main`, add a regression
   test for the old Plan card compression and Goal display mismatch. Run the
   focused existing component/source tests (`plan-renderer-flow`,
   `plan-approval-settings`, `composer-pickers`, `composer-responsive`,
   `subagent-topology`, `team-panel`) and the relevant desktop typecheck,
   `pnpm build:js`, and `pnpm lint`. Use the exact test entry points found in
   current `apps/desktop/package.json` when implementation begins.
2. Run the applicable isolated task-candidate E2E suites
   `pnpm test:e2e:plan-ui`, `pnpm test:e2e:composer-mode-menus`,
   `pnpm test:e2e:subagents`, and `pnpm test:e2e:team` using the provisioned
   host dependencies. Record tested commit/base and fixture. No paid provider,
   live user profile, or production data is part of these checks.
   `verify:ui:*` is prohibited unless the user explicitly requests it.
3. In the actual Electron UI with an isolated profile, compare images 1-8 at
   a wide window and a 450px chat column, dark/light and zh-CN/en: long CJK
   title, two-line summary, pending/running/scheduled approval, Plan-as-Goal
   indicator, dense home/docked Composer, one and many Subagents, Expert Team
   roster, panorama controls and return path. Check no overlap, clipped text,
   false completed state, stale other-session content, or focus loss. If native
   UI cannot be launched, report the missing evidence as `实现中`; source tests
   do not establish visual acceptance.
4. Update affected `04-ux/08-component-spec.md` and
   `06-delivery/04-e2e-test-plan.md` alongside behavior. Update other specs
   only for actual contract changes; no migration/ADR is expected because the
   panorama and label are projections of existing data. Review the task diff,
   preserve unrelated work, and follow root `AGENTS.md` for commit/PR gates.

Use the structure of `/Users/sakurasep/Downloads/1` for the implementation
report: outcome title/source and tested revision, truthful four-metric summary,
phase table, changed-file table, verification table with exact commands and
pass/fail/skipped, native screenshots in a two-column grid when obtained,
limitations callout, and an answer-first conclusion tagged `待体验` only after
all applicable checks pass. Do not reuse that report's StarTool statistics,
screenshots, `feature-complete` tag, or environmental claims. This planning
round has run source inspection only; T1-T4 remain `未开始`.
