# PI-UI-1129: sidebar restyle

Status: 已验收 (accepted by the user on 2026-11-27 after a seeded local walkthrough of the real sidebar; five commits on the request branch; task-candidate E2E passed 215 of 215 on `02a6cf268` over `27dc6b45a`; not pushed at acceptance time). Project: `fork-pi-desktop`. Created: 2026-11-27 (Asia/Taipei).
Tier: T1 (renderer-only visible change; no IPC, Host, protocol, storage or shared-type change; the nine locale files gain two navigation keys). D654 amends D297 and the two 2026-09-16 sidebar entries.
Baseline: `27dc6b45a8c5b5dcb2ea321deed845af378a3f25` (`origin/main`, v0.15.26 plus three merged pull requests after the handoff block's `786179c99`; the block's line anchors still resolved by symbol).
Branch: `feat/20261127-pi-ui-1129-sidebar-restyle`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261127-feat-pi-ui-1129-sidebar-restyle`.
Ids: PI-UI-1129 (the largest task id on `main` was 1128) and D654 (D653 already belongs to the Markdown-table decision; D648 and D649 are merged, so nothing was skipped).
The user's handoff block authorized the implementation; 「提交 C1」 through 「提交 C4」 authorized the local commits, and each Electron round ran only after an explicit 「允许 E2E」. Push, pull request, merge and release wait for the user's word, and 已验收 is the user's.

## Request and source

The user delivered a complete handoff block for a sidebar restyle in five commits, with every judgement point already decided and only local commits in scope. The block's §4 replaced the optional canvas (`/private/tmp/claude-501/.../sidebar-canvas/canvas.html`) as the visual authority, and its §7 defined the E2E assertions.

## Frozen decisions (OD1–OD10)

- OD1 Pinned: every pin shows; the section no longer scrolls on its own.
- OD2 Sessions: five top-level rows plus one load-more row; the expanded state lives in memory and resets on restart, like a project group.
- OD3 A running row draws one neutral 10px ring; the pending-approval dot, the completed check and the failed mark keep their colors.
- OD4 A selected row draws no status glyph at all; `sidebarSessionStatus` returns the same values.
- OD5 A team lead's collapse control sits in the icon column (rules in §4.5) and members step in 16px.
- OD6 The version appears only as a pill while an update is ready; checking and up-to-date states render nothing, and Settings › About owns the manual check.
- OD7 New components live in `apps/desktop/src/features/sidebar/`.
- OD8 i18n adds `nav.updateReady` and fills the missing `nav.sessionPermission`.
- OD9 Rows keep `var(--radius-sm)` (10px) and the project list keeps its 2px top padding.
- OD10 Ids: PI-UI-1129 and D654.

## Behavior change

Five commits, one per stage:

1. **C1 `577a1aeb4` refactor(sidebar): extract the footer and the list cap helper.** `SidebarFooter.tsx` takes the bottom bar as a presentational component (the sidebar keeps the update state, the ready condition, the label/title computation and the click handler); `sidebar-list-cap.ts` owns `capSidebarEntries` and replaces `visibleSidebarSessionGroups`; `useAppShellRuntime` collapses two identical shortcut-label expressions into `shortcutLabel(id)`. No behavior change.
2. **C2 `478a621a2` feat(sidebar): align rows on one icon grid.** Every row uses one 28px grid with an 8px inset, a 16px icon column and an 8px gap, driven by `--sidebar-level` and `--sidebar-team-indent`: titles start at 40, project rows at 56, team members at 72. A project header swaps its pin/folder for the disclosure arrow on hover or keyboard focus and shows an open or closed folder. A running row shows the neutral ring. A selected row draws no glyph. Quick-archive and menu controls float over the row's right end and the row yields 58px while hovered, focused or menu-open. Section gap 8px → 10px.
3. **C3 `c57009fa6` feat(sidebar): add top destinations and an update-only footer pill.** `SidebarNav.tsx` adds New task, Search, Scheduled, Extensions and Context insights above the list, outside the scroller, with `aria-current` and a hover-only shortcut hint for the first two; `IconSquarePen` is added. The footer keeps Settings and notifications and adds a 24px update pill that appears only while an update is available or downloaded; the build chip, its label/title and the footer's Host update check are removed. `nav.updateReady` joins all nine catalogs.
4. **C4 `02a6cf268` feat(sidebar): use one scroll region and hint collapsed project activity.** Pinned, session, Projects heading and project list move inside one `.sidebar-scroll` with one scroll handler; the pinned and standalone bodies lose their height caps; the session section shows five top-level rows plus one load-more row (memory only). `collapsedProjectStatus` reports a folded project's hidden running work or pending approval beside its actions, with a localized name, hidden while the header is hovered. `nav.sessionPermission` joins all nine catalogs, which also localizes the previously English-only permission labels.
5. **C5 this record.** No changelog: `packages/shared/src/plus-changelog.ts` is written at release preparation, per the block.

## Differences from the canvas and from earlier behavior

- Rows keep the 10px token radius (the canvas drew 8px), and the project list keeps its 2px top padding (the canvas had 0).
- Footer buttons keep their existing radius and the pending-approval glow keeps its 15% mix (the canvas showed 8px and 18%).
- The product uses lucide glyphs; SquarePen stands in for the canvas's edit icon.
- A folded project's activity hint and the load-more row are this implementation's own reading of the canvas's structure.
- The project list's old per-list scrolling is gone: long pin lists now push the project section down inside the one scroller instead of pinning themselves to a fixed height.
- `Sidebar.tsx` ends at 2877 lines against the baseline's 2874 (+3): C1 alone took it 2874 → 2828, and the later commits put back the navigation wiring, the session cap, the folded-project hint and the scroll container.

## Acceptance scenarios

`E2E-LAYOUT-sidebar-row-states`, the new `E2E-LAYOUT-sidebar-nav-and-scroll`, and the budget sentence of `E2E-LAYOUT-sidebar-project-group-fold` in `docs/spec/06-delivery/04-e2e-test-plan.md`; specs `04-ux/01-ui-ia.md`, `04-ux/07-ui-design-system.md` §4.5, `04-ux/08-component-spec.md` §3.2/§3.4/§3.5/§3.9/§3.10/§6.6, and decisions log D654 (English and zh-CN).

## Validation

Run in the worktree on 2026-11-27 (no pnpm; the tool binaries were called directly, and the primary checkout's `node_modules` was linked read-only):

- Desktop `tsc --noEmit`: clean.
- Desktop test suite, `node --test test/*.test.mjs`: 4618 tests, 4614 pass, 0 fail, 4 skipped. New behavior tests: `sidebar-list-cap` (5), `sidebar-footer-render` (1), `sidebar-nav-render` (1), `collapsed-project-status` (5), `sidebar-collapsed-project-hint` (1); `packages/i18n` gains `sidebar-copy` (2). The retired source assertions are listed in the per-commit checkpoints; the test-quality baseline only shrank (8067 → 8059).
- `packages/i18n` rebuilt, `vitest run`: 4 files, 32 tests pass.
- `check-style-tokens`: OK. `check-test-quality`: passes. Biome lint: 150 files, clean. `check-pr-base-main`: passes (HEAD descends from `27dc6b45a`).
- Electron E2E, one round per commit, each with the user's approval, all from this worktree's `apps/desktop/out` build with throwaway Electron profiles and Host data directories, loopback fixtures only:
  - C2: `scripts/e2e-three-column-layout.mjs` 205/205 (row grid, hover yield, running ring, selected row).
  - C3: the same suite 211/211 (destination grid, hint reveal, unique `data-nav`, no pill, `aria-current`).
  - C4: the same suite 215/215 (single scroller, no caps, five rows plus load-more, folded-project hint, project-surface context menu), `scripts/e2e-scheduled.mjs` pass.
  - `scripts/e2e-team.mjs` and `scripts/e2e-context-insights.mjs` fail on their own runtime assertions (`Lead runtime lacks strategy declaration`, `Read user path records two completed provider requests`). A temporary worktree at `27dc6b45a`, built the same way, reproduced both failures with the same assertions, so they predate this change; that worktree was removed afterwards. This branch's non-renderer diff is only the nine locale files.
- Task-candidate validation, 2026-11-27: Task candidate `02a6cf268` (four commits; this record is the fifth). Base main `27dc6b45a`, which is `origin/main` and an ancestor of HEAD. E2E suites and counts as listed above. Environment: macOS arm64, Node 22.23.2, Electron 43.6.0, rustc 1.98.0; isolated profiles and Host data directories, loopback fixtures only, no real provider; the Electron spawn hook appended `-ApplePersistenceIgnoreState YES` so the macOS reopening prompt could not block a run; the harness variables were removed from the child environment. Rebuilt for the rounds: `apps/desktop/out` from this HEAD (`electron-vite build`) and the Host from this HEAD (`cargo build --offline --locked -p host-core --bin pi-desktop-host-core`, debug, in the worktree's own git-ignored `target/`, whose dependency cache was cloned read-only from the primary checkout).

## Deviations and residual risks

- The primary checkout's `node_modules/.bin` shims (at least `electron` and `biome`) bake an absolute path into a previously used worktree, so they fail with `MODULE_NOT_FOUND` from any other checkout. Only this worktree's `apps/desktop/node_modules/.bin` was rebuilt as a real directory of symlinks with a local `electron` wrapper; the primary checkout was not modified.
- The seeded E2E suite starts no live turn, so the folded-project hint's running and permission states are probed with an element that carries the same class and hint contract, while the state-to-element wiring is covered by `sidebar-collapsed-project-hint.test.mjs` (seeded `runningSessions` and `pendingPermissions`).
- CDP mouse events do not synthesize `contextmenu` on macOS, so the project-surface menu check dispatches the bubbling event on `.sidebar-session-groups` instead of a pointer click.
- The one-scroll-region layout means a very long pin list can push the project section below the fold; that is the intended trade for a single scroller, and the project list's tail space still belongs to the project section.
- The selected row no longer draws a ring, so selection rests on the row surface alone; the design-system §4.5 table records that explicitly.
- `:has()` and `color-mix()` are used in the row-yield and folded-hint rules; both are supported by the shipped Electron 43 Chromium.

## Not run

- Push, pull request, merge and release (waiting for the user).
- The remaining Electron suites beyond the four named above were not re-run for this change.
- The workflow's post-merge cleanup (waiting for the merge).
