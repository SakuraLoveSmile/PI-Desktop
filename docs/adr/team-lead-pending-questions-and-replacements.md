# ADR: Team Lead pending questions and one failed-slot replacement

- Status: Accepted; isolated local candidate validation completed
- Date: 2026-10-11
- Scope: WP11; ordinary asktool and permission approval remain unchanged

## Context

The overnight Team incident kept a Lead asktool blocked for 346 minutes. The
current runtime stores questions in a Promise map and AgentHost stores them in
memory. Adding only a timer would discard the question on turn settlement and
make a late answer unavailable. An approved failed expert also cannot be replaced
through spawn_teammate: creation and route/roster authorization each require a
confirmed review. Skipping the creation gate would leave inconsistent authority.

## Decision

### Team-only durable question ownership

Rust Host stores versioned questions in `team-lead-ask-v1`, including request,
original running turn, creation time, lifecycle state, normalized answers and
optional queued-answer identity. Registration, defer and live-answer ACK are
sidecar-proxied operations bound to an actual Team Lead and running turn.
`team.listLeadAsks`, resolve and cancellation are trusted Main operations and
are excluded from the sidecar proxy. These records cannot grant tool permission,
confirm a roster, or restore an execution token.

A Lead waits up to 30 minutes. Host time owns the deadline. A successful defer
returns pending, the runtime completes the tool result and interrupts the turn
through the existing TURN_ABORTED path. Approved Plan/Goal execution becomes
interrupted, never completed, and generates no successful Goal report. The Ask
card remains answerable with a pending badge and explicit new-approval guidance.
Only submitted user answers enter that authenticated message; model-authored
question text stays reference data in the existing transcript. Ordinary sessions,
Team members, and ordinary permission approval keep unlimited
waits. The Team Lead contract also applies to its Goal-negotiation questions.

A timely answer is durably recorded as answered_live and returned to the live
tool; the original running runtime acknowledges it. If the process dies before
acknowledgement, a Host read recovers that answer into the normal user queue.
An acknowledged answer is never queued again. This recovery can repeat a user
answer if a crash lands precisely between tool consumption and ACK; it cannot
repeat a tool action or inherit execution authority.

A late answer validates the stored owner, question count, bounded strings and
single/multiple selection rules. One savepoint atomically writes normalized
answers and the existing turn_queue record. Its stable identity and
userMessageId are `asktool-answer:<requestId>`; it has principal desktop and no
sessionMessageId, Team-origin envelope or execution token. Existing queue
admission emits a real role=user message and starts a new user scope. Explicit
resume or new approval is required. Queue-full errors leave the question pending
and answerable. Identical response retries reuse the record; changed retries
fail with an idempotency conflict.

Timeout and answer are serialized by the Host state lock. A committed live
answer wins a concurrent defer. Cancellation checks the expected running turn,
so a stale Stop cannot cancel questions from its successor turn. It leaves a
running-turn fence so a late register cannot create a new question after user
Stop/Abort. Cancellation also discards an unacknowledged live answer, preventing
recovery from starting a new turn after Stop. Orphaned waits
become pending on read after restart. AgentHost reloads durable Team inputs for
local UI and RACP snapshots while retaining its ordinary live-input behavior.
Restored turn_queue entries retain the existing hold-until-controller policy.
Session/Team deletion cleans question data in the owning transaction.

### Exactly one successor for a failed approved slot

`spawn_teammate` gains optional `replaces`, naming an immutable member handle.
The Host checks the same current confirmed user roster, phase failed, no running
or queued work, and a new unique handle. It inherits the confirmed role, route,
thinking level, frozen tools/instructions, presentation and source permission
ceiling. Model-supplied route, description or fork overrides are rejected.

A savepoint creates the fresh session, roster row, frozen config and Host-only
`team-member-replacement-v1` link, and extends the approved decision's member
identities. The original review remains unchanged. Member route admission checks
the link against that review; current-scope checks still apply. One original
approved slot has one successor for its lifetime; successors cannot spawn a
replacement chain. Identical retries reuse the successor. The original handle
cannot receive new Lead dispatch. The successor's initial prompt uses the stable
identity `team-replacement:<successorSessionId>:initial` to deduplicate retries.
Existing tasks and transcript identities remain
unchanged; the Lead must explicitly reassign tasks when needed.

Failed members continue counting toward the frozen eight-member limit. A full
roster or a second failure requires a new trusted roster review, not deletion
of history or a limit bypass. Rejections name a legal next step.

## Alternatives

- Timer-only runtime questions: rejected because restart and turn end lose asks.
- Automatic approval or replay of the old execution token: rejected because it
  crosses the user-consent boundary.
- Rename/reuse the failed session: rejected because routing and audit identity
  would become ambiguous.
- Mutate the original approved review or allow repeated free replacement:
  rejected because immutable consent and bounded roster behavior would erode.

## Compatibility and validation

Changes are additive local contracts. KV uses existing storage; no SQLite schema
version or Plugin SDK change is needed. RACP input requests may carry optional
Team pending metadata; older consumers retain the same question/answer shape.
Ordinary asktool and permission approvals retain their existing semantics.

Acceptance covers fake-provider Lead wait, Host owner/deadline/answer races,
queue-full rollback, orphan recovery, live ACK, current-scope replacement, route
security, once-only behavior, renderer restore and actual Ask-card interaction.
No real provider, production data, publication or user acceptance is implied by
this ADR.
