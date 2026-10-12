# Ordinary Agent Team inbox at the wait boundary (WP16 S3)

## User path and boundary

A current ordinary Agent Team Lead calls `wait_for_updates` while its confirmed
expert sends a report. A capable Host persists the authenticated report into the
same running Lead turn; the runtime stages its `role=user` body with expert
`SessionMessageOrigin`, ACKs its accepted buffer, rechecks the captured lifecycle
and synchronously admits it to the internal Pi queue. The provider's next
request can read it without an intermediate final reply or replacement turn.
The tool result uses `reason:"ordinary_inbox"`, `updated`, fresh `count`,
fresh `messageIds`, `pendingMessageSenders`, `oldestPendingMessageAgeSeconds` and
`ackPendingMessageIds` only. It never exposes bodies, proofs or execution tokens.
On a recognized ACK transport loss the entire FIFO batch stays buffered: the
summary has `updated:false`, zero fresh count/IDs and pending ACK IDs. A later
wait in the exact same turn must successfully re-ACK every original group under
current Host source authority before admitting any body. Authority/unknown errors
cannot flush it either; an uncertain ACK is never an authorization proof.
`team_status` remains a non-consuming backlog summary.

This is task data, not new human authorization. No Goal execution token, approved
execution tools, permission ceiling, scope reset or Team clock reset is introduced.
Ordinary Plan yield and approved Plan/Goal execution-inbox consumption remain
unchanged. A failed read/admission is observable; it cannot masquerade as zero mail.

## Internal protocol

The model tool catalog does not expose these internal operations:

| Host method | Input | Result |
| --- | --- | --- |
| `team.getOrdinaryInboxCapability` | no body parameters | `{capability:"ordinary-team-inbox-v1"}` |
| `team.readOrdinaryInbox` | `teamSessionId`, `callerSessionId`, `leadTurnId`, `boundaryId` | capability and `messages` |
| `team.ackOrdinaryInbox` | same binding plus `messageIds` | `{ok:true, acknowledgedIds}` |
| `team.getOrdinaryInboxProof` | `teamSessionId`, `messageId` | body-free `proof` or `null` |

Each returned delivery contains `messageId`, `userMessageId`, `teamSessionId`,
`leadTurnId`, `scopeTurnId`, its original `boundaryId`, `phase:"persisted"`, and
an authenticated `message: UiMessage`. ACK groups use that delivery's original
boundary; a retry does not invent a new proof. The Host rejects wrong identities,
turns, boundaries or proof state; repeated matching ACK is idempotent.

Host authority requires the exact running ordinary Agent Lead, current confirmed
delegate decision/run, an unpaused/non-hard-paused Team, and current expert/source
dispatch and source-turn evidence within its permission ceiling. Approved
execution cannot reuse this ordinary path. Runtime epochs are not Host facts:
Main, AgentHost and Runtime compare their own captured epochs, exact turn,
cancellation/pause/disposal state after each asynchronous boundary.

The dedicated internal ingestion preserves provenance and existing message IDs;
public human `steer` is not its admission API. Pending genuine human steering has
priority. Eligible reports use mailbox `(createdAt,id)` FIFO. An ineligible old
scope at the queue head is not skipped to admit newer reports. The identity-only
`team.ordinaryInboxPersisted` notification contains
`teamSessionId`, `leadTurnId` and `messageIds`; it is a hint, including after a
partially committed batch fails later. Main rechecks each proof. Proof queries
require the exact Team/message identity but no still-running old turn, enabling
recovery cleanup without exposing a body. Live AgentHost
queue mirrors retire only for `persisted`/`acked` Host proofs, never inferred from
a completed ledger row; `team-message:<id>` stays unchanged and duplicate runtime echoes must not append a second transcript row.

## Journal and crash cuts

Plus schema P6 adds `team_ordinary_inbox`. Message identity is its primary
key; stable user-message identity, recipient Lead turn, scope and boundary bind
its proof, together with immutable source session/turn and permission ceiling.
Collaboration messages keep `turn_id:null` for this path: several
reports can enter one Lead turn without claiming the ledger's one-mail-per-turn
continuation binding.

1. Persist a `prepared` proof before appending a validated authenticated user row.
2. Write/fsync the canonical JSONL row first.
3. In SQLite, index that row, set proof `persisted`, complete the mailbox ledger
   and retire its durable turn-queue receipt together.
4. Runtime accepts a verified buffer and persists exact-proof `acked` separately,
   then rechecks lifecycle before synchronously flushing it to the internal queue.

JSONL and SQLite are not a single transaction. Startup recovery runs before
ordinary collaboration recovery. A preparation without a file row is removed
and leaves its report queued. An existing authenticated file row repairs the
index/retirement. Persisted or ACKed input remains authenticated history; recovery
never starts a new turn/provider, replays execution or controls a stale run.
A persisted proof proves durable input, while ACK proves runtime admission;
neither establishes provider attention, model compliance or exactly-once model
consumption across a crash.

## Compatibility and acceptance

No protocol-version bump or upstream schema migration is required; the additive
Plus migration preserves old mail/history. `METHOD_NOT_FOUND` or unsupported
capability retains queued delivery and S1 pending metadata guidance. It does not
fall back to unauthorized inbox access. S1 remains the compatibility behavior;
its original baseline incident evidence is retained separately from S3 acceptance.

`E2E-TEAM-agent-lead-wait-boundary-ordinary-inbox` exercises the real
Host/Main/AgentHost/runtime transport with an isolated deterministic provider.
Record report persistence, queue retirement, runtime ACK and provider input
separately, require expert 2/Lead 0 process records, and verify repeat notification,
concurrent human input, pause/abort/replacement/disposal and restart crash cuts.
Host/RPC and runtime contracts cover provenance spoofing, FIFO, wrong proof ACK,
no automatic restart, ordinary Plan yield and approved execution isolation. A
scenario definition alone is not a passing run or real-provider acceptance.

Host-authored run-limit/failure notices retain their existing source-specific
proof/delivery paths; the ordinary expert-report capability does not infer expert
identity from a notice body or broaden its eligibility.
