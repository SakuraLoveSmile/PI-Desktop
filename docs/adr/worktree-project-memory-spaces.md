# ADR: Share durable project memory across verified worktrees

- Status: Accepted for the implementation candidate; user acceptance pending
- Date: 2026-10-23
- Amends: ADR 0234, ADR 0249, [worktree-memory-owner](worktree-memory-owner.md)

## Context

A checkout path is an execution location, not a durable project identity.
Branch worktrees and disposable detached slots otherwise acquire separate notes,
recording preferences and history scopes. Reusing a slot for another repository
also makes path-only attribution unsafe. Mapping every checkout into a tool
project group would solve the display problem by granting unrelated file access.

## Decision

Rust Host owns a versioned memory space with a generated stable UUID. Editors
and recording operations use `memory:<uuid>` as their compare-and-swap owner.
Fresh Git evidence associates registered checkouts through their common Git
directory and its filesystem identity. Display names, branch names, matching
basenames and a previously occupied path are insufficient evidence. Git probing
runs outside Host/database locks; trusted session bindings are checked again
before reading or changing memory.

Automatic Git association requires reliable common-directory birth/creation
metadata and filesystem identity. If that evidence is unavailable (for example,
a Linux filesystem without creation metadata), Host retains the original scope
instead of guessing. On non-Unix platforms a moved directory is not inferred to
be the same repository. No marker is written into `.git`. Explicit user project
groups can still share their selected roots; changing/replacing those roots
continues the group's existing logical memory semantics. This is distinct from
automatic slot reuse, which must isolate the new repository with a new UUID.
Linux behavior requires platform evidence; this decision records no Linux run.

Explicit multi-root groups remain deliberate user-owned boundaries. All selected
roots of one such group share its stable logical memory, including mixed Git
and non-Git roots. Automatic repository association must not combine separate
explicit groups, even if their roots belong to the same Git repository. Memory
associations never modify a group's roots, instructions or filesystem policy.
Promoting an existing primary checkout into an explicit multi-root group keeps
its memory UUID, current collection and historical session membership. Creating
an independent group from a branch/slot copies its current collection into the
new group's UUID and transfers only sessions from the selected roots. This
requires fresh matching repository evidence; a reused path cannot authorize
copying its previous repository's notes. Shrinking an explicit group back to one
root retains its logical identity.
Adding a root already bound to another memory space is rejected atomically;
this change does not silently merge separate live collections or replace their
session identities. A first promotion of an associated checkout also requires
fresh evidence, including for internal/config-sync callers. Existing explicit
groups keep their identity when updated without new Git evidence.

Versioned Host `kv` namespaces hold spaces, repository/checkout associations,
session bindings, content and imported-source ownership. This uses the existing
extension boundary without a relational schema reset. A first valid association
may persist these records; repeated steady-state reads do not rewrite them.
Existing path/group collections remain intact. Import combines eligible notes
transactionally, deduplicates identical entries and preserves differing notes
with source attribution. It never truncates a collection to fit the 32 KiB
rendered-context limit. An authoritative empty shared collection stays empty
instead of falling back to preserved old notes.

If the combined context exceeds 32 KiB, the transaction rolls back. The existing
source editor returns `migrationRequired`, retains its complete snapshot and
permits manual CAS edits. Automatic recording stays paused. The user can export
or shorten source collections, save, then reload to retry association; no partial
shared collection or silent deletion is published.

The user editor and agent share one collection and recording preference.
Recording remains default-off; enabling it is an explicit action. Agent writes
require Agent execution mode, the trusted session binding and entry CAS.
Plan/Goal remain read-only. Editor replacement requires both owner and full
snapshot CAS. Disabling recording retains readable notes and revokes write tools
on the next turn. No background model, embedding service or extraction job is
introduced.

Generic worktree projection replaces only project memory. The actual checkout
keeps its cwd, tool roots and checked-out/global instruction chain. The narrow
KaneoPilot schema-1 slot projection retains its earlier owner-group instruction
compatibility, without adding owner roots or copying untracked owner files.
Validated stable spaces may now support opted-in Agent writes through a slot;
the earlier read-only restriction remains only for legacy alias fallback without
a registered shared space.

A session captures its memory-space identity when created or first associated.
Forks inherit that binding in the snapshot transaction. Explicit session moves
and the deliberate project-group transition above can replace a binding; ordinary
reads cannot. History search/read uses
that identity to include related worktree sessions, retains source session/path
provenance and excludes other memory spaces. Removing a worktree does not erase
its notes or historical source membership. A new repository at the same path
receives its own association; old sessions remain with their old space and stale
session operations are refused instead of silently rebinding.

The verified cold profile-copy relocation is the sole exception for rebinding a
copied internal Git directory's physical identity. It requires the source's live
identity to match the stored space and the destination to be the verified copy.
The offline transaction retains the UUID/content/session bindings, replaces the
repository index and retires the old backup's index. Ordinary clone, startup and
resolver paths do not use this exception. Internal repositories with registered
linked-worktree pointers refuse relocation before cutover rather than rewriting
Git configuration or publishing an unusable profile; the original stays active.

The Host adds `memoryProject` metadata to project-group list rows and
`memoryProjectId` to session-list projections. Settings, Sidebar and Projects
collapse rows by that verified ID, preserving the underlying groups. Session
selection opens its actual checkout. Edit/delete/new-task actions target an
actual representative checkout; shared presentation never expands deletion or
tool-root scope. Related task rows expose their checkout source.

## Consequences and alternatives

- Durable memory survives checkout removal, slot reuse and restart while
  workspace permissions remain owned by the existing group/Host resolver.
- Upgrade reads can create associations or import content. The earlier blanket
  assertion that all alias reads leave every `kv` row unchanged no longer holds;
  preserved source bytes/timestamps and steady-state no-op reads are separate
  invariants.
- Path-only storage remains a compatibility/recovery surface, not the identity
  for verified shared worktrees. Distinct explicit groups retain their boundary.
- Portable configuration sync keeps its existing schema and mapped project/group
  scope. It exports shared content once per local memory space; imports and
  deletion tombstones update the mapped local shared collection. Space UUIDs,
  repository identities, checkout/session bindings and recording opt-in remain
  device-local and are not exported or used to infer cross-device associations.
- Path/name matching was rejected because it leaks history after slot reuse.
  Automatically adding worktrees to tool groups was rejected because it widens
  file access and instruction scope. External semantic-memory services were not
  needed for this local persistence defect.
- The executable scenario remains `E2E-PLUS-worktree-memory-owner`. Its isolated
  protocol harness uses real Git, Host, SQLite and Sidecar with a deterministic
  local provider. UI rendering, installed-build behavior and paid/real-model
  behavior require their own evidence; this decision records no passing run.
