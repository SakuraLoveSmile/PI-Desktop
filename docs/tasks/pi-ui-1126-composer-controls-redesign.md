# PI-UI-1126: composer controls redesign

Status: 待体验 (built and verified locally in the request worktree, with one user-approved Electron E2E round on 2026-11-25; committed on the request branch as five commits at the user's word on 2026-11-25; not pushed). Project: `fork-pi-desktop`. Created: 2026-11-24 (Asia/Taipei).
Tier: T1 (renderer-only visible change; no IPC, Host, protocol or storage change; the nine locale files gain and lose keys). D652 amends D347 / ADR 0184.
Baseline: `f6f7642d41b801f027e1b0aed2e1a54df98c8a67` (`main` after PR 104, v0.15.23).
Branch: `feat/20261124-pi-ui-1126-composer-controls-redesign`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261124-feat-pi-ui-1126-composer-controls-redesign`.
Ids: PI-UI-1126 and D652 are provisional. D648, D649 and D651 belong to work that is not on `main` yet; renumber on the rebase if one of them lands first.
The user's 「开始执行」 authorized building here and 「提交」 (2026-11-25) the local commits. Push, pull request, merge and release wait for the user's explicit word, and 已验收 is the user's.

## Request and source

The user asked to optimise the input box at the bottom of the chat, then widened it to everything interactive around it: the workspace strip above the input (project, location and branch menus) and four toolbar popups (the + menu, the Agent/profile menu, the model menu and the usage popover). Work went canvas first (direction B, then an after-canvas that showed every popup), the user chose each knob (「全部按画布默认，智能体警告色用 ink，条件卡片不算，然后专家团那条提醒，我认为可以去掉」), and then said 「开始执行」.

## Frozen decisions

- Direction B: the usage entry moves into the workspace strip and the footer goes away; Send and Stop are round; Plan and its close control are one pill.
- Add menu: workspace files only while a search matches them; no execution-profile group; a description sits after the name on the same line.
- Model menu: one line per model; the reasoning slider has a title that names the control and shows the level.
- Usage popover: a labelled Session block; the two actions side by side; a two-column model-usage grid.
- Strip menus: a chevron on every trigger (a lock while a task runs); the project's folder as a subtitle; descriptions on the Local and Worktree rows; a compact, right-aligned create button.
- Out of scope: the conditional cards above the strip (ask, queue, enhancement, dropped-directory actions, attachments).
- The Team parallel-call notice (`chat.profileTeamNotice`) is removed, so the "ink" choice for its warning colour is moot and `--ds-warning-ink` is untouched.

## Behavior change

Stages, one commit each, in this order:

1. **C1 toolbar menus.** One skin for the Add, execution-profile and model menus (`composer-menu-skin.css`); the Add menu lists actions only; profile rows are two lines with a check; model rows are one line with a fixed check slot and the provider as the group heading; `profileTeamNotice` removed.
2. **C2 usage entry.** The usage trigger (ring, direction label, percentage, session token total) sits at the right end of the strip; the footer and its styles are gone; the popover gains the Session block and a two-column model-usage grid. New keys `usageSessionLabel` and `usageSessionRoundsAria` (replacing `usageSessionActivityAria`).
3. **C3 strip menus.** One row language for the project, location and branch menus: chevron or lock, a banner naming why a menu is locked, an In use tag, 32/44px rows, back-arrow create views. New keys `localModeDesc`, `worktreeModeDesc`, `runLocked`, `branchOccupied`.
4. **C4 round send and Plan pill.** Send and Stop are 32px circles set 8px after the quiet controls (2px apart); Plan and its close control read as one tinted pill with a hover fill per half.
5. **C5 records.** D652 (EN and zh-CN), the D347 and ADR 0184 amendments, the spec and E2E scenario edits, this record, and the removal of the now unused `usageThroughputShort` and `usageThroughputShortEstimated`. Spec text that already contradicted the code was corrected on the way: the composer shell radius (16px, not 20px), the model trigger sentence in the design system §8.2, and the model-menu steps of US-UI-21 and the scheduled E2E coverage line.

Unchanged: the permission menu, the slash and `@` autocomplete, the conditional cards, the message editor's text Send, every Host and IPC contract, storage and settings keys.

## Differences from the canvas and from earlier behavior

- Round Send and Stop is a small change in a high-use spot (radius 10px to a full circle); the toolbar's quiet controls moved from 4px to 2px apart, with 8px before Send.
- The Plan close control is a 20×28 half-pill. Production's was a 28×28 button, because `.composer-toolbar .icon-btn` out-specified the single-class exit rule; the canvas did not show that.
- The profile menu's row gap is 2px, not 6px, and row hover radius is 10px (`--radius-sm`), not the canvas's 12px.
- A long model name wraps instead of hiding the part that tells two models apart; in English the usage popover's two buttons stack when a label does not fit.
- The bottom fade of a list that continues below its fold (the Add menu's rows and the model list) is a sticky 22px layer that a scroll-state container query turns on while the list can still scroll down, with a 150ms opacity transition. It stays at full strength until the end of the list instead of shrinking with the scroll position, and keyboard or focus scrolling leaves the target row clear of it (`scroll-padding-bottom`). A scroll-timeline animation was built first and replaced during the E2E round: it left `Animation.finished` pending and stalled every harness that waits for all animations to settle.
- The create button in the new-worktree and new-branch views is a compact, right-aligned primary (28px, 8px radius). Production's was a full-width default button; the canvas drew its current state as primary.
- A menu that cannot be used now says why (banner order: a running task before a dirty checkout). That is new behavior, not a restyle. The project menu is still not run-locked, as before.
- The branch and worktree rows keep their existing double tab stop (row plus inner button); fixing it is a separate accessibility change.
- `ComposerUsageFooter.tsx` keeps its file name although the footer is gone; renaming it would only add churn.

## Acceptance scenarios

`E2E-060d`, `E2E-089`, `E2E-250`, `E2E-COMPOSER-narrow-controls`, `E2E-COMPOSER-toolbar-footer`, "Composer workspace menus (Plus)", `US-UI-21`, `US-UI-61` in `docs/spec/06-delivery/04-e2e-test-plan.md`. The harnesses that were edited to match (all of them ran on 2026-11-25, see Validation): `scripts/e2e/composer-mode-menus.tsx`, `scripts/e2e/composer-model-selection.tsx`, `scripts/e2e/session-activity-integration.tsx`, `scripts/e2e/session-activity/footer-menus.ts`, `scripts/e2e-scheduled.mjs`.

## Validation

Run in the worktree on 2026-11-24 and again on 2026-11-25 after the E2E fixes (no pnpm; the binaries were called directly). The second run repeated desktop `tsc`, the full desktop suite, style tokens, test-quality, the docs checks, the scenario index and the agent-policy check with the same results; `packages/i18n` and Biome were not repeated because nothing they cover changed after the first run:

- Desktop `tsc --noEmit`: clean.
- Desktop test suite, `node --test test/*.test.mjs`: 4560 tests, 4556 pass, 0 fail, 4 skipped. New behavior tests: `composer-menu-rows` (12), `composer-usage-strip` (8), `composer-strip-menus` (18), each mutation-checked; `composer-usage-footer` and `plugin-composer-slots` were updated.
- `packages/i18n` rebuilt, `vitest run`: 30 of 30.
- `check-style-tokens`: OK. `check-test-quality`: passes and the baseline only shrank (pins that contradicted the new design were retired, none added). Biome lint on the changed files: clean.
- `docs/scripts/check-locales.mjs` (95 EN/zh-CN pairs), `check-docs.mjs` (658 pages; only the ADR "Consequences" warnings that predate this change), scenario index current, `check-agent-policy`: pass.
- An offline render rig (headless Chrome on the production stylesheets, static markup, both themes, English and Chinese, with measured geometry) covered the toolbar states, the strip menu bodies and the popover layouts. It proves layout, not interaction.
- Electron E2E, one round the user approved on 2026-11-25 (「跑 E2E」). Every suite ran from this worktree on the final `apps/desktop/out` build, with a throwaway Electron profile and Host data directory and loopback fixtures only (no real provider, no user data), and with the primary checkout's debug Host binary. All 18 pass: `composer-mode-menus`, `composer-model-selection`, `composer-autocomplete`, `composer-paste`, `composer-input-history`, `composer-ime-stack`, `ime-escape`, `permission-card-layout`, `asktool-card`, `composer-thinking-layout` (30 checks), `plus-curated`, `context-insights` (34 of 34), `plan-ui`, `composer-queue-send-now-abort`, `theme-surfaces --dock-mask-only`, `layout` (three-column, 197 of 197), `scheduled`, and `transcript` (`e2e-transcript-render`, 600 checks, which holds the activity-integration stage and the strip-menu harness).
- The round found two problems in this change, both fixed here: the integration harness still pinned the old 5.5px row gap (now 2px, in `session-activity-integration.tsx`), and the first build's scroll-timeline fade stalled that harness's wait for every animation (see Differences; the fade was replaced and the suites were run on the replacement).
- The replacement fade, on the production stylesheets in headless Chrome with real frames: on at the top and the middle of an overflowing Add menu and model list, off at the end and when the list fits; at device pixel ratios 1, 1.5 and 2, with fractional row heights, it adds nothing to the scroll extent and is off at the true end of the list; dark and light frames show no seam against the menu surface.

## Not run

- `test:e2e:session-activity`: it drives the Host and the agent runner without the renderer, and this change touches neither. The rest of the E2E catalog outside the families listed under Validation, including the smoke and nightly tiers as a whole.
- A Host built from this baseline: the Host-dependent suites above ran against the primary checkout's debug binary of 2026-11-21, which predates the optional `address` field of PR 101. No Rust file changed here, but a Host contract change since that build is not exercised.
- The real app used by hand: hover, focus rings, IME composition and a keyboard walkthrough of the new menus. The harnesses mount the Composer and its menus in the real renderer; nobody has driven the dev or installed app.
- A real-app capture in light and dark; Windows and Linux.

## Remaining work

- The user's word on pushing and opening the pull request. Before that, refresh against the latest `origin/main` and run the task-candidate E2E again (workflow steps 6 to 8): the round above ran on the baseline plus these changes, so it is exploratory evidence until then.
- The changelog entry, assumed to travel with the release-prep commit as for v0.15.23.
- A look at the real app by the user (hover, focus, IME, both themes) before 已验收.
- Pre-existing drift reported but not touched: D089 and the design system §8.0 say the empty draft shows one visible line (28px), while `.composer-dock .composer-input` is `min-height: 2lh`. It needs a decision, not a doc edit.

## Runtime resources

None running: no dev server, no Electron process, no browser pane. Scratch files (render rig, stage snapshots) live in the session scratchpad only.
