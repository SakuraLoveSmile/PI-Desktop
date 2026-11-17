# PI-UI-1115: Light-theme status text ink

- Project: `fork-pi-desktop`; task ID: `PI-UI-1115`; tier: T1; status: 已验收
  (user acceptance passed 2026-11-17 on the before/after capture frames, D3/D8
  not vetoed; built in the request worktree and not committed; hosted validation
  pending).
- Created: 2026-11-15 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: PI-UI-1114 left one measured defect unfixed, light-theme
  status text under the 4.5:1 text floor (see its "Known risks"). The `软件 UI 优化`
  session handed this follow-up over on 2026-11-15, after PR 91 merged. That brief
  defines the change. It does not authorize commit, push, pull request, merge or
  release; only the user gives those. The change touches no version surface: 0.15.19
  is prepared separately and PI-UI-1115 ships in a later patch release.
- Baseline: `12d1c842b7a4246f7ca8a04e5f2b78eaba19a6bb` (the merge of PR 91, the head
  of `origin/main` when the task started).
- Branch: `fix/20261115-pi-ui-1115-status-text-ink`.
- Worktree: `<worktree-root>/20261115-fix-pi-ui-1115-status-text-ink` (central root declared in AGENTS.md).
- Target: the request branch; delivery to `main` needs the user's explicit
  remote-delivery authorization and, if `main` has moved, a refresh against the
  latest `origin/main`.

## Problem statement

The light status tokens are fill colours that the stylesheets also use as text
colours. In the light palette `--ds-success` is `#00a240`, `--ds-warning` `#e25507`
and `--ds-error` `#e02e2a`. As plain text they measure 3.36, 3.79 and 4.57:1 on
white and 2.87, 3.24 and 3.90:1 on the inset surface, so error clears 4.5:1 on white
only. On a chip tinted with 15% of the token's own colour they measure 2.45 to 2.82,
2.72 to 3.14 and 3.16 to 3.65:1 across the primary, sidebar, secondary and inset
surfaces. Every one of those is under the 4.5:1 text floor. Success also misses the
3:1 floor for a glyph: 2.87:1 on the inset surface with no tint at all, and 2.82:1
at best on a tint of its own colour.

The convention is app-wide. The usage lint written for this task counts 197 `color:`
declarations in 28 stylesheets on the baseline that paint text or glyphs with a base
status token. That includes the `--ds-danger` text uses (`--ds-danger` aliases the
error red) and three literal fallbacks (`#22c55e`, `#f59e0b`, `#ef4444`) that never
applied, because the tokens are always defined. The earlier estimates (about 140 in
the PI-UI-1114 record, 178 in the hand-over prep note) used different counting rules;
the lint's count is the one that is enforced. Status chips in the stylesheets use
tints from 6% to 16% (12%, 14% and 15% most often). Since PI-UI-1114 the Team panel
paints its status chips in their accent colours, which made the weak spot visible
there first.

## Scope

In scope (renderer styles, guards, tests, E2E harness and docs; no TS/TSX, Host, IPC
or contract change):

1. Three ink tokens in `tokens.css`: `--ds-success-ink`, `--ds-warning-ink` and
   `--ds-error-ink`. Light: the same hues darkened to `#006c2b`, `#a03c05` and
   `#ad2421`. Dark: aliases of the base tokens.
2. Every `color:` declaration that named a base status token takes the matching ink:
   197 declarations in 28 stylesheets. The literal fallbacks on those declarations
   (`#22c55e`, `#f59e0b`, `#ef4444`) go with them; the background and border
   declarations in `messages.css` keep theirs.
3. `scripts/style-token-contrast.mjs` gains the ink floor check
   (`findLowContrastStatusInk`) and the base-token usage lint
   (`findBaseStatusTextColors`); `scripts/check-style-tokens.mjs` runs both in the
   desktop `lint`.
4. Fixture tests in `apps/desktop/test/text-tier-contrast.test.mjs`. Three CSS
   regex pins that named the retired base tokens (two in
   `plugin-install-dialog.test.mjs`, one in `composer-usage-footer.test.mjs`) are
   retired, not retargeted: the test-quality ratchet counts an edited pin as a new
   assertion. `scripts/test-quality-baseline.json` is lowered to match, removals
   only. Their guarantee moves to the usage lint and to E2E-078 probes.
5. E2E-078: the theme-surfaces harness probes eight production selectors for status
   chips and status text in real Chromium in both palettes; the Team suite's
   success-glyph pin (`scripts/e2e-team.mjs`) moves to the ink token.
6. Design-system spec, E2E plan, component spec and scripts README text (English
   and zh-CN mirrors where they exist).

Out of scope: the dark palette; the 28 solid status fills (`background:
var(--ds-success|warning|error|danger)`), where white text has the base colour's
ratio on white (success 3.36:1, warning 3.79:1) and each needs its own review; the
Team panel's literal chip hexes (`#10b981`, `#ef4444`) and the Goal report's own
`--ds-report-*` inks; version surfaces; Windows and Linux rendering.

## Frozen decisions

- D1: same hue, only a darker ink. The light values are the channel-scale
  darkening chosen at the 4.75:1 level on the worst surface (a 15% chip over the
  inset surface), which leaves a margin for the 16% chips and for rounding. An OKLCH
  lightness-only variant was compared by eye next to them and not adopted.
- D2: the dark inks alias the base tokens (`var(--ds-*)`), so dark paint cannot drift
  and the dark theme is unchanged by construction. The guard still evaluates the
  dark inks: they clear 4.5:1 on every surface and on a 15% chip (4.55:1 at worst).
- D3: every `color:` takes the ink, glyphs included. The brief kept the 3:1 floor for
  non-text glyphs, so plain glyph colours could have stayed on the base tokens. They
  do not clear even 3:1 everywhere (success is 2.87:1 on the inset surface and
  2.45:1 to 2.82:1 on its own tint), and a glyph sits on container tints often
  enough that one exact rule, "a text colour never names a base status token",
  beats a glyph-versus-text heuristic. Dots, rails, borders, fills and shadows keep
  the base tokens. This is an addition to the brief and is flagged for the user to
  veto.
- D4: the chip model is the base token at 15% alpha over each of the four surfaces,
  composited in gamma-encoded sRGB, which is what `color-mix(in oklab, X N%,
  transparent)` means. The light inks also hold 4.5:1 at 16% (4.68:1 at worst). The
  dark error ink on a 16% chip is 4.47:1, a known residual that D2 accepts because
  the dark theme is frozen.
- D5: `--ds-danger` stays the fill of the critical usage meter and its other
  background use; danger text takes `--ds-error-ink`.
- D6: the usage lint is exact: a `color:` value that names `--ds-success`,
  `--ds-warning`, `--ds-error` or `--ds-danger` is a violation, `color-mix()` blends
  included. `background-color`, `border-color` and custom properties are not
  matched, and comments are ignored. The message names the ink to use.
- D7: `.tool-row-content.is-error` keeps its 72% mix into `--ds-text-primary` but
  feeds `--ds-error-ink` into the mix, so its light-theme contrast rises from 6.60:1
  to 8.85:1 (a visible darkening, disclosed here).
- D8: the lint is an addition beyond the literal brief, flagged for the user to veto
  like D3: without it the next `color: var(--ds-success)` silently undoes the work.

## Acceptance scenarios

1. Light theme: each ink clears 4.5:1 on the primary, sidebar, secondary and inset
   surfaces and on a 15% chip of its own colour over each of them (4.75:1 at worst).
   Dark theme: each ink equals its base token and the computed colours are unchanged.
2. Real Chromium, both palettes, on the primary and inset surfaces: the plugin risk
   chip (`.plugins-perm-chip.risk-high`), the Team status chips
   (`.team-task-status-failed`, `.team-task-status-completed`), the extension glyph
   (`.ext-row-glyph.is-ready`), the installed mark (`.plugins-installed-mark`), the
   install dialog outcome and error (`.plugins-install-outcome.is-success`,
   `.plugins-install-error`) and the inline settings error
   (`.settings-inline-error`) compute the resolved ink and clear 4.5:1 on their own
   tint (E2E-078).
3. The critical context-usage meter paints its value with `--ds-error-ink` and its
   fill with `--ds-danger`.
4. The desktop `lint` fails on the baseline content (197 usage violations; base
   colours used as ink fail 23 of the 24 light checks) and passes on the candidate.
5. A contributor who writes `color: var(--ds-success)` gets a lint failure that names
   the ink to use.

## Behavior changes

- Light theme: status text and glyphs in 197 declarations get darker, same hue:
  success `#00a240` to `#006c2b`, warning `#e25507` to `#a03c05`, error `#e02e2a` to
  `#ad2421`. The dark theme paints exactly as before.
- `.tool-row-content.is-error` text is darker in the light theme (D7).
- The literal fallbacks (`#22c55e`, `#f59e0b`, `#ef4444`) are gone from the migrated
  `color:` declarations; they never applied. The background and border declarations
  in `messages.css` keep theirs.
- The desktop `lint` gains two rules (ink floor, base-token usage). A contributor
  who writes a base status token into a `color:` declaration now gets a failure.
- No change to Host, IPC, schema, persistence or any TS/TSX file.

## Code revision and validation

Revision: baseline `12d1c842b7a4246f7ca8a04e5f2b78eaba19a6bb` plus the uncommitted
tree of this worktree: 44 modified files (29 stylesheets, 3 test files, 7 script files
including the lowered test-quality baseline, and 5 docs files; +592 and -230 lines) and this record,
which is the only new file. No file is committed yet, so the checks below bind to
the working tree. `origin/main` has moved since the baseline: it is `ca5bfe9ac` (PR 92,
the 0.15.19 release preparation, 13 files), none of which this change touches, so the
refresh at delivery is expected to be conflict-free. The gates have not been re-run
on the refreshed tree.

Baseline and repro (measured with the new rules on the unchanged content): the usage
lint reports 197 declarations in 28 stylesheets; the base colours used as ink fail 23
of the 24 light checks (three tokens, four surfaces, plain text and chip; only error
as plain text on white passes) and none of the 24 dark checks. After the change both
are zero. The fixture tests pin the rules themselves.

Ink contrast computed from the shipped `tokens.css` by `scripts/style-token-contrast.mjs`:

| Token (light) | Ink | Text on four surfaces, white / worst | 15% chip, white / worst | 16% chip, worst | Base token as text, white / worst | Base token on 15% chip, white / worst |
| --- | --- | --- | --- | --- | --- | --- |
| success | `#006c2b` | 6.60 / 5.64 | 5.55 / 4.81 | 4.76 | 3.36 / 2.87 | 2.82 / 2.45 |
| warning | `#a03c05` | 6.68 / 5.71 | 5.52 / 4.79 | 4.73 | 3.79 / 3.24 | 3.14 / 2.72 |
| error | `#ad2421` | 6.88 / 5.88 | 5.50 / 4.75 | 4.68 | 4.57 / 3.90 | 3.65 / 3.16 |

Dark palette: the inks alias the base tokens (`#40c977`, `#ff8549`, `#ff6764`); text
5.66:1 to 8.32:1, 15% chip 4.55:1 to 6.35:1, and the error ink on a 16% chip 4.47:1.
`findLowContrastStatusInk` reports 0 violations on the shipped file at 15%.

Checks run on the final working tree (node directly from the worktree; pnpm is not
used in overlay worktrees):

| Check | Result |
| --- | --- |
| `node scripts/check-style-tokens.mjs` (the desktop `lint`) | pass ("style tokens OK"); on the baseline content the usage lint reports 197 base-token text declarations, and base colours standing in for the inks fail 23 of the 24 light checks |
| `node --test` on the `text-tier-contrast`, `style-token-integrity`, `plugin-install-dialog` and `composer-usage-footer` tests | 42 pass, 0 fail |
| whole `apps/desktop` `node --test test/*.test.mjs` | 4425 pass, 0 fail, 4 skipped (4429 tests, 119 s). The first full run on this tree had one failure, `plugin-install-dialog.test.mjs` pinning the old token name |
| `node scripts/check-test-quality.mjs` (the CI form) and with `--base origin/main` | pass (237 files, 8117 assertions in the inventory). The first run failed: the three CSS regex pins had been edited in place and the ratchet counts an edit as a new assertion. They were retired and the baseline lowered with `--write-baseline`: three signatures removed (`composer-usage-footer` 22 to 21 assertions, `plugin-install-dialog` 52 to 50, cases unchanged), and the baseline diff shows removals and count decrements only |
| `node scripts/check-agent-policy.mjs` | pass |
| `node scripts/check-architecture.mjs` | pass; 0 new TS/TSX files |
| `node scripts/generate-scenario-index.mjs --check` | current; 138 suites, 168 executable ids |
| `node --test scripts/e2e-suite.test.mjs scripts/scenario-index.test.mjs scripts/test/*.test.mjs` | 25 pass, 0 fail |
| release-tooling tests and `scripts/pi-patch-hash.test.mjs` (the CI release-tooling and Pi patch steps) | 86 and 7 pass, 0 fail |
| `docs/scripts/check-docs.mjs` and `check-locales.mjs` | 647 pages and 95 pairs, pass (the ADR "Consequences" notes it prints are existing warnings) |
| `vitepress build .` in `docs/` (what `pnpm docs:build` runs) | pass, "build complete in 43.95s" on the final record text; the output and cache directories were removed afterwards |
| `node_modules/.bin/biome lint` (what `pnpm lint:biome` runs) | pass, 143 files |
| Usage verification (scratch script over `apps/desktop/src`) | 0 `color:` declarations name a base status token; 197 name an ink; none of those keeps a fallback. The remaining base-token uses are non-text: background 113, border 10, box-shadow 4, border-left 3, `--review-change-rail` 2, border-color 1 |
| Electron `scripts/e2e-theme-surfaces.mjs` (E2E-078) on the final tree | exit 0, 7 of 7 `ok: true`. Eight production selectors are probed on the primary and inset surfaces in both palettes (8 probes each): every computed ink equals its token and the lowest ratio on the element's own tint is 4.84:1. The first run of the harness failed on the two Team chip probes because their stylesheet is the lazily loaded work-panel chunk that `index.html` does not link; the harness now links it |
| Search for other pins of the old values (`scripts/`, `apps/desktop/test/`, `apps/`, `packages/`) | no other use of the old light values (`#00a240`, `#e25507`, `#e02e2a`, or their rgb forms) than the retired-repro fixture in `text-tier-contrast.test.mjs`; no E2E script other than the new probes names a base status token, so no suite besides the two run here needed a change. The unit pins that still mention a base token match fills, dots or the `--ds-success` prefix, and the whole suite is green |
| Electron `scripts/e2e-team.mjs` | exit 0 (last case: French long progress labels). It ran before the last test and harness edits, none of which touch the Team suite, against the primary checkout's debug Host binary built 2026-10-24, so it says nothing about newer Host behaviour |
| Scratch before and after comparison in the light theme (primary and inset surfaces: plugin risk chips, glyph chips, Team status chips, inline error, status words) | by eye, base colour against the shipped ink against an OKLCH lightness-only variant: the shipped ink reads darker with the hue kept and the warning ink is a burnt orange. The screenshot lives in the session scratchpad only |

Renderer bundle behind the Electron runs: built at 03:22 on 2026-11-15, after the
newest stylesheet edit (03:15), so it carries the final CSS; the later edits touch
tests, E2E harness files and docs only.

Candidate E2E evidence (workflow spec §5), run 2026-11-15:

| Field | Value |
| --- | --- |
| Task candidate | the uncommitted working tree on `12d1c842b` (nothing is committed, so there is no candidate commit yet) |
| Base main | `12d1c842b` when the task started; `origin/main` is now `ca5bfe9ac` (PR 92, 0.15.19 preparation, no shared file) |
| E2E suites | `scripts/e2e-theme-surfaces.mjs` (E2E-078, both palettes) and `scripts/e2e-team.mjs` (Team panel) |
| Result | both exit 0 |
| Environment | local, as described next |

Environment of the Electron runs: macOS 27.2.1, Electron 43.6.0, Node 22.23.2, inside
the sandbox, with the `CLAUDE*` variables and `ELECTRON_RUN_AS_NODE` unset and a node
`--import` preload that appends `-ApplePersistenceIgnoreState YES` to the Electron
spawn, so the macOS "reopen windows" modal for the dev app id does not hang the run.
The theme-surfaces harness uses its own temporary profile; the Team suite isolates
`HOME` and its data directory in a temporary root. The user's running app and real
data were not touched.

NOT RUN: hosted CI and every `e2e-run.yml` family (nothing is pushed); every gate on
the tree refreshed to `ca5bfe9ac`; `pnpm build:js` for the packages and
`pnpm -r --if-present test` for packages other than desktop (no input of theirs
changed); `apps/desktop` `tsc --noEmit` and `check:runtime-tests` (no TS or TSX file
changed); the three Rust steps (no `crates/` change); the remaining Electron suites of
`04-e2e-test-plan.md`; Windows and Linux rendering; light-theme review of every screen
(the probes and the scratch comparison cover the touched surfaces only); any
real-model or real-provider run.

## Known risks

- Light-theme status text is darker in 197 declarations app-wide, the broadest
  visual change here. The hue is kept; the warning ink `#a03c05` reads as a burnt
  orange. It was judged by eye on the Team panel and plugin chips only, not on every
  screen.
- The dark error ink on a 16% chip is 4.47:1. Dark is frozen by the brief, and the
  guard models 15%, so this stays a known residual.
- The guard reads the opaque base surfaces: the translucent sidebar (vibrancy) and a
  custom sidebar tint are not modelled. It models the 15% chip; stylesheet chips run
  from 6% to 16%, and the light inks hold 4.5:1 across that range.
- The usage lint matches a base status token written inside a `color:` value. A
  status colour that reaches text through another variable of its own (`--x:
  var(--ds-success)` then `color: var(--x)`) is not seen.
- 28 solid status fills may carry white text at the base colour's ratio on white
  (success 3.36:1, warning 3.79:1). Not changed here; each needs a design call.
- The Team panel's literal chip hexes and the Goal report's `--ds-report-*` inks stay
  outside the ink tokens.
- D3 (glyphs take the ink) and D8 (the usage lint) go beyond the literal brief.
- Three CSS regex pins were retired (see Scope item 4). That the install dialog
  outcome and error and the critical usage value are painted with a status ink now
  rests on the usage lint (no base token as text), the no-hex assertion that stays
  in `plugin-install-dialog.test.mjs` and the E2E-078 probes. A selector repainted
  with a neutral text token would not fail a unit test; the probes catch it in real
  Chromium only.
- `scripts/e2e-team.mjs` ran against a Host binary built 2026-10-24.
- All rendering was checked on macOS only.

## Remaining work

The NOT RUN checks above. Delivery steps 5 to 8 of the workflow spec after the user
authorizes the commit: commit, refresh against the latest `origin/main` (it is
`0d700069e` now; `git merge-base --is-ancestor origin/main HEAD` must hold), the gates
re-run on the refreshed tree, and the candidate E2E repeated on the committed
candidate (the runs above are on the uncommitted tree). A read-only refresh rehearsal
on a detached scratch worktree at `0d700069e` applied this diff cleanly and kept
`check-style-tokens`, `check-test-quality` (8117) and the 35 targeted tests green;
1117 added no new base-status `color:` declarations (197 on baseline and on main,
identical per file). Steps 9 to 14 (push, pull
request, hosted gates, merge, local `main` sync, worktree cleanup) need explicit
remote-delivery authorization and the pinned head SHA; user acceptance
(`已验收`) was given 2026-11-17 on the uncommitted working tree (before/after
capture frames in `$TMPDIR/pi-1115-preview/labelled/`, uncommitted). The in-app changelog entry and any
version surface belong to the release preparation of whichever version ships this
and were left alone on purpose. Follow-ups that need their own decision: the 28 solid
status fills, the Team panel's literal chip hexes and the Goal report's ink family.

## Runtime resources

Worktree-local, git-ignored: a `node_modules` overlay of links into the primary
checkout, and `dist` and `out` builds for the Electron runs. Evidence, probes and logs
live in the session scratchpad only. The Team suite's screenshots
(`.artifacts/e2e/team`, 2.5 MB) and the docs build output were removed. The
desktop unit-test suite creates small fixture directories in `$TMPDIR` that it does
not remove itself; they stay in place because other sessions can run the same suite
there. No process tied to this worktree was left running (checked with `ps` at the
end).
