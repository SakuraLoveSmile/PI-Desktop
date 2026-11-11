# Offline UI evidence

This opt-in tool renders production components with existing capture-rig seeds
and fixed API fixtures. It does not start production Electron Main, Rust Host,
a model runtime or a real provider. It is a visual comparison aid, alongside
the existing Host/IPC, keyboard and product E2E checks.

## Environment and authorization

Run from the dedicated request worktree on a desktop OS with the provisioned
project dependencies and Electron. A shell sandbox unable to launch Electron
cannot satisfy capture acceptance. Linux needs a display, such as the project's
existing Xvfb/Openbox runner. Use the same machine, OS, native runtime, fonts and
installed dependencies for both sides; cross-environment comparison is rejected.

The stability plan's D6 requires explicit user authorization for each capture
round. State the command and number of runs first. Only this tool's own hidden
fixture windows are captured. Each run creates HOME/XDG, app-data and Chromium
profile directories, then deletes them on exit. The child inherits only the
existing tool/display allowlist, strips Host/preview flags and receives no API
keys. Chromium uses sandbox/context isolation with no Node integration. Requests
outside the generated bundle and data/blob assets are blocked and fail the run.
Unexpected API calls, page errors, native crashes and missing content also fail.
On macOS, the child uses a volatile `ApplePersistenceIgnoreState` launch argument
to avoid restoring native windows after a crash; no persistent preference is
changed. Chromium's debugger transport fixes viewport/DPR and captures PNGs
directly, avoiding Retina-dependent `capturePage()` scaling or image resizing.

Reuse provisioned `node_modules` links following the development workflow; do
not install another dependency environment or build an installer. Vite and the
production Tailwind plugin compile this worktree's renderer/shared/locale source
into each run's `bundle/`. User data, product builds, `/tmp/codex-screens` and
published documentation images are not used as output.

With a symlinked workspace `node_modules`, pnpm 12 can attempt an automatic
install before running a script and reject the linked hoist directory. In that
environment use the direct Node entry points below, without installing or
replacing shared dependencies. These invoke exactly the package-script code.

## Fixed scene contract

`scenes.json` owns the fixed list and rendering configuration. Revision 1 uses
1440 × 1000 CSS pixels, DPR 1, dark theme, Simplified Chinese, UTC and a fixed
clock. Reduced motion is enabled; finite animations finish, infinite animations
pause at zero, and the caret is hidden for snapshots. Each scene gets a fresh
renderer/session and waits for actual content, loaded fonts and decoded images.
Frame waits synchronize rendering; failed screenshots are not retried.

| ID | Production surface and fixture |
| --- | --- |
| sidebar-states | Sidebar with `seedSidebarStatuses`, four session states |
| chat-transcript | ChatSurface and Composer with `seedTranscript` |
| composer-menu | Real Composer model menu with two offline models |
| team-panel | WorkPanel / TeamPanel with fixed roster and tasks |
| team-work-page | WorkPanel / TeamTaskTab with member transcript |
| goal-progress | Real Goal progress with four milestones and Composer |
| goal-report | WorkPanel / GoalReportTab with fixed structured report |
| work-panel | WorkPanel file viewer with fixed README content |
| settings-home | SettingsPage General with offline storage summary |
| model-provider-settings | SettingsPage provider rows and catalog status |
| plugins | PluginsPage with four `seedPlugins` rows |
| dialog | Real ProviderSetupDialog editing a fixture provider |

Shell containers follow AppShell's layout and platform initialization without
its production bootstrap. The harness checks that scene-specific content is
visible in the viewport. Change fixture inputs deliberately and increment
`fixtureRevision`; recapture both sides when configuration changes.

## Commands

Preparation and tool checks do not launch Electron:

```bash
node scripts/ui-capture/typecheck.mjs
pnpm test:ui-tools
python3 -B -m unittest discover -s scripts/ui-capture -p 'test_*.py'
pnpm verify:ui:capture -- --build-only --output .artifacts/ui/prepare
```

Direct entry points for a worktree reusing linked dependencies:

```bash
node --test scripts/ui-capture/capture.test.mjs
node scripts/ui-capture/capture.mjs --output .artifacts/ui/before
node scripts/ui-capture/capture.mjs --output .artifacts/ui/after
node scripts/ui-capture/compare.mjs --before .artifacts/ui/before --after .artifacts/ui/after --output .artifacts/ui/comparison --assert-identical
```

The two direct capture commands still require the capture round's authorization.

Python must already have Pillow, as required by the existing screenshot
publisher. For comparison, select an already provisioned interpreter with
`PI_UI_PYTHON=/path/to/python3` if system Python lacks Pillow. Nothing is
installed automatically.

After authorization, capture into new directories:

```bash
pnpm verify:ui:capture -- --output .artifacts/ui/before
pnpm verify:ui:capture -- --output .artifacts/ui/after
```

One command produces all before/after/diff panels and a contact sheet:

```bash
pnpm verify:ui:compare -- --before .artifacts/ui/before --after .artifacts/ui/after --output .artifacts/ui/comparison
```

For U1 repeatability acceptance, run capture twice on the same candidate and
add `--assert-identical` to compare. Source identities must match and all twelve
scenes must have zero changed RGBA pixels. There is no tolerance, masking,
missing-scene exemption, retry or automatic baseline replacement. PNG metadata
and compression differences alone do not count as pixel changes.

## Evidence

A successful run writes `manifest.json` with HEAD/base, the dirty-source
fingerprint, configuration, actual native/font/dependency identity and every
image's hash/dimensions. Source changes during capture invalidate it. Failures
retain partial PNGs, `electron.log` and `capture-result.json` where available;
they never write a success manifest.

The comparer rejects incomplete/duplicate scenes, unsafe paths, wrong hashes,
decoded dimensions, configuration or environment mismatches. New output lives
outside both inputs: twelve `*-comparison.png` panels, `contact-sheet.png` and
`report.json` with original manifest hashes, identities and exact pixel counts.
A repeatability failure retains these files and exits nonzero. Inspect full-size
panels for clipping; the contact sheet is only an index.

Keep evidence with the task record and its tested source. A build or tool test
does not establish native capture or repeatability: mark these `NOT RUN` until
executed. This tool does not publish; `scripts/publish-screenshots.py` remains
the separate documentation publisher.
