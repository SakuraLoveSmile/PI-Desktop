# ADR: Durable Plan/Goal revision and one-time execution lifecycle

- Status: Accepted for implementation
- Date: 2026-09-29
- Related: ADR 0052, ADR 0053, ADR 0305

## Context

Plan and Goal proposals are immutable checkpoints, but the approval surface
needs to support user feedback, a separate Goal contract, and a one-time
execution at a specified time. Treating feedback as a renderer-only draft or
reusing the recurring Scheduled-task prompt would lose proposal identity,
artifact provenance, permission selection, and restart behavior.

## Decision

Rust host-core remains authoritative for proposal identity, version, artifact
hash, status, revision intent, execution binding, and schedule state. The
existing `plans.resolve` contract is extended with `request_changes` and
`schedule`, while `approve` and `reject` remain compatible for older callers.

`request_changes` atomically records a validated revision intent on the current
proposal. Electron admits the next planning turn only when its
`revisionProposalId` and content/model binding match that intent. A successful
revision submits a new immutable proposal and artifact; the old proposal is
retained as read-only history. Failed admission retains the saved intent for
retry and never executes the old proposal. Converting Plan to Goal uses this
same path with `targetKind = goal`, producing a new Goal proposal that needs a
separate approval. A revision turn that ends without submitting its new
contract becomes failed and retryable immediately. Cancelling an in-flight
conversion targets that revision's exact turn ID, so a later turn in the same
session cannot be interrupted by an old card.

`schedule` approves an immutable Plan/Goal snapshot and stores an explicit
execution provider/model, permission mode, UTC instant, and display timezone
in `plan_execution_schedules`. Host-core performs one atomic claim. A due
snapshot is either claimed once, cancelled before claim, or marked `missed` and
requires explicit Run now confirmation. The schedule is independent of
recurring `scheduled_tasks`; it is never rebound to a later Markdown revision
and is not automatically caught up after a missed time. While the app remains
running, automatic admission permits up to two minutes of delay after the UTC
deadline (inclusive), including sleep/resume. Longer delays atomically mark the
snapshot `missed` without queuing an execution; the user must confirm Run now.
Host enforces this window both when scanning due schedules and when claiming
one, so a claim cannot cross the boundary after a successful scan. Startup and
Host restart still mark every due schedule `missed`, with no grace window.

The renderer keeps the Composer visible during review, restores bounded
proposal history after reload, and exposes terminal cards read-only. Work Panel
Overview, resolved AskTool summaries, and Detailed/Compact transcript display
are projections of existing session, transcript, artifact, and settings data;
they do not become alternate persistence owners.

## Consequences

- Every actionable request is scoped by proposal/session/turn/tool-call/version.
- A changed model affects the next revision only; it cannot mutate an approved
  execution snapshot.
- Execution bindings, revision intent, and schedules are stored by Plus schema
  step P3, which is additive. An existing database that is behind on the Plus
  track gets a readable backup before the step runs
  (ADR plus-schema-version-track).
- Remote backends that only support the legacy approve/reject path must reject
  revision and scheduling explicitly rather than pretending to support them.
- Candidate validation must cover stale responses, retry, separate Goal
  approval, duplicate claims, missed schedules, restart restoration, and the
  retained Composer.

## Alternatives rejected

- Mutating the existing Markdown artifact would invalidate audit hashes and
  make old transcript cards change under the user.
- Reusing a recurring Scheduled task would omit the approved contract snapshot
  and permit a later task edit to change what was approved.
- Keeping revision state only in the renderer would lose retryability on reload
  and allow stale approvals.
