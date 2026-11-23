# PI-UI-1121: activity rail sections, one hairline and a chosen order

Status: 待体验 (Batches A, A2, B, the Reconnect follow-up and C built and verified locally on the request branch; committed there as one commit at the user's word on 2026-11-22; pushed and merged as PR #101, merge commit `ed162b47d`, and shipped in v0.15.22). Project: `fork-pi-desktop`. Created: 2026-11-21 (Asia/Taipei).
Tier: T1 for Batches A, A2, B and Reconnect (renderer-only visible change; no IPC, Host, protocol or storage-schema change); **T2 for Batch C**, which adds an optional Host protocol field derived from untrusted process output (ADR `session-activity-server-address`, D647). D645 amends the D297 stroke rule for this one surface; D646 (Batch B) records the rail as a read-only mirror of the composer's context entry; D647 (Batch C) records the Servers section and the address contract.
Baseline: `3a709f373721ac86f13f5ca020c29606bd9e23e0` (`main` after PR 100).
Branch: `feat/20261121-pi-ui-1121-activity-rail-sections`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261121-feat-pi-ui-1121-activity-rail-sections`.
Pushed, opened as [PR #101](https://github.com/SakuraLoveSmile/PI-Desktop/pull/101) and merged on 2026-11-22 (merge commit `ed162b47d`), then shipped in v0.15.22 ([PI-REL-01522](PI-REL-01522-macos-release.md)). Merge and release are tracked separately from acceptance; 已验收 is the user's.

## Request and source

The user asked for the right activity rail to be restyled after Claude Code's side panel. A chat-only canvas went through six iterations; the choices that bind this change are: a whole-row expand control, one hairline between sections (the user picked "用分割线" over spacing alone), Goal and Plan split apart, a drag grip on every section to choose the order, and no outlined buttons. The implementation plan was cut into batches A to D. This record is **Batch A** (the section skeleton and the ordering) plus **A2**: after the first frames the user judged Batch A far from the v6 canvas, and asked for the visual-alignment pass with both behavior defaults following the canvas (「做 A2，两个默认值都按画布来」). A2 reworks the headings, rows and status of the five existing sections on this same branch. Batches B to D (environment, changes, context and MCP rows; servers; the pinned session summary) are separate requests with their own branch and worktree, so the canvas items that belong to them are not in this change.

## Behavior change

- The rail is a stack of sections in this default order: Goal, Plan, Live status (subagents, team members, background processes), Artifacts (outputs, sources), Skills & MCP. One 0.5px `--ds-border-default` hairline separates neighbours; none above the first section and none around or inside a group, row, heading or the attention block. The `--ds-tile` group plates, the attention-block outline, the artifacts-label rule and the process-detail rule are removed (D645, amends D297).
- A recorded Goal is listed in its own Goal section instead of inside Plan.
- A section heading is a whole-row toggle: title, chevron and, only while folded, a quiet summary (running, failed and timed-out counts, or the number of artifacts). A nested group heading (Subagents, Team members, Background processes, Sources) is the smaller medium-weight heading: title, count, chevron. The Skills & MCP heading follows the section pattern; its suggestion action is a borderless link (sparkle glyph and the count, or "Suggest" while there is none).
- Every section heading ends in a drag grip. Pointer drag, Arrow Up/Arrow Down on the focused grip, Escape, a cancelled pointer or a blurred window (all restore the starting order), a polite live region that announces name and position, and a **Reset order** control that appears while the order differs from the default and returns focus to the first grip.
- The order is one per-device renderer preference shared by every session's rail: `localStorage` key `pi-desktop:activity-section-order:v1`, removed again when the order is the default. Unknown or repeated ids are dropped, a section the saved order lacks lands after its default predecessor, a section that is not currently shown keeps its slot, and an unreadable or unwritable storage keeps the order for the running window and logs only the error name.
- A2, rows and status: a row is one line (34px) with a 16px muted glyph, the label and a quiet status at the far edge: a spinner while the work runs, a check once it is done, a coloured word only for a failed, timed-out or degraded state, a quiet word otherwise; the accessible name always carries the state. Overview agents show the name over a truncated task, with the status and elapsed time at the far edge. A Goal row shows a target glyph, the title, `done/total`, a 3px progress bar and the report chip, and no state word while it simply runs. Zero line counts (`+0`, `−0`) are not printed.
- A2, defaults (both follow the canvas and both change documented behavior): outputs are listed directly under Artifacts with no fold of their own and no Outputs label, and only Sources start folded (the old rule folded both; my earlier note "outputs and sources expanded by default" mislabeled the canvas, whose Sources stay folded). Empty groups and sections, including the per-group hint lines, are left out; a rail with nothing at all keeps Live status with one hint line, and a notice that only says data is still loading no longer opens an empty group. The Plan group is now left out whenever it has no plans, not only while Goals exist. Skills & MCP follows the same rule: with nothing to list it is its heading and the Suggest link, and its inline hint paragraph is gone (the suggestion dialog keeps its own empty state).
- A2, information moved off the row: write count, last-change time and citation count are no longer printed under the row; they stay in its tooltip and accessible name. Row actions (open, locate, copy path, details) overlay the row's far edge on hover or keyboard focus, and while one of them holds focus, instead of reserving width; coarse pointers keep them visible. The same reveal rule covers the skill suggestion's Ignore control.
- A2, loaded-range notice: with only part of the transcript loaded, the notice (Load earlier, Return to latest) shows once in Live status and once in Artifacts instead of inside each of agents, outputs and sources.
- Unchanged: counts and Host totals, attention targets and focus rules, Goal report links, Skill suggestion content and actions. Strings: new `panel.activity.goals`, `panel.activity.sections.*`, `panel.activity.emptyLive` and `panel.activity.skills.extract`; removed the six per-group empty hints (`emptyPlans`, `emptyAgents`, `emptyTeamMembers`, `emptyProcesses`, `emptyOutputs`, `emptySources`) and the `outputs` group label, in all nine locales.

## Implementation notes

- New modules, all small: `activity-section-order.ts` (pure order logic), `use-activity-section-order.ts` (store plus hook), `ActivityRailSections.tsx` (layout, drag and keyboard), `ActivitySectionGrip.tsx` (context that hands each section its own grip), `session-activity-sections.css`. A2 adds `activity-rail-visibility.ts` (the pure rule for which sections and groups show, unit-tested) and `ActivityRowStatus.tsx` (spinner, check or word), and rewrites `ActivityRailGroup`, `SubagentActivityRow`, `GoalActivityRow`, the row markup and the rail CSS.
- The sections container is a block, not a flex column: the canvas relies on margin collapsing between the Goal progress bar and the next section's hairline, and a flex column added 6px.
- Single-group sections (Goal, Plan, Skills & MCP) put the grip in their group heading through the context; Live status and Artifacts hold several groups, so they get a muted label row that carries the grip. Existing class names and `data-activity-*` attributes are kept, so the older probes and unit tests keep their selectors.
- The drag follows the pointer on `window`, so it survives the live re-parenting that the reorder causes. Listeners exist only while a drag is active and are removed on release, cancel, blur and unmount.
- Deviation from the plan: no placeholder element is added for the pinned summary. The attention block stays above the sections, and Batch D adds the summary there, so no dead DOM ships in this batch.
- Harness fix found on the way: the optional screenshot steps of `scripts/e2e-transcript-render.mjs` waited with `Promise.all(animation.finished)`. A cancelled animation rejects that with a non-Error object, which the runner prints as `[object Object]` and exits 1. This reproduced on unmodified `main` at the light-theme step, so it predates this change. Both waits now use `Promise.allSettled(...).then(() => undefined)`, which still waits for every finite animation to end.

## Validation

| Check | Result |
| --- | --- |
| desktop `tsc --noEmit`, `tsc -b` for shared, i18n and agent-runtime | pass |
| new behavior tests: `activity-section-order.test.mjs` (14), `session-activity-rail-sections.test.mjs` (18, rewritten for A2) | 32 pass |
| `node --test apps/desktop/test/*.test.mjs` (full) | 4477 tests, 4473 pass, 0 fail, 4 skipped |
| i18n vitest | 3 files, 30 tests pass |
| `check-style-tokens` | style tokens OK (it caught a raw `line-height: 1` and a raw `2px` radius in the A2 CSS; both are tokens now) |
| `check-test-quality` | pass, baseline untouched (237 files, 8112 assertions) |
| docs `check-locales` / `check-docs` | 95 pairs / 655 pages |
| `generate-scenario-index --check` | 138 suites, 168 ids, current |
| `check-architecture` / `check-agent-policy` / `check-release-docs` | pass |
| `electron-vite build` (candidate) | pass |
| `node scripts/e2e-transcript-render.mjs` gate form (rail probe 95 checks: default disclosure state, hairline widths, keyboard and pointer reorder, Escape, Reset order, fit in the real 264px pane at font scale 1.4 in both themes, empty-rail hint; integration probe 196 checks incl. Goal report scenes and the Skills & MCP empty state) | pass (`ok: true`) |
| same script with the three screenshot env vars, hardened wait | pass (`ok: true`, dark, light and Artifacts frames written) |
| `node scripts/e2e-session-activity-history.mjs` (isolated Rust Host from `main`, production Overview) | pass (`ok: true`, 13 checks, 66 outputs, offsets 0 and 50; the probe now reads the total from the Show all control because outputs have no heading) |
| `node scripts/e2e-goal-blocked-ui.mjs`, `node scripts/e2e-goal-team-renderer-ui.mjs` | both pass (`ok: true`) |
| repo-wide `biome lint` (the `lint:biome` script) | pass, 146 files; its `biome.json` does not include the rail directory |

Environment: macOS arm64, Node 22.23.2, dependency overlay from the primary checkout, library `dist` built locally with direct `tsc`, no pnpm run inside the overlay. Electron E2E ran with `CLAUDE*` and `ELECTRON_RUN_AS_NODE` unset and `-ApplePersistenceIgnoreState YES` to avoid the reopen-windows modal. Host binary: primary `target/debug/pi-desktop-host-core` built from `main`; this change touches no Rust.

## Visible evidence

Acceptance for A2 is canvas parity, not plan text: the v6 canvas and the real `SessionActivityRail` side by side, same state, real 264px pane with its padding, device pixel ratio 2, dark and light, paired section by section. Frames live in the review session's scratch directory and are not committed (`parity-dark-work.png`, `parity-dark-attn.png`, `parity-light-work.png`, `idle-folded.png`; before = the Batch A frames from the earlier fallback-state fixture).

| Section (work state) | Canvas | Real |
| --- | --- | --- |
| Goal | 84.0px | 84.0px |
| Plan | 79.0px | 79.0px |
| Live status | 222.5px | 222.5px |
| Artifacts | 181.0px | 181.0px |
| Skills & MCP | 113.0px | 113.0px |

In the attention state Live status is 34px taller than the canvas (249.5 against 215.5) only because the real rail keeps the nested Ended processes group, which the canvas does not draw; every other section matches.

Differences that remain, none of them in this change's scope: the icon set (the app's glyphs against the canvas's webfont), the elapsed format (`2m 14s` against `02:14`), command titles trimmed to the script name (`pnpm test` against `pnpm test --watch`), no per-row meta such as "2 次" or "已连接" (Batch B), and a folded Goal or Plan heading that shows running counts rather than `3/6`. The canvas also draws the environment, changes, context and MCP status rows, the servers section and the pinned session summary; those are Batches B to D. The canvas text looks heavier only because of font smoothing in the capture.

## NOT RUN and risks

- NOT RUN: `verify:ui:*` (only on the user's request), Windows and Linux rendering, the installed app and any real provider, a touch-device drag (the grip sets `touch-action: none` and uses pointer events, but only mouse-style events were exercised), `biome lint` on the rail directory itself (the repository's `biome.json` excludes it; the repo-wide run covers 146 other files).
- Information moved off the row: write count, last-change time and citation count are now only in the tooltip and accessible name, so they need a hover to read. If that proves too quiet, Batch B's per-row meta is the place to bring them back.
- A2 changes documented behavior twice (outputs listed, empty groups hidden) and removes the six per-group empty strings; the specs, decisions log (D645), E2E plan and zh-CN mirrors are updated with it.
- Not handled: two windows keep separate in-memory caches of the section order and do not listen for `storage` events, so a change in one window shows in the other after a reload. The Host and the order never talk to each other, so no data is at risk.
- The Reset order control sits at the end of the stack; on a long rail it is below the fold. Moving it next to the first section is a one-line change if the first look shows it is missed.
- D645 is the next free decision number on this branch; a parallel branch that also adds a decision would need renumbering at merge. The sibling markdown-table worktree added none when this was written.
- Changelog: not changed. Release notes are written by the release-prep step, not by a feature change.

## Batch B: environment, context, changes and MCP status

Request: 「下一步是不是开始做 B 批次了 做吧」, after the implementation plan with batches A–D. Tier T1: the data comes from calls and stores the composer, the Review tab and the Extensions page already use, so there is no IPC, Host, protocol or storage-schema change. B is built on the same uncommitted worktree because it needs A's section skeleton; the stack (A, A2, B) is one branch.

### Behavior change

- Three sections join the rail, giving the default order Goal, Plan, Live status, **Environment, Context**, Artifacts, Skills & MCP, **Changes**. Each shows only when its data exists and only the visible pane reads it. A saved order from before B lacks the new ids; they land after their default predecessor (unit-tested, including the five-id legacy order).
- Environment: the session's project (name over a path shortened to the last two folders, full path in the tooltip) and the git branch, from the Host-owned git snapshot the composer's workspace menu reads (`useComposerWorkspaceGit`). A snapshot of another project is dropped, a branch changed from the composer menu is read again, and a folder outside git (or a session without a project) has no section. Folded: the project's name.
- Context: the newest usage-bearing request through the composer inspector's own functions and the same used/remaining preference: headline, `~used / window`, a bar split into system / tools / messages (one segment until the request's breakdown is known) and a legend with the free space. The breakdown subscription lives only while the section is open and visible. Details opens the context dashboard by the composer's placement rule. Warning at 25% or less remaining, critical at 10% or less. Folded: label and percentage.
- Changes: the Review tab's recorded change count and +additions −deletions from the same summary functions, a heading that cannot fold, and a Review link that opens the tab. Omitted while nothing is recorded.
- Skills & MCP: one row per MCP server the session used, with its state at the far edge: a quiet Connected, a spinner while connecting (re-read every 2 s, at most 20 times), a warning-coloured Sign-in needed (HTTP server that asks for authorization and sends no `Authorization` header), a failure word, or a quiet Idle; the tooltip carries the server's message. A tool whose server is gone, or any tool while the list cannot be read, keeps its own row without a state; skills carry none. Rows wait for the first read so a raw tool name never flashes before it folds into its server. A failed server also offers Reconnect (see the follow-up at the end).
- Behavior-preserving refactors on the way, both pinned by existing tests: the capacity rule lived twice in the composer (footer and inspector popover) and a third copy would have been a rule duplicated, so it is now `contextCapacityLevel` in `lib/context-usage.ts`; the inspector's dashboard link and the rail's Details link share `openContextInsights` (modal preference opens the dialog, otherwise the work-panel tab).
- Strings: new `panel.activity.environment`, `environmentBranch`, `context`, `contextFree`, `changes` and `mcp.idle` / `mcp.authNeeded` in all nine locales (`mcp.reconnect` / `mcp.reconnectNamed` came with the follow-up); the Details, Review, change-count, usage and MCP state strings are reused.
- Not touched: Composer.tsx, app-store.ts, ChatTranscript.tsx, electron main and the Rust files of the architecture ratchet.

### Implementation notes

- Pure layer: `activity-context-view.ts` (the composer's functions behind one view), `activity-mcp-rows.ts` (tool names `mcp_<id>_<tool>` fold into their server, longest id prefix wins, states and the sign-in rule), `activity-workspace-view.ts` (path and folder names). Hooks: `use-activity-workspace.ts` (environment, changes and context from the existing sources, for the visible pane only) and `use-activity-mcp-servers.ts` (global and project `listMcpServers`, owner-guarded, polls while connecting, reports `settled`). Sections: `ActivityEnvironmentSection`, `ActivityContextSection`, `ActivityChangesSection`, `ActivityMcpStatus`, one stylesheet `session-activity-workspace.css`. Every module is below 250 lines.
- `SessionActivity.tsx` only wires the new props; `ActivityRailGroup` takes a node as its folded summary; `SessionSkillSuggestions` renders a row's state and tooltip from the row data.
- Probes: new `scripts/e2e/session-activity-workspace.tsx` (37 checks on the real store, hooks and production CSS with only the Host edge faked: section order, git branch and stale-answer drop, usage numbers, bar and legend arithmetic, the five MCP states and the polling, 264px fit at font scale 1.4 in both themes, link placement, Details and Review targets) runs as stage `activity-workspace` of `e2e-transcript-render.mjs`. Two existing probes changed for intended behavior only: the rail probe renders all eight sections and stubs the context-insights calls, and the integration probe scrolls the Skills trigger into view (the workspace sections push it below the window, and the anchored flyout closes by design once its trigger leaves the viewport) and waits for the first server read before it expects a raw MCP tool row. No assertion was weakened.

### Validation

| Check | Result |
| --- | --- |
| desktop `tsc --noEmit`, `tsc -b` for shared, i18n and agent-runtime | pass |
| focused unit tests: `session-activity-workspace` (23), `activity-section-order`, `session-activity-rail-sections` (18), `context-usage` (incl. the capacity level) | 77 pass |
| `node --test apps/desktop/test/*.test.mjs` (full) | 4502 tests, 4498 pass, 0 fail, 4 skipped |
| i18n vitest | 3 files, 30 tests pass |
| `check-style-tokens`, `check-test-quality` | pass; baseline untouched (237 files, 8112 assertions) |
| docs `check-locales` / `check-docs` | 95 pairs / 655 pages |
| `generate-scenario-index --check`, `check-architecture`, `check-agent-policy`, `check-release-docs` | pass (138 suites, 168 ids) |
| `electron-vite build` | pass |
| `node scripts/e2e-transcript-render.mjs`, gate and screenshot forms | pass (`ok: true`; rail probe 95 checks, workspace probe 37, integration probe 196, readability 16) |
| `node scripts/e2e-session-activity-history.mjs` (isolated Rust Host from `main`) | pass (`ok: true`, 13 checks) |
| `node scripts/e2e-goal-blocked-ui.mjs`, `node scripts/e2e-goal-team-renderer-ui.mjs` | both pass (`ok: true`) |
| repo-wide `biome lint` | pass, 146 files |

### Visible evidence

Acceptance is canvas parity: the v6 canvas and the real `SessionActivityRail` side by side, same state, real 264px pane, device pixel ratio 2, paired section by section. The context headline moved from 13px to the canvas's 14px during this pass, which closed a 1.5px height gap. Frames live in the review session's scratch directory and are not committed (`b-parity-work.png`, `b-parity-attn.png`, `b-mcp-and-folded.png`).

| Section (work state) | Canvas | Real |
| --- | --- | --- |
| Environment | 120.0px | 120.0px |
| Context | 179.0px | 179.0px |
| Artifacts | 181.0px | 181.0px |
| Skills & MCP | 113.0px | 113.0px |
| Changes | 43.0px | 43.0px |

In the attention state Live status is still 34px taller (the nested Ended processes group) and the idle Live status is 1px taller; every other section matches in all three states.

Differences that remain: no settings gear on the folder row (nothing to open); the path caption reads `…/Fork Project/PI-Desktop` where the canvas draws `~/…/`; the context headline uses the composer's wording (已用) and compact tokens (`~82K / 200K`) where the canvas has 已使用 and 万; legend swatches are circles like the composer's own legend, because the design system's radius ladder has no 2px step for the canvas's rounded squares; the Review link is labelled 审阅 like the tab (the canvas says 审查), and the section is 更改 as in the canvas while the Review tab's own wording is 改动; a skill row has no "N 次" (the recorded data carries no per-skill count); Skills & MCP keeps its heading and suggest action in an idle rail (an A decision) where the canvas hides it. The canvas's Servers section (Batch C) and session summary (Batch D) are not built.

### Decisions left to the user

- Legend swatch shape, circles (composer) or squares (canvas), and the Review link wording.

### NOT RUN and risks

- NOT RUN: `verify:ui:*` (only on the user's request), Windows and Linux rendering, the installed app, a live MCP server (the state mapping, polling and the reconnect call run against a faked Host edge), a project with a very large change list, a touch device.
- Environment reads the git snapshot through the Host for the visible pane (the composer's own hook: one read per visibility or branch change). MCP polling stops by itself after 20 reads.
- The rail grows from five to eight sections, so a busy rail scrolls more and the Skills & MCP control can sit below the fold (the integration probe now scrolls to it, as a person would).
- `ContextUsageInspector.tsx` changed (shared capacity rule, shared dashboard opener); the composer footer, inspector position and compaction tests in the full suite cover it and pass.
- D646 is the next free decision number after D645; no local branch uses either. A parallel branch that takes it would need renumbering at merge.

## Follow-up: Reconnect for a failed MCP server

Request: 「接上重连」, the answer to the Batch B question whether a failed server should get the canvas's 重新连接. Tier T1: renderer only, over a channel the Extensions page already uses (`testMcpServer`), so there is no IPC, main-process, Host, protocol or storage-schema change and no ratchet file is touched. Built on the same uncommitted stack.

### Behavior change

- A failed MCP server that is not waiting for a sign-in offers **Reconnect** in the failure word's place: a borderless word in the warning colour (28px tall, 12px type, 6px corners, tinted only under the pointer), the canvas's quick action. Its accessible name is "Reconnect <server> (connection failed)", so the state the word carried is still announced; the failure message stays in the row's tooltip.
- Clicking it calls the existing `testMcpServer` (the Extensions page's Test connection) with the server's own level and, for a project server, its project. The side effect is the one the user accepted: a forced handshake that rebuilds the workspace's user-MCP runtime, not a plain retry.
- While the Host answers, the row shows the connecting spinner and offers nothing. The answer replaces that server's status: a server that connects reads Connected, one still down reads Failed with its new message in the tooltip, one that now asks for a sign-in reads Sign-in needed. One request per server and project runs at a time (a second click in the same tick is ignored), an answer that arrives after the pane moved to another project or closed is dropped, and the spinner of an abandoned request does not outlive it.
- A server that is still down, and a request the Host could not take, say so once in an error toast that names the server (`Kaneo: connect ECONNRESET`), in the Extensions page's own wording (`extensions.mcp.authRequired`, `extensions.mcp.testFailed` or the server's message). A server that connects says so in its row only.
- A server that needs sign-in is not offered Reconnect; signing in stays on the Extensions page. A row that is itself a button keeps the word, so no button holds another button (no MCP row is one today).
- Strings: `panel.activity.mcp.reconnect` and `panel.activity.mcp.reconnectNamed` in all nine locales.

### Implementation notes

- `activity-mcp-rows.ts`: `McpReconnectTarget` and `mcpReconnectTarget` (the level comes from the record the Host lists, the project only for a project server); a failed row that is not waiting for sign-in carries its target. `withReconnecting` and `withStatus` are pure.
- `use-activity-mcp-servers.ts`: `reconnect(target)` keeps a request per `project + server` in a ref (refuses a second click before any render could hide the button) and in state (paints the spinner), merges the answer into the rows it belongs to, and drops it when the pane left that project or unmounted. `SessionActivity` turns a failed answer or a rejection into the toast.
- `ActivityMcpStatus` renders the button, `SessionSkillSuggestions` hands the callback only to rows that are not themselves buttons, and the style is one rule in `session-activity-rail.css` made of existing tokens.

### Validation (follow-up)

- Unit tests: `session-activity-workspace` 23 to 27 (target by level and project, no retry for connected, connecting, idle or sign-in rows, the pure status helpers, the button's name and place, no nested button).
- Probe `activity-workspace` 37 to 55 checks on the real store, hooks and production CSS with only `testMcpServer` and the server list faked: the button's name, colour, frame, metrics and edge, fit at font scale 1.4, one call with the server's level, the spinner while waiting, settling on the answer, a rejected request, a server that stays down, and a late answer after a project switch.
- Mutation checks, each restored afterwards: without the duplicate guard the probe failed at "once", without the owner guards at the late answer, and without the pending cleanup at "the row did not settle".

| Check | Result |
| --- | --- |
| desktop `tsc --noEmit`, `tsc -b` for shared, i18n and agent-runtime | pass |
| `node --test apps/desktop/test/*.test.mjs` (full) | 4506 tests, 4502 pass, 0 fail, 4 skipped |
| i18n vitest | 3 files, 30 tests pass |
| `check-style-tokens`, `check-test-quality` | pass; baseline untouched (237 files, 8112 assertions) |
| docs `check-locales` / `check-docs` | 95 pairs / 655 pages |
| `generate-scenario-index --check`, `check-architecture`, `check-agent-policy`, `check-release-docs` | pass (138 suites, 168 ids) |
| `electron-vite build` | pass |
| `node scripts/e2e-transcript-render.mjs`, gate and screenshot forms | pass (`ok: true`; rail probe 95 checks, workspace probe 55, integration probe 196, readability 16) |
| `node scripts/e2e-session-activity-history.mjs` (isolated Rust Host from `main`), `e2e-goal-blocked-ui`, `e2e-goal-team-renderer-ui` | all pass (`ok: true`, history 13 checks) |
| repo-wide `biome lint` | pass, 146 files |

### NOT RUN and risks (follow-up)

- NOT RUN: the real main-process `testMcpServer` handler against a live failing server (the call is faked at `api.testMcpServer`), and a project-level server end to end (the probe's servers are global; the project target is unit-tested).
- Reconnect rebuilds the workspace's user-MCP runtime, as accepted; a server tested while the rail shows a project other than the app's current workspace is put back by the handler afterwards (existing behavior of the call).
- A server list read that started before an answer and finishes after it can show the older state until the next read; the next click or the next tool use reads again.

### Visible evidence (follow-up)

Canvas parity again, in the attention state: same state, real 264px pane, device pixel ratio 2, both themes. Skills & MCP is 113.0px in the canvas and in the real rail, and the failed server reads 重新连接 in the warning colour at the far edge, 8px inside the status column like the canvas's own quick action, so the button's 28px height fits the 34px row without growing it. Every other section keeps its height (Live status is still +34px in this state, as recorded above). Frames live in the review session's scratch directory and are not committed (`rc-skills-attn.png`, `parity-dark-attn.png`, `parity-light-attn.png`, `real-dark-mcp.png`).

Differences that remain for this row: the canvas draws its own plug and wrench glyphs where the app uses its plug and wrench icons, a skill row has no "N 次", and the 12% warning tint under the pointer is written from existing tokens but was not captured, since a static frame has no hover.

## Batch C: servers

Request: 「开始批次 C」, after the implementation plan with batches A–D. Tier **T2**: a new optional field on the Host's `backgroundProcesses.list` rows, derived from untrusted process output, crosses the Host protocol, so the ADR (`docs/adr/session-activity-server-address.md`) and a briefing came first. C is built on the same uncommitted worktree because it needs A's section skeleton; the stack (A, A2, B, Reconnect, C) is one branch. If C should be its own PR, A and B have to be committed first, on the user's word. D647 is the next free decision number after D646; no local branch uses it.

### Behavior change

- A **Servers** section joins the rail directly after Live status (default order Goal, Plan, Live status, **Servers**, Environment, Context, Artifacts, Skills & MCP, Changes). A saved order that lacks it places it right after Live status, wherever Live status was moved (unit-tested).
- Host: a process's own stdout and stderr are scanned for the first local web address. Only `http`/`https` URLs with host `localhost`, a `127.x.y.z` address or `[::1]` and an explicit port 1–65535 qualify (`0.0.0.0` and `[::]` are reported as `localhost`), and the URL must be followed by a delimiter. Credentials, look-alike hosts (`localhost.evil.test`, `localhost:3000@evil.test`), LAN addresses, other schemes and `xhttp://` or `git+http://` never match. The value is the origin only (`scheme://host:port`): path, query and fragment, which can carry tokens, are dropped. ANSI sequences (also inside the URL) and a URL split across two reads of one stream are handled with a bounded 256-byte tail per stream; the first match wins and never changes.
- The value is live-only: it lives with the Host's in-memory output buffer, is overlaid on `running` and `stopping` rows of `backgroundProcesses.list`, and is never stored, never on `read`, `stop`, ended or restored rows, and gone after a Host restart, so there is no migration. The read that completes the first match emits one immediate `backgroundProcesses.changed` (still identity-only). The field is additive and optional: protocol 11 and the IPC are unchanged (Electron main passes the Host answer through untouched).
- Renderer: a `running` or `stopping` process whose `address` passes a second, strict origin check is a server whatever its `backgroundKind` (an ordinary command or a Team service). It is listed once, under Servers, and not under Live status. A process with no address stays in Live status, and an ended server goes to Live status's ended group.
- A row is one line (34px): server glyph, name (the script or tool name without the port the address already shows; command and working directory in the tooltip), the address in muted 12px text and a stop square (24px by 28px, flush with the row edge, a 10px glyph with 2px corners). The name opens the process details, which show **under the server rows** (details of any other process stay under Background processes, so a servers-only session never gets an empty Live status section; this was found on review of the first build, which opened them under an empty "Background processes 0"). The address opens the work panel's browser tab at the server's origin, and Stop calls the existing `stopBackgroundProcess` that the details use. One stop per process runs at a time: a spinner takes the square's place until the Host answers or the status reads stopping, a rejected stop gives the square back with one error toast naming the server (the log keeps the error name only), and an answer after the pane closed reaches nothing. Without handlers the address is text and no stop is drawn. Folded, the section says "N running".
- Not changed: how a server is started (an approved background Bash call), the default 60 second Bash timeout (a dev server started without a longer explicit `timeout` still ends after 60 seconds, like any background command), the Team service TTL, the process details and Stop semantics.
- Strings: `panel.activity.servers` and `panel.activity.server.stop`, `open`, `stopFailed` in all nine locales.
- Not touched: Composer.tsx, app-store.ts, ChatTranscript.tsx, electron main and the ratchet Rust files (plugins.rs, db.rs, providers.rs, plans.rs).

### Implementation notes

- Host: new module `crates/host-core/src/background_address.rs` (pure detector `AddressDetector::feed` and `detect`, ANSI stripping, 9 tests). `background_processes.rs` (+56 lines, 704 in total, under the 1000-line limit) feeds it from `BackgroundOutput::push` for both streams; `live_address` overlays `list_view`; `address` is `skip_serializing_if = "Option::is_none"`, so existing rows serialize exactly as before.
- Renderer: `activity-server-rows.ts` (`serverAddress`, `splitServerProcesses`), `use-activity-server-stop.ts`, `ActivityServersSection.tsx`, `session-activity-servers.css`; `activity-section-order.ts` (the new id), `activity-rail-visibility.ts` (a server counts as content, so no empty hint), `SessionActivityRail.tsx` and `SessionActivity.tsx` (wiring, `selectedProcessId` decides where the details show), `activity-rail-presentation.ts` (`backgroundProcessName`).
- Tests that had to follow the new default order: `activity-section-order.test.mjs` (ten tests encoded the eight-id default; one new test covers an order saved before Servers existed) and the saved-order checks of the rail probe (the saved order is complete, so a hidden Servers section keeps its fourth slot; the probe's `saved()` helper says so). The servers probe's placement checks look for "directly under Live" instead of an exact list, because the pane also carries the Skills section.
- Probe: new `scripts/e2e/session-activity-servers.tsx` (32 checks on the real store, hooks and production CSS with only the Host edge faked: placement, one listing per server, names, tab order, 34px rows, the 24×28 stop square and its 10px glyph, the muted 12px address, fit at font scale 1.4, folding, address to browser tab, name to details under the row, one stop request on a double click, the spinner, the ended group, a rejected stop and a late answer after unmount) runs as stage `activity-servers` of `e2e-transcript-render.mjs`.
- Rust: `background_server_address_is_live_only_and_reaches_the_list_and_its_event` runs a real shell command that prints `Local: http://localhost:5173/?token=secret` through the RPC layer: the list shows the origin only, `read` and the stored row carry none, and after a stop the row has none.

### Validation

| Check | Result |
| --- | --- |
| `cargo test -p host-core --locked --offline` (whole crate) | 1309 passed, 0 failed, 1 ignored (11 new: 9 detector, 1 output owner, 1 real-shell RPC) |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy -p host-core --all-targets --all-features` | no warning in the changed files; two existing `too_many_arguments` warnings in `plugins/install.rs` and `team/roster.rs` |
| desktop `tsc --noEmit` (worktree shared sources mapped, see risks), `tsc -b` for shared, i18n and agent-runtime | pass |
| focused unit tests: `session-activity-servers` (10), `activity-section-order` (16) | 26 pass |
| `node --test apps/desktop/test/*.test.mjs` (full) | 4517 tests, 4513 pass, 0 fail, 4 skipped |
| i18n vitest | 3 files, 30 tests pass |
| `check-style-tokens`, `check-test-quality` | pass; baseline untouched (237 files, 8112 assertions) |
| docs `check-locales` / `check-docs` | 95 pairs / 656 pages |
| `generate-scenario-index --check`, `check-architecture`, `check-agent-policy`, `check-release-docs` | pass (138 suites, 168 ids) |
| repo-wide `biome lint` | pass, 146 files |
| `electron-vite build` | pass |
| `node scripts/e2e-transcript-render.mjs`, gate form | pass (`ok: true`; rail probe 95 checks, workspace 55, servers 32, integration 196, readability 16) |
| `node scripts/e2e-transcript-render.mjs` with the three screenshot env vars | pass (`ok: true`) |
| `node scripts/e2e-session-activity-history.mjs` (isolated Host binary from the primary's `target/debug`, built before this change), `e2e-goal-blocked-ui`, `e2e-goal-team-renderer-ui` | all pass (`ok: true`); the history run therefore checks the new rail against a Host without the address field |

Two failures on the way, both stale expectations rather than defects: the saved-order checks of the rail probe (above) and ten `activity-section-order` unit tests that encoded the eight-id default order.

### Visible evidence

Acceptance is canvas parity: the v6 canvas and the real `SessionActivityRail` side by side, same state (work and attention), real 264px pane, device pixel ratio 2, both themes. The Servers section is 79.0px in the canvas and in the real rail in all four frames; every other section keeps its height (Live status is still 34px taller in the attention state, the nested Ended processes group, as before). Frames live in the review session's scratch directory and are not committed (`parity-c/servers-pair.png`, `folded-crop.png`, `details-pair.png`).

Differences that remain: the name reads the command title (`pnpm dev`) where the canvas draws the bare `dev`; the server glyph is the app's own icon; the canvas's "wire" tags (需要接线：地址字段, 停止可复用) are canvas annotations and are not drawn. Not captured: the stop square's hover tint and focus ring (a static frame has no hover; both are written from existing tokens and asserted in the probe's style checks only for the resting state), and the folded Servers heading beyond the "1 运行中" frame.

The details-under-the-row placement is not in the canvas; it is shown in `details-pair.png`.

### Decisions left to the user

- Whether C ships as its own PR (A and B would be committed first) or with the whole stack, and when the stack is committed at all.
- Whether the ordinary background command should outlive the 60 second default so a dev server stays listed without a long explicit `timeout`: unchanged here, and a separate behavior decision.

### NOT RUN and risks

- NOT RUN: Electron plus a production Host with a real dev server end to end. The Host side runs a real shell through the RPC layer in Rust, and the renderer side runs the production store, hooks and CSS against a faked Host edge; the seam between them is the JSON field name and the pass-through in Electron main (`session-activity-ipc.ts`; the renderer API does no field filtering), which were read, not exercised. Also NOT RUN: `verify:ui:*` (only on the user's request), Windows and Linux, the installed app, a touch device, and the stop square's hover and focus frames.
- Known limits, accepted in the ADR: URL form only (a bare "listening on port 3000" is not detected), the first URL only, a Jupyter-style token URL opens tokenless (the origin is all that is kept), a process in `starting` is never listed as a server, and a process that prints a loopback URL it only connects to is listed as a server (Stop works).
- Servers started as ordinary background commands still end at the 60 second default unless the model passes a longer explicit `timeout`, so a dev server can leave the section after a minute. Unchanged by design; it is the second decision above.
- The address comes from output the process prints. A hostile or buggy process can make itself appear as a server on a loopback port, never on another host, and the renderer opens only the origin (no credentials, no path) in the work panel's browser tab.
- The desktop `tsc` ran against the worktree's shared sources through a temporary tsconfig (deleted afterwards): the symlinked `node_modules` resolves the primary checkout's stale shared dist. The repo's own config is unchanged.
- `background_processes.rs` grew to 704 lines (the 1000-line Rust limit holds; the detector has its own module).
- D647 is the next free decision number after D646; a parallel branch that takes it would need renumbering at merge.
- The change is stacked: A, A2, B, Reconnect and C are one commit on one branch, so splitting C into its own PR would need A and B split out first.

