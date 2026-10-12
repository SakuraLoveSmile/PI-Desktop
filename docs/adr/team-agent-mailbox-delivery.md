# ADR: Ordinary Agent Lead mailbox delivery within a running turn

- Status: Proposed; delivery alternatives are not implemented
- Date: 2026-10-11
- Related: [Expert Team collaboration](plus-expert-team-collaboration.md),
  [session collaboration messages](0239-session-collaboration-messages.md)
- Scope: WP16 S3; reassess after the S1 visibility candidate is exercised

## Context

An ordinary Agent Team Lead can hold its running turn while repeatedly waiting
for an expert report. Main persists that report through the authenticated Team
mailbox and admits it to AgentHost with `admission: "queue"`. A busy AgentHost
does not drain an ordinary queue entry until the active turn settles. Queue
acknowledgement proves durable admission, not that the Lead read its body.

The existing same-turn execution inbox is narrower: Host authorizes it against
the original approved Plan/Goal execution and its exact Lead turn. Ordinary
Plan aggregation instead yields for pending mail, then receives authenticated
continuations. Neither path authorizes arbitrary ordinary Agent inbox reads.

WP16 S1 exposes pending-mail metadata without consuming mail or ending an Agent
turn. Together with coordination instructions, that may remove blind waits and
duplicate commands. It cannot mechanically prevent a model from repeating work.
Evidence of remaining delay or repeated execution is required before changing
delivery semantics. This ADR proposes alternatives; it is not a grant of
implementation, new approval, or stronger runtime authority.

## Decision

Keep ordinary Agent Team delivery unchanged for the visibility candidate. Do
not set queue priority to impersonate the user's Send now action. Do not extend
`team.readExecutionInbox` by accepting historical approvals or omitting its
execution/turn proofs. Preserve the current authenticated `role=user` mailbox
continuation, `team-message:<id>` idempotency key, permission ceiling, FIFO,
pause holds, and cancellation behavior.

Before adopting either alternative below, obtain a separate decision on its
user-visible timing and contract. Define its persisted consumption proof and
restart behavior in the normative runtime and Host protocol specifications,
then cover producers and consumers with contract and user-path regressions.

### Alternative A: Authenticate and steer ordinary Team mail into its live turn

Main would request a dedicated Team delivery operation, not reuse user priority.
Host/AgentHost would validate the message's Team ledger origin, caller/recipient,
current session, live turn and epoch, pause state, and permission ceiling before
the runtime admits its body. The runtime would preserve the full authenticated
message provenance and `role=user` framing without presenting it as new user
consent. A refusal must leave the original durable queue entry intact.

Advantages: reuse the existing runtime steering boundary and keep the original
Lead turn active. Costs: mailbox admission becomes observable during an active
model/tool run; the ordering contract must cover a concurrent real user steer,
multiple Team reports, tool batches and cancellation.

### Alternative B: Introduce an ordinary Lead inbox consumption boundary

Host could authorize a separate ordinary Lead operation against a current,
confirmed Team strategy, exact active Lead turn, recipient and authenticated
message source. It must remain distinct from approved-execution authorization.
Successful consumption would atomically persist a turn-specific proof and retire
eligible queue receipts, with Main and runtime deduplicating against the same
durable message identity. It cannot obtain execution tools or restore a Goal
token. Whether bodies remain authenticated `role=user` input rather than tool
output is a required explicit contract choice, not an implementation detail.

Advantages: explicit pull and transactional consumption at existing wait points.
Costs: a new authority and consumption contract, recovery semantics and event
ordering across Host/Main/runtime. Reusing the approved inbox without a separate
ordinary identity would blur the approval and execution-token boundary.

## Threats and required invariants

- **Untrusted report text:** instructions inside a report do not grant consent,
  spawn authority, permission or an execution token. Validate the ledger identity
  and preserve origin; never infer trust from a body claiming to be a report.
- **Cross-session or stale delivery:** pin recipient and exact live turn/epoch
  across every await. After replacement, cancellation, pause or restart, an old
  callback must not insert into a new run. Preserve the existing no-replay fence.
- **Duplicate delivery:** repeated notifications, ACK/resume retries, a lost
  transport response and a simultaneous drain must resolve through the durable
  message ID and the unchanged idempotency key. A queue ACK is not consumption.
- **Ordering:** define whether real user steering precedes pending Team mail,
  keep per-recipient mail ordering, and prevent a later report from overtaking an
  earlier unconsumed one silently. A model tool batch is not an atomic mail read.
- **Interrupted consumption:** consumption, receipt retirement and runtime
  admission must have a recoverable commit boundary. Persisting a consumption
  proof before the body is admitted may lose mail; admitting without durable
  deduplication may repeat it after a crash. Choose and test the boundary first.
- **Execution token invalidation:** neither proposal changes an interrupted
  Goal back to running, grants approved-execution tools to an ordinary turn, or
  binds a mailbox continuation as the original approved turn. Approved Plan/Goal
  inbox and ordinary Plan yield retain their existing semantics.
- **Resources and privacy:** dispose listeners and pending reads on every run
  transition. Scope diagnostics to IDs/counts and timings, avoiding bodies,
  credentials and arbitrary workspace paths. Do not add a busy-loop retry or
  bypass shell limits to mask an unread report.

## Consequences

The visibility candidate makes backlog visible while keeping persistence,
transport, permissions and execution lifecycle compatible. The Lead still has
to finish an ordinary Agent turn to receive queued bodies. This is a known
limitation, not proof that same-turn delivery is already supported.

Neither alternative requires a new process boundary, but both change a frozen
message/authority boundary. Adoption therefore needs an explicit decision,
specification, failure/recovery coverage and migration analysis for queued mail
from older Hosts. Unknown or older clients must retain safe queued delivery,
not silently acquire an in-turn capability.

The follow-up decision is conditional on S1 evidence: record report admission,
queue receipt, turn settlement and actual body delivery separately; count
expert and Lead background processes from Host records. Simulated providers
cannot establish arbitrary real-model obedience or production acceptance.
