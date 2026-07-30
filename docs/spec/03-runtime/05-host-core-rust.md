# 05. Rust Host Core

## 1. Purpose

`host-core` is the privileged local backend of PI-Desktop.

It does **not** replace pi. It provides safe host capabilities to:

- Electron shell
- pi agent runtime
- plugin system

## 2. Responsibilities

1. Workspace path canonicalization and boundary checks
2. Builtin tool execution (Read/Glob/Grep/Write/Edit/Bash)
3. Authoritative durable session-mode and tool-policy evaluation
4. Permission policy evaluation, including Plan Bash prompts
5. Plan approval broker and atomic Plan → Agent transition
6. Plugin registry/install/lifecycle services
7. Contribution registration bookkeeping (with TS side)
8. Persistence adapters (sessions/settings metadata, Plan approvals, and the durable
   notification inbox)
9. Secrets storage integration points
10. Audit logging for sensitive actions

## 3. Non-responsibilities

- LLM provider SDKs
- agent turn graph/orchestration
- React rendering
- marketplace web frontend

## 4. Suggested crate layout

```text
crates/host-core/
 src/
 main.rs # sidecar entry
 lib.rs
 rpc/
 tools/
 permissions/
 workspace/
 plugins/
 storage/
 notifications.rs
 secrets/
 audit/
 util/
```

## 5. RPC transport

Frozen: **stdio JSON-RPC NDJSON** with Electron main (see `06-host-rpc-protocol.md`).

## 5b. RPC surface (logical)

Domains:

- `app.*`
- `workspace.*`
- `tools.*`
- `permissions.*`
- `plugins.*`
- `session.*` (adapter level)
- `notification.*` (adapter level; durable inbox)
- `plans.*` (approval broker and recovery)
- `settings.*` (adapter level)
- `secrets.*`
- `audit.*`

Example:

```text
tools.execute
plans.resolve
plans.pending
permissions.request
plugins.list
plugins.load_dev
workspace.set
secrets.set
notification.list
```

## 6. Security invariants

1. No unchecked path escape from workspace tools
2. Host resolves the durable session mode; request-supplied mode is never
   authoritative
3. Plan denies Write/Edit/plugin/unknown tools before permission evaluation
4. Plan Bash follows the durable permission mode and may mutate under Auto
5. Plan approval is host-authenticated, durable, and atomic before Agent entry
6. Secrets never returned to renderer logs
7. Crash in plugin or approval path fails closed and does not grant execution

## 7. Packaging

- build target per platform
- ship binary next to Electron resources
- versioned protocol handshake with Electron/Node

## 8. MVP acceptance

1. Electron can start Rust host sidecar
2. healthcheck RPC succeeds
3. at least one tool path executes through Rust
4. permission deny path works
5. unseen completed/failed turns create exactly one durable notification
   through the `session.endTurn` transaction; results already visible in the
   focused current chat and aborted turns create none
6. a durable Plan session cannot authorize Write/Edit/plugin tools through a
   conflicting request mode, and Plan Bash follows the resolved permission
   mode
7. plan submission and approval are durable, session/turn-scoped, and fail
   closed on timeout, stale response, persistence failure, or crash
