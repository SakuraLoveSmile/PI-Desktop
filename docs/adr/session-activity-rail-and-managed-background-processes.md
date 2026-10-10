# ADR: Session activity rail, managed background processes and Quick Notes

- Status: Accepted
- Date: 2026-10-09

## Context

Compact transcripts need a quiet place to monitor independent work without
repeating every tool detail between progress paragraphs. The accepted reference
uses a right activity rail. Existing Overview records already identify plans,
delegations, successful changed files and captured sources, but no canonical
background-process registry or persisted notes existed.

## Decision

Keep transcript order and the existing process architecture. The display mode is
changed only in Settings / General / Defaults, using the existing persisted
`thinkingDisplayMode` field and Detailed fallback. A session-owned activity rail
contains plans, agents, background processes, outputs, sources and Quick Notes.
It reserves 264px only when the actual chat surface is at least 820px wide and
the work panel is closed. Otherwise the same controls remain reachable in the
activity view of the existing work panel. Hidden retained panes neither read
Host resources nor act on the current session implicitly.

Reuse one pure plan/delegation projection with Overview. Files and references
come from recorded actions in the loaded reading range, never assistant claims
or enabled-plugin inventories. Range-limited history is explicitly identified.
Captured web links allow HTTP(S) without embedded credentials and retain the
existing host browser permissions. Resources open a session-scoped work-panel
context even if an asynchronous artifact resolution finishes after a switch.

Extend `Bash` with optional `run_in_background`, default false. Pi's existing
argument conversion remains unchanged; the Host independently requires a
boolean at its RPC boundary. A background command goes through the same mode,
permission, pinned-shell, workspace and admission path once. Rust owns its
runner and process tree, cancellation, output and execution permit. The start
receipt names the process and does not claim its command exited successfully.
Do not implement background work with shell `&`, move shell execution into the
renderer/Node, or introduce a second authorization path.

The Host provides session-scoped list/read/stop operations and changed events.
All active processes remain listed alongside the most recent 100 terminal
records. Output is bounded at 64KiB per stream (stdout head, stderr tail), with
visible truncation and execution errors. A job retains its permit until its
process tree exits. Explicit stop signals its owner even if writing the stopping
state fails; a storage failure remains observable. Failed terminal persistence
retains the terminal result and output in memory, and a scoped read/list/stop
makes one repair attempt. No retry automatically re-executes a command.

Commands outlive the model turn, renderer reload and sidecar replacement. Host
EOF/application shutdown drains runners; a new Host marks unfinished durable
rows interrupted, never resumes them or kills a persisted PID. Session/project
and plugin deletion refuse active or unpersisted terminal jobs until they are
stopped/saved. A database trigger protects deletion paths that omit the RPC
precheck. Duplicate session/tool-call identities never start a second command.

Quick Notes stores exact user text per local Desktop session, with a 64KiB
UTF-8 limit and a revision CAS. Explicit save is distinct from a transient draft.
Dirty drafts survive retained-pane switches/eviction during the renderer
lifetime; conflicts preserve the draft and require a deliberate reload and
save. Notes never enter model context, transcripts or forked sessions. SQLite
ownership remains exclusively in Rust. Both tables use additive, idempotent
Plus migration P5, preserving the upstream schema chain.

## Alternatives and consequences

A renderer-only note store would lose saved text and violate data ownership.
Moving shell execution into Node would duplicate existing permission/process
cleanup boundaries. Showing a fixed rail in every window would violate the
chat width floor; the work-panel fallback keeps management accessible.

The new APIs and optional Bash parameter are additive. Old clients keep
foreground behavior and ignore the new resource APIs. Local native Pi and
remote sessions do not expose unsupported management controls. The packaged
Host, shared contracts and runtime must be upgraded together for background
launch. Existing command timeout and permission rules still apply.

A hard crash during a terminal storage failure cannot preserve output that has
not been written; the durable row is recovered as interrupted, with no replay.
Windows process-tree behavior requires platform acceptance separately from the
macOS production-runner evidence.

## Validation

Focused tests cover authorization/admission, deduplication, session isolation,
output limits, explicit stop, storage failure repair, schema replay and note CAS.
Real production Host E2E covers child/grandchild cleanup under stop, EOF,
application dispose and forced Host loss, plus interrupted recovery and notes
across restart. Real React/Chromium tests cover interaction, hidden-pane reads,
stale responses, saved/dirty/conflict note states and responsive activity access.
