# ADR: Host member activity evidence and explicit forced interruption

- Status: Accepted
- Date: 2026-10-11
- Related: ADR plus-expert-team-collaboration, ADR 0166

## Context

A quiet expert can be running a long background test without any Git activity.
The previous `interrupt_agent` / `team.interruptMember` path stopped any running
member turn without inspecting Host activity. Leads also could not distinguish
waiting for a member from waiting for that member's already queued report.

The approved reliability plan requires a ten-minute activity safeguard and an
explicit `force` with a reason. It does not authorize automatic inactivity
killing, shell-budget changes, mailbox delivery changes, or wider permissions.

## Decision

Extend `team.getRoster` additively with optional `memberActivity`, containing
Host observations for the Lead and named members. Read live managed background
state (including pending finalization), active Bash ownership, latest turn and
tool observations, completed physical request usage, and queued Team mail ages.
Expose identifiers, names, statuses and counts; exclude command bodies, paths,
report text and provider credentials. ACKed mail remains queued until consumed.

Do not use received/queued mail as member execution activity. A member's own
outbound response is activity, except Host-authored approval/failure notices
that use a member identity. Turn start, tools, observed usage and background
start/completion are activity within ten minutes. Active managed background
processes and owned foreground Bash calls protect a member regardless of age.

Persist the first Host observation of a physical request identity in existing
KV storage in the same savepoint as its usage ledger update. Replayed usage may
increase its known token count but never refresh its activity timestamp. Usage
without an observation timestamp is unknown historical activity, not recent
activity. Counts cover completed reported usage, not in-flight provider calls.
Do not infer duration, cost or liveness from missing usage or Git changes.

Extend the interruption request with optional `force` and `reason`, preserving
all existing participant/Lead checks and stop-only strategy authority. Default
requests return `TEAM_MEMBER_ACTIVE` when protected. `force:true` requires a
trimmed, nonempty reason of at most 1000 characters; missing reasons return
`TEAM_INTERRUPT_REASON_REQUIRED`. This override grants no dispatch, approval,
filesystem or process capability. No-running-turn still returns false.

Before emitting the existing exact-turn interruption notification, persist a
`team_member_interrupt` audit record with caller, target, turn, override,
reason and evidence. Audit redaction applies as usual. An audit failure prevents
the notification. Projection, decision and notification share the Host state
lock so a stale snapshot cannot interrupt a replacement turn.

## Consequences

Old readers can ignore the additive projection; old interruption callers gain
the intended safety refusal without a protocol-version bump. No database schema
or mailbox idempotency change is needed. The runtime only forwards arguments
and renders Host evidence; it does not implement a competing guard.

No observation is proof that an expert is dead. This is an explicit stop guard,
not a watchdog. Provider internals remain unknown during a quiet request.

## Alternatives

- Git activity as a heartbeat: rejects legitimate compute-only work.
- Runtime-only guard: bypassable by direct RPC and races with Host state.
- Automatically kill after silence: outside the approved scope and risks data.
- Expose reports or command output in status: widens the trusted text boundary.

## Verification

`team_member_activity_tests` replays a twenty-minute running background job,
idle eligibility, foreground ownership, authority refusal and audited force.
Domain tests cover five-hour ACKed queues and durable usage replay. The real
Host/fake provider script `scripts/e2e-team-member-activity.mjs` exercises the
Lead's actual `team_status` and `interrupt_agent` tools without a paid API.
