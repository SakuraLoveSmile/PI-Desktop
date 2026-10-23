# ADR: Resolve verified worktree memory without aliasing workspace access

- Status: Accepted for the implementation candidate
- Date: 2026-10-16
- Amends: ADR 0234, ADR 0249
- Amended 2026-10-23 by [stable project memory spaces](worktree-project-memory-spaces.md)

## Context

KaneoPilot reuses detached planning/review worktrees. Their paths have no real
project memory, while mapping them into a logical project group would also
grant tool access to its roots and disclose those roots in launch prompts.

## Decision

Use a memory-only Host resolver for KaneoPilot's fixed, derived slot registry.
Validate the bounded projection and actual Git worktree identity on each read,
outside Host locks; recheck session identity before reading persisted memory.
Return additive memoryAlias context without roots and use it for launch and
every-turn refresh. The original implementation made every alias read-only.
The stable-space amendment now permits opted-in Agent writes after Host validates
and registers a shared memory owner; only legacy alias fallback remains read-only.
Plan/Goal writes remain prohibited. Generic Git worktrees share only memory;
this narrow slot projection retains its existing owner-group instruction
compatibility. Neither path widens tool roots or the filesystem instruction chain.
Session memory identity and cross-worktree history now follow the amended stable
space contract, independently of tool project-group membership.

## Consequences

Existing group/path source collections and callers remain readable. Stable
spaces add transactional associations/imports in versioned Host `kv` namespaces;
initial association can write derived records, while steady-state reads do not.
Source notes are preserved and oversized imports require manual CAS recovery.
Plus requires the matching producer projection but never writes it. Invalid
entries degrade to the original slot context with observable diagnostics.
Each refresh can revoke stale alias content. Real untracked root instructions
remain outside this feature. A direct primary-root mapping or manual group
registration was rejected because it would widen workspace access.
