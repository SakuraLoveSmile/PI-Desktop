# Team task dispatch, queue receipts and age

WP10 adds an explicit association for queued task dispatches. It does not change
WP5 shell timeouts, permissions, execution inbox authorization or mailbox FIFO
for unrelated messages.

## Producer contract

`send_message({targetMemberName, content, taskDispatch?})` calls
`team.sendMessage({teamSessionId, callerSessionId, target, content,
idempotencyKey?, taskDispatch?})`. `taskDispatch` contains exactly
`{taskId: string, expectedRevision: positive integer}`. The Host rejects malformed
objects, non-Lead sends, a target other than the exact task owner, deleted or
terminal tasks, stale revisions and unapproved recipients. The field is optional
for both execution and research dispatches. Existing research `taskId` arguments
on task creation/result submission keep their meaning; a task ID in message text
never associates mail with a task. Reports and additional updates omit this field.

The original message body, kind, source-turn proof, dispatch HEAD, permission
ceiling, authenticated ownership and `team-message:<id>` delivery key are unchanged.
Replaying a send key returns the same row and immutable send metadata, including a
canceled receipt. Reusing the key with a different target, content or association
returns `IDEMPOTENCY_CONFLICT`. A canceled replay emits no new mail wake event.

## Receipt and model input

New Host sends capture `sentAt` (ISO UTC) and `targetBusyAtSend` (whether the target
has a running turn). Message projections add `targetState: running | paused | idle`
as observed when queried. Busy takes precedence over paused because a pause can
hold the next queue without terminating an existing turn.

`queuePosition`, when present, is one-based among that target's queued **Team
mailbox** messages in existing `(createdAt,id)` order, including accepted/ACKed
but unstarted messages. It is absent for running or settled messages. It is not
the position among ordinary user turn queue entries; the tool explicitly returns
`queuePositionScope: team_mailbox`. Acceptance/ACK does not establish consumption,
and the tool retains `delivered:false`.

Only Host ledger resolution supplies `sentAt`, `targetBusyAtSend` and
`taskDispatch` to `SessionMessageOrigin`. Its shared framing identifies agent
input as task data without new authorization and, when busy at send, warns that
it may be stale and asks the recipient to check the current task/newer
instructions. Both live input and restored model history use the same framing.
Legacy messages lacking metadata retain the old framing. Transcript append and
rewrite continue to enforce immutable Host provenance; human steering does not
inherit the metadata.

## Lifecycle

In one send transaction, a new explicit dispatch retires only older unstarted
`kind:message`, `status:queued`, `turnId:null` rows from that Lead to that recipient
associated with the same board task. Their ledger status/delivery status becomes
`cancelled`, with `dispatchCancellation:superseded`; original content/identity and
proofs remain queryable. Other tasks, recipients, ordinary messages, reports,
Host failure notices and running/consumed mail are untouched. The mailbox limit
is checked after replacement within the transaction, so a full mailbox may
replace one of its own obsolete dispatches without increasing capacity.

A task's actual `completed` transition retires all its unstarted explicit Lead
dispatches with `dispatchCancellation:task_completed`. This applies to direct
updates, successful turn settlement after a provisional completion claim, and
structured research result submission. A claim still in progress or failed
terminal turn does not falsely trigger successful-completion cleanup.

Retirement removes only those messages' durable turn queue rows in the same
transaction. Existing `team.changed` events let Main verify each live queue
entry's current Host ledger state and remove only canceled explicit dispatches
from the Agent Host mirror. Duplicate notifications are harmless. If dispatch,
notification and dequeue race, authenticated input resolution and the existing
queued-to-running claim prevent canceled mail from entering model execution.
Running or consumed mail is never canceled retroactively. Current schema and
protocol version are unchanged; optional KV records are cleaned with their owning
session's existing deletion path.

## Validation

The RPC regression enters via declare/confirm, create task, send, begin turn,
update task and successful end-turn settlement with isolated storage and no model
network requests. Main uses the real Agent Host, controlled 40-minute clock and
fake runtime boundary: it preserves unrelated FIFO mail, removes old dispatches,
and sends only the latest authenticated input into the fake model. Runtime and
Host-runtime tests cover tool receipts, ordinary report omission, shared framing
and restored history. See [scenarios](../06-delivery/team-task-dispatch-scenarios.md).
