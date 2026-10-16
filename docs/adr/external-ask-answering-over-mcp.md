# External ask answering over local MCP

- Status: Accepted for implementation; implementation and acceptance pending
- Date: 2026-10-14
- Scope: ordinary interactive asktool in local execution sessions

## Context

An external scheduler can create and observe a Plus execution session, but
cannot discover its ordinary pending asktool request identifiers. The question
therefore remains visible only in Desktop. A scheduler may eventually stop or
abort the session as a timeout, losing the user's opportunity to answer.
The existing generic control operation can resolve an ask when its identifier
is known, but records Desktop as the answering principal.

## Decision

Expose additive typed read and dangerous resolve tools, plus a pending summary
in the existing status envelope. Reuse the runtime's in-memory waiter and its
at-most-once consumption; an answer resumes the original tool invocation in
the original turn. Preserve the ordinary Desktop card and allow either surface
to answer first. Do not use unattended interception plus a new prompt for
execution, since that would change continuation semantics and remove direct
Desktop answering.

Exclude Team-managed asks and native-pi sessions. Keep permission approval and
planning/Review policy separate. The named and generic MCP paths use a trusted
controller principal, while Renderer IPC keeps its existing Desktop principal.
No client-provided source or principal is accepted. The local MCP bearer,
loopback binding, reviewed catalog, dangerous confirmation and existing Host
permissions remain intact.

The protocol and spec 17 own DTOs, error semantics, size limits and behavior;
this ADR does not substitute for executable checks. No database migration or
durable waiter recovery is introduced by this feature.

## Consequences

KaneoPilot can present and answer an ordinary ask without prompting again.
Late answers return not_pending; a client's network timeout cannot prove the
answer failed, even if a later snapshot still shows the question. A sidecar
restart loses ordinary in-memory waiters and cannot resume the old call.
External waiting budgets and question history remain the scheduler's concern.

The existing documented stop-as-skip behavior has a runtime gap and needs a
failing behavioral test followed by a minimal ordinary-waiter fix. Graceful
stop remains completed, abort remains aborted, and Team stop semantics remain
unchanged. Real Renderer card removal must be verified separately from pending
list disappearance.

## Verification

Targeted MCP/bridge/runtime tests cover confirmation, identity, filtering,
principal and competing answers. The production Rust Host/sidecar and a local
deterministic SSE provider verify original-turn continuation, Desktop-first
and simultaneous answers, graceful stop, abort and restart. Renderer acceptance
checks card removal and reconstruction. The linked KaneoPilot rehearsal covers
question discovery, answer delivery, unknown results, waiting and recovery.
All of these checks are pending at specification time; no paid provider call
or production installation is part of this decision.

The existing ordinary asktool tool-result details add `resolutionKind` with
`answered`, `stopped`, or `aborted`. Ordinary answers, including Decline all,
are answered; graceful-stop cancellation is stopped, and abort cancellation
is aborted. This private waiter consumption marker is persisted alongside
questions, answers and resolvedAt. It does not change model-facing content,
introduce a history API, or persist an answering principal. An external
scheduler can match session, turn and tool-call identity in a complete
transcript to distinguish a real answer followed by immediate completion
from cancellation. `input.resolved.by` remains event-only evidence.

The transcript projection includes optional message turn identity from the
existing persisted message index, verified within the same session. The
transcript file alone does not carry the Host append operation's turn
association. Exposing that established identity avoids guessing the current
turn and makes immediate completed settlement verifiable.
