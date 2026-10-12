# ADR: Ordinary Agent Lead mailbox delivery at a wait boundary

- Status: Accepted decision; candidate implementation and acceptance are tracked separately
- Date: 2026-10-11
- Related: [Expert Team collaboration](plus-expert-team-collaboration.md),
  [session collaboration messages](0239-session-collaboration-messages.md)
- Scope: WP16 S3, adopted alternative B

## Context

An ordinary Agent Lead can wait within a long turn while its expert's complete
report is already durable in the Team mailbox. Ordinary AgentHost queue admission
previously deferred the body until that turn settled. A queue ACK proves admission,
not that the Lead or provider consumed the body. S1 made this backlog visible but
did not remove the delivery delay or mechanically prevent duplicate work.

The approved Plan/Goal execution inbox is authorized against its original
execution and exact Lead turn. Ordinary Plan aggregation yields for pending mail.
Neither contract should be broadened to grant execution authority to an ordinary
Agent Lead. Public human steering also clears Team provenance and denotes new
human input, so reusing it would misrepresent the expert's report.

## Decision

Adopt a separate ordinary Lead inbox only at `wait_for_updates` boundaries.
The Host validates a current confirmed delegate strategy, current Team run,
exact running ordinary Agent Lead turn, recipient, authenticated expert/source
turn and permission ceiling. Main, AgentHost and Runtime validate their captured
turn/epoch and lifecycle state after asynchronous work. The model cannot supply
an epoch or a historical approval as authority.

Admit each body as authenticated `role=user` input with its expert origin through
a dedicated internal runtime operation. Keep the same Lead turn open. Tool output
contains metadata only. Neither report text nor this transport supplies new user
consent, an execution tool grant, a Goal token or a new Team run budget. Human
steering has priority; eligible expert reports retain mailbox FIFO order.

The capability is `ordinary-team-inbox-v1`. Old Hosts lacking it retain queued
continuations and S1 metadata guidance. Ordinary Plan yield and the approved
execution inbox remain separate. See the normative [ordinary inbox contract](../spec/03-runtime/team-ordinary-inbox.md).

## Persistence and recovery

Plus P6 adds a dedicated message-identity journal, without changing upstream
schema version or the collaboration ledger's unique turn binding. Each journal
row pins its stable user-message ID, Lead turn, user scope and wait boundary.
The phases are `prepared`, `persisted` and `acked`.

Preparation is durable before the authenticated JSONL append. JSONL is written
first; indexing, persisted proof, mailbox completion and durable queue retirement
then commit together in SQLite. A filesystem append and a SQLite transaction are
not one atomic transaction. Runtime buffer acceptance is followed by a separate
exact-proof ACK and a fresh lifecycle check before synchronous queue flush.
Persistent delivery and model consumption remain different facts.

Startup recovery deletes a preparation with no file row and leaves its mail
queued. When the authenticated file row exists, it repairs the index and completes
queue retirement. Persisted/ACKed bodies remain authenticated history. Recovery
never starts a turn or provider request, adopts a stale turn, or promises that a
provider read a report exactly once. A transport retry uses the same identities;
Main retires the live queue mirror only after the Host proof permits it.

## Threats and alternatives

- Report prose is task data, including instructions embedded within it. Origin,
  body, IDs, recipient, source dispatch and permission ceiling are Host checked;
  a claimed origin or `steering:true` cannot forge that evidence.
- Pause, hard limit, cancellation, run/turn replacement and disposal fence late
  responses. A stale mailbox head cannot be silently overtaken. The ordinary
  proof cannot consume an approved execution inbox.
- Repeated notifications, lost responses, ACK retries and concurrent queue drains
  deduplicate through durable message identity and unchanged `team-message:<id>`
  keys. A proof is not inferred from a live queue receipt or model claim.
- Diagnostics expose scoped identities/counts/timings rather than report bodies
  or credentials. Waiting uses existing bounded cleanup, not busy-loop retries.

Alternative A, immediate in-turn steering on arrival, was not selected: it adds
admission during arbitrary model/tool execution and has a broader ordering
surface. Extending the approved execution inbox was rejected because it conflates
ordinary collaboration with approved execution authority. Raising queue priority
to imitate Send now was rejected because that priority belongs to human input.

## Consequences and acceptance

The Lead can receive expert bodies without an extra visible final reply or new
turn, while Host persistence remains authoritative. It adds an internal transport
and a recoverable journal rather than altering permission/token ownership.
The cost is explicit ordering, lifecycle fencing and recovery across three
process owners. Legacy clients continue safely with queued delivery.

Acceptance records journal crash cuts, repeat ACK/read, source spoofing, current
scope/turn/epoch fences, human-steer ordering and unchanged Plan/Goal paths. The
isolated incident replay counts processes by session: expert 2, Lead 0. Unit or
fake-provider success does not establish real-model compliance or user acceptance.
