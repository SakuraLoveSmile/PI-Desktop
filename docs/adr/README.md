# Architecture Decision Records

ADRs record decisions that should not silently change.

## Format

Each ADR includes:

- Status
- Context
- Decision
- Consequences
- Alternatives (optional)

## Index

| ID | Title | Status |
|---|---|---|
| 0001 | Use Electron as desktop shell | Accepted |
| 0002 | Use pi Agent Harness as agent engine | Accepted |
| 0003 | Hybrid runtime (historical main-process note) | Superseded in part |
| 0004 | No remote Gateway in MVP | Accepted |
| 0005 | User-installable plugin system | Accepted |
| 0006 | Marketplace postponed after local plugin runtime | Accepted |
| 0007 | Plugin package format `.piplug` (zip) | Accepted |
| 0008 | Plugin runtime isolation target = separate process | Accepted (Target) |
| 0009 | English-first globalization | Accepted |
| 0010 | Rust backend host core | Accepted |
| 0011 | Freeze host RPC, storage ownership, and mode defaults | Accepted |
| 0012 | Universal provider & model coverage | Accepted |
| 0013 | Consolidate settings navigation into four destinations | Superseded in part by 0026 |
| 0014 | Adopt host-owned storage schema v2 | Accepted |
| 0015 | Make settings content responsive to window width | Accepted |
| 0016 | Organize the sidebar around retained multi-project tabs | Accepted |
| 0017 | Remove composer workspace context rail | Accepted |
| 0018 | Carry thinking mode through the complete session pipeline | Accepted |
| 0019 | Work panel subsystems (PTY terminal, embedded browser, git review, file browsing) | Accepted |
| 0020 | Configuration provider studio | Accepted |
| 0021 | Platform application chrome | Superseded in part by 0025 |
| 0022 | Application update delivery | Accepted |
| 0023 | Independent conversation session fork | Accepted |
| 0024 | Composer slash commands and @ file references | Accepted |
| 0025 | Keep application menus out of Windows/Linux windows | Accepted |
| 0026 | Move the Projects index into Settings as an archive | Accepted |
| 0027 | Make pi-ai authoritative for model metadata | Accepted |
| 0028 | Scope work-panel runtime contexts to conversations | Accepted |
| 0029 | Separate native-window and work-panel resize ownership | Superseded in part by 0032 |
| 0030 | Turn-boundary context checkpoint compaction | Accepted |
| 0031 | Keep composer prompt rows free of brand icons | Accepted |
| 0032 | Reserve native width for the docked work panel | Accepted (superseded in part by 0033) |
| 0033 | Internal-dock work panel (no native window expansion) | Accepted |
| 0034 | Merge command palette into global search | Accepted |
| 0035 | Surface the OS locale through the preload bridge | Accepted |
| 0036 | Split Settings into AI and Shortcuts destinations | Accepted |
| 0037 | Resolve project instructions in Electron main | Accepted |
| 0038 | Bridge plugin-declared MCP servers in Electron main | Accepted |
| 0039 | Activate plugin skills and ship plugin authoring as a first-party devkit | Accepted (skill delivery revised by D174) |
| 0040 | Resident plugin services and the inter-plugin message bus | Accepted |
| 0041 | Bound host runtime resources and decouple message persistence | Accepted |
| 0042 | Message-scoped inline review cards | Accepted |
| 0043 | Message-owned review snapshots and guarded rollback | Accepted |
| 0044 | Session-bound project instruction preflight | Accepted |
| 0045 | Bash tool inherits the user's login-shell PATH | Accepted |
| 0046 | Categorized process log files | Accepted |
| 0047 | Context usage inspector with exact and estimated token sources | Accepted |
| 0048 | Lazy per-turn tool activation | Accepted |
| 0049 | Recover automatic context compaction failures with a retained tail | Accepted |
| 0050 | Bounded provider stream recovery and diagnostics | Accepted |
| 0051 | Isolate host RPC stdio from the Tokio blocking pool | Accepted |
| 0052 | Plan operating state and approval boundary | Superseded by 0053 |
| 0053 | Plan checkpoint artifact, approval, and execution epoch | Accepted for implementation |
| 0054 | Selectable command shell catalog and execution identity | Accepted for implementation |
| 0055 | Agent-only mode; Chat becomes an internal read-only profile | Superseded by 0052 / 0053 |
| 0056 | User-owned MCP servers and skills, with a shared activation scope | Accepted |
| 0057 | Permission-gated external paths and portable native search | Accepted for implementation |
| 0058 | Extensions page density and theme-readable button surfaces | Accepted |
| 0059 | Persist composer clipboard files in session scratch | Accepted |
| 0060 | Imperceptible background context compaction | Accepted (amends 0030 / 0049) |
