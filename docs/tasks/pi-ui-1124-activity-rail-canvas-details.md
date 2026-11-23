# PI-UI-1124: activity rail canvas details

Status: 待体验 (built and verified locally; one commit on the request branch, pushed, pull request open against `main`). Project: `fork-pi-desktop`. Created: 2026-11-23 (Asia/Taipei).
Tier: T1 (renderer-only visible change; no IPC, Host, protocol or storage change). D650 amends D645 and D646.
Baseline: `ed162b47daafe75a4ef3c0f4f0e9075942ebb251` (`main` after PR 101).
Branch: `fix/20261123-pi-ui-1124-activity-rail-canvas-details`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261123-fix-pi-ui-1124-activity-rail-canvas-details`.
The commit, the push and the pull request were authorized by the user on 2026-11-23 (「提交 推送并开 pr」). Merge and release wait for the user's explicit word, and 已验收 is the user's.

## Request and source

Batches A, A2, B, Reconnect and C of the activity-rail redesign are merged (PR 101). The user then asked what was left of the design replication and how far the rail still was from the approved v6 canvas, and, after that comparison, asked for the small differences to be aligned (「对齐小差别」). This change does the part of that list the renderer can express. The pinned session summary (Batch D, PI-UI-1123) is a separate request with its own branch and worktree and is not in this change.

## Behavior change

- **Environment path.** A project path under a person's home folder is captioned from `~`: `~/Code/PI-Desktop`, or `~/…/Fork Project/PI-Desktop` when it is deeper (the last two folders after an ellipsis, as before). The whole path stays in the row's tooltip. Home is recognised by the platform's layout (`/Users/<name>`, `/home/<name>`, `<drive>:\Users\<name>`; never `Shared`, `Public`, `Default` or `All Users`) because the renderer has no home-directory API. Any other path is shortened as before.
- **Elapsed clock.** An overview agent row prints its elapsed time as a clock, `02:14` (`1:02:14` from an hour on). Its tooltip and accessible name keep the spoken duration (`2m 14s`); rows inside the transcript are unchanged.
- **Context.** The used framing is headed 已使用 (Used) in the rail where the composer says 已用; the remaining framing keeps the composer's word. Chinese locales write the section's token counts in 万 (萬 in Traditional Chinese) with at most one decimal and counts under ten thousand in full; other locales keep K/M. The `~` before the used count stays. The legend swatches are 8px squares with a 2px corner (new token `--radius-4xs`, UI design system §6.2) instead of dots.
- **Review link.** The Changes section's link reads 审查 (審查) in Chinese; the Review tab keeps its own name 审阅.
- **Folded headings.** A folded Goal section that holds one Goal says that Goal's state: a failed report in the failure colour, 已完成 in the success colour, otherwise `done/total` steps, by the same rule the Goal row uses. A folded Plan section that holds one plan says its status word. With several items, or before a Goal's steps are known, the heading keeps its counts. A folded Context heading keeps its label.
- Strings: new `panel.activity.contextUsed` and `panel.activity.reviewLink` in all nine locales.
- Unchanged: counts and Host totals, attention targets and focus rules, the Host contract, storage keys, the section order and every other row.

## Not aligned, and why

| Canvas detail | Why it stays | What it would take |
| --- | --- | --- |
| Settings gear on the Skills & MCP heading | The canvas draws a static placeholder with no destination | A decision where it leads |
| Tabler glyphs | The app's icon module (`apps/desktop/src/components/icons.tsx`) is built on Lucide and the app has no Tabler dependency; the canvas drew the Tabler webfont | A decision to change the rail's icon family (every rail icon, and a new dependency or hand-copied SVGs) |
| "N 次" on a skill row | The Host snapshot carries no per-skill use count | An optional field on `SessionActivitySnapshot` (`crates/host-core/src/session_activity.rs`): a protocol contract change, so T2 with an ADR and a briefing, like Batch C's `address` |
| Pane 264px against the canvas's 265px | An artifact of the capture rig, not a rail difference | Nothing |
| Command titles trimmed to the script name; server name `pnpm dev` against `dev` | Deliberate presenter rules | Only if those rules are reopened |
| Live status 34px taller in the attention state, and 1px taller when idle | The 34px is the nested Ended processes group, which the canvas does not draw; the idle 1px was measured and not traced | Nothing planned |

## Choices that differ from my earlier advice

The user chose the canvas over two of my earlier recommendations (keep the circular swatches; keep 审阅 as the link word). Consequences, none of them a defect: the rail says 审查 while the Review tab says 审阅; the composer's context legend stays circles and the composer keeps K counts while the rail shows 万; the home `~` is a layout heuristic, so a path inside another account's folder (`/Users/other/…`) is captioned from `~` too.

## Implementation notes

- New modules: `activity-token-format.ts` (万/萬/K), `goal-row-facts.ts` (one rule for the Goal row and the folded heading: step count, report state, done) and `GoalFoldedSummary.tsx`. `ActivityRailItem` gets an optional `foldedSummary`, and `ActivityRailGroup`'s `collapsedSummary` may be a function that receives the counts fallback; `SessionActivityRail` uses the only item's summary for Goal and its status label for Plan.
- `subagentElapsed` gains a `format` (`duration` or `clock`); the overview row asks for `clock`, so the running clock and the settled value still come from the same runtime and the same real end.
- `shortProjectPath` keeps the path's own separator, so a Windows project reads `~\Code\project-a`.
- Docs: component spec (08), UI design system (07, §6.2 `--radius-4xs`), decisions log D650 (D648 and D649 belong to the unmerged PI-BG-1122 and Batch D, so the number skips them and leaves a gap on `main` until those merge), E2E plan (`E2E-CHAT-session-activity`) and the zh-CN mirrors of the three specs.
- Probes: the transcript E2E rail probe checks the clock; the workspace probe checks the `~` caption and the 8×8 swatch with its 2px radius.

## Validation

| Check | Result |
| --- | --- |
| new behavior tests: 12 cases in `session-activity-model`, `session-activity-rail-presentation` and `session-activity-workspace` (clock, path, folded summaries, token units, context label, review link) | pass |
| `node --test apps/desktop/test/*.test.mjs` (full, run in the worktree) | 4528 tests, 4524 pass, 0 fail, 4 skipped |
| i18n vitest (`packages/i18n`, run directly) | 30 tests pass |
| desktop `tsc --noEmit -p tsconfig.json` (after building the worktree's library `dist` with direct `tsc`) | pass, exit 0, no error |
| `check-style-tokens` | style tokens OK (the new radius is a token, not a raw px value) |
| `check-test-quality` | pass, baseline untouched (237 files, 8112 assertions) |
| docs `check-locales` / `check-docs` | 95 pairs / 657 pages |
| `generate-scenario-index --check` | 138 suites, 168 ids, current |
| `check-architecture` / `check-agent-policy` / `check-release-docs` | pass (`check-architecture` reports 0 new files because the three new modules are untracked until a commit; each is under 40 lines) |
| repo-wide `biome lint` | pass, 146 files; its `biome.json` does not include the rail directory |
| `electron-vite build` (worktree) | pass |
| `node scripts/e2e-transcript-render.mjs` (gate form, real Chromium in Electron, worktree build) | pass, `ok: true`: rail probe 96 checks (the new clock check included), workspace probe 56 (the `~` caption and the swatch included), servers 32, integration 196, readability 16 |

Environment: macOS arm64, dependency overlay from the primary checkout, library `dist` and `apps/desktop/out` built locally with direct `tsc` and `electron-vite` (git-ignored), no pnpm run inside the overlay. Electron E2E ran with `CLAUDE*` unset. The Host binary is untouched; no Rust file changed. Before the worktree's library `dist` existed, a run through a temporary path-mapped config showed 17 errors, all in `packages/agent-runtime/src`; an export of the baseline commit gave the identical 17, and the plain run above is clean once the `dist` is built, so none of them belongs to this change.

## Visible evidence

Acceptance is canvas parity: the real `SessionActivityRail` before (an export of the baseline commit) and after (this worktree), same state, same theme, real 264px pane, device pixel ratio 2, paired section by section. Frames live in the review session's scratch directory and are not committed: `f1124-pair-dark-work.png` (Environment, Context, Live status, Changes while working), `f1124-pair-light-attn.png` (the same in light with attention), `f1124-pair-dark-folded.png` (folded headings) and `f1124-goal-folded.png` (a running, a finished, a failed-report and a two-goal rail, in dark and light). The Goal frames use the real Goal row and the real folded summary with a stubbed Host, so they show the rendering rule, not a live Goal. Section heights are unchanged by this change; what differs is exactly the list under "Behavior change".

## NOT RUN and risks

- NOT RUN: `verify:ui:*` (only on the user's request), `e2e-goal-team-renderer-ui.mjs` and the other Host-backed probes (the Host is untouched; the 1121 run of them predates this change and nothing it covers was edited), the real-Host `test:e2e:session-activity`, the installed app, a real provider, Windows rendering and a real Windows path (the `<drive>:\Users\<name>` rule is unit-tested only).
- `~` is a layout heuristic: a project inside another account's home folder is captioned from `~` as well. A real home path from the main process would remove the guess; that is a separate, small IPC change.
- The rail and the composer now word the same state differently (已使用 against 已用, 审查 against 审阅, 万 against K). The canvas asked for it; unifying the composer is a separate decision.
- Batch D (PI-UI-1123, another worktree) edits `SessionActivityRail.tsx`, the locale files and the decisions log as well; whichever merges second rebases, and the D-number may need renumbering.
- Changelog: not changed. Release notes are written by the release-prep step, not by a feature change.
