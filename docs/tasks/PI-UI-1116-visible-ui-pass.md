# PI-UI-1116: Visible UI pass on the activity rail and the home checklist

- Project: `fork-pi-desktop`; task ID: `PI-UI-1116`; tier: T1; status: 已验收
  (user acceptance passed 2026-11-17 on the before/after preview frames; built and
  verified locally on the request branch; nothing committed or pushed).
- Created: 2026-11-15 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the session goal `优化一下软件的 UI 软件的 UI 设计全靠你决定`
  (optimize the software's UI; the design is left entirely to the executor) stays
  open. After v0.15.19 shipped the user wrote `但是我没有看到具体的 UI 优化` (I do not
  see a concrete UI optimization), so this pass exists to make a change that can be
  seen. The goal authorizes the change itself. Commit, push, PR, merge and release
  each wait for the user's explicit word.
- Baseline: `ca5bfe9acbf71302893bd262c99ae9190892e5d4` (`origin/main` after
  v0.15.19).
- Branch: `feat/20261115-pi-ui-1116-visible-ui-pass`.
- Worktree: `<worktree-root>/20261115-feat-pi-ui-1116-visible-ui-pass` (central root declared in AGENTS.md).
- Target: the request branch; delivery to `main` needs the user's explicit
  remote-delivery authorization.

## Problem statement

PI-UI-1114 repaired token integrity and was correct, but it changed pixels in only 4
of 61 capture frames and none of them in the dark theme, so a user looking at the
app could not tell anything had happened. This pass starts from what a user sees on
every working session instead.

- **The activity rail has no hierarchy.** A group title (13 px) and the empty-state
  sentence under it (12 px) both sit in the muted tier, so the title does not read as
  a heading. The count is bare muted text. Populated and empty groups look alike.
- **The home onboarding checklist is an outlined box.** It carries a 1px
  `border-subtle` stroke on a fill identical to the page (`#181818` on `#181818` in
  dark, `#ffffff` on `#ffffff` in light, measured from the capture), so the stroke
  is the only thing that separates it. The design system says in-flow surfaces draw
  no strokes (D297) and that a card is a `--ds-tile` plate (§6.4, §11.3).
- **The transcript's "Processed" row count is the least legible real text on screen.**
  The `已处理 40s 1 个工具` row closes every assistant turn, and its count sits in
  `--ds-text-faint` at 11px: measured 3.69:1 in light (`rgb(133,133,133)` on white)
  and 3.59:1 in dark (`rgb(112,112,112)` on `rgb(24,24,24)`). That is inside the
  faint tier's own 3:1 floor, so this is not a token break — it is a tier
  misassignment. Design system §4.3 assigns `--ds-text-faint` to placeholder and hint
  text and §15 requires 4.5:1 on all text/background pairs, so an 11px count that
  reports what the turn did belongs in the muted tier, which the system already keeps
  at or above 4.5:1 for exactly this kind of content. A pixel audit of the live build
  across chat, home, plugins and settings found no other real failure; three further
  hits were inverted foreground/background picks in the audit itself, not defects.

## Scope

In scope (renderer styles and docs; no TS/TSX, Host, IPC or contract change):

1. `session-activity-rail.css`: group titles in primary ink, counts as a tonal chip,
   a `--ds-tile` plate behind an open group that holds rows, a quiet nested Ended
   group, and a colour/transform transition on the disclosure caret (collapsed under
   `prefers-reduced-motion`).
2. `session-skill-suggestions.css`: the Skills and MCP title matches the group
   titles (same ink, same weight, same caret behaviour).
3. `chat-shell.css`: the onboarding checklist becomes a `--ds-tile` plate.
   Superseded at delivery: PI-UI-1117 landed the identical plate in `main`, so this
   hunk is dropped from the committed change (the plate ships via 1117).
4. `messages.css`: the Processed row's tool count moves from `--ds-text-faint` to
   `--ds-text-muted`, clearing the 4.5:1 floor in both themes.
5. `tokens.css` + `composer.css`: the composer placeholder ink becomes fully opaque
   in the token (light `#6b6d70`, dark 50% white) and the fade ends at `opacity: 1`
   instead of `0.72`, so the dark placeholder stops compositing to 2.72:1 (D10).
6. `composer.css`: the unavailable context-usage placeholder stops inheriting the
   global half-opacity disabled dimming and carries its state in one quiet ink tier
   instead (D11).
7. Component spec §13.4, design-system §8.0 and §12.1, and their zh-CN mirrors.

Out of scope: any new token or accent hue (the placeholder retune reuses the
existing `--ds-placeholder-ink` and only moves its value and its fade endpoint);
the global `base.css` disabled rule itself, which stays as-is for every real
inactive action (D11 scopes over it for one read-out only); the
sidebar, the transcript, the rest of the composer chrome and the work panel; the
work-panel Overview sections (already primary ink, a different pattern); Windows and
Linux rendering.

## Frozen decisions

- D1: monochrome and token-only. No new token, no accent hue, no literal.
- D2: group titles take `--ds-text-primary` and keep weight 500 (`--font-weight-medium`).
  `--font-weight-semibold` is reserved for brand and CTA buttons (design system
  §5.4), so a bolder title is out; the contrast step carries the hierarchy.
- D3: the plate (`--ds-tile`) is applied with `:has()` to top-level groups only
  (`.session-activity-rail > .session-activity-group`), so the Ended group nested
  inside Background processes never becomes a plate inside a plate. Folded and empty
  groups stay flat, so the rail is calm while idle. The plate is paint, not layout: an
  `8px` spread `box-shadow` in the same tile colour grows it visually, so padding,
  margins and therefore the text column stay identical to the flat groups and the rail
  gains no scrollable overflow. Radius is `--radius-2xs` (6px): the plate sits inside
  the rail column, not on the page, so it is not a card.
- D4: the count chip uses `--ds-tile-deep`, the token the sidebar source chip
  already uses for chips.
- D5: the onboarding plate clears its stroke colour instead of deleting the border,
  so the box keeps its geometry. The Tailwind utilities on the element are layered
  and the plate rule is not, so the rule wins; verified in the built app.
  Superseded: PI-UI-1117 shipped the same plate; the hunk is dropped at delivery.
- D6: considered and rejected.
  - A sidebar active-row marker: it collides with the status dot in the gutter
    (rendered as a bar through a circle) and the active pill is already clear.
  - A spotlight behind the home mascot: the spec says empty-home branding stays
    quiet so the composer remains the primary surface.
  - A fade-in on the home hero and checklist: destination surfaces already enter
    once with opacity (§8.7).
  - Moving the caret of the "Processed" row next to its label:
    `transcript-style.test.mjs` pins that the caret trails the row, for the
    band-width reason recorded there.
  - Semibold titles: D2.
- D7: this pass supersedes two accepted sentences of component spec §13.4 ("without
  a framed card" and "group headers are muted"). They had no ADR behind them. The
  replacement text is in the spec; the plate is one rule, so a reviewer who prefers a
  flat rail can drop it without touching the heading and chip changes.
- D8: the empty gap between the checklist and the composer on a tall window
  (measured at 1200×800) is intended, not a defect. `.home-stack-inner` centres its
  block with `margin: auto` inside `.home-scroll`, and `home-empty-layout.test.mjs`
  pins that declaration *and* asserts the absence of `justify-content: center`;
  raising the stack would break a pinned layout contract for a taste preference, so
  this pass leaves it alone. Reported as a known visual note instead.
- D9: the tool count stops at `--ds-text-muted` (5.10:1 dark, 6.58:1 light on the
  transcript), not `--ds-text-secondary`. Both tiers clear the floor; the muted tier
  keeps the count quieter than the label it follows, which is the hierarchy the row
  already had, so the fix restores legibility without promoting a 11px count to body
  ink. The count's `--text-xs` size is untouched: the floor is about colour, and
  shrinking or growing the type would move a pinned row height.
- D10: the composer placeholder ink is **fully opaque in the token** and the fade
  ends at `opacity: 1`. Before this pass `--ds-placeholder-ink` carried its own alpha
  (dark 42% white) and `.composer-placeholder` multiplied it again with
  `opacity: 0.72`, so dark composited to 30% white and 2.72:1. Two stacked dimmings make
  the result depend on which layer the reader measures, and they pulled the themes apart
  (light 4.06, dark 2.72). One opacity budget per element fixes both: the token holds the
  quietness (light `#6b6d70` 5.19:1, dark 50% white 5.04:1 at full alpha) and the
  element holds only the fade. The fade itself is kept because
  `apps/desktop/test/composer-placeholder-context.test.mjs:104` pins the animation; only
  its endpoint moved from 0.72 to 1. Rejected alternatives: dropping `opacity` alone
  leaves dark at 4.02 and makes light read as loud as body text (8.59); raising the dark
  token alone leaves light at 4.06, so the themes still disagree.
- D11: a disabled control that only reports state keeps its ink; one that offers an
  action keeps the dimming. The composer's unavailable context meter is the first kind:
  `ContextUsagePlaceholder` renders a `disabled` `TooltipButton`, so the global rule in
  `base.css:102-107` halved it on top of an already-muted value token and the row landed
  at **2.22:1 (light) and 2.34:1 (dark)** for both the label and the dash — under every
  floor in §12.1 and §15, on the one screen a new user sees first. The state is already in
  the content (a dash, not a percentage, plus the `chat.usageContextUnavailable` tooltip),
  so the dimming was a second, illegible signal. The fix is scoped to
  `.composer-usage-context[data-unavailable="true"]` — that attribute exists only in this
  component, so the live footer (`ContextUsageInspector`) is untouched — and it does two
  things: restores `opacity: 1` on the disabled button and moves the label into
  `--ds-text-muted`, so the whole read-out sits in one tier, one step below a live meter
  (which keeps `--ds-text-secondary` on the label and `--ds-text-primary` on the value).
  Measured after: **6.58:1 light, 5.56:1 dark**. The `not-allowed` cursor stays, because
  the control still does not act. Rejected: brightening the global disabled rule (real
  inactive actions must stay quiet), lifting the read-out to `--ds-text-secondary` (an
  empty meter would then read as loud as a live one), and dropping the `disabled`
  attribute (it is the honest accessibility state, and `plugin-composer-slots.test.mjs`
  pins it).

## Acceptance scenarios

1. Rail, working state (three recorded subagents): titles in primary ink; counts in
   chips; the open Subagents group on a plate; Skills and MCP title matches.
2. Rail, idle state (every group empty): titles read apart from the empty-state
   copy; counts in chips; no plate.
3. Home with the onboarding checklist: a filled plate with no outline; the five rows
   keep their positions. (Satisfied by PI-UI-1117's plate in `main`; not part of
   this committed change.)
4. Both themes for 1 to 3.
5. Nested Ended group: muted title, no plate of its own.
6. The transcript Processed row: the tool count reads at 4.5:1 or better against the
   transcript in both themes, and stays visibly quieter than the `已处理` label.
7. Composer placeholder, both themes: the empty home and thread composers draw the
   hint at 4.5:1 or better against their own plate (measured 5.17:1 light, 5.04:1
   dark) while still reading quieter than a typed draft.
8. Reduced motion: the only new transition is the caret's colour and transform. It is
   declared on the caret `svg`, which the shared `.btn` collapse in
   `styles/responsive.css` does not reach, so both rules carry their own
   `@media (prefers-reduced-motion: reduce) { transition: none }` and the effect is
   instant. Verified in the built bundle CSS.
9. The unavailable context meter on an untouched home composer, both themes: the
   `上下文` label and its dash read at 4.5:1 or better against the composer plate
   (measured 6.58:1 light, 5.56:1 dark) and stay one step quieter than a live meter,
   which still leads with secondary/primary ink. The button stays `disabled` with its
   `not-allowed` cursor, its tooltip and its accessible name, and the row keeps its
   exact geometry (measured: `x 670, y 762, 135×22` in both themes, before and after).

## Behavior changes

Visual only. No interaction, content, route, i18n string or accessibility name
changes. The disclosure buttons keep their role, label and `aria-expanded`. The
composer placeholder still fades in through the same keyed animation; only its
endpoint became opaque, so the hint is legible without becoming a second draft. The
unavailable usage placeholder is still a disabled control that reports the same
content; only its ink changed, from half-opacity muted to full-opacity muted.

## Code revision and validation

Evidence frames (before and after, both themes, same fixtures, viewport and
emulation) live outside the repository in the review session's scratch directory and
are not committed: `$TMPDIR/pi-ui-shots/final-cmp-rail-light.png`,
`final-cmp-rail-dark.png`, `cmp-checklist-light.png`, `cmp-checklist-dark.png` (the
labelled side-by-side sheets), the raw frames under `probe24/`, `probe20/` and
`probe28/` (the final rebuilt app), and `probe18/min-light.png` at the 800×560 window
minimum. The tool-count pair is different: both sides are real frames of the candidate
build, `probe33` before the CSS change and `probe40` after the final rebuild, with no
injected declarations; `fix-count-sheet.png` is the labelled 4× crop of both themes.
`placeholder-cmp.png` is the labelled 2× crop of the composer hint in both themes:
light and dark, before (`probe65`) and after (`probe66`), each side a real frame of
the built app with the pre-change declarations injected for the before column only.
The rail
and checklist before sides are produced from the candidate build by injecting the
pre-change declarations (muted heading ink, bare count text, no plate) over the same
DOM, because the baseline binary has no way to run the newer fixtures; the inject is
printed below so it can be re-run.

| Check | Result |
| --- | --- |
| `node scripts/check-style-tokens.mjs` (desktop `lint`) | pass, `style tokens OK`, exit 0 (re-run after the reduced-motion additions and again after the tool-count ink change) |
| `npx electron-vite build` in `apps/desktop` | pass; rebuilt after the tool-count change and again after the final comment rewording (8.61 s). The two reduced-motion overrides and `color:var(--ds-text-muted)` on `.turn-process>.tool-activity-header>.tool-activity-count` are present in the emitted CSS |
| `node --test test/*.test.mjs` in `apps/desktop` after the D10 placeholder change (the whole renderer suite, not just the styling files) | 4419 tests, **4415 pass, 0 fail**, 4 skipped, 101.7 s. The four skips are the pre-existing platform-gated ones. Narrower re-runs on the styling files alone: 83 / 83 pass (`style-token-integrity`, `theme-surface-tokens`, `surface-polish`, both `session-activity-rail` files, `composer-placeholder-context`, `transcript-style`, `plugins-page-style`, `markdown-prose-style`, `window-background-theme`) and 34 / 34 on the layout files (`home-empty-layout`, `composer-usage-footer`, `interaction-polish`, `active-turn-surface`, `fixed-dropdown-surfaces`, `theme-surface-tokens`, `settings-theme-picker`) |
| `node scripts/check-test-quality.mjs` | pass, baseline unchanged (no test added) |
| `node scripts/generate-scenario-index.mjs --check` | current, 138 suites, 168 executable ids |
| `node scripts/check-agent-policy.mjs` | pass, 15 / 15 anchors, no stray paths |
| `node scripts/check-release-docs.mjs` | pass, aligned with 0.15.19 |
| `docs/scripts/check-locales.mjs` / `check-docs.mjs` | pass, 95 English/Chinese spec pairs verified, 648 pages verified (the ADR "Consequences" advisories are pre-existing and non-fatal) |
| E2E-078 `e2e-theme-surfaces` (re-run on the final build, and again after D10) | pass, `ok: true`, no failures in either theme (6/6 scenes, `failures: []`). The suite guards the composer and settings surfaces as a whole, not the placeholder token itself; the token is covered by the pixel measurement row below and by `composer-placeholder-context` |
| `e2e-session-activity` (re-run on the final build, `NODE_OPTIONS=--no-warnings`) | 5 / 5 pass: notes, processes, EOF, app-exit, crash |
| `e2e-session-activity-history`, `e2e-session-activity-aggregate` | pass (earlier run on the same source tree) |
| Transcript tool count, pixel audit of the live build before and after (probe33 / probe40 on the final rebuild, 1200×800, both themes) | before: 3.69:1 light (`rgb(133,133,133)` on `rgb(255,255,255)`) and 3.59:1 dark (`rgb(112,112,112)` on `rgb(24,24,24)`); after: 6.58:1 light (`rgb(93,93,93)` on `rgb(255,255,255)`) and 5.56:1 dark (`rgb(144,144,144)` on `rgb(24,24,24)`). The ink is sampled from the glyph core of the rendered frame, not from token arithmetic. Re-auditing the whole visible text of chat, home, plugins and settings leaves zero failures in light; the only remaining dark hit is the tinted `已完成` badge at 4.49:1, which is a pre-existing `badge-success` surface outside this pass's scope |
| `e2e-transcript-render` (re-run on the final build, and again after D10) | exits 0 with no `ok: false` anywhere in the report — the runner prints the full scene JSON rather than a summary line, so the check walked every nested `ok` flag. Includes `turnProcess` (the row whose count gained ink), `readability`, and the two composer blocks that render the placeholder span |
| `e2e-smoke` | 23 / 23 pass, 2 skipped (`E2E-008`, `E2E-009` need `PI_DESKTOP_TEST_API_KEY`); `E2E-004-onboarding` passes. Needs `PI_DESKTOP_HOST_BIN` pointed at the primary checkout's debug host — without it the runner exits 1 with "host binary missing", which is an environment message, not a test failure |
| Rail, open Subagents group with three recorded delegations (probe, light) | plate `rgb(247,247,247)` on a `rgb(255,255,255)` page (1.07×), `--radius-2xs` = 6px, `0 0 0 8px` halo, margins unchanged at `0 0 20px`; title `rgb(26,28,31)` at weight 500, 15.94:1; count chip `rgb(230,230,230)` on `rgb(78,80,82)`, 19×17 px, full pill, 6.42:1; row label 7.00:1 |
| Rail, same scene, pre-change declarations injected for the before side (light) | plate absent (page colour, radius 0, no halo); title `rgb(93,93,93)`, 6.58:1; count is bare text 8 px wide at 6.58:1 |
| Rail, dark theme | plate `rgb(32,32,32)` on `rgb(24,24,24)` (1.09×); title `rgb(255,255,255)` 16.26:1; chip `rgb(50,50,50)` on `rgb(194,194,194)` 7.22:1; row label 8.62:1. Before side: `rgb(144,144,144)` title at 5.60:1 and bare 8 px count |
| Rail, empty Plans group (both themes) | stays flat on the page colour; title 17.08:1 light / 17.76:1 dark; chip 6.67:1 / 7.84:1 |
| Rail plate is paint only (probe, 1200×800) | rail stays 232 px wide, `margin-bottom: 20px` on every group and the rail gains no scrollable overflow; only the populated group's painted height differs (175 px with rows versus 53 px flat), because it holds rows |
| Nested Ended group (synthetic DOM, the fixtures hold no ended-process record) | no plate and muted title while its parent gains a plate once a row exists |
| Onboarding checklist, light and dark (pixel diff of the same DOM with the pre-change fill and stroke injected) | light bbox `[739,324,2211,960]`, 130 740 pixels changed, max channel delta 255; dark bbox `[739,323,2211,960]`, 131 906 pixels changed, max delta 228 — the outline-only box becomes a flat `--ds-tile` plate with no stroke in both themes, rows unmoved |
| Minimum window 800×560 (emulated via `Emulation.setDeviceMetricsOverride` at dsf 2) | home stack overflows by 2 px and `.home-scroll` scrolls (`scrollHeight` 377 vs `clientHeight` 375); composer 477×109 at y 413, its footer and usage footer fully inside the window at y 522 — expected for `margin:auto` centring, nothing clipped. Re-checked on the final build in both themes for home, chat and settings: no new finding; the only hit is the `.sr-only` project-path span, which clips by design (`scrollWidth` 909 against `clientWidth` 1) and is not visible |
| Cross-screen layout audit on the final build (probe41: light home / settings / plugins / scheduled / build / context-insights and dark home / settings / plugins, 1200×800) | zero findings in both themes. The detector flags an element that leaves the viewport without a scroll ancestor, and an `overflow: hidden` box whose real `scrollWidth`/`scrollHeight` exceeds its client box; neither fires on any of the nine screens |
| Visible-text contrast audit of the final build (probe57: light home / settings / plugins and dark home / settings / plugins, 1200×800, 2× DPR) | every text node whose ink resolves to a design token, scored against its composited backdrop. Zero failures on light home, light settings, dark settings and dark plugins. Three hits remain, all pre-existing and none introduced here: (a) light `.plugins-perm-chip.risk-high` `rgb(226,85,7)` on `rgb(251,231,220)` at 3.17:1 — PI-UI-1115 fixes exactly this rule by moving it to `--ds-warning-ink`; (b) dark home composer placeholder, measured here as 3.98:1 from the token alone — that figure ignores the element's own `opacity`, and the D10 row below supersedes it with the composited 2.72:1 before, 5.04:1 after; (c) light theme reports no other failure at all |
| Keyboard focus ring across the shell (probe58, Tab × 14 from a reset focus, light) | every stop inside the sidebar, the footer and the checklist renders the shared `:focus-visible` ring (`outline: solid 1.5px`, `outline-offset: 2px`, ink `oklab(0.22559 …)` light / `oklab(0.99999 …)` dark on `--ds-accent`). No stop loses its ring |
| Onboarding checklist row focus (probe59 / probe60, both themes) | an earlier read of this pass reported `outline: 3px none` on the four visible checklist buttons. That was a false positive from an element-handle read: driving real Tab focus and focusing the rows directly both return `outline: solid 1.5px` with `:focus-visible` true, and the captured crop shows the rounded ring drawn around `保存 API 密钥`. No fix needed; the checklist inherits the global rule like every other control |
| Composer placeholder ink on the rendered frame (probe64 after, probe65 before/after pair, probe66 settled re-read; both themes, 1200×800) | **the one code change of this round (D10).** `.composer-placeholder` used to compose `--ds-placeholder-ink` with an element `opacity: 0.72`, so the dark token (42% white) landed as 30% white: `rgb(100,100,100)` on the `rgb(33,33,33)` elevated plate, **2.72:1** — under even the 3:1 faint floor. Light was 4.06:1 (`rgb(125,126,128)` on white), under §15's 4.5:1 rule. Both tokens now carry full alpha at one shared quietness (light `#6b6d70`, dark 50% white) and the fade ends at `opacity: 1`. Re-measured on the same frame: light `rgb(108,109,112)` on white **5.17:1**, dark `rgb(144,144,144)` on `rgb(33,33,33)` **5.04:1**; the DOM read agrees (computed ratio 5.19 light / 5.07 dark, chain opacity 1.0 in both). The thread composer is the second state the token serves, and it measures identically (probe68, seeded transcript: 5.19:1 light on `rgb(255,255,255)`, 5.04:1 dark on the same elevated plate) — the token has one visible consumer in both states. No other surface moved: `composer-usage-label` and the placeholder of every field still use their own tokens |
| `git apply --check` of this diff against PI-UI-1115's working tree | applies cleanly |

The before side of every rail and checklist pair is the candidate build with the
pre-change declarations injected over the same DOM, so both sides share one fixture,
one viewport and one render path:

```css
.session-activity-rail > .session-activity-group { background: transparent; box-shadow: none; border-radius: 0; }
.session-activity-disclosure.btn { color: var(--ds-text-muted); }
.session-activity-group-count { min-width: 0; padding: 0; background: transparent; font-size: var(--text-sm); color: var(--ds-text-muted); }
```

The placeholder before side uses the same trick, scoped to the one element and keyed by
theme so the before frame differs from the after frame only in the change under test:

```css
:root[data-theme="light"] { --ds-placeholder-ink: #4a4c4f; }
:root[data-theme="dark"]  { --ds-placeholder-ink: color-mix(in oklab, #fff 42%, transparent); }
.composer-placeholder { opacity: 0.72 !important; animation: none !important; }
```

The installed `/Applications/Pi-Desktop-Plus.app` is v0.15.19 and predates this pass
(`grep` for `session-activity-goal-row)` in its bundle finds nothing), so it cannot
serve as an after frame; it was used only to confirm the shipped baseline.

NOT RUN: hosted CI and hosted candidate E2E (nothing pushed), `pnpm lint` and any
pnpm task (not run inside an overlay worktree; the underlying node scripts ran
instead), `verify:ui:*` (only on request), live-model E2E (no API key), Windows and
Linux rendering. Biome does not process CSS in this repository.

No test was added: the change is styling, the token guards and E2E-078 already
cover it, and a new CSS regex pin would count as a new assertion in the
`check-test-quality` ratchet. The placeholder fade keeps its existing pin
(`composer-placeholder-context.test.mjs:104-106` asserts the animation, the keyframes
and the native input's `opacity: 0 !important`), and the whole renderer suite was run
rather than only the styling files, so the token retune is covered by the shipped guard
and not by a new one. Residual risk is visual: the plate rule relies on
`:has()` (Chromium in Electron supports it) and was reviewed only in the frames above
and the fixtures in this record. Two further limits: the rail plate is judged on
transcript-loaded fixtures only, so a very long rail is unmeasured, and the pixel diff
proves *that* the checklist surface changed, not that every surrounding surface reads
as intended on a real display. The contrast fixes are colour changes, so their residual risk
is only how loud the new ink reads: the count now sits one step closer to the row
label, and the empty composer hint is a little more present than before. Both crop
sheets show the hierarchy still holding (the label leads the count; the hint stays
quieter than a typed draft, 5.19:1 against the draft's 17.08:1), and every sampled
ratio above is a pixel measurement from a rendered frame, not token arithmetic.

## Remaining work

- The user's word to commit, push, open the PR and merge.
- Merge order with PI-UI-1115: it edits status-colour lines of
  `session-activity-rail.css` (51 to 54, 63, 119, 132 to 133) while this pass edits
  the head of the file (7 to 26) and the reduced-motion block near line 97; `git
  apply --check` of this diff onto its working tree passes, so either order works.
  The second to land should re-run `check-style-tokens` and E2E-078.
- The user's veto items: the plate (D3), primary-ink titles (D2). The tonal
  onboarding checklist (D5) is dropped (shipped by PI-UI-1117), so it is no longer
  a veto item here. The tool-count ink (D9) needs no veto: it restores a
  measured floor and changes no hierarchy, so dropping it is a one-line revert rather
  than a design choice.
- The placeholders (D10) are the one change of this pass that a reader can see on an
  untouched home screen, so they are also the easiest to judge: the empty composer hint
  is now the same quietness in both themes instead of two. If it reads too loud, the
  revert is four lines (two `--ds-placeholder-ink` values, the base `opacity` and the
  keyframe endpoint); nothing else depends on the value.
- Known visual notes, deliberately not changed here: the ~135px empty band between
  the checklist and the composer on a tall window (D8), and the rail's plate only
  covering a group that is open *and* holds rows, so an all-empty rail stays flat.

## Runtime resources

Every inspection ran a separate probe process against a fresh temporary
`PI_DESKTOP_DATA_DIR` and `HOME`, on CDP port 9477, using the checkbox's built
`apps/desktop/out` and the primary checkout's debug `pi-desktop-host-core`. Each
probe exits when its scenario ends and the temporary data directory is discarded. Two
processes from earlier runs of this pass outlived their scenarios — a capture app and
the CDP-9333 review session — and both were stopped; `ps` now finds no process from
this worktree and nothing listens on 9333 or 9477. The driver and the scenario files
live outside the repository in `$TMPDIR/pi-ui-shots/`. The worktree stays for review.
