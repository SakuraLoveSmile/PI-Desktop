# ADR: Goal blocked state and same-execution continuation

- Status: Accepted for implementation
- Date: 2026-10-13
- Related: [Plan/Goal lifecycle](plus-plan-goal-revision-and-one-time-execution-lifecycle.md),
  [Plus schema track](plus-schema-version-track.md),
  [Expert Team](plus-expert-team-collaboration.md)

## Context

A model turn ending successfully did not establish that its approved Goal
contract was met. Without a valid report, automatic Host fallback could publish
completed/unknown or partial results. Structured partial/blocked reports could
also appear completed. Team completion recovery could end with unsettled work
and leave no same-execution continuation path. Resuming through an ordinary
Agent prompt lost the original Goal report and progress identity.

## Decision

Rust host-core owns the completion decision. Automatic Goal completion requires
a valid structured met report, every item in an existing matching progress
snapshot completed, and settled current-decision Team work. Absent progress
remains compatible with existing callers. Terminal failed/cancelled tasks are
disclosed rather than independently preventing met. All other normal endings,
Agent errors and dispatch failures become blocked; explicit user Stop remains
interrupted. A blocked Goal publishes no completion report or completion
notification and pauses associated Team work. Host crash recovery settles
queued/running effective Goals into holds with the `agent_error:HOST_RESTARTED` reason before the generic Plan
interruption fence; already blocked
holds remain unchanged and no work is automatically replayed.

Use additive Plus step P9 (`goal_execution_holds`) and the existing
`interrupted/GOAL_BLOCKED` execution encoding. Do not rebuild plan_approvals or
extend its shared CHECK. Holds own reasons, segment history, CAS version and
Team pause ownership; they survive restart without automatic dispatch. The
existing progress-token lifecycle revokes old writes at settlement and issues
a new token only after binding the resumed turn.

The user has three explicit exits. Continue resumes the same execution and
approved contract with a new turn and the current Composer model, preserving
permissions and prior progress. User guidance is visible; internal context
replays the contract and demands a fresh report. The Composer defaults to
continuation with a removable intent chip. Text and ordinary file references
are supported. Unsupported image/plugin attachments preserve the complete draft
and show a localized ordinary-send hint, without silently dropping bytes or
changing the user's intent. Acceptance is the only route to a
non-met completed Goal; it records user_accepted and preserves available draft
claims or bounded Host facts without claiming verification. Abandon records
GOAL_ABANDONED with no report. Approving a replacement Goal supersedes the old
hold with GOAL_SUPERSEDED and a visible approval warning. Supersession atomically releases only the old hold-owned
Team pause, preserving independent user pauses and allowing the replacement
Goal to use its Team. An explicit user pause clears hold pause ownership so
resume or supersession cannot release that independent pause.

Keep the existing one-report recovery per execution segment and three Team
settlement continuations. Exhausted approved-Goal Team recovery yields a normal
blocked segment with team_unsettled instead of a terminal authorization error.
No automatic hold retry loop or new blockers report field is introduced.
Limitations/nextSteps carry Agent-authored blockers. Historical completed/fallback
reports are immutable and cannot be reopened in this version. Report schema v2
adds optional closure/segments/blocks and keeps schema-v1 reading compatibility;
Host-facts construction remains available for explicit acceptance and historical
failed completed-report Retry. Remote v1 displays holds read-only; it does not
acquire local continuation or close capability.

## Consequences

- Completion means verified contract outcome, not a successful model boundary.
  A held session is idle but keeps its execution identity and scratch workspace.
- Main/headless dispatch call Host settlement rather than independently finishing
  and then finalizing Goals. Host owns attention/completion notification decisions.
- Resume and close require the current hold version and owning session. Concurrent
  stale actions, competing queued/running execution and running turns are rejected.
  Admission failure returns to a hold rather than consuming the continuation path.
- Existing report files/rows and non-Goal behavior are retained. New automatic
  fallback completion is removed; acceptance is explicitly labeled unverified.
- P9 upgrades behind the verified Plus backup and does not advance the shared
  schema. The interrupted encoding preserves shared row vocabulary only. Existing
  Prior Plus binaries refuse a v9 database before mutation because of their newer-Plus
  guard. The user accepted this compatibility boundary: whole-database downgrade to
  prior Plus versions is unsupported; the unchanged execution column and CHECK remain
  compatible with interrupted rows. Do not bypass the guard, lower metadata or
  claim that an old application can open a v9 database.
- Acceptance requires the Host matrix and CAS/lifecycle tests, real runtime resume
  context and per-segment budget tests, Renderer action tests, and the incident-shaped
  cross-process paths A–G and the accepted H boundary. Historical incident files
  are evidence, not test fixtures to modify. Legacy fallback evidence uses an isolated old-binary fixture and
  never the production incident session. Native 010 uses a real sidecar child/
  proxy; UI-001 uses real sandboxed Renderer components/Composer and a fixture
  preload boundary. Neither lane alone proves the whole Desktop journey.
  H verifies legacy interrupted-column
  compatibility separately from the fail-closed whole-database downgrade refusal.

## Alternatives

- Adding blocked to the shared execution CHECK would require a table rebuild,
  diverge from upstream and still not bypass the old Plus-version open guard.
- Keeping fallback completion would report unfinished contracts as completed.
- Creating a new Goal for each continuation would require approval again and lose
  same-execution progress/report history.
- Automatically retrying blocked Goals would spend model calls without the user's
  missing input or decision and conceal the held boundary.

## Integration amendment (2026-10-16)

Main already shipped P8 for interaction policy and terminal details. Goal holds
therefore use P9. P7, main P8 and the original Goal P8 candidate upgrade behind
a verified backup, preserving their existing rows and applied feature data.
