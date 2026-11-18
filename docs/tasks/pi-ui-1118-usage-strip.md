# PI-UI-1118: composer usage strip and context composition popover

Status: 已验收 (user confirmed the rendered effect on 2026-11-18). Project: `fork-pi-desktop`. Created: 2026-11-18, Asia/Taipei.
Tier: T2 (new read-only RPC + IPC channel). Branch:
`feat/20261118-pi-ui-1118-usage-strip`. Merge and release tracked separately.

## Request

Rebuild the read-out below the composer input card after two reference frames:
a centered three-group strip (`rounds/steps · tok/s`, `session tokens · cache
hit`, `ring + Used/Remaining %`), and a context popover whose header reads
`Context used N%` with `~used / window` above a segmented occupancy bar and a
three-row legend (system prompt, tool definitions, conversation).

User decisions: session-cumulative figures; keep the weakened direction label;
authorize chromatic data visualization (chrome stays monochrome).

## Behavior change

- New host aggregation `session.usageTotals` (see
  [ADR](../adr/session-usage-totals-owner.md)); the renderer no longer derives
  session totals from the loaded transcript page.
- The footer meter becomes a ring; the popover gains a composition bar + legend
  and falls back to the single-fill bar without diagnostics.
- Context-insights category swatches and the popover share one `--ds-viz-*` ramp.
- The unavailable placeholder uses the same empty ring, so the home screen and a
  live session speak one meter language.
- Each cumulative group is a labelled `role="group"`; when the host total is
  unavailable it announces "session usage unavailable" instead of fabricated
  zeros, and the visible figure is an em dash.
- E2E harnesses were moved to the ring DOM: `scripts/e2e-theme-surfaces.mjs`
  fixture, `scripts/e2e/theme-surfaces.js` critical-ink probe (arc now paints with
  `--ds-error-ink`, not a `--ds-danger` fill), and
  `scripts/e2e/session-activity-integration.tsx` arc/centering/group assertions.
- All existing popover content (turn total, speed, provider detail, tools,
  dashboard entry, compaction record and action) is preserved.

## Evidence

| Check | Result |
| --- | --- |
| `cargo test -p host-core` (full) | 1298 passed, 0 failed, 1 ignored |
| `cargo test -p host-core sessions::usage` | 6 passed (2 new: turn summing + legacy/unbilled rows) |
| `pnpm typecheck` | pass |
| `node scripts/check-test-quality.mjs` | pass after retiring 2 bar assertions (21 → 19, reduction only) |
| `node --test apps/desktop/test/*.test.mjs` | 4433 tests, 4429 pass, 0 fail, 4 skipped (final state) |
| desktop `pnpm lint` (style tokens) | pass (`style tokens OK`) |
| `pnpm test:e2e:theme-surfaces` | pass on real Electron, both themes, `failures: []`; the critical ring arc paints `--ds-error-ink` (light `rgb(173,36,33)`) |
| `pnpm test:e2e:session-activity` | 5/5 passed (isolated Host, no provider calls) |
| `pnpm test:e2e:transcript` | pass on real Electron; includes the updated strip probes: ring arc ↔ reported tokens, strip centered below the input, two cumulative groups beside the meter, percentage/progressbar agreement |
| `pnpm test:e2e:context-insights` | 34/34 passed against the candidate host binary (built from this worktree via the shared cargo cache) |
| host-core `rpc::tests::usage_totals_rpc_…` | pass — RPC producer/consumer contract: empty session, recorded ledger, invalid params |
| Manual dark/light + narrow-container review | **Partial** — dark and light were reviewed on a static fixture that renders the real components through Vite SSR against the real stylesheets (`/tmp/pi-usage-preview.html`, `-light.html`). This proves ink, spacing, segment hues and ring geometry, but it is **not** an app run: native-surface occlusion, popover placement and live updates remain unverified. |

## Drift fixed in this change

`docs/zh-CN/spec/06-delivery/04-e2e-test-plan.md` E2E-250 still described the
pre-2026-10-20 default (Remaining) while the English plan specified Used. The
mirror now matches the English contract.

`docs/spec/04-ux/09-interaction-patterns.md` was checked and needs no edit: its
inspector statements cover the abort/throughput path and the muted compaction
line, both unchanged by this work.

## Risks

- Cumulative figures depend on the outbox; the IPC handler flushes before reading.
- Legend estimates can trail the newest usage tick by one request; widths are
  scaled onto the provider-reported occupancy so the headline stays authoritative.
- A new blue hue enters the palette by explicit user authorization; chrome remains
  monochrome to bound the visual impact.