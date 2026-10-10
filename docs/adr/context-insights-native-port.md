# ADR: Native Context Insights

- Status: Accepted for implementation under the requested plugin-first port
- Date: 2026-10-09
- Related: ADR 0106 (command-count amendment), ADR 0174, ADR 0215,
  [Context Insights](../spec/03-runtime/context-insights.md)

## Context

The requested source is `bowenliang123/dsh-context` 0.66.0 (Apache-2.0).
It observes DeepSeek Harness session projections, request headers, durable
events and browser services. These are not PI-Desktop plugin contracts.

Ordinary plugins can only read their own imported sessions; `getLlmContext`
is an in-flight tool-only, bounded text projection. Trusted agent extensions
have context hooks but no functional session-manager history reader, complete
tool schema reader or sidecar-to-panel event bus. Combining those surfaces
cannot reproduce arbitrary session/request inspection. Reading Host SQLite
from a plugin would violate storage ownership and permission boundaries.

The user explicitly requested a native port if all functionality cannot be
implemented as a plugin. The native approach was communicated before changes.

## Decision

1. Implement the feature natively, behind dedicated runtime diagnostics,
   Host persistence, a read-only IPC endpoint and a renderer feature module.
   Keep existing process and data ownership intact; do not widen plugin grants.
2. Capture dispatched provider contexts at the actual runtime boundary, after
   context construction. Never infer an exact historical or next-request context
   from visible transcript messages. Missing captures remain unavailable.
3. Preserve the existing model window, runtime estimator, usage ledger,
   compaction, cancellation and tool authorization. Inspection does not make a
   provider call. No new automatic pruning or model policy is introduced.
4. Bound diagnostic content independently of billing history. Expose metadata
   without full content for overview and request selection; fetch selected
   content on demand. Diagnostics are private application data and follow their
   session's lifecycle. Transport credentials and binary image data are excluded.
5. Add `builtin.context.inspect` / `/context` to the five existing commands.
   This explicit sixth task-oriented command amends ADR 0106's count freeze;
   no removed navigation or administration commands are restored.
6. Reuse PI-Desktop's shared primitives, theme and session-owned Work Panel.
   The upstream capability and information layout inform the port; its Cordis,
   DSH projection runtime and React 18 dependencies are not embedded.

## Alternatives

- A plugin-only partial dashboard would omit exact request history and expose
  estimates as though they were full contexts. Rejected for this request.
- Expanding every plugin's access to ordinary chats would alter trust contracts
  and still require the native capture pipeline. Rejected as unnecessary.
- Replaying old visible transcripts would guess prompts, schemas and compaction
  state. Rejected as an exact-data source; transcript-derived operation statistics
  are identified separately where used.

## Consequences

The port needs no DSH dependency, provider credentials, paid validation or
plugin installation. Captures begin with this version and are bounded samples;
older requests and content beyond retention are not recoverable from diagnostics.
Token estimates and provider reports remain distinct. Provider-specific DSH
facilities cannot be simulated as native PI facts. This is a local implementation
decision, not a publication or user-acceptance record.
