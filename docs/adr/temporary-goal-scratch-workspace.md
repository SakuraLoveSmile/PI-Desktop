# ADR: Temporary Goal sessions own a persistent scratch workspace

- Status: Accepted
- Date: 2026-09-25
- Amends: [ADR 0124](0124-temporary-session-scratch-workspace.md)

## Context

The UI permits a temporary session to negotiate a Goal, but submission required
an explicit project. A valid `SubmitGoal` therefore failed with
`PLAN_WORKSPACE_REQUIRED` before an approval existed. Ordinary tools already
resolve these sessions to their own Host-managed scratch root. Requiring the
user to repeat the negotiation inside a project is unnecessary.

## Decision

Use the same session-owned scratch root for temporary Goal checkpoints and
approved execution outputs. Keep `projectPath` absent, Plan's project
requirement unchanged, and the existing approval, immutable artifact hash,
permission, containment, and no-replay startup boundaries. Resolve approval
against the stored proposal kind rather than the session's current mode.
Persist an explicit `artifact_workspace_kind` column (`project` | `scratch`)
on `plan_approvals` (schema version 20) so the contract's origin remains durable
even if the session is subsequently moved to a project or enters Agent mode.
Artifact previews resolve the proposal's own session root, never the currently
visible workspace. Existing project previews preserve their established UI.
A temporary session with a persisted Goal checkpoint retains its scratch
workspace across age sweeps. Session deletion still removes the workspace;
ordinary scratch retention is unchanged. Failure to read retention identities
must not cause data deletion.

Submission failures must enter the runtime's actual tool-error channel. A
failure result embedded in successful tool content is not sufficient. Successful
submission terminates the negotiation turn and awaits explicit approval.

## Consequences

Temporary Goals can be negotiated, approved and executed without binding a
project, and their outputs survive restart. Persisting the workspace origin
requires Host database schema version 20 (`artifact_workspace_kind`), with safe
migration defaulting historical rows to `'project'`. No public RPC protocol
version bump or Plugin SDK change is necessary. Goal data now has the lifetime
of its owning session, so users must retain that session to retain its outputs.

## Alternatives

- Requiring a project at mode selection would preserve the older restriction,
  but the user explicitly selected support for temporary Goals.
- Falling back to the visible project risks writing into an unrelated project.
- Treating scratch as a project would also change project-scoped instructions,
  memory and plugin activation. Host workspace resolution avoids that change.
