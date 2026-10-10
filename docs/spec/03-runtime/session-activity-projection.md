# Complete session activity projection

The local Desktop Overview reads Host-owned summaries of the complete canonical
active transcript. Renderer transcript windows, display limits and compactions
do not restrict this inventory. Archived inactive regenerate branches are not
included. Plans/Goals, Team membership and managed processes retain their
existing authoritative services; they are not reconstructed from this projection.

## Read contract

`sessionActivity.get({sessionId, offset?: 0, limit?: 50})` returns `{activity}`.
The additive v1 contract does not change protocol 11 or storage schema:

- `version: 1`, owning `sessionId`, and SHA-256 `revision` of the complete summary;
- `subagents`, `changedFiles`, `websites`, `attachments`, and `references`
  (`skills`, `memory`, `mcp`);
- `totals`: full counts for the seven collections;
- `hasMore`, `nextOffset`: each collection contributes the same bounded slice,
  at most 50 entries. A caller drains all pages and checks revision consistency;
- `limited`: recorded literal identities/paths/URLs over 4096 UTF-8 bytes or
  invalid literal identities cannot be displayed. This is distinct from a
  renderer reading window and is never claimed to be fixed by loading earlier
  messages. Display labels/task summaries use at most 1000 Unicode characters;
  exact actionable paths and URLs are never rewritten into guessed aliases.

Readers validate version, session identity, collection shapes, safe numbers and
HTTP(S) source URLs. Pagination is published atomically. A changed revision or
post-commit notification discards the partial sequence and begins a current
sequence, so counts never combine different canonical histories.

The Host validates a live local Desktop session before any transcript access.
Remote, native/imported and missing/deleted sessions are rejected. No message
prose, tool output body, file/attachment contents, credentials, filesystem reads
of output paths, model calls or network requests are returned/performed.
No schema, cached persisted projection or migration is introduced.

## Evidence semantics

Successful non-error Write/Edit operations are grouped by their exact literal
path. Counts include every matching canonical operation; latest recorded valid
time/message owns navigation. Complete matching ReviewChange v1 facts provide
line totals only when every operation supplies full nonbinary/nontruncated
metrics. Otherwise totals are absent. Attachments and recorded Skill/MCP
references remain recorded evidence, never enabled extension inventories.

Safe captured HTTP(S) citations are grouped by hostname; each captured occurrence
counts once and the first safe URL remains the opening destination. Embedded
credentials and malformed/non-HTTP(S) URLs are excluded.

Only Task/Subagent start calls create delegate rows. Later lifecycle snapshots
settle their status/timing, and refreshed terminal launch receipts outrank older
running lifecycle snapshots. Known terminal receipt timing fields have priority;
lifecycle timings fill only missing fields and cannot erase completion time. Each receipt's indexed owning turn determines
whether it remains live; a later running turn cannot revive old receipts. Missing
or legacy NULL turn attribution is conservatively reconstructed as aborted.
Renderer pending/newer Task activity is merged by delegation identity or the same
canonical message identity while persistence catches up; reused provider call IDs
never merge distinct historical records. It must not create duplicate rows or
revert a known Host terminal state to older running data.

## Canonical changes and delivery

`sessionActivity.changed({sessionId})` is emitted after successful canonical
append, replacement, truncation, revision save/activation and turn start/end.
It follows durable persistence rather than the earlier agent message stream.
Electron forwards the allowlisted event; visible readers coalesce notifications,
refresh on focus/Host restart, reject late generations and detach when hidden.

A narrow append exception persists delegate settlement: an indexed canonical
Task/Subagent launch receipt with structured `details.delegationId` and running
status may advance to a known terminal delegate status. Message/call/delegation
identity, arguments, lineage, creation time and owning turn must match. Known
start-time conflicts fail; legacy receipts can gain their first known start time.
Only the canonical tool result/text are atomically replaced. Original index
position, turn, call completion/duration, tool usage and unknown block/meta
extensions survive. Duplicate terminal snapshots and stale running/different
terminal replays do not rewrite it. Ordinary tools remain immutable/idempotent.
Cross-session message-ID collisions apply the same settlement guard to the
owning session's namespaced canonical receipt, retaining the original call ID and
turn and leaving the other session untouched. Streaming effective-model metadata
refresh is outside this terminal-only change.

Old Hosts return METHOD_NOT_FOUND and explicitly fall back to loaded-message
projection with per-group range notices/history controls. Transient errors keep
a known full snapshot with an observable error/retry; an initial error marks the
loaded fallback explicitly. Host summary limits use a separate notice and do
not advertise renderer pagination as a solution.

## Verification

`session_activity` Host domain/RPC tests cover oldest history, full counts,
pagination revisions, writes/metrics, identity/privacy and restart. The renderer
reader tests cover atomic pages, changes, stale identity/restart/hidden reads,
unsupported/errors/retry and live terminal overlays. Delegation update tests
exercise the actual append settlement path, stale replays, immutable identities,
original usage/position, unknown canonical extensions and reopening.
`scripts/e2e-session-activity-aggregate.mjs` exercises real isolated Rust RPC,
production IPC registration and production renderer reader across tail-window
reads, canonical append events, delegate settlement/replay and Host restart.
