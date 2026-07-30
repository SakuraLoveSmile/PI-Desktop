# 01. MVP Milestones

## Version slices

### M0 — Spec Freeze
- [x] Product positioning
- [x] Electron route
- [x] Rust host core route
- [x] English-first globalization route
- [x] Plugin system architecture
- [x] Private GitHub repository initialized

### M1 — App Skeleton
Status: **Implemented (MVP)**

Goal: bootable desktop shell with dual backend skeletons.

Deliverables:
- pnpm monorepo
- Electron app (main/preload/renderer)
- English locale source pack
- Rust `host-core` crate skeleton + healthcheck
- Node agent-runtime package skeleton
- IPC healthcheck end-to-end
- reserved PluginManager/CommandPalette interfaces

Exit criteria:
- `pnpm dev` opens window in English
- Electron can call Rust host healthcheck
- protocol/version handshake visible in logs

### M2 — Pi Chat Runtime
Status: **Implemented (MVP)**

Goal: real streaming chat.

Deliverables:
- pi runtime integration
- provider/model settings
- secret storage
- prompt/abort
- stream event UI
- session persistence baseline

Exit criteria:
- configure key and chat successfully
- streamed tokens visible
- history survives restart

### M3 — Workspace Tools
Status: **Implemented (MVP)**

Goal: controlled local agency.

Deliverables:
- project open
- Read/Glob/Grep/Write/Edit/Bash via Rust host
- permission cards
- tool traces

Exit criteria:
- complete one approved local modification on a real project
- denied permission path is correct

### M4 — Plugin Foundation
Status: **Implemented (MVP)**

Goal: user-installable local extension system.

Deliverables:
- PluginManager
- manifest validation
- local/dev plugin load
- command palette plugin commands
- sample plugin e2e
- permission declaration UI

Exit criteria:
- load example plugin
- run plugin command
- register low-risk agent tool
- disable removes contributions

### M5 — Desktop Hardening
Status: **In Progress**

Goal: daily-usable package.

Deliverables:
- packaging (macOS arm64, Windows x64, and Linux x64 tag artifacts; D126)
- settings polish
- logging/error boundaries
- session management basics
- isolation verification

Progress:
- [x] packaging scaffold (electron-builder macOS arm64 `--dir`, host/sidecar resources)
- [x] substantial settings/session/UI polish on main
- [x] code signing lanes (unsigned local default; Developer ID + hardened
  runtime + entitlements injected by `scripts/release-macos.sh`, D078)
- [x] custom app icon (generated pi mark → `build/icon.icns`, D079)
- [x] isolation/logging hardening (renderer sandbox D081, NDJSON log
  channels D082, crash supervision D080, window state D083)
- [x] packaged macOS update discovery, fixed release link, typed update state,
  and tag-workflow feed assets (manual delivery, D120 / ADR 0022)
- [ ] full DMG + notarization — runbook ready
  ([06-release-runbook](06-release-runbook.md)); blocked only on Apple
  Developer credentials (operational, not code)

### M6 — Plan Operating State
Status: **In Progress (spec freeze; implementation not complete)**

Goal: replace the former Chat operating profile with a host-authoritative Plan
state on the same pi Agent, including a separate approval boundary.

Deliverables:
- Agent | Plan selector with Agent as the default
- persisted session/settings/scheduled `chat` → `plan` migration
- protocol v7 and schema v8 with durable plan approvals
- Rust-owned mode resolution, Plan tool policy, Bash permission behavior, and
  atomic Plan → Agent approval transition
- one-Agent `EnterPlanMode` / `ExitPlanMode` lifecycle with request-changes
  feedback and fail-closed recovery
- Plan approval IPC/RPC/events, renderer projection, approval UX, and EN/zh-CN
  copy
- plugin denial, scheduled/unattended policy, and focused unit/integration
  verification documented in the E2E plan

Exit criteria:
- only one pi Agent is used before, during, and after planning
- Plan denies Write/Edit/plugin tools but exposes Bash under the selected
  permission mode, including Auto's explicit mutation tradeoff
- approval is separate from generic tool permission and atomically selects the
  Agent permission mode
- reject, timeout, abort, crash, stale response, and persistence failure leave
  the session in Plan without execution capability
- all M6 scenarios are documented; E2E execution remains opt-in

### M6+ (Post-MVP)
- Skills depth
- MCP
- `.piplug` packaging UX polish
- marketplace preview
- Windows/Linux hardening
- additional locales beyond the shipped zh-CN catalog

## Release constraint

Tag releases publish **macOS arm64, Windows x64, and Linux x64** artifacts
(D126 lifts the original D010 macOS-only constraint).

## Rough effort (solo)

| Milestone | Estimate |
|---|---|
| M0 | done |
| M1 | 1-2 days |
| M2 | 2-4 days |
| M3 | 3-5 days |
| M4 | 3-5 days |
| M5 | 2-4 days |
