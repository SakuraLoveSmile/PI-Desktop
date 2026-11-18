# PI-UI-1119: work-panel toggle no longer overlaps conversation actions

Status: 待体验 (code validated; merge tracked separately). Project: `fork-pi-desktop`. Created: 2026-11-19 (Asia/Taipei).
Tier: T1 (user-visible layout fix; no contract, persistence or boundary change).
Branch: `fix/20261119-pi-ui-1119-topbar-toggle-overlap`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261119-fix-pi-ui-1119-topbar-toggle-overlap`.
Merge and release tracked separately.

## Request and source

First slice of the UI optimization batch: adopt upstream
[vastsa/PI-Desktop#2424](https://github.com/vastsa/PI-Desktop/pull/2424)
(`fix(chrome): keep conversation actions clear of the work-panel toggle`,
head `159379dcc1baa39ee3e9f225244f28206fb994ee`, author Linuxdazhao).
Upstream CI was green at intake. The competing fix #2423 (token-lane) was
reviewed and not selected; #2424 follows the pane's real geometry and carries
per-frame E2E evidence.

## Verified problem (R5/R6 intake)

Confirmed in the fork before porting: `apps/desktop/src/styles/chrome.css`
still reserved the toggle with `.ct-right { padding-right: 36px }` and cleared
it instantly via `.ct-work-panel-open`, while the dock width animates from 0.
During the opening first frame / closing last frame the viewport-fixed toggle
overlaps the New Task / Search hit area. Same failure mode as upstream #2421.

## Behavior change

- `.conversation-topbar` becomes `position: fixed` anchored to `.main-pane`
  (`anchor-name: --main-pane`); its right edge is
  `max(anchor(--main-pane right), toggle-right + toggle-size + 8px - padding)`,
  so the action group stays >= 8px clear of the toggle in every animation frame
  and on narrow windows.
- Removes the `workPanelOpen` prop from `ConversationTopbar` and the
  `ct-work-panel-open` class; the topbar no longer tracks panel state.
- New token `--ds-work-panel-toggle-right` (default = inset; win32/linux =
  window-controls-width + inset) owns the toggle's right offset.
- Retires the obsolete `padding-right: 36px`, the win32/linux topbar `right`
  band overrides, and the source assertion pinning the old `right: 0` rule.

## Adaptations to the fork

- Cherry-pick `-x` preserved the author and upstream source line. Conflicts:
  - `topbar-title-rendering.test.mjs`, `scheduled-return.test.mjs`: dropped the
    removed `workPanelOpen` prop, kept fork formatting.
  - `e2e-window-controls.mjs`: added `checkConversationActionSpacing()` and its
    call; kept the fork's `checkWindowsRoundedCorners(label, rounded)` signature
    and label (upstream's `radius` parameter is unrelated drift, not adopted).
  - `topbar-title-inline-rename.test.mjs` (upstream-only): NOT introduced — the
    fork topbar has no inline-rename feature; fork coverage stays in
    `topbar-title-rendering.test.mjs`.
  - `docs/spec/06-delivery/e2e/ui-shell.md` (upstream-only): the fork keeps a
    monolithic E2E plan; ported the scenario additions into
    `E2E-CHROME-window-controls-survive-work-panel` in `04-e2e-test-plan.md`
    and its zh-CN mirror (that mirror section is English-source identical).
- `08-component-spec.md` en auto-merged; zh-CN §2.3 position bullet rewritten
  to the new geometry contract.
- `scripts/test-quality-baseline.json`: lowered `work-panel.test.mjs`
  290 -> 289 assertions (one retired signature) via `--write-baseline`;
  reduction only, no raised ceiling.

## Validation

| Check | Result |
| --- | --- |
| targeted topbar/work-panel/sidebar tests (8 files) | 59 pass, 0 fail |
| `node --test apps/desktop/test/*.test.mjs` (full) | 4433 tests, 4429 pass, 0 fail, 4 skipped |
| desktop `tsc -p tsconfig.json --noEmit` | pass |
| `node scripts/check-style-tokens.mjs` | style tokens OK |
| `node scripts/check-test-quality.mjs` | pass after reduction-only baseline lower |
| docs `check-locales` / `check-docs` | 95 pairs / 652 pages verified |
| `generate-scenario-index.mjs --check` | 138 suites, 168 ids, current |
| `check-agent-policy` / `check-architecture` | pass |
| `electron-vite build` (worktree candidate) | pass |
| `pnpm test:e2e:window-controls` (real Electron) | pass — 12/12 checks, exit 0 (see teardown note) |

Candidate E2E evidence (`/tmp/pi-ui-1119-wc.log`): PASS panel closed; **PASS
conversation actions are reachable throughout both work-panel animations
(807×567 win32 CSS)** — the new per-frame spacing probe, 21 frames each
direction, gap >= 8px and both button edges hit-testable; PASS panel opened /
sidebar toggled / panel maximized / restored / native fullscreen / panel closed
again / settings route / panel reopened; PASS native darwin window-control flow.
`failed=false`, `process.exitCode=0`.

Teardown note: after the final PASS the harness hung in `finally`
(`child.kill()` then `await once(child, "exit")` with no timeout) — the
Electron child did not exit on SIGTERM in this environment. The Electron
process tree was force-killed so node could finish cleanup and exit 0. This is
a pre-existing harness shutdown hang, not an assertion failure and not caused
by this renderer/CSS slice; all assertions had already passed.

Environment: macOS arm64, Node 22.23.2, dependency overlay from the primary
checkout (workspace links retargeted into this worktree; library `dist` built
locally with direct `tsc`). Host binary: primary `target/debug/pi-desktop-host-core`
built from `main`; this slice changes no Rust code, so the candidate host is
behaviorally identical (recorded, not a candidate Rust build).

## Risks and remaining work

- CSS anchor positioning requires Chromium >= 125; the fork ships Electron 43
  (Chromium 136), satisfied. No other fork surface used anchors before this.
- Native Windows/Linux window-control qualification is not claimed; the E2E
  emulates win32/linux renderer CSS on macOS, as upstream did.
- The E2E harness teardown hang (force-killed Electron child) is environmental;
  subsequent UI E2E slices in this batch may need the same teardown handling.