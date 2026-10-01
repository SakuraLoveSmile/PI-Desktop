# ADR 0307: Host-owned Expert Team collaboration with durable member sessions

- Status: Accepted for implementation
- Date: 2026-09-25
- Amends: ADR 0239, ADR 0165
- Related: ADR 0062, ADR 0237, `packages/shared/src/types/sessions.ts`

## Context

Complex software tasks require coordinated teamwork: a Lead agent collaborating
with specialized teammates capable of parallel execution, durable session
identities, a shared revisioned task board, structured messaging, and
predictable plan and goal execution.

PI-Desktop's existing collaboration models each serve distinct purposes:

1. **In-process subagents (`Task*`)**: Governed by ADR 0062, standard Agent turns
   can spawn up to 10 lightweight delegate subagents (`explorer`, `fixer`,
   `code-reviewer`, `test-runner`, etc.). Subagents run in-process, produce
   compact reports, and terminate with the parent turn. They lack durable session
   identities, cannot receive follow-up messages across turns, and cannot coordinate
   among peers.
2. **Withdrawn A2A peer stack**: ADR 0165 withdrew the unconstrained peer-to-peer
   broker, toolset, and direct SQLite access because distributed peer autonomy
   bypassed host authorization boundaries and created untrackable state.
3. **Plugin session collaboration**: ADR 0237 and ADR 0239 established a
   host-owned ledger for the `pi.session-orchestrator` plugin, enabling scoped
   parent-worker messages. However, plugin workflows cannot own native product
   concepts like an Expert Team, a shared task board, or first-class UI projections.
4. **Third-party frameworks**: The public `@deepseek-ai/dsh-experimental-agent-team-profile`
   specifies full Team behavior (Lead, named teammates, roster, shared task board,
   mailboxes, and team tools). However, importing Cordis directly into PI-Desktop
   would violate the frozen process model (Renderer -> Preload -> Main -> Rust Host / Agent Runtime)
   and compromise host persistence invariants.

## Decision

PI-Desktop implements **Expert Team** collaboration with host-owned authority,
reusing durable Sessions as teammates and extending ADR 0239's scoped messaging
ledger to team peers:

1. **Execution Profile**:
   Sessions introduce an orthogonal `executionProfile = "standard" | "team"`
   property. It defaults to `"standard"` for full backward compatibility.
   `ExecutionProfile` governs whether a session executes as a standalone agent
   (with `Task*` subagents) or as the Lead of an Expert Team. Contract modes
   (`none`, `plan`, `goal`) remain completely independent of the execution profile.

2. **Durable Sessions as Teammates**:
   Each team member is a genuine, durable PI-Desktop `Session` with its own
   transcript, project association, model binding, and permission ceiling.
   Teammates are not transient in-process delegates.

3. **Host-Owned Team Authority**:
   Rust `host-core` is the sole authority for team state, persisting:
   - `teams(team_session_id, revision, paused)`
   - `team_members(team_session_id, member_session_id, name, description, context_kind, phase, model_id, provider_id, error)`
   - `team_tasks(team_session_id, task_id, revision, subject, description, status, owner_session_id, blocked_by, write_scopes)`
   - An internal `team` origin on the `session_collaboration_messages` ledger.

4. **Scoped Sibling Messaging Exception**:
   Extending ADR 0239's exception to ADR 0165, authenticated members of the same
   team may exchange structured messages through the host collaboration ledger.
   Cross-team or arbitrary session-to-session messaging remains strictly forbidden.

5. **Roster and Lifecycle**:
   - The Lead can create at most 8 named teammates with fresh context or
     completed-prefix fork context.
   - Teammate names are immutable within a team and cannot be recycled.
   - Teammates cannot spawn other teammates (flat hierarchy).
   - Only the Lead can interrupt or pause teammates.

6. **Shared Task Board with CAS and DAG Validation**:
   - The shared task board holds at most 256 live tasks.
   - Updates enforce Compare-And-Swap (`expectedRevision`).
   - Dependency declarations undergo cycle detection and missing-dependency
     rejection before commit.
   - Advisory write-scope overlap warnings are surfaced without relaxing host
     filesystem permissions or PathMutex containment.

7. **Mailbox Queue and Pause Semantics**:
   - Mailboxes hold at most 64 pending messages per member (max 64 KiB per framed message).
   - User Stop on the Lead atomically sets `paused = 1` before aborting active
     turns. While paused, queued mail cannot claim target turns.
   - Resume Team explicitly unpauses the team and resumes orderly delivery.

8. **Tool Catalog Isolation**:
   In Team turns, standard `Task*` subagent tools and plugin `SessionTask` are
   hidden. The dispatch tools are defined by `TEAM_TOOL_NAMES`; the Lead-only
   `declare_team_strategy` is defined separately in `TEAM_LEAD_TOOL_NAMES`.
   These catalogs, not a numeric count, define which Team tools are available.

## Consequences

- Clear conceptual separation between contract mode (`none` | `plan` | `goal`)
  and execution profile (`standard` | `team`).
- Full backward compatibility: all existing sessions, APIs, and workflows
  continue operating under `executionProfile = "standard"`.
- Host-level security: no client or renderer can forge team origin or bypass
  host permission ceilings.
- Storage schema upgrades safely to version 21 with additive migrations.
- Desktop UI gains clear two-axis Composer controls (`Agent` / `Expert Team` profile
  and `None` / `Plan` / `Goal` contract).

## Launch approval amendment (2026-10-01)

The Team Lead declares a strategy using its current Host-owned turn identity.
A delegation proposal creates a pending review only. Trusted Desktop review
operations select provider/model/thinking bindings and atomically confirm the
batch before new expert sessions, execution assignments or work messages can
be admitted. The dispatch catalog remains `TEAM_TOOL_NAMES`, while the
Lead-only `declare_team_strategy` is represented separately in
`TEAM_LEAD_TOOL_NAMES`. These symbols, rather than a numeric tool count, define
the current boundary. Host mutation entry points reject unapproved work with
`TEAM_APPROVAL_REQUIRED`.

Review revision checks apply on the Host, including retries. Confirmation
persists the selected effective bindings, approved member identities and one
idempotent Lead continuation together; it makes no provider call. Existing
pre-upgrade durable mailbox entries keep their original recovery semantics.
The sidecar proxy exposes declaration and reads, never the trusted UI's review
update/confirm/cancel operations. No process ownership, database schema or
Plugin SDK contract changes are introduced.

## Presentation and live-snapshot amendment (2026-10-02)

This amendment records the additive contracts used by the Expert Team UX
repair. The implementation is covered by isolated candidate validation in the UX
repair plan; this ADR does not establish user acceptance or release status.

### Presentation metadata follows review-before-dispatch

The immutable `TeamMember.name` remains the Host routing and messaging handle.
Optional `{ role, displayName }` presentation belongs to a proposed member on
`declare_team_strategy`, then to the serialized `TeamLaunchReviewMember`. It is
plain display data and grants no execution capability. The review screen keeps
it while provider/model/thinking choices are edited. No member session, task
assignment, or mailbox work is created before confirmation. Confirmation
persists presentation in the existing KV namespace
`team-member-presentation-v1`, keyed by member session ID, in the same Host
transaction as approved creation/review state. Missing presentation on an old
review remains valid. This adds no SQLite schema migration and does not add a
presentation argument to `spawn_teammate`.

Legacy handles remain immutable and receive a deterministic renderer display
projection. Unknown handles use the collaborator role; recognized historical
scout handles use stable roster-order aliases. Portrait selection hashes the
durable member Session ID, so refreshes do not change identity.

### Shared read view and notification

The additive `team.getSnapshot` read returns one flat `TeamSnapshot`: Team ID
and revision, pause state, members with optional presentation, tasks,
readiness, scope overlaps, real Lead phase, queued Team-mail count, current
launch review, and latest execution decision. Keeping review and decision in
this response lets Overview, the Team panel, and the approval surface share one
revisioned reader without removing the existing review mutation APIs. Existing
roster and board reads remain for compatibility.

Committed Team mutations publish `team.changed` with Team ID, revision, and a
bounded reason. Main forwards the notification through the existing Desktop
event path. It contains no prompt or transcript content. The local Desktop
renderer owns a scoped reader for visible Team surfaces; remote/native sessions
retain their existing source projections and are not routed through local Team
IPC. Lower revisions cannot replace newer state. A failed read keeps the last
good snapshot visibly stale and exposes Retry.

`SessionSummary.team` is a Host-derived relation used to group durable member
sessions beneath their Lead. Grouping changes presentation only: member IDs,
transcripts, pin/archive semantics, and individual actions remain intact.

### Activity remains Host-owned

Member phase follows successful turn admission and durable turn settlement,
atomically with turn state. Aborted/interrupted work returns to idle; a failed
turn becomes failed; successful settlement completes only the member turn and
does not complete its tasks. Task readiness remains separate. A late settlement
cannot overwrite a newer running turn. Lead activity comes from the Lead's
actual turn projection; task status and pause state do not fabricate a running
Lead. Unclaimed Team mail prevents a settled Lead from being presented as a
fully completed collaboration.

Team row creation/configuration is part of the session transaction. Restricted
legacy bootstrap respects a durable KV dissolution marker, preventing a read
from recreating removed Team state. Lead deletion checks Plan/Goal gates first,
then commits Team cleanup and session deletion together before removing files.
A Lead holding durable Team data cannot switch to the standard profile;
an empty Team may convert atomically. These repairs preserve member sessions
and require no database schema change.

The process model, permission ceilings, Team/standard Task tool isolation,
session persistence ownership, and Plugin SDK contract do not change. The
additions are local-Host projections and renderer presentation over existing
Host-owned sessions, KV metadata, and Team tables.
