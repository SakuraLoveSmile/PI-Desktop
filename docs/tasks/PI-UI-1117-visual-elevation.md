# PI-UI-1117: Visible surface pass — transcript rhythm, one composer card, grouped settings

- Project: `fork-pi-desktop`; task ID: `PI-UI-1117`; tier: T1; status: 待体验
  (built and verified locally on the request branch; nothing committed or pushed).
- Created: 2026-11-16 (Asia/Taipei).
- Authoritative record: this file.
- Goal / authorization: the session goal `我需要你优化一下这个软件的 UI 界面，目标是做到美观`
  (optimize the software's UI; make it beautiful). Prior passes (PI-UI-1114/1115/1116)
  repaired token integrity and contrast but changed few pixels, and the user reported
  seeing no concrete UI optimization. This pass changes surfaces a user sees on every
  session. Commit, push, PR, merge and release each wait for the user's explicit word.
- Baseline: `ca5bfe9acbf71302893bd262c99ae9190892e5d4` (`origin/main`, v0.15.19).
- Branch: `feat/20261116-pi-ui-1117-visual-elevation`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261116-feat-pi-ui-1117-visual-elevation`.

## Problem statement (measured on the baseline build, 1280×832 @2x)

- **The transcript reads as scattered islands.** Every `.message-row` reserved a
  26px invisible band under its bubble for the hover action toolbar
  (`.message-actions` `min-height: 24px` + `padding-top: 2px`, in flow), on top of
  row padding. Measured: user row 96px tall for a 42px bubble; ~56px of mostly
  invisible air between consecutive bubbles.
- **The composer reads as two stacked plates.** `.composer-top-strip` was 32px
  narrower than the shell (`margin: 0 16px -12px`), carried its own elevated fill
  and squared bottom, and tucked under the shell: a detached tab in dark, floating
  labels in light (70% white on a white page).
- **Settings is a wall of identical bars.** D296 dissolved row-stack panels into
  one tile per row with 6px gaps: every row the same gray plate, same height, no
  grouping, no rhythm.
- **The home onboarding checklist is an outline on nothing.** Its Tailwind fill
  (`bg-bg-elevated-opaque`) equals the page colour in light, so the 1px
  `border-subtle` stroke was the only thing separating it (same finding as
  PI-UI-1116 D5, unmerged).

## Scope

Renderer styles and specs only. No TS/TSX, Host, IPC, contract, i18n or
accessibility-name change.

1. `messages.css` + `chat-shell.css`: between consecutive rows the hover action
   band paints into the gap instead of reserving layout height; assistant top
   padding 6→12px so the 24px band fits the 24px inter-row gap exactly;
   `overflow-clip-margin` 8→16px so paint containment does not clip the band.
   The last row of a turn keeps its band in flow
   (`.message-row:not(:has(+ .message-row))`), because the runtime status lane
   or a decision card follows it — `e2e-transcript-render` pins that 52px wait
   gap and the status/action non-overlap, and the first absolute-only attempt
   failed exactly those six checks.
2. `composer.css`: the workspace strip becomes the header band of one card —
   full shell width, a 4% ink tonal step over `--ds-bg-composer`, inset hairline
   paint (box-shadow) instead of a border so it adds no geometry, and the shell
   clears its top stroke and top radius when the strip is present.
3. `settings.css`: row-stack panels keep one `--ds-tile` plate; rows sit flat
   inside (`padding: 12px 16px`), consecutive rows divided by an inset
   `--ds-border-subtle` hairline, first/last row carry the plate corners.
4. `chat-shell.css`: the onboarding checklist clears its stroke colour and fills
   with `--ds-tile`, geometry unchanged.
5. Specs: `docs/spec/04-ux/07-ui-design-system.md`, `08-component-spec.md` and
   zh-CN mirrors — the workspace-strip row amended inline plus a dated
   `PI-UI-1117` supersession block in all four files.

Out of scope: new tokens or hues (monochrome contract kept); the sidebar, work
panel, plugins index (keeps D296), transcript prose width, the home dead band
(pinned by `home-empty-layout.test.mjs`), Windows/Linux rendering.

## Frozen decisions

- D1: monochrome and token-only. Every new fill is a `color-mix` of existing
  tokens; no literal, no accent hue, no gradient.
- D2: the action band stays hidden by default and revealed on hover/focus; only
  its layout reservation is removed. Measured after: band height 24px, overlap
  with the next bubble 0px (user→assistant) or −2px (assistant→user) across all
  five row pairs of the seeded transcript.
- D3: the strip adds no geometry: outline is inset `box-shadow` paint, vertical
  padding and the −12px tuck unchanged, so pinned composer/footer rects survive.
- D4: `:where(.settings-row)` in the two row overrides keeps the base
  `.settings-row {` rule the first literal match in the sheet, so
  `default-model-picker.test.mjs`'s shared-geometry pin keeps reading the base
  rule without touching the test.
- D5: the settings hairline partitions rows *inside one card*; D297's stroke-free
  rule for page-level surfaces still holds. Supersedes D296 for row-stack panels
  only; recorded in the spec block.
- D6: no test assertion was added, expanded or reset. The first attempt expanded
  the `transcript-style` density regex and `check-test-quality` rejected it; the
  expansion was reverted and the CSS was fitted to the existing pin instead
  (24px band inside the pinned `padding: 12px 0` rhythm).
- D7: considered and rejected — saturated accent palette / gradients (the design
  system's non-goals and monochrome contract forbid them); sidebar tone change
  (native vibrancy owns it); raising the home stack (pinned layout contract).

## Acceptance scenarios

1. Seeded transcript, both themes: turns read as one continuous flow; no invisible
   band; hover/focus reveals the action row inside the inter-row gap without
   touching the next bubble.
2. Composer, both themes, home and docked: one card with a tonal header band
   holding project/location/branch; strip and shell share width and silhouette.
3. Settings general, both themes: one grouped plate per section, quiet inset
   hairlines, controls right-aligned; scrolling still works.
4. Home empty state, both themes: checklist is a tonal plate with no outline;
   rows unmoved.
5. Contributed themes: E2E-078 still passes (the strip fill derives from
   `--ds-bg-composer`, so a theme moves it).

## Behavior changes

Visual only. Disclosure/hover/focus semantics, accessible names, routes and
strings unchanged. The action toolbar is now reachable in the same gap it always
visually occupied; keyboard focus still reveals it (`:focus-within`).

## Code revision and validation

Frames live outside the repository: `/tmp/pi-ui-1117/base` (baseline build),
`after`, `after2`, `after3`, `final`, `final2` (candidate builds), `hover`
(focus-revealed band, light), `darksettings` (true dark settings), `final3`
(fair same-state before/after pairs). Driver:
`/tmp/pi-ui-1117/probe.mjs` (CDP 9488, fresh temporary
`PI_DESKTOP_DATA_DIR`/`HOME` per run, primary checkout's debug host binary).
Labelled comparison sheets: `/tmp/pi-ui-1117/sheet-light.png`,
`sheet-dark.png` (chat / home / settings, both themes).

The before side of each `final3` pair is the candidate build with the
pre-change declarations injected over the same DOM, fixture, viewport and
render path, so both sides differ only in the change under test:

```css
.message-actions { position: static !important; padding-top: 2px !important; }
.message-row.assistant { padding-top: 6px !important; }
.message-row { overflow-clip-margin: 8px !important; }
.composer-top-strip { margin: 0 16px -12px !important; background: var(--ds-bg-elevated) !important; box-shadow: none !important; }
.composer-stack:has(> .composer-top-strip) > .composer-shell { border-top-color: var(--ds-border-subtle) !important; border-radius: var(--radius-lg) !important; }
.home-onboarding-checklist { border-color: var(--ds-border-subtle) !important; background: var(--ds-bg-elevated-opaque) !important; }
```

The settings pairs use real baseline frames (`base/settings-light.png`,
`base/settings-dark.png`) against candidate frames, same fixture and viewport.

| Check | Result |
| --- | --- |
| `npx electron-vite build` (apps/desktop) | pass, final rebuild 8.26s |
| `node scripts/check-style-tokens.mjs` | pass, `style tokens OK` |
| `node --test test/transcript-style.test.mjs test/default-model-picker.test.mjs test/settings-general.test.mjs` | 54/54 pass |
| `node scripts/check-test-quality.mjs` | pass after D6 revert (no test diff vs HEAD) |
| E2E-078 `e2e-theme-surfaces` | pass, `ok: true`, 6/6 scenes, `failures: []` (light/dark × built-in/contributed) |
| `docs/scripts/check-locales.mjs` / `check-docs.mjs` | pass, 95 EN/zh pairs, 647 pages |
| `node scripts/generate-scenario-index.mjs --check` | current, 138 suites / 168 ids |
| `node scripts/check-agent-policy.mjs` | pass, 15/15 anchors |
| Action band geometry (hover probe, light) | band 24px; overlap with next bubble 0 / −2px on all five pairs |
| Full renderer suite on the final build | 4415 pass, 0 fail, 4 skipped (platform-gated), 82.7s |
| `e2e-transcript-render` on the final build | exit 0, no `ok:false` in any scene (after the last-row flow fix) |
| `e2e-settings-scroll` on the final build | exit 0, 18 destinations at 1440×780 and 720×500 |
| E2E-078 re-run on the final build | `ok: true`, 6/6 scenes, 0 failures |
| `check-test-quality` / `check-locales` / `check-docs` on the final source | exit 0 / 95 pairs / 648 pages |

NOT RUN: hosted CI and hosted candidate E2E (nothing pushed), `verify:ui:*`
(only on request), live-model E2E (no API key), Windows/Linux rendering,
packaged-app review (cloud-only packaging).

Known pre-existing notes, not introduced here: with the app theme dark and the
macOS system appearance light, the probe's renderer-only `setThemeAttr` leaves
native vibrancy on the light material (gray sidebar under white ink); the real
app drives vibrancy from the same theme state
(`electron/main/bootstrap/app-lifecycle.ts:517-538`), so this is a capture
artifact, not a product defect. The home dead band above the composer on tall
windows remains (pinned).

## Remaining work

- The user's word to commit, push, open the PR and merge.
- Veto items: the grouped settings card (D5), the unified composer card (D3),
  the continuous transcript rhythm (D2). Each is a small, isolated revert.