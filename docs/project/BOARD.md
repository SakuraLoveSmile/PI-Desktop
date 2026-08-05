# PI-Desktop Project Board

GitHub Projects requires additional token scopes (`project`).
Until that is enabled, track delivery with:

- GitHub Issues
- Milestones
- this board document

## Columns

| Column | Meaning |
|---|---|
| Backlog | Logged, not started |
| Ready | Ready to implement |
| In Progress | Active work |
| Review | Waiting validation |
| Done | Completed |

## Status snapshot (2026-08-05)

| Milestone | GitHub | Local status |
|---|---|---|
| M0 Spec Freeze | [closed](https://github.com/vastsa/PI-Desktop/milestone/1) | Done |
| M1 App Skeleton | [closed](https://github.com/vastsa/PI-Desktop/milestone/2) | Done |
| M2 Pi Chat Runtime | [closed](https://github.com/vastsa/PI-Desktop/milestone/3) | Done |
| M3 Workspace Tools | [closed](https://github.com/vastsa/PI-Desktop/milestone/4) | Done |
| M4 Plugin Foundation | [closed](https://github.com/vastsa/PI-Desktop/milestone/5) | Done |
| M5 Desktop Hardening | [open](https://github.com/vastsa/PI-Desktop/milestone/6) | Done except notarization (credential-gated) |
| M6 Plan Operating State | planned | Complete (2026-08-05) |

Open issue:
- [#6 M5: Packaging and desktop hardening](https://github.com/vastsa/PI-Desktop/issues/6)

## Swimlanes

### Done
- M0 Spec Freeze
- English-first policy
- Rust host-core architecture decision
- Private repo initialization
- UX design system spec (07/08/09)
- AI development workflow spec (03)
- E2E test plan spec (04)
- Change checklist spec (05)
- AGENTS.md agent instruction file
- M1 App Skeleton (pnpm monorepo, Electron, host-core health, i18n)
- M2 Pi Chat Runtime (provider/secrets, streaming chat, session persistence)
- M3 Workspace Tools (Read/Glob/Grep/Write/Edit/Bash, permissions, path sandbox)
- M4 Plugin Foundation (dev load, command palette, plugin tool registration)
- M5 packaging: unsigned DMG builds locally (`PI-Desktop-0.1.0-arm64.dmg`)
  with custom icon, host binary + sidecar resources; signed/notarized lane
  scripted (`scripts/release-macos.sh`, D078)
- M5 hardening: renderer sandbox + prod CSP (D081), NDJSON log channels
  with redaction/rotation (D082), crash supervision + degradation UI
  (D080), window state persistence (D083), app icon (D079)
- Cross-platform shell readiness: native macOS application menu plus
  menu-free Windows/Linux frameless titlebars, window controls, and
  native-runner package configurations (D118/D129)
- Transcript storage v7: per-session JSONL files under `sessions/` with
  SQLite reduced to an index (FTS/list/badges), append-only revisions file,
  pre-v7 databases archived via breaking reset (D119)
- Conversation branching: protocol-v5 host snapshot creates an independent
  session from an idle conversation while preserving workspace/runtime
  configuration and remapping transcript identifiers (D122 / ADR 0023)
- Application update delivery: Main-owned fixed feed, packaged macOS discovery
  and manual release link, typed renderer state, and Windows NSIS/Linux
  AppImage in-app delivery lanes (D120 / ADR 0022, published by D126)
- Spec corpus 0.4.7: English-first everywhere (translated runtime/plugins/
  ADR docs), error-code registry unified to shared/errors.ts, e2e statuses
  synced to real automation, decisions-log restructured (A–I) with
  supersession chains, acceptance criteria evidence-tagged
- Codex visual parity pass (D034–D072 series; capture suite)
- M6 Plan operating state implementation: one-Agent Agent/Plan transitions,
  immutable `.pi/plan/*.md` checkpoints, approve/reject with explicit
  Ask-defaulted permission selection, restart interruption without replay,
  scheduled Plan rejection, selectable shell identity/stream/timeout/abort
  handling, and English/Simplified Chinese renderer coverage
  (E2E-104–E2E-117)

### In Progress
- Codex visual gold polish (ongoing capture-driven iteration)
- Composer slash commands + @ file references wired to pi prompt templates
  (D123–D125 / ADR 0024)

### Blocked (external)
- Full DMG notarization — needs Apple Developer credentials; runbook ready
  ([06-release-runbook](../spec/06-delivery/06-release-runbook.md))

### Backlog
- Playwright automated desktop e2e (UI-driven journeys)
- Marketplace
- Windows/Linux release qualification (native CI, signing, upgrade tests)
- Skills depth / MCP / additional locales (post-MVP)

## Validation snapshot (2026-08-05 — M6 Plan acceptance)

- `cargo test -p host-core --locked` — 139/139 passed; 15 focused DB tests passed
- `pnpm --filter @pi-desktop/desktop test` — 353 passed, one
  platform-conditional skip
- `pnpm --filter @pi-desktop/agent-runtime test` — 97 passed
- `pnpm --filter @pi-desktop/shared test` — 114 passed after building `dist`
  (57 source cases executed in source and built form)
- `pnpm --filter @pi-desktop/i18n test` — 7 passed
- `pnpm build:js`, `pnpm typecheck`, `pnpm lint`, and
  `cargo fmt --all -- --check` — passed
- `PI_DESKTOP_E2E_LONG_TIMEOUT=1 pnpm test:e2e:plan` — 13 passed; the two
  public-RPC fixture skips have direct deterministic Rust coverage
- `pnpm test:e2e:plan-ui` — default no-key run 5/5 passed at 1280×800 and
  900×700 with the live case explicitly skipped; the optional env-gated live
  case requires an OpenAI-compatible provider. The authorized run with model
  `gpt-5.6-luna` passed 6/6 with zero console diagnostics: real Composer/Send,
  live `EnterPlanMode` → `SubmitPlan`, rendered Ask approval through
  preload/Main, exact durable marker after approval, private WeakMap proof of
  the same `DesktopAgentRuntime` object before/after approval, and stable
  Main/Host/sidecar PIDs; credentials never entered CDP or output
- `pnpm test:e2e` — 20/20 passed with credentials; no skips
- `pnpm test:e2e:boot` and `pnpm test:e2e:supervision` — passed on Windows

## Upgrade to GitHub Projects later

```bash
gh auth refresh -s read:project,project
gh project create --owner vastsa --title "PI-Desktop Roadmap"
```
