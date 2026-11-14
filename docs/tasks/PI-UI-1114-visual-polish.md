# PI-UI-1114: Renderer visual polish and token guards

- Project: `fork-pi-desktop`; task ID: `PI-UI-1114`; tier: T1; status: 实现中
  (built and committed on the request branch; hosted validation pending).
- Created: 2026-11-14 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: on 2026-11-14 the user set the session goal
  `优化一下软件的 UI 软件的 UI 设计全靠你决定` (optimize the software's UI; the design
  is left entirely to the executor). The goal authorizes the change itself. On
  2026-11-15 the user then told the executor to commit this session's work and
  release a new version (`将此次会话内容提交 然后发新版本`). That authorizes the commit.
  Push, PR, merge, tag and publication are the remote steps of that release and run
  only after the executor has confirmed the plan, the version and the pinned head
  SHAs with the user.
- Baseline: `a963980c23a61d2972bdf76209bd10fac8c4920c` (`origin/main`;
  `git ls-remote origin main` returned the same SHA on 2026-11-15).
- Branch: `feat/20261114-pi-ui-1114-visual-polish`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261114-feat-pi-ui-1114-visual-polish`.
- Target: the request branch; delivery to `main` needs the user's explicit
  remote-delivery authorization.

## Problem statement

"The UI design is entirely up to the executor" is an open brief, so the work went
after defects that can be measured instead of redrawing screens. A scan of the
baseline showed the renderer drifting from its own token system in ways no guard
noticed:

- **Undefined custom properties.** 59 `var()` references to 14 names that no
  stylesheet declares and no script sets (`team-panel.css` 47, `goal-report.css` 3,
  `messages.css` 3, `settings.css` 3, `composer-menus.css` 2, `ui-kit.css` 1). A
  reference to an undefined name makes the declaration invalid at computed-value
  time, so the property falls back to its initial value: `border` to none,
  `font-weight` to the inherited weight, `background` to transparent, `border-color`
  to the text colour. A fallback does not rescue it either: `var(--ds-bg, #000)`
  paints `#000` in every theme. What that cost on screen:
  - the Team panel's status chips and titles had the inherited weight and no
    warning, success or error accent (`--font-medium`, `--font-semibold`,
    `--ds-amber`, `--ds-emerald`, `--ds-rose`); its hover borders and the task
    detail tile were missing (`--ds-border-hover`, `--ds-bg-sunken`);
  - the chat Goal report card, the plugin scenic theme cards and the blur control
    had no border (`--ds-border` inside `color-mix`);
  - two hosted-search meta lines inherited the body colour (`--ds-text-tertiary`);
    the Goal report's code text fell back to the inherited family
    (`--font-family-mono`);
  - the plus-menu search had no fill and its focus border read as the text colour
    (`--ds-bg-subtle`, `--ds-border-focus`);
  - the unused `.ds-checkbox` tick was `#000` in both themes.
- **Raw literals the guard cannot read.** Seven typography or radius literals sit
  in rules written on one line (`.x { font-weight: 650; }`), which the line-based
  style guard skips: six in the plugin scenic theme cards (`settings.css`) and one
  `line-height: 1.5` in `composer-menus.css`.
- **Quiet text under the contrast floor in the light theme.** `--ds-text-faint` was
  `#afafaf`: 2.19:1 on white, 1.98:1 on the sidebar, 2.08:1 on the secondary
  surface and 1.87:1 on the inset surface. 76 references in 16 stylesheets (74
  painting declarations, 69 of them text colours, plus two token aliases) carry
  meta lines, counts, hints and empty states.
- **Two layout defects.** In the chat delegation card each subagent task row was
  flush with the card edge (the avatar touched the card and the hover wash ran
  into the rounded corner); plugin market card footers sat on different baselines
  within one row because only some footers carry a button.

## Scope

In scope (renderer styles, guards and docs; no TS/TSX, Host, IPC or contract change):

1. Map every retired token name to the defined token that carries the same role.
2. Replace the seven literals with their scale tokens.
3. Retune the light `--ds-text-faint` to `#858585`.
4. Inset the delegation card's task rows; give plugin card footers a common height.
5. Guards in the desktop `lint` (`scripts/check-style-tokens.mjs`): the
   undefined-variable rule and the inline-declaration rule
   (`scripts/style-token-integrity.mjs`) and the quiet-text contrast floor
   (`scripts/style-token-contrast.mjs`), each with fixture unit tests.
6. Design-system spec, component spec and E2E-078 text (English and zh-CN mirrors).

Out of scope: any redesign or new token; removing the dead `.ds-checkbox` class;
the dark theme palette; Windows and Linux rendering; the Host-only Goal report
tests.

## Frozen decisions

- D1: no redesign. A retired name maps to an existing token of the same role and a
  fix that would need a new token is out. Mapping: `--font-medium` and
  `--font-semibold` to `--font-weight-medium` and `--font-weight-semibold`;
  `--ds-border-hover` to `--ds-border-strong`; `--ds-bg-sunken` to `--ds-tile`;
  `--ds-amber`, `--ds-emerald`, `--ds-rose` to `--ds-warning`, `--ds-success`,
  `--ds-error`; `--font-family-mono` to `--font-mono`; `--ds-text-tertiary` to
  `--ds-text-muted`; `--ds-border` (inside `color-mix`) to `--ds-border-subtle` on
  the chat card and `--ds-border-default` on the plugin theme cards and blur
  control; `--ds-bg-subtle` and `--ds-border-focus` on the plus-menu search to
  `--ds-field-inset-bg` (with `--ds-field-inset-focus-bg` on focus) and
  `--ds-border-strong`; `--ds-accent-foreground` to `--ds-bg-primary`, the ink the
  other accent chips already use; `--ds-bg` to `--ds-bg-primary`.
- D2: a fallback never excuses an undefined name.
- D3: the undefined-variable rule has an exact-name allowlist with a recorded
  reason per entry (four Tailwind default theme variables that Tailwind emits on
  reference, and the optional `--ds-main-pane-min-width` layout hook). No prefix
  rules, so a typo of a real token still fails.
- D4: `.ds-checkbox` has no consumer; its tick is fixed minimally and the class is
  not deleted here.
- D5: the light faint tier becomes `#858585`: 3.69:1 on white, 3.33 on the
  sidebar, 3.50 on the secondary and 3.15 on the inset surface (tightest). The
  muted tier already clears 4.5:1 and is unchanged. The dark tiers (3.4 to 3.6:1)
  are unchanged.
- D6: contrast floors are 4.5:1 for `--ds-text-muted` and 3:1 for
  `--ds-text-faint`, on the primary, sidebar, secondary and inset surfaces in both
  themes. Alpha tokens are composited over the surface before the ratio is taken,
  and an unsupported colour form is reported, never passed.
- D7: the English component spec held a byte-identical duplicate block glued on
  with a missing newline; it is removed (documentation only).

## Acceptance scenarios

1. Team panel with a populated snapshot: status chips and titles show the medium or
   semibold weight and the warning, success or error accent; the task detail card
   shows the tonal tile; hover borders appear; geometry is unchanged.
2. Light theme: faint text clears 3:1 on white, the sidebar, the secondary and the
   inset surface; dark theme paint is unchanged.
3. Chat delegation card: each task row's avatar sits on the header's 16 px column
   and the hover wash clears the rounded corner.
4. Plugin market: card footers land on one line across a row, with and without a
   button.
5. Plus-menu search: inset fill at rest; focus shows the strong border and the
   focus fill.
6. Chat Goal report card, plugin theme cards and blur control show their border
   (computed in both themes; see the borders probe in the checks table).
7. The desktop `lint` fails on the baseline content (59 undefined references, 7
   inline literals, 4 contrast violations) and passes on the candidate.

## Behavior changes

- Team panel (`team-panel.css`, 47 references): chip and title weights, status
  accents, hover borders and the detail tile now render as written. Geometry is
  unchanged.
- Chat Goal report card gains a subtle border; the plugin scenic theme cards and
  blur control gain the default border; the Goal report error code and code blocks
  use the mono family; the two hosted-search meta lines use the muted colour.
- Plugin scenic theme cards: weights 650 and 700 become the semibold token (600);
  the 15 px and 12 px sizes and the round check chip keep their values through
  tokens. The check mark uses the primary background ink on the accent chip.
- Light theme: every use of the faint tier (74 painting declarations across the 16
  stylesheets that reference it) is darker, `#afafaf` to `#858585`.
- Delegation card task rows are inset 8 px (list margin) with 8 px row padding;
  plugin card footers reserve one button row of height.
- Plus-menu search uses the inset field fill, and the strong border with the focus
  fill on focus.
- The desktop `lint` gains three rules (undefined custom property, inline
  typography literal, quiet-text contrast). A contributor who adds a retired token
  name, a one-line raw literal or a quieter text colour now gets a failure.
- No change to Host, IPC, schema, persistence or any TS/TSX file.

## Code revision and validation

Revision: baseline `a963980c23a61d2972bdf76209bd10fac8c4920c` plus the single commit
on this branch (`git log a963980c2..HEAD`): 16 modified files (+164 and -94 lines),
four new source and test files of 160, 148, 143 and 88 lines, and this record. The
checks below ran on this tree before it was committed; no file other than this
record changed after the last full test run, so the evidence binds to the commit's
tree.

Baseline and repro (measured on the unchanged content with the new rules, before
any fix): 59 undefined references (14 names, 6 files), 7 inline literals, and the
light faint tier under the floor on all four surfaces (2.19, 1.98, 2.08 and 1.87
against 3:1). After the change all three counts are zero. The fixture tests pin the
rules themselves: retired names are reported with their line, a fallback does not
excuse a missing name, rule, `@theme`, `@property` and script definitions all count,
the allowlist is by exact name, inline declarations are read while start-of-line
ones stay with the line-based check, the retired `#afafaf` fails at 2.19 and 1.98,
`#858585` passes, an alpha token is judged after compositing, an unsupported colour
form is reported, and the contrast ratio equals the WCAG reference values.

Checks run (node directly from the worktree; pnpm is not used in overlay worktrees):

| Check | Result |
| --- | --- |
| `node scripts/check-style-tokens.mjs` (the desktop `lint`) | pass; the same rules on the baseline content report 59 undefined references, 7 inline literals and 4 contrast violations |
| `node --test` on `style-token-integrity.test.mjs` and `text-tier-contrast.test.mjs` | 12 pass, 0 fail |
| whole `apps/desktop` `node --test test/*.test.mjs`, on the final tree | 4415 pass, 0 fail, 4 skipped (4419 tests, 123 s) |
| `node scripts/check-test-quality.mjs --base origin/main` | pass; the frozen baseline is untouched. A first contrast test that read `tokens.css` with a regex was rejected by this check and was rewritten as fixture-only tests, with the real-file check moved into the `lint` guard |
| `node scripts/check-agent-policy.mjs` | pass; 15 of 15 anchors |
| `node scripts/generate-scenario-index.mjs --check` | current; 138 suites, 168 executable ids |
| `docs/scripts/check-docs.mjs`, `check-locales.mjs` | 645 pages, 95 pairs, pass; `check-locales` first failed on a one-sided table row and the zh-CN row was added |
| `node_modules/.bin/biome lint` (what `pnpm lint:biome` runs) | pass, 143 files; none of the touched JavaScript files is in biome's allow-list, so biome does not cover them |
| script-level tests: `node --test scripts/e2e-suite.test.mjs scripts/scenario-index.test.mjs scripts/test/*.test.mjs` | 25 pass, 0 fail |
| Electron E2E on the candidate (the evidence block below) | pass: all four suites exit 0 with `ok: true` |
| Computed borders on the live bundle (injected-element probe, dark and light) | `.goal-report-card`, `.plugin-scenic-theme-card` and `.plugin-scenic-blur-control` compute `solid 1px` with the subtle (5% ink) or default (8% ink) border colour in both themes; a replica of the baseline declaration (`border: 1px solid color-mix(in oklab, var(--ds-border) 60%, transparent)`) computes `none 0px` in both |
| Status accent contrast, computed from the token values | light theme: success 3.36:1, warning 3.79:1, error 4.57:1 on white, and 2.82, 3.14 and 3.65 on a 15% tinted chip; dark theme 5.06 to 8.32. Not a pass of a 4.5:1 floor in the light theme; see the risks |
| `node scripts/check-architecture.mjs` | pass; it reports 0 new TS/TSX files because it finds new files in committed history, so the new modules were checked by hand: 160 and 148 lines (scripts), 143 and 88 lines (tests), far under the roughly 500-line guideline |
| `node scripts/check-test-quality.mjs` (the CI form, without `--base`) | pass |
| Renderer bundle behind the Electron and capture runs | built after the last CSS edit (bundle 00:31, newest stylesheet 00:19) and it carries the final rules: no `--ds-amber` or `--font-medium` left; the `#858585` faint tier, the footer `min-height`, the delegation inset and the focus fill are present |
| `vitepress build .` in `docs/` (what `pnpm docs:build` runs in `docs-check.yml`) | pass: exit 0, "build complete in 36.92s", the new record page is rendered, no dead-link errors (the only warning is the existing chunk-size notice); the output directories were removed afterwards |
| UI capture rig (the repo's `PI_DESKTOP_CAPTURE=1` frames, isolated profile), baseline `HEAD` against the candidate | 61 frames each. Frames that differ for other reasons were traced (the plugin market loading state, the work panel and scroll-button animation phase differ run to run). The CSS-caused differences were re-checked live on the rebuilt bundle (plus-menu search, market footers), and the delegation-card frames, light and dark, show the row inset directly |
| Team panel before and after (esbuild bundle of the real `TeamPanel` with a `TeamSnapshot` fixture; baseline CSS from `git archive HEAD`) | chips and titles gain weight and accent, the detail card gains its tile, geometry identical |

Candidate E2E evidence (workflow spec §5), run 2026-11-15 on the final tree:

| Field | Value |
| --- | --- |
| Task candidate | `a963980c2` plus the single commit on this branch (`git log a963980c2..HEAD`); its tree is the tree the suites ran on |
| Base main | `a963980c23a61d2972bdf76209bd10fac8c4920c` (`origin/main` when checked on 2026-11-15) |
| E2E suites | `scripts/e2e-theme-surfaces.mjs` (E2E-078, light and dark surfaces), `scripts/e2e-goal-report-canvas.mjs` and `scripts/e2e-goal-team-renderer-ui.mjs` (Goal report and team renderer, where tokens were remapped), `scripts/e2e-composer-mode-menus.mjs` (composer menus) |
| Result | all four exit 0 with `ok: true`; no `ok: false` anywhere in the theme-surfaces probe output (7 of 7 true) |
| Environment | local, as described next |

Environment of the Electron and capture runs: macOS 27.2.1, Electron 43.6.0, Node
22.23.2, inside the sandbox, with the data directory, Electron profile and `HOME`
pointed at a throwaway temp directory (the user's running app and real data were not
touched), `CLAUDE*` variables and `ELECTRON_RUN_AS_NODE` unset, and a node
`--import` preload that appends `-ApplePersistenceIgnoreState YES` to the Electron
spawn so the macOS "reopen windows" modal for the dev app id does not hang the run.

Pull request CI (`ci.yml`, `docs-check.yml`, `pr-base.yml`, `project-memory.yml`)
against this run: the node gates a pull request runs were run here (lint, agent
policy, docs checks, architecture, test quality, scenario index, the script-level
tests, the desktop unit tests) except the ones named below. Not run because no
input of theirs changed: `pnpm build:js` for the packages (only the renderer bundle
was built), the desktop `tsc` and `check:runtime-tests` (no TS or TSX change), the
release-tooling tests and `check-release-docs.mjs` (no release surface), the Pi
patch hash test, the unit tests of packages other than desktop, and the three Rust
steps. `pr-base.yml` needs a pull request. `project-memory.yml` is path-filtered and
no path of this change matches its filter.

NOT RUN: hosted CI and every `e2e-run.yml` family (nothing is pushed); the
Host-dependent suite `scripts/e2e-goal-report-ui.mjs` as a pass (see below); the
remaining Electron suites of `04-e2e-test-plan.md`; `apps/desktop` `tsc --noEmit`
(no TS or TSX file changed; the overlay's unbuilt package outputs would also add
unrelated errors); Windows and Linux rendering; light-theme
review of every screen (the 61 frames and the live probes cover the touched
surfaces only); any real-model or real-provider run.

`scripts/e2e-goal-report-ui.mjs` ran once, against the primary checkout's Host
binary `target/debug/pi-desktop-host-core`, and finished 1 of 2: E2E-GOAL-UI-002
passes, E2E-GOAL-UI-001 fails ("chk-3 should be matched by its command", Host
answer `inconclusive`). It is a Host-only test: neither the script nor its
`scripts/e2e/` helpers import anything from `apps/desktop` (the one mention is a
file path inside fixture data), and this change touches no `crates/` or `packages/`
file. That
binary was built on 2026-10-24 17:12, before commit `064813150` (2026-11-08, "match
unbound check commands to the Goal's Bash runs"), which is the feature the failing
assertion exercises, so a stale binary is the likely cause. That cause is inferred
from dates, not proven by a rebuild, and the suite is reported as not passing.

Drift found, not fixed: the example token blocks of the design-system spec (the
`:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks of
`07-ui-design-system.md`) list `--color-text-muted` as `#5d5d5d` (dark) and
`#94A3B8` (light), while the shipped `--ds-text-muted` is a 52% white mix in dark
and `#5d5d5d` in light. The shipped tokens are the contract and the new contrast
guard reads them; rewriting the example blocks is a separate documentation change.

Known risks:

- The token fixes make declarations that never rendered appear for the first time
  (Team panel weights, accents and tile; the Goal report card, plugin theme card and
  blur control borders). They match what the CSS was written to say, but nobody has
  seen them in production, so they deserve a look in the real app.
- The faint-tier change is the broadest visual change: 74 painting declarations in
  the light theme become darker, which narrows the step between the
  muted and faint tiers while keeping their order (6.6:1 muted against 3.7:1 faint
  on white).
- Light-theme status text is under 4.5:1. The status tokens give success 3.36:1,
  warning 3.79:1 and error 4.57:1 on white, and 2.82, 3.14 and 3.65 on a 15% tinted
  chip. The Team panel now follows the convention the rest of the app already has:
  140 declarations in 20 stylesheets (12 of them the Team panel's) use these tokens
  as text colour, and 45 rules in 9 other stylesheets pair them with a tint of the
  same colour. So the fix matches the app, but small status text in the light theme
  is a legibility weak spot app-wide. Improving it needs darker light-theme status
  tokens, a design decision across those declarations, and is not done here; the
  contrast guard covers only the muted and faint tiers.
- The plugin theme cards lose the odd 650 and 700 weights for the 600 token.
- `.ds-checkbox` stays as dead code.
- The guards are static text analysis: a variable defined only on another element
  counts as defined everywhere, the contrast rule reads the opaque base surfaces
  (the translucent sidebar and custom sidebar tints are not modelled), and a new
  Tailwind default variable referenced from CSS needs an allowlist entry or a
  project token.
- Capture-frame comparisons carry timing noise (loading state, animation phase);
  they are supporting evidence, not a pixel gate.
- All rendering was checked on macOS only.

## Remaining work

Delivery steps 9 to 14 of the workflow spec (push, pull request, hosted gates, merge,
local `main` sync, worktree cleanup), after the user confirms the plan and the pinned
head SHA, with a `latest origin/main` refresh if `main` has moved; hosted pull request
CI; user acceptance (`已验收`). The user asked on 2026-11-15 for a new release after
the commit: the version preparation (version surfaces and the in-app changelog entry)
is a separate T2 request that starts from the merged `main`. Outside this change: a
Host binary built after `064813150` is needed to get `e2e-goal-report-ui.mjs` back to
a clean pass.

## Runtime resources

Worktree-local, git-ignored: a `node_modules` overlay of links into the primary
checkout, and `dist` and `out` builds for the Electron runs. Evidence, probes and
logs live in the session scratchpad only. The live Electron session was stopped
with SIGTERM to its launcher (which removed its own throwaway data directory); the
capture rig's two `pi-ui-capture-*` profile stubs, the Goal team E2E's
`.review-evidence/` folder and the VitePress `dist` and `cache` output of the docs
build were removed. No process tied to this worktree is left running. The two full
unit-test runs left about 535 small fixture directories (about 5 MB) in `$TMPDIR`
that the suite creates and does not remove itself; they stay in place because other
sessions can run the same suite there.
