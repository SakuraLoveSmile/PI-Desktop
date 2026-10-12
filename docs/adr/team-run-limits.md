# ADR: Host-owned Team wall-clock limits

- Status: Accepted for implementation
- Date: 2026-10-11
- Related: [Expert Team](plus-expert-team-collaboration.md), [run-limit spec](../spec/03-runtime/team-run-limits.md)

## Context

An expert-team validation/fix loop can repeatedly dispatch expensive long tests
without converging. Runtime prompts alone cannot enforce elapsed time, and killing
shell processes can lose work or interrupt evidence collection. Team sessions may
be reused for different user tasks; their creation time is not a run boundary.

## Decision

Rust Host owns a durable wall-clock budget under the existing KV extension
boundary, keyed by Team and bound to the existing trusted strategy-scope user
turn. Default limits are enabled at six/ten hours and user-adjustable. Soft emits
one Host-authored wrap-up mailbox notice plus a UI notification. Hard reuses Team
pause/queue hold and existing Goal interruption/token invalidation. Main requests
a runtime safe batch boundary; it does not kill foreground batches or ordinary
background commands, or route through the ordinary user-stop peer-abort hook.
The approved WP14 [explicit service lifecycle](team-managed-service-processes.md)
adds an exception: any Team pause stops owned explicit services, including hard
pause. Shell quotas and ordinary command behavior remain unchanged. Existing
user Stop keeps
its prior semantics. A provider-only abort signal fences request/stream retry
backoff even in infinite retry mode, and an admitted-batch proof separates an
already-started tool batch from a late model response. This signal never cancels
an agent/tool batch. No renderer persistence, permission widening, or parallel
execution inbox is introduced.

Completed idle Teams are not awakened. Mail continuations, pauses and restart
preserve the clock; only a newly admitted non-mail user scope establishes a new
budget. Hard-paused runs require a policy adjustment and explicit Resume. The
additive settings/projection fields tolerate old consumers; protocol/schema
versions and shell quotas stay unchanged.

## Alternatives and consequences

A runtime-only timer loses state after restart and has no authoritative pause.
A process-kill watchdog can corrupt in-flight work. Team-creation-time limits
lock old sessions and wake completed tasks. Reset-on-resume permits indefinite
loops by repeatedly refunding budget. These alternatives were rejected.

The one-second Host sweep may be delayed under load. A foreground tool batch
can outlive the hard deadline until its existing timeout/natural completion;
paused mail will not wake another batch. Wall clock includes offline and paused
time; persisted high-water elapsed prevents backward-clock refunds. Real providers
can ignore advisory soft text, so hard is an independent Host/runtime effect.
Transient native notifications can be missed while the UI is disconnected, but
the persistent Team projection remains visible. Optional LLM-call limits are
omitted because no accepted limit or authoritative counting contract was supplied.
