# ADR 0234: Keep project memory host-owned and path-scoped

- Status: Accepted (amended 2026-10-23)
- Date: 2026-09-12
- Deciders: PI-Desktop maintainers

## Context

Projects need a durable memory surface similar to ChatGPT Projects. Renderer
preferences are not a safe owner for model context: they are presentation state,
can be reset independently, and do not provide a host-enforced boundary when a
session switches projects.

## Decision

Store one user-authored memory collection per canonical project path in the
existing host `kv` table under the `projectMemory` namespace. The visual editor
stores normalized entries with an id, optional title, and content using the
`entries-v1` format. The host also derives a readable plain-text `content`
value, limited to 32 KiB, for runtime injection. Electron main loads the value
for the session-bound project path and passes it to the agent runtime. The
runtime renders it after project instructions as explicitly user-provided
context and compares it when deciding whether an idle runtime can be reused.

The memory editor is exposed from Settings > Memory and the Project archive
row menu. Both entry points use the same host-owned collection. Creating a
project keeps the creation surface compact and shows that project memory is
available later; it does not add a memory mode selector whose semantics the
application does not implement.

## Consequences

- Memory survives renderer restarts and is isolated by canonical project path.
- The visual editor can add, edit, and remove memory entries while the runtime
  consumes the host-derived plain-text projection. Existing legacy records that
  contain only `content` remain readable as one untitled entry.
- Changing memory retires the next reusable runtime so a follow-up prompt sees
  the new value.
- Project memory cannot override runtime safety, tool, or collaboration rules.
- No schema migration is needed because `kv` is the existing extensibility
  boundary for new configuration domains.
- ADR 0249 adds an explicit host-owned logical project-group identity and root
  membership model. Path-scoped records remain the compatibility behavior for
  legacy single-root projects.

## Plus amendment: opt-in agent updates and on-demand recall

The user editor and Agent now share the same Host-owned collection. Agent writes
are default-off and prohibited in Plan/Goal; per-entry CAS and editor snapshot
CAS protect concurrent edits. Per-turn refresh replaces launch-only freshness.
This keeps Rust persistence ownership and the labelled user-context boundary.
Project-scoped history retrieval and a disposable local text cache complement
memory without moving database ownership to Electron or adding a model service.

The memory implementation adapts contributor hui455's upstream PR #951
(head `aa36735d8d55dd314dfedf94b05e3b3f5528caf8`) to the Plus branch, preserving
its unified collection and opt-in design. Workspace cache design references
PR #697 by muzimu217 (`ceb8908dac02794f2d071e720ea74ce26a60a014`); this version
adds a separate literal CodeSearch tool and does not take over Grep's results
or claim the upstream feature was merged.

## Worktree amendment: stable memory spaces

[Stable project memory spaces](worktree-project-memory-spaces.md) amend the
original path-scoped ownership decision. Verified checkouts use a Host-generated
UUID and `memory:<uuid>` owner, with one shared collection and opt-in preference.
Explicit multi-root groups remain stable logical boundaries, including Git and
non-Git roots; different explicit groups are not automatically combined.

Old path/group source collections remain intact and readable for recovery.
Imports preserve differing notes and source attribution without truncation. A
combined value over 32 KiB leaves the sources unchanged, pauses recording and
exposes a manual snapshot-CAS recovery editor. An empty shared collection does
not resurrect old source notes. Generic worktree sharing changes memory only;
tool roots and instruction chains remain bound to the actual checkout.
