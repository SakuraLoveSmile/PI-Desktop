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

## Status snapshot (2026-07-25, evening)

| Milestone | GitHub | Local status |
|---|---|---|
| M0 Spec Freeze | [closed](https://github.com/vastsa/PI-Desktop/milestone/1) | Done |
| M1 App Skeleton | [closed](https://github.com/vastsa/PI-Desktop/milestone/2) | Done |
| M2 Pi Chat Runtime | [closed](https://github.com/vastsa/PI-Desktop/milestone/3) | Done |
| M3 Workspace Tools | [closed](https://github.com/vastsa/PI-Desktop/milestone/4) | Done |
| M4 Plugin Foundation | [closed](https://github.com/vastsa/PI-Desktop/milestone/5) | Done |
| M5 Desktop Hardening | [open](https://github.com/vastsa/PI-Desktop/milestone/6) | Done except notarization (credential-gated) |

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

## Validation snapshot (2026-07-25, late evening — post impl-audit fixes)

- `cargo test -p host-core` — pass (11: workspace escape/symlink suite,
  bash pipe-drain, oversized-read refusal, shell module)
- `pnpm --filter @pi-desktop/shared test` — pass (4)
- `pnpm typecheck` — pass (all 5 packages)
- `node scripts/e2e-smoke.mjs` — 14/14 pass without live key incl. new
  E2E-024 plugin tool dispatch (16/16 with live-model lane)
- `node scripts/e2e-electron-boot.mjs` — PASS (sandboxed preload + IPC
  round-trip, dev build AND packaged .app)
- `node scripts/e2e-supervision.mjs` — PASS (host-core SIGKILL →
  supervised restart → healthy RPC)
- `electron-builder --mac --arm64` — DMG built with icon + resources;
  packaged-app boot probe PASS

Impl-audit hardening landed: workspace write-escape closed, bash >64KB
deadlock fixed, sidecar host-proxy allowlist, AGENT_BUSY + turnId +
provider error mapping, D003 default-mode restored, cross-session event
bleed fixed, permission countdown + timeout auto-close, onboarding
checklist UI, palette session-delete + spec-conformant builtins,
plugin agent tools wired to the model (E2E-024), real provider network
test, capture fixtures gated. Plugin marketplace browse/install, .piplug package install, isolated
plugin panels, auto-update policy, and gated high-risk plugin APIs are
implemented. Official source is the dedicated repo vastsa/pi-desktop-plugins. Remaining deferred (documented):
full separate-process plugin runtime (ADR 0008 target), model catalog +
native Anthropic/Google adapters (11-provider §5 status), session-
scoped mode (02-agent-runtime §11).

## Upgrade to GitHub Projects later

```bash
gh auth refresh -s read:project,project
gh project create --owner vastsa --title "PI-Desktop Roadmap"
```
