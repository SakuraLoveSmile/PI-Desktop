# PI-Desktop Baseline Freeze

- Baseline Version: `0.4.12`
- Date: `2026-07-28`
- Status: `Frozen for implementation details (icon-free composer prompt row + turn-boundary context checkpoint compaction + session-scoped work panel + pi-owned model metadata + provider/runtime safety + M5 hardening + settings IA + project archive + sidebar organization + app update delivery + three-platform release)`
- Language policy: **English-first**
- Backend policy: **Rust host core + pi agent sidecar**

> Version history: `0.3.4` froze provider/runtime-safety decisions
> (D001–D033). `0.4.0` absorbs the Codex visual-parity decision series
> (D034+, gold source = decisions-log §D) and the M5 hardening decisions
> (D078–D083: signing lanes, brand icon, supervision, renderer sandbox,
> log channels, window state). `0.4.1` freezes the compact four-destination
> settings directory from D090 / ADR 0013. `0.4.2` replaces the frozen 720px
> settings content cap with the window-responsive D092 / ADR 0015 layout.
> `0.4.3` adopts retained multi-project sidebar tabs, non-destructive
> project/session organization, and session-rooted tool isolation through
> D093 / ADR 0016. `0.4.4` removes the passive composer context rail through
> D095. `0.4.5` freezes end-to-end thinking levels and provider presets through
> D096/D102 and ADR 0018. `0.4.6` supersedes D020's blanket deferral with the
> packaged application update modes in D120 / ADR 0022 while preserving D010.
> `0.4.7` lifts D010's macOS-only release scope through D126: tag builds
> publish installers and electron-updater feeds for macOS arm64, Windows x64,
> and Linux x64.
> `0.4.8` moves the durable Projects index out of the home sidebar and into
> Settings as the fifth **Project archive** destination through D133 / ADR 0026.
> `0.4.9` makes the pinned pi-ai catalog authoritative for known-model
> metadata and removes desktop-owned model parameter overrides through D136 /
> ADR 0027.
> `0.4.10` replaces destructive work-panel clearing on conversation switches
> with runtime session-scoped contexts through D142 / ADR 0028.
> `0.4.11` adopts turn-boundary model-context checkpoint compaction through
> D158 / ADR 0030 while preserving the complete visible transcript. The
> context-recovery amendment in ADR 0049 adds a durable retained-tail
> fallback for automatic compaction failures.
> `0.4.12` standardizes home and thread-docked composer prompt rows without a
> leading brand mark through D160 / ADR 0031 while preserving shell branding
> elsewhere.

## Frozen Decisions

1. Product name: **PI-Desktop**
2. Desktop shell: **Electron**
3. UI: **React + TypeScript + Vite + Tailwind**
4. UI language default: **English**
5. Docs / issues / commits language: **English primary**
6. Agent engine: **pi (`pi-ai` + `pi-agent-core`)**
7. Backend host core: **Rust**
8. Agent loop location: **Node/TypeScript pi sidecar** (not renderer)
9. Electron main role: **thin orchestrator**
10. Bridge: **preload IPC only for renderer**
11. Host services transport: **Rust sidecar + stdio JSON-RPC (NDJSON)**
12. Storage ownership: **Rust host-core owns SQLite exclusively**
13. MVP domain: **local coding agent**
14. Default mode: **Agent**
15. Chat mode tools: **read-only** (`Read` / `Glob` / `Grep`)
16. MVP Agent tools: **Read / Glob / Grep / Write / Edit / Bash**
17. Permission timeout: **120s → deny**
18. Session grant scope: **by toolName**
19. `~/.pi` auto-import: **not in MVP**
20. Not in MVP: **Gateway / remote WebUI control**
21. Extension model: **user-installable plugin system**
22. Plugin first phase: **commands / panel / agentTools / skills**
23. Plugin runtime target: **separate process**; M4 may use host-managed sandboxed runtime
24. Plugin market: **protocol defined, implementation postponed**
25. Plugin package format: **`.piplug` (zip)**
26. Plugin trust first step: **sha256 checksum; signature later**
27. First release platform: **macOS arm64 only** — lifted in `0.4.7`/D126;
    tag builds now publish all three desktop platforms
28. TS schema library: **typebox**
29. i18n library: **i18next**
30. Bash in M3: **non-interactive only**
31. Onboarding: **inline checklist**
32. Observability MVP: **local logs only**
33. Error model: **shared AppError code registry**
34. Provider coverage: **universal via pi-ai native + OpenAI-compatible + custom**
35. Model policy: **no closed allowlist; refreshable catalog + free-form model IDs**
36. Provider storage: **Rust SQLite configs + OS secret store references**
37. Secrets backend: **safeStorage primary + encrypted file fallback**
38. Workspace ignore: **denylist + defaults + `.pi-desktopignore`**
39. Tool result limits: **256KB / 4000 lines with truncation markers**
40. Settings directory: **Basics / Model configuration / Import / Project archive / Info**;
    the project archive owns durable project discovery, archive, restore, and
    reopen workflows;
    plugin management remains the app shell's independent **Plugins** destination
41. Sidebar organization: **retained multi-project tabs with renderer-local
    project/session pin, archive, collapse, and sort metadata**
42. Project activation: **one visible host workspace via existing
    `project.set`; tool roots remain bound to the originating session project**
43. Context management: **pi-native checkpoint summaries with PI-Desktop-owned
    per-`turn_end` soft guidance, deterministic pre-request hard guards,
    durable host checkpoints, and one overflow retry**

## Source of Truth

- Spec index: `docs/spec/README.md`
- Navigation: `docs/spec/NAV.md`
- Decisions log: `docs/spec/08-meta/decisions-log.md`
- ADRs: `docs/adr/`
- Example plugin: `examples/plugins/hello`

## Next Action

Start **M1** against these frozen details:

1. pnpm monorepo + Electron app skeleton
2. Rust host-core crate + handshake/health RPC
3. English i18n source catalog
4. shared protocol types (typebox)
5. reserved plugin interfaces
6. provider settings contracts + model catalog scaffolding
