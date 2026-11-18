# ADR: Host owns session-cumulative usage totals

- Status: Accepted for the implementation candidate
- Date: 2026-11-18
- Task: `pi-ui-1118-usage-strip`

## Context

The composer read-out strip reports session rounds, steps, cumulative tokens and
prompt-cache hit rate beside the context meter. The renderer cannot derive those
figures: `session-slice` activates a session with `messageLimit: 100`, so
`state.messages` holds only the newest transcript page. Summing that page would
silently under-report a reopened long session — the exact case the strip exists
to describe — and the error grows with session length.

The host already owns the authoritative ledger. `turns.usage_json` is merged by
`sessions::usage::merge_usage` on every usage event, deduplicated by
`operationId`, and retains legacy residual counts. One turn row is one user
prompt; one ledger operation is one physical model request.

## Decision

Add a read-only aggregation, `sessions::session_usage_totals`, exposed as the
`session.usageTotals` RPC and the `pi-desktop/session/usageTotals` IPC channel.
It sums each turn's already-deduplicated top-level counts and counts physical
requests for the step figure. The renderer consumes it through a feature-local
hook that refreshes on `usage` / `turn_end` / `agent_end`, and never sums
transcript pages itself.

The IPC handler flushes the persistence outbox before reading, so a total never
lags the transcript it sits under. Sessions without a host transcript
(`native-pi:`) return zeroed totals; an unavailable host renders an em dash
rather than a partial number.

## Alternatives considered

- **Renderer-side fold over `state.messages`.** Rejected: structurally wrong for
  any session longer than the loaded page, and `addUsage` folding is quadratic
  in the number of ledger records.
- **Reading the whole transcript with a large `messageLimit` and `contentLimit`.**
  Rejected: abuses a content-bounding knob to move megabytes of rows for one
  number, and duplicates aggregation the host already performs.
- **Extending `session.get`.** Rejected: couples a decorative read-out to the
  transcript activation path and forces a full session read to refresh a counter.

## Consequences

- SQLite stays exclusively owned by Rust host-core; no schema change or migration
  is needed because the ledger already exists.
- The RPC/IPC surface grows by one read-only method; the channel is whitelisted
  automatically from `IPC.invoke`.
- Cumulative figures are eventual within one outbox flush, which the handler
  removes for user-initiated reads.