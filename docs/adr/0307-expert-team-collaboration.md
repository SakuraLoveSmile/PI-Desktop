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
   hidden. Instead, nine specialized team tools (`spawn_teammate`, `send_message`,
   `task_create`, `task_update`, `task_list`, etc.) are provided.

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
be admitted. The nine existing Team tools remain available, but their Host
entry points reject unapproved work with `TEAM_APPROVAL_REQUIRED`.

Review revision checks apply on the Host, including retries. Confirmation
persists the selected effective bindings, approved member identities and one
idempotent Lead continuation together; it makes no provider call. Existing
pre-upgrade durable mailbox entries keep their original recovery semantics.
The sidecar proxy exposes declaration and reads, never the trusted UI's review
update/confirm/cancel operations. No process ownership, database schema or
Plugin SDK contract changes are introduced.
