# ADR: Resolve verified worktree memory without aliasing workspace access

- Status: Accepted for the implementation candidate
- Date: 2026-10-16
- Amends: ADR 0234, ADR 0249

## Context

KaneoPilot reuses detached planning/review worktrees. Their paths have no real
project memory, while mapping them into a logical project group would also
grant tool access to its roots and disclose those roots in launch prompts.

## Decision

Use a memory-only Host resolver for KaneoPilot's fixed, derived slot registry.
Validate the bounded projection and actual Git worktree identity on each read,
outside Host locks; recheck session identity before reading persisted memory.
Return additive memoryAlias context without roots and use it for launch and
every-turn refresh. All alias access is read-only, including Agent sessions.
Do not modify the general group resolver, project binding, history/search
scope, filesystem instruction chain, or data ownership.

## Consequences

Existing group/path storage and callers remain compatible without migration.
Plus requires the matching producer projection but never writes it. Invalid
entries degrade to the original slot context with observable diagnostics.
Each refresh can revoke stale alias content. Real untracked root instructions
remain outside this feature. A direct primary-root mapping or manual group
registration was rejected because it would widen workspace access.
