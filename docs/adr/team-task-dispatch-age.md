# Explicit Team task dispatch and queued-message age

- Date: 2026-10-11
- Status: Accepted for WP10
- Related: [Expert Team collaboration](plus-expert-team-collaboration.md)
- Behavior contract: [Team task dispatch](../spec/03-runtime/team-task-dispatch.md)

## Context

A member can stay in one turn for tens of minutes while the Lead queues mutually
incompatible instructions. Ordinary mailbox delivery occurs at the turn boundary.
Neither message text nor a research task ID mentioned in text establishes a safe
relationship between a message and a board task. Existing dispatch HEAD, source
turn proofs, permission ceilings and idempotency records must remain intact.

## Decision

Add optional typed `taskDispatch: { taskId, expectedRevision }` to `send_message`
and `team.sendMessage`. The Host accepts it only from the Lead to an approved
expert who owns that active board task at that exact revision. Ordinary messages,
questions and reports omit it. No text parsing or implicit task selection exists.

The Host stores immutable send-time metadata beside the existing mailbox ledger
in `team-dispatch-metadata-v1` KV. In the send transaction, the new dispatch
cancels only queued, unbound dispatches from the same Lead for the same task and
recipient. Completed tasks cancel their remaining queued explicit dispatches in
the successful task settlement transaction. Provisional completion claims do not
cancel them. Cancellation retains the original row, content, key and proofs; it
removes only its turn queue receipt. Existing Team change events reconcile the
Agent Host mirror, and ordinary authenticated ledger resolution and turn claim
refuse canceled mail even if a mirror notification races a dequeue.

Send receipts expose current target state and one-based Team mailbox position.
They do not claim model consumption or an exact position in the user turn queue.
Authenticated origin metadata carries send timestamp, whether the target was
busy, and the explicit association into the existing shared model framing. Busy
messages warn that instructions may be stale. This data never grants permission,
changes a user authorization, or becomes trusted system instructions. Live input
and restored history use the same framing and Host-owned provenance.

## Alternatives

- Parsing task IDs from content would misclassify reports, permit accidental
  cleanup and introduce ambiguous ownership. Rejected.
- Replacing every target's queued message would discard independent work and
  informational results. Rejected.
- Canceling running turns would interrupt already accepted work. Rejected.
- Steering mail into the current Lead/member turn is a different delivery and
  trust-boundary decision (WP16 S3); it is not implemented here.

## Consequences and compatibility

Legacy callers and existing persisted messages omit the optional fields and retain
FIFO behavior. No migration, queue, execution token, permission change or new IPC
channel is introduced. A retired idempotency key returns its original canceled
receipt and cannot resurrect work; changing an association under the same key is
an idempotency conflict. The additive RPC and model-input fields require producer
and consumer regression coverage. Task identity is checked at send; recipients
still check the current board before acting because later task revisions may
change its details. A replacement directed to another owner does not silently
cancel the previous owner's work.
