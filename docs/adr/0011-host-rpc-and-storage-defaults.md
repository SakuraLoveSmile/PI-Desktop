# ADR 0011: Freeze host RPC, storage ownership, and mode defaults

- Status: Accepted
- Date: 2026-07-25

## Context

After baseline 0.3.0, implementation still depended on several high-impact defaults:

- Electron ↔ Rust transport
- SQLite ownership
- default interaction mode
- chat/agent tool split
- permission timeout behavior

## Decision

Freeze the following defaults for implementation:

1. Transport = **Rust sidecar + stdio JSON-RPC (NDJSON)**
2. SQLite ownership = **Rust host-core only**
3. Default mode = **Agent** *(the only mode since D188 / ADR 0052)*
4. Read-only mode = **read-only tools** *(renamed from Chat and UI-removed by ADR 0052)*
5. Permission timeout = **120s deny**
6. Session grants = **by toolName**
7. First release platform = **macOS arm64 only**
8. TS schema = **typebox**
9. i18n = **i18next**

## Consequences

### Positive
- M1/M2 can proceed without re-litigating core choices
- Clear process and data ownership
- Safer chat/agent split

### Negative
- JSON-RPC text protocol may later need binary upgrade
- Exclusive Rust DB ownership requires mature host RPC coverage early

## Related docs

- `docs/spec/08-meta/decisions-log.md`
- `docs/spec/03-runtime/06-host-rpc-protocol.md`
- `docs/spec/03-runtime/07-process-model.md`
- `docs/spec/04-ux/03-permission-ux.md`
