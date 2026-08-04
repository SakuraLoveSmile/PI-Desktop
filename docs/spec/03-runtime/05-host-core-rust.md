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
3. Permission policy evaluation
4. Plugin registry/install/lifecycle services
5. Contribution registration bookkeeping (with TS side)
6. Persistence adapters (sessions/settings metadata and the durable
   notification inbox)
7. Secrets storage integration points
8. Audit logging for sensitive actions

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

### 5a. Control-pipe resource isolation

The host's stdin reader and stdout writer each run on one named, dedicated OS
thread. They must not use Tokio's `tokio::io::{stdin, stdout}` adapters: those
adapters obtain a blocking-pool worker for each operation, and an exhausted OS
thread budget can otherwise panic the host before a structured error reaches
Electron. The dedicated threads retry `EINTR` and transient `EAGAIN`/`EWOULDBLOCK`
(`errno` 11 or 35) with a short delay, preserve NDJSON framing, and stop only
on EOF or an unrecoverable pipe error. Failure to create either control thread
is a startup error rather than an unhandled panic.

The best-effort login-shell PATH probe follows the same rule: a failed probe
thread creation returns `None`, so Bash falls back to the host environment.

## 5b. RPC surface (logical)

Domains:

- `app.*`
- `workspace.*`
- `tools.*`
- `permissions.*`
- `plugins.*`
- `session.*` (adapter level)
- `notification.*` (adapter level; durable inbox)
- `settings.*` (adapter level)
- `secrets.*`
- `audit.*`

Example:

```text
tools.execute
permissions.request
plugins.list
plugins.load_dev
workspace.set
secrets.set
notification.list
```

## 6. Security invariants

1. No unchecked path escape from workspace tools
2. High-risk ops require policy decision
3. Plugin calls pass permission gateway
4. Secrets never returned to renderer logs
5. Crash in plugin path should not take down host core if isolatable

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
