# PI-GOAL-1112: Goal report first screen shows only the result and the next steps

- Project: `fork-pi-desktop`; task ID: `PI-GOAL-1112`; tier: T1; status: 实现中
  (built and committed on the request branch; hosted validation pending).
- Created: 2026-11-12 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: on 2026-11-12 the user reviewed a real completed Goal
  report, said it is too complex to read at a glance, proposed that the report
  say only two things (the quantified result of the session, and what a human
  must do next), approved the first-screen mock and its restyle, and told the
  executor to build stage G1 ("按此做 G1"). On 2026-11-14 the user asked to ship
  G1 alone as the next patch version and told the executor to start the ordered
  delivery: the commit is authorized, while push, PR, workflow dispatch, merge
  and release each wait for their own explicit word.
- Baseline: `9574c37017a68a5dddfd4e59b149780a7bbf67cd` (`origin/main`).
- Branch: `feat/20261112-pi-goal-1112-report-two-block`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261112-feat-pi-goal-1112-report-two-block`.
- Target: the request branch; delivery to `main` (workflow spec delivery steps
  9-14) needs the user's explicit remote-delivery authorization.

## Problem statement

The ready Goal report (Work Panel tab, default width 360 px) is a long document
whose first screen is the header, up to eight metric tiles in one column, a
notice and the execution timeline. A reader cannot find the outcome or what is
asked of them without scrolling. Observed defects:

- The footer duration badge subtracts the first segment start from the
  completion time, so a report that waited for the user reads the wall-clock
  span instead of the working time (a synthetic two-turn report with a 2 h 40 m
  wait reads 3 h 06 m for 26 m of work).
- Long metric values stack in one column below roughly 372 px of panel width and
  fill the first screen; the files and checks tables scroll sideways at 360 px.
- Limitations and next steps are two unordered callouts at the end; asks to the
  user and suggestions are mixed.
- A `kind = file` evidence reference that the Host cannot resolve by
  construction is shown with the same warning as a genuinely missing record.

## Scope

In scope (renderer only, variant A, no contract change):

1. First screen = title, a **Result** block (verdict, optional `conclusion`,
   the first three `metrics`, one Host-derived line) and a **Next steps** block
   (the first three `nextSteps`, the rest on demand). Everything else sits behind
   one native `<details>` fold with inner folds.
2. Duration fix: active time from the segments, wall-clock span as fallback.
3. Metrics leave the header; the full list lives in a fold.
4. Neutral display for unresolved `kind = file` evidence.
5. Report-scoped tokens and the restyled look; darker report inks in the light
   theme for small text.
6. Spec (component spec 10B and mirror), E2E scenario text, the canvas E2E probe,
   the Work Panel wait of `scripts/e2e-temporary-goal.mjs` and the renderer tests
   follow the new structure.

Out of scope: the blocked/unfinished report page (G2), typed `attention` and
authoring `conclusion`/`group`/`label` in the tool schema (G3, T2), the chat
`GoalReportCard`, a table redesign (tables stay scrollable inside their fold),
any Host, schema, persistence or IPC change.

## Frozen decisions

- D1: variant A. The Result block reads the existing report fields only. A
  `conclusion` is rendered when the report already carries one.
- D2: honest counts. "x/y passed" uses executed checks as the denominator and
  shows not-run or blocked checks separately; "host-verified" counts only
  observations whose `checkId` matches a check; a conflict uses the same rule
  as the checks table.
- D3: active time is the sum of segment spans (an open last segment ends at the
  completion time); with no segments it is the wall-clock span. It is shown only
  when `timingSource = "turn"`. Waiting time is shown in the execution record.
- D4: fallback, user-accepted and interrupted states stay on the first screen;
  the `verdict-*`, `status-*` and `integrity-*` hooks are kept.
- D5: the neutral file-evidence display applies only to `state = unresolved`
  with `kind = file`; a missing resolution still reads "unknown".
- D6: the goal title becomes the `h1`; the document name becomes the article's
  accessible label.
- D7 (supersedes the Canvas-reference rule in component spec 10B): the first
  screen no longer shows every metric; all of them remain in the Metrics fold.
  The user approved this on 2026-11-12.

## Acceptance scenarios

1. A completed `met` report: the first screen shows the verdict with its
   self-reported marker, three metrics, the Host line, up to three next steps
   and the closed full-report fold.
2. A two-segment report with a 2 h 40 m wait: active time is the sum of the
   segments, the wait appears only in the execution record.
3. Fallback, user-accepted and interrupted reports keep an explicit notice on
   the first screen and never read as agent-verified.
4. At 360 px and 782 px nothing but the tables scrolls horizontally; a panel of
   600 px or more shows each first-screen metric as a label-and-value row.
5. Empty metrics, next steps, checks and criteria degrade without placeholders.
6. Light theme text on tinted surfaces keeps at least 4.5:1 contrast.

## Behavior changes

- The first screen no longer lists every metric (D7); all of them stay in the
  Metrics fold. The header no longer carries metrics.
- The footer duration badge is gone. The Result block shows active time; the
  execution record shows the total span and the waiting time.
- The goal title is the visible `h1`; `deliveryTitle` is now the article's
  accessible label.
- The fallback "N steps" conclusion line is no longer rendered. A `conclusion`
  shows only when the report carries one.
- The blocked/resumed timeline and the verdict, status and integrity badges
  moved from the header into the details fold (`GoalReportRecord.tsx`).
- Test ids removed: `goal-report-evidence`, `goal-report-conclusion`,
  `goal-report-metrics-grid`, the `.goal-report-section*` classes. Added:
  `goal-report-result`, `-next-steps`, `-full`, `-fold-*`, `-checks`,
  `-evidences`, `-key-metrics`, `-host-line`.

## Code revision and validation

Revision: baseline `9574c37017a68a5dddfd4e59b149780a7bbf67cd` plus the single
commit on this branch (`git log 9574c37..HEAD`). The unit, type and style checks
below ran on this tree before its last edits (the temporary-goal wait, two
scenario sentences and this record); those edits were re-checked with the docs,
scenario-index and test-quality gates.

Baseline and repro: on the baseline the canvas and presentation renderer tests
were 10/10 green. The duration regression test (active time across a wait, not
the wall-clock span) was added first and failed on the unchanged components
(7 pass, 1 fail in the canvas file). The first-screen, neutral-file-evidence and
digest assertions were written together with the implementation and were not
run red against the old code. The full `apps/desktop` suite then caught one
regression of this change: `goal-blocked-rendering.test.mjs` looked for the
execution timeline and the badges in the header. It now reads them from the
record components with the same user-visible assertions. Reviewing the Electron
suites that read the report found a second break before any commit:
`e2e-temporary-goal.mjs` waited for the report summary in the Work Panel's
`innerText`, and the summary now sits in the closed full-report fold. The script
now waits for the first screen, opens the full-report fold and its Summary fold,
and then waits for the text. Every `goals-team` suite is nightly tier and pull
request CI runs only the smoke tier, so nothing before the nightly would have
caught it.

Checks run (node directly from the worktree; pnpm is not used in overlay
worktrees):

| Check | Result |
| --- | --- |
| `node --test` on `goal-blocked-rendering`, `goal-report-canvas-rendering`, `goal-report-digest`, `goal-report-presentation` | 28 pass, 0 fail |
| `packages/i18n`: `tsc --noEmit` and vitest | exit 0; 30 pass |
| `apps/desktop` `tsc --noEmit` | 613 errors, all under `electron/main` (unbuilt package outputs in the overlay); none elsewhere |
| `scripts/check-test-quality.mjs --base origin/main` | pass; it lists the working tree with `git ls-files -co`, so the untracked `goal-report-digest.test.mjs` is counted |
| `scripts/check-architecture.mjs` | pass for the ratcheted files and limits, but it checked 0 new files because it finds them in committed history (`base...HEAD`); the five new modules were checked by hand against the 800-line new-module limit: 159, 64, 54, 49 and 54 lines (the largest existing report module is 104) |
| `scripts/check-style-tokens.mjs` (the desktop `lint`) | pass, after three raw literals became tokens |
| `docs/scripts/check-docs.mjs`, `check-locales.mjs` | 644 pages, 95 pairs, pass |
| `scripts/generate-scenario-index.mjs --check` | current |
| whole `apps/desktop` `node --test test/*.test.mjs` | 3725 pass, 98 fail, 3 skipped |
| headless Chrome rehearsal of `scripts/e2e/goal-report-canvas.tsx` (1040, 782, 320 px; dark and light; folds closed and open) | every probe assertion passes; measured contrast 5.03 (light pill) to 7.61 (dark pill) |
| Electron canvas E2E (R7 gate): the same probe in Electron 43.6.0 on macOS 27.0.1, real `GoalReportTab`, 10 layouts | pass (`ok: true`, exit 0, 2 s); contrast figures equal the Chrome rehearsal; three screenshots (first screen, opened folds, light theme) were written to the session scratchpad only and have since been cleaned up, so re-running the probe is the way to see them again |
| Work Panel wait of `scripts/e2e-temporary-goal.mjs` against the real `GoalReportTab` with a synthetic fixture (headless Chrome 157, not the suite itself) | the old wait (summary text in the panel's `innerText` with closed folds) is false, so it would have timed out; the new first-screen wait is true, and the text is present after opening the full-report fold and its Summary fold; `node --check` on the script passes |
| `node --test scripts/e2e-suite.test.mjs scripts/scenario-index.test.mjs scripts/test/*.test.mjs` (the script-level tests of pull request CI) | 25 pass, 0 fail |

Electron E2E method (2026-11-12, run outside the sandbox with the user's
approval): the unmodified `scripts/e2e-goal-report-canvas.mjs` hung until its
45 s limit, both from the Bash tool without the sandbox and from the Terminal
panel. Sampling a minimal Electron script showed why: the main thread sat in a
macOS modal ("reopen windows after an unexpected quit?") for the dev Electron
app id `com.github.Electron`, before `app.whenReady`, and every force-killed run
arms that prompt again. The passing run used a temporary copy of the script
whose only change was the extra Electron argument
`-ApplePersistenceIgnoreState YES`; the copy was deleted afterwards. `origin/main`
was still `9574c37` when it ran (`git ls-remote`), so the candidate contains the
latest `origin/main`.

The 98 failures are unresolved package outputs of this overlay worktree
(`dist/index.js` of `@pi-desktop/agent-runtime`, `host-runtime` and
`agent-host`, and `agent-runtime/dist/provider-binding.js`): 65 files fail at
import and 33 tests fail on the same packages. The failing set is identical
before and after this change apart from the regression above, and no file of
those packages is changed here. Those tests are NOT RUN.

NOT RUN: a full `scripts/e2e-temporary-goal.mjs` run (it needs the Host binary
and built packages; only its changed wait was exercised, see the table); the
other Electron `goals-team` suites (their selectors were checked by reading, and
none of them reads the Work Panel report); the unbuilt-package tests above; hosted
CI; `pnpm docs:build`; any real-model run.

Known risks: the report components import `formatDuration` from
`features/scheduled/scheduled-format` (a cross-feature formatter, kept because
its unit labels are language-neutral); the first screen measured about 680 px at
360 px width with the stress fixture, in headless Chrome only; the zh-CN spec
mirrors hold the same English text as the English pages, as before; the in-app
changelog entry is a release-preparation step, so none is added here.

## Remaining work

Push and PR authorization; before merge, one dispatch of `e2e-run.yml` with family
`goals-team` on the pushed branch (pull request CI does not run it); user
acceptance (`已验收`); the release that carries this change (changelog entry in
every shipped locale); then G2 and G3 as separate requests. Outside this change: the 41 Electron E2E scripts each spawn Electron
themselves, so none of them skips the macOS restore prompt described above.

## Runtime resources

Worktree-local, git-ignored: a `node_modules` overlay of links into the primary
checkout, and `dist` builds of `shared`, `i18n`, `plugin-sdk`, `voice-runtime`
(and a partial `racp`). No processes are left running.
