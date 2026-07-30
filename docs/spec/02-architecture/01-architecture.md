# 01. Architecture

## 1. Overview

PI-Desktop uses a layered desktop architecture:

```text
┌──────────────────────────────────────────────────────────┐
│ Renderer (React UI, English-first i18n) │
│ - chat / sessions / settings / plugins / command palette│
│ - no Node integration │
└───────────────────────────▲──────────────────────────────┘
 │ preload IPC
┌───────────────────────────┴──────────────────────────────┐
│ Electron Main (thin orchestrator) │
│ - window lifecycle │
│ - IPC routing │
│ - process supervision │
└───────────────▲─────────────────────────────▲────────────┘
 │ local RPC │ process bridge
┌───────────────┴──────────────┐ ┌──────────┴────────────┐
│ Rust Host Core │ │ Node pi Agent Sidecar │
│ - tools + sandbox │ │ - pi-ai │
│ - permission gateway │ │ - pi-agent-core │
│ - plugin host services │◄─►│ - turn orchestration │
│ - persistence adapters │ │ - provider streaming │
│ - secrets adapter │ └───────────────────────┘
└──────────────────────────────┘
```

## 2. Design principles

1. **UI and privileged runtime are separated**
2. **Rust owns host/system capabilities, durable mode, and approval policy**
3. **pi owns model/agent loop semantics**
4. **Renderer is unprivileged**
5. **All cross-boundary contracts are typed**
6. **English is the product source language**
7. **Plan is a state of the one pi Agent, never a second planner**

## 3. Subsystems

### 3.1 App Shell (Electron)
- windows/menus
- app lifecycle
- fixed-feed update check/download/install lifecycle
- process boot order

Electron Main exclusively owns the update client and fixed GitHub Releases
target. The renderer can request allowlisted operations and render typed state,
but cannot supply a feed URL or access the updater directly. App updates do
not pass through Rust host-core or the agent sidecar (D120 / ADR 0022).

### 3.2 UI (React)
- session UX
- streaming transcript
- permission cards
- settings
- plugin manager UI
- command palette

### 3.3 Rust Host Core
- workspace path enforcement
- builtin tool execution
- permission policy evaluation
- durable session mode resolution (`agent | plan`)
- plan approval records, requests, and atomic Plan → Agent transition
- plugin install/registry/lifecycle services
- sqlite adapters / secure storage glue
- audit logs

### 3.4 Node pi Agent Runtime
- model catalog/provider setup
- `Agent.prompt/abort`
- event normalization from pi events
- tool call requests emitted to host core
- one-Agent planning state, structured plan submission, and feedback loop

### 3.5 Plugin System
- manifest validation
- contribution registry (commands/tools/skills)
- plugin panels
- permission grants

## 4. Request path (conversation + tool)

```text
1. UI submits prompt
2. Electron main routes to agent sidecar
3. pi runtime starts turn and streams events
4. UI renders text deltas
5. On tool call:
 5.1 pi requests tool execution via host bridge
  5.2 Rust resolves the durable session mode and evaluates the authoritative
      Plan/Agent tool policy before permission modes
  5.3 UI confirms if required, including a separate Plan approval request
 5.4 Rust resolves the durable session's project and executes the tool in that
     workspace sandbox (never whichever sidebar tab is currently active)
 5.5 result returns to pi runtime
6. turn ends; session persistence updates
```

When the same Agent calls `ExitPlanMode`, host-core persists the structured
proposal and waits for `plans.resolve`. Approval atomically changes the durable
session to Agent with the selected permission mode, then the sidecar starts a
new provider request with the Agent tool set. Requesting changes returns
feedback to that same Agent and keeps the session in Plan. Reject, timeout,
host/sidecar crash, and persistence failure grant no execution capability.

The renderer may display Plan state and approval UI, but it is only a projection
of host/runtime events. It cannot authorize a tool or choose a mode for host
policy by sending a conflicting request field.

The renderer may retain several project tabs, but this does not create several
host workspace singletons. One project supplies visible shell context;
session-bound project identity supplies each turn's privileged tool root.

## 5. Why hybrid Rust + pi

| Approach | Verdict |
|---|---|
| Pure TS Electron main for everything | simpler, weaker systems boundary |
| Full Rust rewrite of agent loop | too expensive, loses pi leverage |
| **Rust host + pi sidecar** | chosen: strong host + mature agent engine |

## 6. Process model

Transport: Rust sidecar + stdio JSON-RPC (NDJSON).

MVP target processes:

1. Electron main
2. Electron renderer
3. Rust host core sidecar
4. Node pi agent sidecar

Dev mode may colocate some services, but contracts stay the same.

## 7. Extension points

- Tool providers (builtin / plugin / MCP later)
- Session backends
- Model catalog sources
- Permission policy packs
- Locale packs
- Market providers (post-MVP)

## 8. Packaging implications

Desktop package must ship:

- Electron app
- Rust host binary
- Node runtime assets for pi sidecar (strategy implementation-defined)
- English locale pack (default)
