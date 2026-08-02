# ADR 0047: Context usage inspector with exact and estimated token sources

- Status: Accepted
- Date: 2026-08-02
- Related: [D103](../spec/08-meta/decisions-log.md) ·
  [D137](../spec/08-meta/decisions-log.md) ·
  [D184](../spec/08-meta/decisions-log.md) ·
  [IPC protocol](../spec/03-runtime/01-ipc-protocol.md) ·
  [Component spec](../spec/04-ux/08-component-spec.md)

## Context

The first context-usage ring exposed only a percentage and a small aggregate
breakdown. It did not answer why a turn became large, which tool contributed
the most context, or how quickly the model generated its output. The runtime
already has provider usage, tool arguments/results, and a model stream timing
anchor, but providers do not expose exact per-tool allocation.

## Decision

1. Replace the standalone ring with a compact Codex-style context inspector
   trigger. Hover and keyboard focus reveal one scrollable, non-modal panel.
2. Keep provider-reported input/output/cache/reasoning usage authoritative and
   show aggregate output throughput as `outputTokens / responseDurationMs`.
3. Estimate each tool's argument and result footprint with the existing
   pi-agent-core token heuristic. Persist the estimate on the tool message,
   mark it as estimated in the UI, and never add it to the provider total.
4. Carry `responseDurationMs` on assistant messages and `toolUsage` on tool
   messages. Add `toolUsage` to `tool_end` as an optional event field so live,
   persisted, and restored transcripts use the same values.
5. Preserve additive compatibility: missing fields use the renderer fallback
   estimate or omit throughput when no stream duration is available.

## Consequences

- Users can inspect exact model usage and see every tool's relative context
  footprint without opening logs.
- Historical tool rows remain useful through a deterministic fallback estimate.
- Tool estimates are transparent but cannot claim billing precision.
- The transcript protocol and storage shape gain optional fields, while the
  existing protocol version remains compatible.

## Alternatives

- Keep the ring-only UI: rejected because it hides the source of large turns.
- Claim exact per-tool provider usage: rejected because the provider response
  does not contain that attribution.
- Calculate throughput from wall-clock turn time: rejected because tool wait
  and provider wait would distort model generation speed.
