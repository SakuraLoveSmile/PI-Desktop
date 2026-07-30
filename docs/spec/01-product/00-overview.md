# 00. Overview

## One-line definition

**PI-Desktop** is a local-first AI coding agent desktop client built on:

- Electron desktop shell
- Rust host backend core
- pi Agent Harness for model/agent loop
- user-installable plugin extensibility

## Product formula

```text
PI-Desktop =
 Electron Shell
 + React UI (English-first)
 + Rust Host Core
 + pi Agent Runtime
 + Local Tools
 + Plugin System
```

## Goals

1. Provide a stable desktop UX for pi-powered agents
2. Support multi-provider streaming chat
3. Execute local tools under explicit permissions
4. Persist sessions, settings, and secrets locally
5. Allow users to install/develop plugins
6. Ship as a global product with English as default language
7. Let the same Agent inspect a task, submit a structured Plan, and continue in
   Agent only after a separate user approval

## Non-goals (MVP)

- Remote WebUI / Gateway control
- Full IDE replacement
- Multiplayer collaboration
- Rewriting pi in Rust
- Marketplace-first distribution

## Key architecture decisions

| Decision | Choice |
|---|---|
| Desktop shell | Electron |
| UI | React + Vite + TypeScript |
| Default language | English |
| Host backend | Rust |
| Agent engine | pi (`pi-ai` + `pi-agent-core`) |
| Agent process | Node sidecar / controlled process |
| Renderer access | preload IPC only |
| Extensions | user-installable plugins |
| Storage | SQLite + secure secret storage |

## Minimal user loop

1. Launch PI-Desktop
2. Configure provider/API key
3. Open a project workspace
4. Create a session and send a task
5. Optionally enter Plan, inspect the project, and submit a structured plan
6. Approve the plan and choose the execution permission mode
7. Approve local tool execution when required
8. Restart app and resume the session

## Quality principles

1. **Engine stability first** — correct pi loop before feature sprawl
2. **Least privilege default** — deny by default for risky tools/plugins
3. **Observability** — every tool call and failure is traceable
4. **Replaceability** — providers/tools/storage can evolve
5. **Global-ready** — English source strings and locale architecture early

## Doc map

- Baseline: `../00-baseline.md`
- Product scope: `01-product-scope.md`
- Architecture: `../02-architecture/01-architecture.md`
- IPC: `../03-runtime/01-ipc-protocol.md`
- Agent runtime: `../03-runtime/02-agent-runtime.md`
- Tools/permissions: `../03-runtime/03-tools-and-permissions.md`
- Milestones: `../06-delivery/01-mvp-milestones.md`
- Plugins: `../07-plugins/01-plugin-system.md`
