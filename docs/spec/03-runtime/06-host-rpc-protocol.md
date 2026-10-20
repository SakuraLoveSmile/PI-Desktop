# 06. Host RPC Protocol

## 1. Goal

Define the local protocol between:

- Electron main (orchestrator)
- Rust host-core (privileged backend)
- Node pi agent sidecar (tool requester / event source consumer via host)

MVP transport decision (**D001**):

> **stdio JSON-RPC over NDJSON**

## 2. Transport

- Process: Electron main spawns Rust host-core sidecar
- Channel: child process stdin/stdout
- Framing: one JSON object per LF-delimited line (NDJSON); CRLF is accepted.
  U+2028 and U+2029 inside JSON strings are payload, never frame delimiters.
  All Node stdio readers preserve UTF-8 characters across input chunks and
  release buffered fragments/listeners on transport close. A final unterminated
  frame is accepted at EOF for compatibility.
- Invalid JSON frames produce a diagnostic containing only the byte length,
  never payload text, before being discarded. Later complete frames remain
  readable. Existing session text is not rewritten or migrated.
- Encoding: UTF-8
- Request/response: JSON-RPC 2.0 style

The control pipe is resource-isolated inside host-core. One dedicated OS
thread reads stdin and one dedicated OS thread serializes stdout; request and
tool tasks never perform Tokio stdio operations. This keeps temporary OS
thread exhaustion from turning a pipe read/write into a Tokio blocking-pool
panic. The threads retry interrupted and transient nonblocking errors while
preserving one-message-per-line framing; an unrecoverable pipe error ends the
host and is handled by the normal Electron supervision path.

### 2.1 Runtime admission and backpressure

Host-core does not create an unbounded task or subprocess for every request.
The RPC dispatcher caps active requests at 32. `tools.execute` then enters a
bounded execution budget:

- 16 total tool executions
- 4 concurrent `Bash` processes globally, subject to the 4-tool per-session limit
- 8 read/search tools globally
- 2 mutating tools globally, 1 per session
- 4 plugin tools globally
- 4 tool executions per session
- 64 queued tool executions globally

Permission prompts do not consume an execution slot. A full queue returns
`HOST_OVERLOADED` with retryable semantics in the tool result instead of
waiting indefinitely or spawning more work. The limits are host-owned so
Electron and the sidecar cannot independently over-admit the same resources.
Admission reserves total, tool-class, session, and session-mutation capacity
atomically. A queued call holds no execution capacity. When capacity returns,
the oldest runnable request is admitted; a request blocked by one class or
session does not block unrelated runnable work. Calls wait at most 30 seconds.
Dropping a waiting admission future or letting it time out removes its queue
entry and releases any reservation made before the caller receives its permit. The health counters report only
fully admitted reservations, including those awaiting delivery to the caller;
`queued` counts only requests still waiting for capacity.

A rejected `Bash` admission adds `content.capacity` to the existing tool result.
It contains `host` and requesting `session` counts (`inFlight`, `queued`,
`shellInFlight`, `shellQueued`) and `holders`, a sorted list of `{ sessionId,
tool: "Bash", inFlight }`. Counts are captured atomically at rejection, before
removing the rejected call's queue entry: a timed-out call is included in queued
counts; a queue-full call was never queued and is excluded. Granted reservations
count as in-flight, never queued. Diagnostics and admission logs contain only
session/tool identities and counts, never commands, paths or command output.
The English error explains that managed background processes and long `sleep`
hold a shell slot until they stop. Use `wait_for_updates` for Team replies, or
start long commands in the background and check their process status after
capacity returns; background execution uses the same limits. Bash descriptions
and execution Team prompts repeat the no-sleep-polling guidance. Non-shell
rejections keep their existing message and omit `capacity`; limits, retryability,
FIFO among eligible requests, approval and cancellation semantics are unchanged.

Electron's `HostProcess` treats an explicit `HOST_OVERLOADED` response as
retryable backpressure for renderer-facing calls. It waits 50, 100, 200, and
400 ms between at most four retries, then returns the structured error to the
caller. This retry applies only to an admission rejection; transport failure,
timeout, and errors from an admitted request are never replayed.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "method": "tools.execute",
  "params": {}
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "result": {}
}
```

### Error

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "error": {
    "code": 1003,
    "message": "PATH_OUTSIDE_WORKSPACE",
    "data": {
      "errorCode": "PATH_OUTSIDE_WORKSPACE",
      "details": {}
    }
  }
}
```

### Notification (server → client, no id)

```json
{
  "jsonrpc": "2.0",
  "method": "permissions.request",
  "params": {}
}
```

## 3. Handshake

On spawn, Electron must call:

### `app.handshake`

Params:

```ts
type HandshakeParams = {
  protocolVersion: 11
  client: "electron-main"
  clientVersion: string
  locale: string // default "en"
}
```

Result:

```ts
type HandshakeResult = {
  protocolVersion: 11
  host: "rust-host-core"
  hostVersion: string
  features: string[]
  capabilities: string[] // does not include "a2a"
}
```

Rules:

1. If protocol major version mismatches → abort boot
2. Electron should exit with actionable error if handshake fails
3. All subsequent calls require successful handshake
4. Version 4 introduced the durable notification inbox and the
   notification-bearing `session.endTurn` result.
5. Version 5 requires the host-owned `session.fork` snapshot operation; a
   version 4 host must be rejected before chat becomes interactive (ADR 0023).
6. Version 6 adds durable model-context checkpoints through
   `session.appendCompaction`; a version 5 host must be rejected before the
   runtime claims automatic context protection (ADR 0030).
7. Version 9 is the frozen ADR 0053/0054 contract: it covers the checkpoint
   Plan artifact/queue, active-turn Plan identity/CAS, explicit approval
   permission, shell catalog identity and dialect pin, streamed command output,
   and scheduled-task mode projection from `config_json`. A v7 or incompatible
   v8 host must be rejected before the UI becomes interactive.
8. Version 10 added the A2A protocol stack (ADR 0147): the host-core A2A broker,
   the `a2a.*` method domain, and the `a2a.task.event` / `a2a.push` host→client
   notifications. The `capabilities` array advertised `"a2a"`; a v9 host that
   could not advertise `a2a` was rejected before the UI became interactive.
9. Version 11 withdraws that stack (ADR 0165 / D326). The `a2a.*` methods and
   `a2a.task.event` / `a2a.push` notifications are gone. Handshake no longer
   advertises `"a2a"`. A v10 host or client is rejected before the UI becomes
   interactive, so a mixed pair cannot call a missing domain.

Protocol v11 is paired with host-core storage schema v16. Schema v12 had added
the A2A tables (`a2a_tasks`, `a2a_messages`, `a2a_artifacts`,
`a2a_push_configs`) via `migrate_v11_to_v12`; `migrate_v12_to_v13` drops those
tables, and v14 adds the plugin-session ownership sidecar and soft-delete
column. Schema v15 adds the Host-owned turn queue, and schema v16 adds the
session collaboration ledger and its turn-queue binding. A fresh database
creates neither A2A tables nor unowned plugin-session rows. The schema version is an
internal persistence invariant, not an additional JSON-RPC field; the
checkpoint architecture remains host-owned.

The shared host-core storage chain is v21. Plus-only structures, including
approved execution provider/model bindings, durable revision intent fields, and
the `plan_execution_schedules` table, are versioned by the separate Plus track
recorded in `plus_schema_meta` (current v9; see the data-storage spec, section
7.1), so a Plus persistence increment does not move `user_version`. Protocol v11
remains the wire version; persistence increments on either track do not add a
JSON-RPC version field.

## 4. Method catalog (MVP)

### App
- `app.handshake`
- `app.health`
- `app.getVersion`
- `app.getOnboarding` — inline onboarding checklist state (D031)

`app.health` returns a diagnostic `toolBudget` object:

```ts
type ToolBudgetHealth = {
  active: number
  queued: number
  total: number
  shell: number
  reads: number
  mutations: number
  plugins: number
}
```

### Workspace
- `workspace.get`
- `workspace.set`
- `workspace.clear`

### Review snapshots (ADR 0043)
- `review.rollback({sessionId, snapshotId})` — verify the current post-tool
  hash, restore the session-owned previous bytes, and return one of
  `rolledBack`, `alreadyRolledBack`, `conflict`, or `unavailable`.

### Projects
- `projects.list` — returns durable project records ordered pinned-first, then
  by last-opened time; includes records materialized by session imports
- `projects.create({ path })` — upserts a durable project record without
  changing the active workspace and returns the host-generated project id
- `projects.remove({ path })` — deletes one durable project row together with
  every session attached to it, removing those sessions' transcript, scratch,
  and review files and the project's durable memory, and never touching the
  project folder on disk. Idempotent: an unknown path returns
  `{ removed: false, sessionsRemoved: 0 }`. If the path belongs to a stored
  project group, deletion detaches that root in the same flow; deleting the
  primary promotes the first remaining root, and deleting the last root also
  removes the group record. The call is refused (1008 / `CONFLICT`) while any
  attached session has a running turn, before changing group membership, so a
  live turn never loses the transcript it is writing and a rejected delete
  leaves the project group unchanged.
- `project.memory.get({ path })` — returns the durable memory for the canonical
  project path, or an empty record when no memory has been saved
- `project.memory.set({ path, entries })` — normalizes and stores visual memory
  entries, derives readable `content`, and validates the 32 KiB limit. The
  derived value is injected into that project's next runtime context as
  user-provided context. `{ path, content }` remains supported for legacy
  callers and returns a memory record without structured entries.
- `project.groups.list` — returns one host-owned logical group per named
  project. Existing path-only records are compatibility `legacy` groups.
- `project.group.create({ name, folders })` — validates the display name and
  local directories, stores the ordered roots, and returns the new group
  without changing the active workspace. A non-legacy root cannot belong to a
  second group.
- `project.group.rename({ groupId, name })` — persists the group display name.
- `project.group.update({ groupId, name, folders })` — edits the group name and
  ordered roots. The primary root must remain first; duplicate roots are
  removed, roots owned by another non-legacy group are rejected, and a root
  with existing chats cannot be detached. Removed roots are retained as
  suppressed historical paths rather than reappearing as standalone legacy
  groups.
- `project.group.memory.get/set({ groupId, entries })` — reads or normalizes
  shared group memory using the existing 32 KiB entry limit.
- `project.group.instructions.get/set({ groupId, content })` — reads or stores
  shared group instructions using a bounded host-owned value.
- `project.group.context({ path })` — resolves the group containing a primary or
  member root and returns its shared instructions and memory for runtime launch.
  Legacy groups return no group context so the path-scoped compatibility APIs
  remain authoritative. Builtin tools default to the primary root; absolute
  paths under registered additional roots use the same canonical containment
  resolver and never become arbitrary external access.

### Secrets
- `secrets.set`
- `secrets.delete`
- `secrets.has`
- `secrets.getForRuntime` — main/host only, never reachable from the renderer
- // never `secrets.get` to renderer logs

A provider row has two independent refs — `secret:provider:<id>:api_key` and
`secret:provider:<id>:oauth` (D237/D240). The generic methods above serve both, so a
vendor-account credential needed no new host method. `ProviderPublic` therefore
reports `hasSecret` (true for **either** credential), `hasOauth`, and the
non-secret `oauthAccountLabel`; `providers.create` / `providers.update` accept
`oauthAccountLabel` and optional `headers` (stored in `config_json.headers`,
cleared with `{}`), and `providers.delete` clears both refs for
exactly one row. Login orchestration and token refresh stay in Electron main
and never reach this protocol — see [14-secrets-storage](14-secrets-storage.md)
§10. An OAuth row's headers are edited after the account exists and apply
to later refresh and inference; the vendor picker does not collect them.

### Settings
- `settings.get`
- `settings.set` — optional `networkProxy` (`system` / `direct` / `custom`).
  Custom requires an `http`/`https`/`socks5` URL. host-core uses the stored
  value for marketplace `curl --proxy` and does not put it on process env.

### Sessions
- `session.list` — returns summaries with host-authoritative `messageCount`
  alongside the existing session metadata
- `session.create` — accepts optional `thinkingLevel` and optional
  `inheritPermissionFromSessionId`; when present, the host copies the existing
  session's persisted permission mode atomically, while omission preserves the
  existing `inherit` default. Missing/null thinking level defaults to `off`.
  Optional `interactionMode` is `interactive | unattended` and defaults to
  interactive. Host summaries explicitly return the stored policy plus
  `interactionPolicyVersion: 1`; clients must not synthesize support for older
  responses. Unknown or null interaction modes are invalid.
- `session.fork` — accepts `sessionId`, an optional caller-provided display
  `title`, and optional `throughMessageId`; creates
  one independent session from the source's current active canonical
  transcript, truncated inclusively at the selected message when supplied.
  The child inherits project/provider/model/mode/thinking and
  permission and interaction configuration, receives new message/tool-call ids, and starts
  without turns, revisions, notifications, artifacts, grants, or scratch data.
  Missing sources or anchors return `NOT_FOUND`. While a Desktop source runs,
  only a completed assistant prefix containing no indexed messages owned by a
  running turn is allowed. This check and publication share the host RPC lock.
  Whole-session, non-assistant, streaming/error, or live-turn anchors return
  `CONFLICT`, normalized by Electron to `AGENT_BUSY`. The source turn continues
  without sharing runtime state with the child.
- `session.get` — accepts an optional renderer read window:
  `messageBefore` is the exclusive zero-based end offset, `messageLimit` is
  the positive page size, and `contentLimit` is the positive character budget
  for the derived display projection. The response includes
  `messageStart` and `hasMoreBefore` when a window is requested. Omitting all
  three options returns the complete lossless UI projection for sidecar and
  mutation callers. Window offsets are physical transcript message-line
  positions, clamped against the cached transcript layout rather than the
  deduplicated session index counter, and a window is served by seeking to its
  first selected line instead of scanning the history before it.
  Optional `messageAround` centers that window on a stable message ID resolved
  against the canonical file, requires `messageLimit`, and excludes
  `messageBefore`. Missing IDs return no session. The focused user/assistant
  message retains its complete text; neighboring text and tool fields stay
  capped. Bounded reads also return exclusive physical `messageEnd` and
  `hasMoreAfter` to support contiguous forward pages (ADR session-content-search).
  When the selected message has `parentToolCallId`, optional `navigationParent`
  contains the latest matching Task tool-call projection from the same canonical
  transcript. It is capped separately and does not widen the window or alter its
  cursors. Ordinary and uncapped reads omit this navigation-only field.
- `session.getTurn({ sessionId, turnId })` — read-only, additive to protocol
  v11. Returns one persisted turn's state as
  `{ sessionId, turnId, status, errorCode?, errorDetails?, endedAt? }`, where `status` is the
  durable domain `running | completed | error | aborted` and `endedAt` is the
  RFC3339 instant of the terminal write (`session.endTurn`). The row is matched
  on `turnId` **and** `sessionId`, so a turn id belonging to another session,
  like an unknown one, returns `NOT_FOUND`; blank ids are `INVALID_PARAMS`. The
  response never carries prompt, transcript, or credential material. The
  `INTERACTION_REQUIRED` error may carry the structured questions described in
  [asktool](17-asktool-questions.md#host-owned-unattended-sessions).
- `session.delete`
- `session.getScratchPath` — the session's scratch directory (D114), created
  on demand
- `session.rename({ id, title })` trims and validates the title at the host
  boundary. It accepts 1–80 Unicode code points and returns `{ ok: boolean }`;
  blank or overlong titles are `INVALID_PARAMS`. A successful rename changes
  only session metadata and does not update `updated_at`, transcript content,
  message count, or historical notification title snapshots.
- `session.configure` — atomically persists `mode`, `providerId`, `modelId`,
  and optional `thinkingLevel` (`off|minimal|low|medium|high|xhigh|max|omit`)
  for the next pi turn; omitting/null
  `thinkingLevel` preserves the current value; invalid modes or levels return
  `INVALID_PARAMS`; mode is `plan | goal | agent` and changing any session
  configuration is allowed only while idle and without a pending/queued/running
  Plan or Goal record
  Optional `interactionMode` is persisted under the same active-work fence;
  omission preserves its current value. Permission auto approval does not
  replace this interaction policy.
- `session.moveProject({ sessionId, projectPath })` moves an idle session to a
  project and returns `{ session }` carrying the canonical project path. It
  upserts the project row and updates only `sessions.project_id` and
  `updated_at`; transcript, revisions, artifacts, notifications, and scratch
  data stay with the session. Blank ids or paths are `INVALID_PARAMS`, an
  unknown session is `NOT_FOUND`, and a session with a running turn is
  `CONFLICT` so a live agent never switches instruction roots mid-turn.
  Active managed background jobs return `SESSION_HAS_BACKGROUND_PROCESSES`;
  an unsaved terminal job returns `BACKGROUND_PROCESS_PERSISTENCE_FAILED`.
  Stop jobs and persist terminal state before moving their owning session.
  Additive RPC; no protocol version bump.
- `session.appendMessage`
- `session.saveInflightMessage` — Electron-main-only checkpoint of the
  assistant reply currently streaming, including the finished `message_end`
  snapshot: `{ sessionId, turnId?, message }`
  atomically replaces `sessions/<id>.inflight.json` (D299, D327, spec 04 §2.1).
  Returns `{ ok, saved }`; `saved` is false for a message without visible text
  or for an id that is already indexed (the final row landed first), and in the
  latter case any leftover checkpoint is removed. Non-assistant roles are
  `INVALID_PARAMS`-class failures. A `completed`/`error` `session.endTurn`
  deletes the file only when that id is already indexed.
- `session.recoverInflightMessages` — Electron-main-only post-drain sweep
  (D327). Promotes leftover checkpoints whose final row never landed,
  including `completed` turns as `complete`. Boot recovery skips completed
  leftovers so the outbox can append first. Returns `{ ok, count }`.
- `team.getRuntimeContext({ sessionId })` derives the Team and Lead/member
  identity from Host-owned execution profile and roster state. It returns
  `null` for non-Team sessions; callers cannot supply or override authority.
- `team.getRoster({ teamSessionId, callerSessionId })` and
  `team.getBoard({ teamSessionId, callerSessionId })` return separate roster
  and revisioned task-board projections after Host membership validation.
- `team.getSnapshot({ teamSessionId, callerSessionId })` is the additive local
  Desktop read used by Overview, TeamPanel, and the panorama. It returns one
  flat, revisioned view with members/presentation, Lead phase, tasks/readiness,
  overlaps, queued Team-mail count, current launch review, and latest execution
  decision. Review edit/confirm/cancel remain separate trusted operations; the
  read does not grant mutation authority. Existing roster and board methods
  remain available to older clients. Remote/native source projections do not
  call this local IPC surface.
  Missing legacy Team rows may bootstrap only for an existing local Team Lead;
  dissolved, standard, deleted and member sessions cannot bootstrap a Team.
  Lead configuration to `standard` returns `TEAM_LEAD_CONFIGURATION_BLOCKED`
  while durable Team work exists; deletion failures do not dissolve the Team.
- After committed Team state changes, `team.changed` carries only
  `{ teamSessionId, revision, reason }`. Desktop Main forwards it on the typed
  Team event. A renderer can ignore an older revision and refresh its scoped
  snapshot; prompts, task descriptions, and transcripts are not event payload.
- `team.declareStrategy` accepts optional member presentation on proposed
  review data. Host derives launch policy from session mode: Plan declarations
  atomically materialize read-only researchers and a `confirmed` audit with
  `launchPolicy: "automatic_plan"`, without user review or a confirmation-mail
  continuation. The current Lead turn continues owned task creation/dispatch.
  Agent declarations remain pending with `launchPolicy: "user_confirmed"`;
  trusted Desktop confirmation binds routes before execution. Missing legacy
  policy means user-confirmed. Automatic Plan authority cannot authorize Agent
  tools; direct mutations still require the current valid scope and actual expert
  turns before substantive work. `spawn_teammate` does not accept presentation.
- `team.getMessage({ teamSessionId, callerSessionId, messageId })` reads one
  durable Team mailbox row. The Lead can read every row; a member can read only
  a row it sent or received. Unknown and cross-Team ids return `null`.
- `team.pendingMessages({ teamSessionId, callerSessionId })` is Lead-only and
  returns queued rows for an unpaused Team, including messages with a durable
  Agent Host queue receipt that need restart recovery. A message bound to a turn
  is never replayed. Queued Team mailbox messages without a queue receipt remain
  queued across application restart, including while paused; Resume makes them
  eligible for delivery.
- `team.sendMessage({ teamSessionId, callerSessionId, target, content,
  idempotencyKey? })` persists one Team-origin message and emits
  `team.messageQueued`. Its response reports the mailbox state, not completed
  delivery. Host resolves the sender's effective permission mode (including
  `inherit` against the current default) and stores it as the message ceiling;
  `session.beginTurn` enforces that ceiling before a recipient turn starts.

A member turn that wins terminal settlement with `status: "error"` atomically
adds one Host-authored mailbox notice. It retains the existing ledger
`kind: "message"` and string `content` envelope; the content is JSON:
`{kind:"member_failed",memberName,errorCode,retriable,taskIds,suggestedAction}`.
The error is a sanitized code, never raw text, a path or credentials. Task ids
include open owned tasks and tasks failed by that exact settled attempt.
`retriable` is conservative advisory guidance: only unambiguous transient codes
(`HOST_OVERLOADED`, `HOST_UNAVAILABLE`, `PROVIDER_RATE_LIMITED`, `TIMEOUT`)
are true; other/unknown failures require inspection before explicit re-dispatch.
It does not authorize an automatic retry.

The Host reserves `member-turn-failed:<turnId>` idempotency keys; model calls to
`team.sendMessage` using this prefix return `TEAM_UNAUTHORIZED`. The terminal
CAS, notice, Host-only source proof and Team revision commit together. Replay
cannot add a notice; user abort/cancel adds none. Completed turns use the
separate silent-completion rule below. After commit,
existing `team.messageQueued` wakes waiting Leads and Main's existing durable
Team delivery admits idle Leads without changing Agent Host queue semantics.
Restart recovers undelivered notices through the existing pending-mail drain.

For an approved execution, the notice has `team-message-source-turn-v1` plus a
Host-owned `team-member-failure-v1` proof. Only this proof permits an error-ended
current dispatch result to enter the execution inbox; arbitrary member text
claiming `member_failed` is not proof, and aborted turns remain excluded.
The unread notice blocks completion until `wait_for_updates` consumes its full
body. Consuming a failure does not count as successful expert participation.

Host failure delivery also survives post-commit checkpoint I/O errors: the error
remains observable, while the already durable queued notice emits its existing
wake event. A terminal replay may re-notify that same pending row; no second
notice is inserted, and a consumed/running notice is not emitted again.

A Lead-dispatched non-Lead member turn that settles as `completed` without a
report atomically adds one Host-authored member-to-Lead notice when, after task
attempt settlement, that member still owns non-deleted `pending` or
`in_progress` tasks. The starting collaboration message must have `source=team`
and the exact turn binding. A direct user conversation with a member, an
aborted/cancelled turn, a member with no open tasks, or a turn that already sent
Team mail to Lead produces no silent-completion notice. Existing source-turn
proofs on outgoing Team mail determine whether the member reported; body text
is never evidence.

The existing message content is JSON
`{kind:"member_ended_without_report",memberName,taskIds,suggestedAction}` without
model output or paths. `member-turn-silent:<turnId>` is Host-reserved;
model-authored sends using any Host notification prefix fail with
`TEAM_UNAUTHORIZED`. The terminal CAS, notice, source proof in
`team-message-source-turn-v1`, and Team revision commit together. Terminal
replay never inserts another notice or repeats an already admitted wake. A
Host-only kv event marker is written after transport admission; failed transport
leaves pending recovery possible. A crash between admission and that marker may
repeat the same message ID, which the durable delivery path deduplicates. Existing `team.messageQueued` delivery
wakes the Lead, including an idle Lead. An unread notice from a current
completed dispatch blocks approved completion until `wait_for_updates` consumes
it. Completed dispatch provenance needs no error-turn `team-member-failure-v1`
proof. Consuming a Host notice does not establish successful participation or
complete tasks. Deleting either owning session removes notification proofs.

The `wait_for_updates` tool subscribes before reading its baseline and wakes on
matching `team.changed` / `team.messageQueued` notifications, debounced for
100 ms. It rechecks every 5 s as a bounded fallback, or every 1 s when the Host
has no notification API. Baseline failures return a tool error; recheck failures
are retried, and a deadline with no successful recheck returns the last error.
Abort returns immediately. Every exit removes subscriptions, timers and abort
listeners. Board/message change reasons and successful timeout behavior remain
unchanged.

- `team.ackMessage({ teamSessionId, ackSessionId, messageId })` accepts only
  the target member and requires a durable Host queue or turn receipt. Repeated
  acknowledgements are idempotent. It does not reject a durable receipt solely
  because either session's permission setting changed after turn admission.
- `team.pause/resume({ teamSessionId, callerSessionId })` are Lead-only
  transitions. Electron Main holds or resumes the corresponding Agent Host
  queues and drains pending mail after resume. It then kicks each resumed session
  so idle ordinary user queues continue even when no Team mail is pending.
  Other lifecycle holds and active-turn admission still prevent execution.
- `team.createTask` and `team.updateTask` require `callerSessionId`; Host checks
  membership, Lead-only reassignment, task ownership, CAS revision, and
  dependency constraints before mutation. When supplied, the owner session and
  member name resolve as one pair; a Lead may reassign or clear task ownership.
- `session.appendCompaction` — sidecar-only append of the newest typed
  model-context checkpoint. It requires non-empty checkpoint/summary/boundary
  ids and non-negative `tokensBefore`; it does not insert a message/search row
  or change the visible transcript projection
- `session.replaceMessages` — atomic transcript rewrite (temp-file rename +
  one index transaction, D119) used by message delete and unanswered
  renderer smart-stop undo; it preserves the
  newest checkpoint only while both its boundary and optional first-kept id
  remain valid in the rewritten prefix, and it carries each surviving message's
  owning `turn_id` across the rewrite. It is only safe from a caller that owns
  the whole transcript for the duration of the call: any rewrite from a snapshot
  taken outside the RPC lock can delete a message appended in between.
  Regenerating and retrying use `session.truncateFrom` instead so the kept
  prefix never crosses the JSON-RPC pipe (ADR 0216)
- `session.truncateFrom` — host-owned suffix cut for regenerate / retry /
  edit-resend: `{ sessionId, fromMessageId?, truncateBefore? }`. Identity
  wins; an unknown `fromMessageId` is `NOT_FOUND`. Under the state lock it
  aborts a leftover running turn, archives the discarded regenerate tail
  (refreshing the stamped variant, or minting an inactive one), rewrites the
  kept prefix, and drops the in-flight checkpoint. Returns
  `{ ok, keptCount, discardedCount, abortedTurnId, revision }` where `revision`
  is the pager stamp for the upcoming user prompt, or null when the discarded
  tail has no user root. No transcript snapshot is in the request or the
  result. Additive on protocol v11 (ADR 0216)

- `session.saveRevision` — archive a regenerate branch under
  `(sessionId, rootUserId)`. With `revisionIndex`, refresh that existing
  variant's payload in place (the branch grew since it was archived) instead
  of minting a new index; the DB row keeps its identity and active flag and
  only `message_count` changes
- `session.saveActiveRevision` — archive the branch of the newest
  revision-bearing user root as its active revision and stamp that root's pager
  metadata, all under the RPC lock. The stamp rewrites one transcript line
  instead of the file, so a concurrent `session.appendMessage` survives.
  Returns `{ saved: null }` when the session owns no regenerate history.
  An already-archived active variant is refreshed, not skipped.
  Turn-completion callers use this instead of
  `session.get` + `session.replaceMessages`
- `session.listRevisions` — list linear variants for a root user family
- `session.activateRevision` — replace live transcript with `prefix + branch`
  and stamp root pager metadata. Before the switch it re-archives the live
  branch of that family from the durable transcript (refreshing the variant
  the live root's `activeRevision` stamp names, or storing a stamped but
  never-archived branch as its own variant), so nothing appended since the
  last archive is lost. When the family is present in the durable transcript,
  the prefix in front of the restored branch is taken from there rather than
  from the caller. Surviving messages keep their owning `turn_id`
- `session.beginTurn({ sessionId, providerId?, modelId?, sessionMessageId?, expectedInteractionMode? })` —
  starts one durable turn. When `sessionMessageId` is present, host-core
  atomically verifies that the queued collaboration delivery targets this
  session, rechecks its permission ceiling, claims the delivery, and binds the
  new turn to its message id. A collaboration turn cannot be started from
  caller-supplied replacement text.
  The optional expected interaction policy is checked against durable session
  state in the same admission transaction. A mismatch returns
  `INTERACTION_POLICY_MISMATCH` without admitting the turn. Desktop/headless
  launchers supply their policy snapshot, and `pi_agent_prompt` accepts the
  same optional condition for external callers.
- `session.queuePush` / `session.queueList` / `session.queueRemove` /
  `session.queuePrioritize` / `session.queueReorder` — the Host-owned turn queue
  (D386 / ADR 0213 / ADR 0265, schema v18); push is idempotent per principal and
  key, bounded at eight entries per session. `queuePrioritize` appends an entry
  to the end of its session's priority block (`priority = MAX + 1`) and refuses
  an already promoted entry with `CONFLICT`; `queueReorder` swaps one
  non-promoted entry with its adjacent non-promoted neighbour and reports
  `{ moved }`. Listing and delivery order is `priority ASC` for promoted entries
  followed by `position ASC` for the rest
- `session.endTurn` — atomically moves a running turn to its terminal state and
  conditionally returns the newly created notification for `completed`/`error`;
  returns no notification when `createNotification=false`, for `aborted`, or
  for an already-terminal turn. It also settles the session's in-flight reply
  checkpoint (D299): `completed`/`error` remove it; `recoverInflight: true`
  (sent when the sidecar is gone and no final row can follow) promotes a
  checkpoint whose final row never landed into the transcript as an `aborted`
  assistant message and returns it as `recovered`; a plain `aborted` (user
  Stop) leaves the checkpoint for the arriving final row to supersede
  Optional structured `errorDetails` is stored with the first terminal write.
  Duplicate or stale terminal events cannot overwrite its error identity or
  question details. Desktop and headless paths preserve this field.
- `session.import` — atomically imports one converted session; a non-empty
  project path is normalized and upserted into `projects` before the session
  references it; returns `{ imported, skipped }`

Plugin-owned session methods are additive to protocol v11 and are called only by
Electron main after plugin permission and manifest-source checks:

- `plugin.session.import` — import one host-owned session with an idempotency
  key `(pluginId, source, externalId)`; the host generates ids and binds to a
  project only when the caller supplies an existing `projectId` created by
  `projects.create`; the historical `projectPath` remains metadata
- `plugin.session.importBatch` — bounded `skip` or all-or-nothing `fail` batch
- `plugin.session.list` / `plugin.session.get` / `plugin.session.listMessages` —
  read only the calling plugin's active imported sessions
- `plugin.session.rename` — rename an owned active imported session
- `plugin.session.delete` — `trash` hides and retains the transcript; `purge`
  removes it and permits re-import
- `plugin.usage.listTurns` — keyset page of completed-turn facts (identifiers
  and token counters, never a message body) for non-deleted sessions. Gated
  in Electron main by `usage.read`. Additive; no protocol version bump.
- Successful plugin session mutations cause Electron main to emit one
  `sessionsChanged` renderer event; the renderer refreshes the session list,
  and plugins do not emit this UI synchronization event.

Host-internal session collaboration methods are additive to protocol v11 and
are called by Electron main only after the reviewed plugin gateway has checked
the plugin permission and active Agent tool invocation. They are not renderer
or general MCP operations:

- `session.collaboration.spawn` — create a bounded Agent worker session that
  inherits the source project's, thinking, and permission configuration, create
  its first `task` delivery, and return the real target `sessionId` plus the
  message record. Worker creation is limited per parent and plugin; a worker
  cannot create another worker.
- `session.collaboration.send` — enqueue a `task` or `message` delivery to an
  existing Agent session. The host binds `sourceSessionId` and `sourceTurnId`
  to the current plugin tool invocation, enforces idempotency, a target inbox
  bound, the source permission ceiling, and a bounded autonomous hop count.
- `session.collaboration.message` — read one durable delivery by message id for
  Electron's dispatch and provenance paths.
- `session.collaboration.status` / `session.collaboration.result` — return a
  bounded status/result projection without loading a complete worker
  transcript. `result` may select a delivery by `messageId` or `turnId`.
- `session.collaboration.pending` — list queued completion callbacks for the
  Electron drain; `fail` records a dispatch failure and creates the requested
  failure callback once; `settle` derives the result from the persisted turn
  and creates at most one completion callback.
- `session.collaboration.cancel` — cancel queued deliveries or interrupt their
  exact currently-bound turns while retaining the target session and history.

The ledger is durable across a host restart. A queued entry with its
`turn_queue.session_message_id` remains held for a new Agent Host controller;
an unclaimed or running delivery is marked `interrupted` by the startup fence
and is never replayed automatically. Transcript provenance is host-derived and
cannot be forged or removed by `session.appendMessage` or transcript
replacement. Steering (`UiMessage.steering`) into a claimed delivery turn is
additional human input in that session: it does not receive the delivery
origin, and a client-supplied `session_message` is stripped (D597).

The host rejects unknown roles, non-RFC3339 or non-monotonic timestamps, and
oversized/deep payloads. Tool values are sanitized for host-reserved keys. The
per-plugin rolling limits are 10 single imports, 5 batch imports, and 20
deletes per 60 seconds. P2/P3 methods are not present in protocol v11.

### Session Todo checklist

- `todos.get({ sessionId })` returns the committed checklist snapshot for a live
  Desktop session: `{ sessionId, todos, revision, updatedAt }`. Unknown or
  soft-deleted sessions return `NOT_FOUND`; native Pi sessions and blank ids are
  rejected as `INVALID_ARGUMENT`.
- `tools.execute` with `toolName: "TodoWrite"` accepts only `{ todos }` and
  replaces the complete ordered checklist. The host trims content, defaults
  priority to `medium`, truncates overlong Unicode content at 500 characters
  with a warning, demotes later `in_progress` items to `pending`, and rejects
  more than 50 items or malformed values. The owner session and running turn
  come from the trusted transport fields, never from tool arguments.
- TodoWrite is allowed only for an Agent session's own running turn. Plan/Goal,
  delegated, plugin, and MCP calls receive a tool result error and do not mutate
  storage. A successful replacement advances the session revision even when
  `todos` is empty and emits `todos.changed` after the transaction commits.
  The event payload is the same complete snapshot returned by `todos.get`.
- SQLite ownership is host-core only. The renderer receives snapshots through
  Electron Main IPC, keeps them by session id, and ignores revisions older than
  or equal to the cached revision. Remote RACP sessions are local-only for this
  vertical slice because RACP v1 has no Todo snapshot operation.

### Stats

- `stats.getTokenUsageHistory` — roll up completed `turns` token columns and
  `usage_json` cache/reasoning fields into local-calendar `day` / `week` /
  `month` buckets. Additive RPC; no protocol version bump. Default range is
  bounded (53 weeks / 52 weeks / 24 months). `week` uses ISO week year.
  Empty buckets in range are returned as zero rows so a calendar consumer sees a
  complete window. `session.endTurn.usage` is the durable turn total: parent
  assistant messages plus settled subagent usage, not a rewrite of
  `message.usage`. The user-facing dashboard is plugin `pi.token-insights`
  (D335 / ADR 0173), not a Settings destination.

### Plan and Goal state and approvals

Both contract kinds share these methods; the optional `kind`
(`plan | goal`, default `plan` so a pre-D198 sidecar still works) selects which
contract is being negotiated.

- `plans.enter` — accepts only the active Agent turn's `sessionId`, `turnId`,
  and `toolCallId` plus the `kind`; host-core performs the mode transition to
  that kind's mode with a compare-and-swap update and emits `plans.changed`
  carrying the `kind`. An unrecognized `kind` fails with `INVALID_PARAMS`
- `plans.submit` — writes the host-owned artifact under the kind's directory and
  creates a pending proposal whose `kind` is persisted on the row. Team Plan
  submissions with otherwise-ready research but queued Lead inbox messages
  return normal `deferred` status instead of publishing an approval fence.
- `plans.pending` — returns pending approval rows plus bounded proposal history,
  the session planning
  state, and the `kind` of the contract being negotiated (the pending row's kind,
  falling back to the session's own contract mode); renderer reload does not
  extend the absolute deadline while the host remains alive and also returns
  bounded proposal history so terminal cards can be restored read-only
- `plans.resolve` — validates one matching approve, reject, request_changes, or
  schedule response. `request_changes` stores a durable revision intent and
  `schedule` commits an approved one-time snapshot; approval commits the
  selected permission mode and `execution_state = queued`
- `plans.claimSchedule` / `plans.cancelSchedule` — atomically claim a due
  schedule (including an explicitly confirmed missed schedule) or cancel a
  scheduled/missed snapshot. A claim is single-use and returns the bound
  execution descriptor. Automatic claims allow at most 120000 ms after the
  deadline (inclusive); a later claim atomically marks it missed, emits
  `plans.changed` and returns `PLAN_SCHEDULE_MISSED` without creating an execution.
  Explicit Run now (`allowMissed: true`) bypasses that automatic grace window.
- `plans.markRevisionFailed` — records a failed revision admission while
  retaining the saved revision intent for retry
- `session.endTurn` — marks a still-started revision intent failed when its
  exact revision turn ends without submitting a replacement proposal, and
  emits `plans.changed` so the retry card refreshes

- `plans.dueSchedules({ nowMs? })` returns `{ schedules, nextDueAt }`.
  Without an explicit `nowMs`, scan/claim/recovery time is read after acquiring
  Host state, so lock contention cannot extend the admission window.
  Before reading, Host atomically marks schedules more than 120000 ms overdue
  as missed and emits `plans.changed` once per transitioned proposal.
  `schedules` contains eligible schedules at or before `nowMs` within that
  inclusive grace window; `nextDueAt` is
  the earliest eligible future timestamp in epoch milliseconds, or `null`. Both
  queries require a scheduled snapshot, an approved proposal and no execution
  state. This additive field needs no database migration.
- Main polls immediately on start, then wakes at the next due time, clamped to
  1–30 s (30 s when no schedule exists or `nextDueAt` is missing, non-numeric
  or non-finite). `plans.changed` nudges the poller after
  200 ms; system resume nudges it too. Polls are single-flight; a nudge during a
  poll requests one follow-up. Host/sidecar unavailability, Host errors and
  non-busy claim failures retry after 5 s. Busy schedules remain marked missed.
  Stop and Host restart remove timers and notification subscriptions; restart
  preserves stop → mark missed → drain → start recovery ordering. While the
  running app sleeps, schedules can be claimed after resume only within that
  inclusive two-minute grace window. Longer delays require explicit Run now;
  startup/restart still mark all due schedules missed without a grace window.

- `plans.queuedExecutions` / `plans.claimExecution` /
  `plans.finishExecution` — consume and transition execution fields on the
  same approval row; the claimed execution reports its `kind` so the sidecar can
  select the matching execution instruction
- `plans.abort` — marks pending approval work interrupted; it never replays or
  changes an already-approved session back to its contract mode

### Goal execution holds

Host-core owns Goal settlement and all hold mutations. `PlanExecutionState`
remains `queued | running | completed | interrupted`: blocked is represented by
`interrupted` with `errorCode = GOAL_BLOCKED` and `hold.state = blocked`.
Execution and report readers include the optional hold; session ownership is
checked before reading or mutating it. Local Renderer actions use Main/preload,
not direct persistence access.

- `goalExecutions.get({ sessionId, executionId? })` returns `{ execution?, hold? }`.
  Omitting the execution ID reads the latest blocked Goal in that session.
- `goalExecutions.settle({ sessionId, executionId, ended, errorCode?, stopHint?,
  persistenceBarrierFailed?, durableSeq? })` returns `{ execution, hold?, report? }`.
  `ended` is `agent_stopped | errored`. This is an internal orchestrator operation;
  explicit user Stop retains the existing interruption path. Only verified
  structured `met` with completed existing progress and settled current Team
  work permits automatic completion. All other endings, including Agent errors,
  create a hold. Transcript-barrier failure retains report `markFailed` semantics
  and must never publish stale ready evidence.
- `goalExecutions.resume({ sessionId, executionId, expectedVersion, modelOverride? })`
  returns `{ execution, hold, resume: { reasons, segment, priorTurnIds } }`. The optional override
  is `{ providerId, modelId }`. The hold must be blocked with its expected CAS
  version and the matching execution must be `interrupted/GOAL_BLOCKED`. The
  session must be idle with no other queued/running execution. Resume clears
  the error, changes execution to running, increments the segment/resume count,
  audits model choice and resumes only the Team pause owned by this hold. Main
  locks the session operation, begins a turn, binds it (invalidating the old
  draft) and calls `agent.executeApprovedPlan` with resume metadata. `priorTurnIds`
  lists this hold's previously bound segment turn IDs in execution order, before
  the new turn is bound. It is additive/optional for older callers; current Host
  producers always supply the array, including an empty scope. Runtime matches
  these identities to Host-projected `UiMessage.turnId`; it never selects by
  timestamps or includes intervening ordinary turns. Malformed supplied IDs are
  rejected before runtime admission. Any admission or dispatch failure settles
  back to a `resume_failed` hold.
- `goalExecutions.close({ sessionId, executionId, expectedVersion, action })`
  returns `{ execution, hold, report? }`; `action` is `accept | abandon`. Acceptance
  is the only path to completed/non-`met`, records `closure = user_accepted`, and
  uses a valid structured draft or bounded Host facts. Abandon records
  `GOAL_ABANDONED` and publishes no report. Both are CAS-guarded blocked-only
  transitions; stale concurrent responses cannot close or resume a newer hold.
- `goalExecutions.changed` refreshes session/execution-scoped hold readers after
  settlement, resume, acceptance, abandonment or supersession.

`GoalHold` carries `executionId`, `sessionId`, `state` (blocked/resumed/accepted/
abandoned/superseded), `reasons`, optional `firstTurnId`, `segments`, `blocks`,
`resumeCount`, `pausedTeam`, CAS `version`, `createdAt` and `updatedAt`. Reader
responses may include the available draft and progress snapshot. Reasons are
`{ code, detail?, tasks? }`, with task entries `{ id, title, status, assigneeId? }`.
Segments are `{ turnId, startedAt, endedAt? }`; blocks are `{ at, reasons }`.
`goalExecutions.changed` carries `{ sessionId, executionId, execution?, hold? }`.
Private progress write tokens never appear in these public payloads.

Blocked settlement atomically updates the approval execution, invalidates its
progress token, persists reasons/segment history, pauses associated Team work,
writes `goal_execution_blocked` audit state and creates `task.failed` with
`error_code = GOAL_BLOCKED`. It never creates `task.completed` or a report-ready
event. Reasons distinguish `report_missing`, `report_invalid`, `verdict_partial`,
`verdict_blocked`, `verdict_unknown`, `team_unsettled` (member/task diagnostics),
`resume_failed` and `agent_error:<code>`. Model blockers continue to use
`limitations`/`nextSteps`; no `blockers[]` report field is added.

Approval of a replacement Goal atomically marks the old blocked hold superseded
and its execution `interrupted/GOAL_SUPERSEDED`, releasing only that hold's
owned Team pause in the same transaction so the new Goal may use its Team.
An explicit independent user pause clears hold pause ownership; resume and
supersede cannot clear that user pause. Historical reports are not mutated.
Plan execution and legacy completed reports keep their existing paths. Host
boot recovery settles queued/running effective Goals as blocked with a
`agent_error:HOST_RESTARTED` reason before the generic
Plan interruption fence. Previously blocked holds are not changed or replayed.

### Goal reports and real-time progress

- `goalReports.get` / `goalReports.list` / `goalReports.submitDraft` / `goalReports.invalidateDraft` /
  `goalReports.finalizeReport` / `goalReports.markFailed` / `goalReports.getAsset`
  - `goalReports.submitDraft` rejects a `met` claim when the latest matching Goal progress
    contains any item not marked completed. Expected draft validation failures return
    `INVALID_ARGUMENT` (RPC code 1002), with correction guidance, and do not mark the
    report as a persistence failure. Reconcile progress and retry; honest partial/blocked
    claims and legacy callers without a progress snapshot remain supported.
    Finalization rechecks progress so a later update cannot publish a stale `met` claim.
  - `goalReports.finalizeReport` and report Retry require the Host's persisted execution state `completed`.
    Attempting to finalize/retry an execution that is `interrupted`, `queued`, `running`, or missing completion
    is rejected with `GOAL_EXECUTION_NOT_TERMINAL`, without writing report files or broadcasting ready.
    Status overrides cannot promote an interrupted execution or overwrite a completed report as interrupted.
    Rejection precedes draft removal or metadata updates, including retries of historical ready reports.
    Interruption records execution status only; it does not publish a fallback completion report.
    Automatic finalization requires a verified structured `met` draft; otherwise
    `GOAL_REPORT_NOT_VERIFIED` is returned before writing report files. Bounded
    Host-facts construction is reserved for explicit held-Goal acceptance and
    historical completed-report Retry. `goalReports.get`/`list` include the
    optional hold even when no ready report exists. Schema v2's optional
    `closure`, `segments` and `blocks` distinguish user acceptance from Agent
    verification and retain the original first-segment start time.
- `goalProgress.get` — `{ executionId, sessionId? }` returns `{ progress: GoalProgressSnapshot | null }`.
- `goalProgress.issueToken` — `{ executionId, sessionId, turnId }` generates and returns `{ writeToken }`
  bound to the running turn recorded in `goal_reports.turn_id` and the effective Goal execution
  (`COALESCE(execution_kind, kind) = goal`), not the earlier planning turn.
- `goalProgress.update` — `{ executionId, sessionId, writeToken, expectedRevision?, items }` verifies
  session identity, active running turn, running execution, and token validity. Updates increment `revision`
  and broadcast `goalProgress.changed({ sessionId, executionId, revision })`.
  Errors: `UNAUTHORIZED` (invalid or expired write token), `GOAL_PROGRESS_NOT_RUNNING` (execution or turn not running),
  `CONFLICT` (optimistic concurrency mismatch on expectedRevision), `INVALID_PARAMS`.

### Scheduled tasks

- `scheduled.list` / `scheduled.create` / `scheduled.update` /
  `scheduled.delete`
- `scheduled.import` — imports task records and normalizes their persisted mode
- `scheduled.run` / `scheduled.finishRun` / `scheduled.listRuns`

The wire `ScheduledTask.mode` is a normalized projection of the durable
`config_json.mode`; create, update, and import map legacy `chat` to `plan` and
default missing values to `agent`. `scheduled.run` reads the selected task's
persisted mode; a `plan` or `goal` task fails with
`PLAN_REQUIRES_INTERACTIVE_SESSION` before creating a session or run. It never
uses `settings.defaultMode` as the task mode.

Canonical thinking levels at the host boundary are:

```text
off | minimal | low | medium | high | xhigh | max
```

Session summaries/details always return `thinkingLevel`. Assistant messages
may return `thinking`; host storage maps it to a canonical content block rather
than appending it to answer `content`.

### Tools
- `tools.list`
- `tools.execute`
- `tools.abort`
- `tools.output` notifications for ordered `stdout`/`stderr` chunks

### Shells
- `commandShells.list`
- `settings.set` with a partial settings object; omitted fields are preserved,
  and a changed effective `defaultCommandShell` is accepted only when every
  session has no active turn and no pending/queued/running Plan/Goal work

Tool execution starts only after admission. Shell spawn retries transient
resource exhaustion (`EAGAIN` / `WouldBlock`) with bounded backoff, never
retries a command after it has started, and reaps timed-out children before
releasing the execution slot.

`session.appendMessage` is idempotent by message id. An id already indexed in
another session is remapped to `{sessionId}:{id}` before the JSONL write, and
a later replay of the original id is a no-op (D444). Electron main may keep
message appends in its application-owned outbox while host-core is restarting;
the outbox flushes in order after a successful handshake and treats
`UNIQUE constraint failed: messages.id` as an ack rather than pausing the
queue. A `PERMISSION_DENIED:` append is dropped the same way so a poison head
cannot stall the FIFO (D597). A missing sessions row is restored from the live JSONL (or created as a
stub under the same id when the file is gone) so a queued outbox can drain
(D318). `session.delete` drops that session's outbox entries. In-flight
checkpoints never go through the outbox: a checkpoint is only meaningful
against a live host, and replaying one after the final row would be wrong.

### Permissions
- `permissions.evaluate`
- `permissions.resolve`
- `permissions.pending` (D374: open requests as Host state)
- `permissions.listSessionGrants`
- `permissions.clearSessionGrants`

### Plugins
- `plugins.list`
- `plugins.loadDev`
- `plugins.installFromPath`
- `plugins.installFromPackage` — install a `.piplug` archive after checksum
  verification
- `plugins.enable`
- `plugins.disable`
- `plugins.uninstall`
- `plugins.getPermissions`
- `plugins.grantPermissions` / `plugins.revokePermissions` — change the
  granted set; the runtime enforces the intersection of declared and granted
- `plugins.setAutoUpdate`
- `plugins.setScope` — activation scope (ADR 0056)
- `plugins.resolveExecution` — resolve which plugin tools/skills/MCP servers
  are active for a session's project before a turn starts

### Marketplace
- `market.refresh` — fetch and cache the catalog from the configured URL
- `market.search` / `market.getDetail`
- `market.install` — download, verify (`PLUGIN_INTEGRITY`,
  `PLUGIN_MARKET_*`), and install one catalog release
- `market.checkUpdates` / `market.applyUpdates`

### Providers and models
- `providers.list` / `providers.get` / `providers.create` /
  `providers.update` / `providers.delete`
- a plugin-owned row (`ownerPluginId`) is refreshed from its manifest on every
  load, so `providers.update` / `providers.delete` refuse it with a
  `PROVIDER_OWNED_BY_PLUGIN` error; only the owning plugin's lifecycle changes
  or removes it (ADR 0259)
- `providers.setSecret({ id, secretValue })` — stores or clears one provider's
  API key (`secret:provider:<id>:api_key` and the row's `secret_ref`). It is the
  write a plugin-owned row accepts: only the credential the declaration asks for
  changes, never a field the manifest owns. An empty or omitted `secretValue`
  deletes the stored key. Returns `{ provider }`, or `null` for an unknown id
- `providers.getSecret` — main/host only, never reachable from the renderer
- `providers.listModels` / `providers.cacheModels` — discovered model rows
  and their host-side cache (ADR 0027 / ADR 0134)
- `providers.testConnection`

### Agent capabilities (skills, subagents, MCP servers)
- `skills.list` / `skills.active` / `skills.read` / `skills.create` /
  `skills.update` / `skills.remove` / `skills.import` /
  `skills.setEnabled` / `skills.setScope` / `skills.transfer` — user skill
  documents (`SKILL_INVALID` on validation failure)
- `agents.list` / `agents.active` / `agents.read` / `agents.create` /
  `agents.update` / `agents.remove` / `agents.setEnabled` /
  `agents.setScope` — user subagent documents (`SUBAGENT_INVALID`)
- `mcp.list` / `mcp.active` / `mcp.upsert` / `mcp.remove` /
  `mcp.setEnabled` / `mcp.setScope` / `mcp.transfer` — user MCP server
  definitions (`MCP_INVALID`)

`skills.transfer` and `mcp.transfer` take `{ id, from, to }`, each end a
`{ level, projectPath? }` target (`projectPath` is required for the project
level), and return `{ skill }` / `{ server }` for the document where it landed.
A transfer moves the document between the two levels rather than copying it, so
the source level stops listing the entry. A destination that already owns the
same id gives the arriving document a `-2`/`-3` id suffix; one that owns the
same display name / label, compared case-insensitively, gives it a matching
` (2)`/` (3)` display suffix. The existing entry stays untouched. Enablement
travels with the document: the source level drops every state entry for the old
id, including its project overrides, and the destination stores the value the
source was showing (a project target keeps that project's state, a global
target the global default). Naming the source's own directory as the
destination is a no-op.

`*.active` returns the entries that apply to the given project after
activation-scope filtering (`CAPABILITY_INVALID` for an unknown scope).

### Search, artifacts, keyboard
- `search.query` — legacy indexed-message hits; existing response and limit remain compatible
- `search.sessions({ query, offset? }) -> { hits, nextOffset }` — global session
  discovery with title/project metadata and indexed user/assistant text. Trimmed
  literal queries have a 500-character limit (`INVALID_ARGUMENT` above it).
  Each 30-session page includes `session`, `projectName`, `metadataMatch`, the
  full matching `messageCount`, and at most two `matches` containing
  `messageId`, `role`, `createdAt`, and a `snippet` containing the matching
  sentence or line. Long sentences are capped to a match-centered 180-character
  window, extended when needed to preserve the complete literal query.
  `nextOffset: null` marks the last page. Sort by updated time descending and
  session ID ascending; exclude soft-deleted sessions. Empty queries return no
  hits because the renderer owns its recent-session presentation.
- `search.context({ sessionId, messageId, query, direction? })` — resolve a
  stable message ID in the owning, non-deleted session's JSONL layout. Default
  `direction: "around"` returns up to 21 nearby message text projections;
  `"before"` / `"after"` returns up to 20 messages excluding the anchor. Return
  `messages`, `hasMoreBefore`, `hasMoreAfter`, `previousMatchId`, and
  `nextMatchId`. Adjacent matching IDs follow transcript sequence order and
  have no 100-message cutoff. Context comes from canonical JSONL and is capped
  at 64 Ki characters per message; the target is centered on the query. Tool
  bodies, thinking, and attachments are omitted. Missing/deleted targets return
  `NOT_FOUND`; invalid directions or identifiers return `INVALID_ARGUMENT`.
  See [ADR session-content-search](../../adr/session-content-search.md).
- `artifacts.list` — Plan/Goal checkpoint artifacts for a session
- `keyboard.setGlobalShortcut` — host-owned native fallback for the plugin
  launcher chord where Electron cannot register it

### Audit
- `audit.append`

### Notification (D117)
- `notification.list`
- `notification.markRead`
- `notification.markAllRead`
- `notification.clear`

## 4a. Notification contracts (protocol v4)

```ts
type AppNotification = {
  id: string;
  kind: "task.completed" | "task.failed";
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  errorCode?: string;
  createdAt: string; // ISO-8601 UTC
  readAt?: string | null;
};

type SessionEndTurnParams = {
  turnId: string;
  status: "completed" | "error" | "aborted";
  errorCode?: string;
  usage?: unknown;
  createNotification?: boolean; // default true; Electron supplies visibility decision
};

type SessionEndTurnResult = {
  ok: boolean; // false when the turn was missing/already terminal
  notification?: AppNotification; // omitted when no row was inserted
};

type NotificationListParams = {
  unreadOnly?: boolean; // default false
  limit?: number;       // default/max 200
};

type NotificationListResult = {
  notifications: AppNotification[]; // newest first
  unreadCount: number;               // global count, independent of filter
};
```

- `notification.markRead({ id }) -> { ok }` is idempotent. `ok=false` means
  the id does not exist; an already-read row remains successful.
- `notification.markAllRead({}) -> { ok: true }` updates every unread row in
  one transaction.
- `notification.clear({}) -> { ok: true }` deletes inbox rows only.
- `id` is the stable exactly-once key for renderer and native delivery. A
  client must discard duplicate or delayed records for an id it has already
  acknowledged/cleared; clearing the inbox never makes an old terminal turn
  eligible for insertion again. A later terminal turn receives a new id.
- No `notification.created` JSON-RPC server notification is emitted. Electron
  receives the inserted record directly from `session.endTurn`, avoiding a
  second ordering channel between terminal turn persistence and UI refresh.
- `createNotification=false` suppresses only inbox insertion; the running turn
  still reaches its requested terminal state in the same transaction. Missing
  or non-boolean values default to true so unknown/stale UI state cannot lose a
  notification.
- `sessionTitle` is the stable session-name snapshot stored with the row.
  Localized event title/body prose is derived by Electron/renderer and never
  crosses host RPC.

## 5. Tool execute contract

### `tools.execute` params

```ts
type ToolsExecuteParams = {
  sessionId: string
  turnId?: string
  toolCallId: string
  toolName: string
  args: unknown
  /** Diagnostic/request context only; never used for authorization. */
  requestedMode?: "plan" | "goal" | "agent"
  expectedCommandShellId?: CommandShellId
  /** Bash only: dialect pinned by the same runtime turn. */
  expectedCommandShellDialect?: "powershell" | "cmd" | "posix"
  /** Bash only: host default 60000; accepted override 1000..21600000. */
  timeoutMs?: number
}
```

Authoritative mode and workspace resolution are session-scoped:

1. Host loads `sessionId` and resolves its persisted `project_id`/path.
2. Host reads the persisted `sessions.mode` and validates it as `plan | agent`.
   A conflicting `requestedMode` is ignored for authorization and recorded only
   as diagnostic data.
3. That path becomes the tool sandbox root for permission preview, execution,
   artifact paths, and audit context. A tool's explicit `path` may name an
   outside location only after the host applies the outside-path permission
   rule; successful external results retain an absolute canonical path.
4. The mutable `workspace.get` selection is not consulted for a valid durable
   session, so switching a retained project tab cannot redirect a background
   call.
5. A durable path-less session resolves no root and receives
   `WORKSPACE_REQUIRED` where the tool requires one. A selected project is not
   inherited.
6. Legacy calls whose session does not exist may temporarily fall back to the
   selected workspace; new renderer flows must always provide a valid
   `sessionId`.
7. A database/session-resolution error returns `INTERNAL` and fails closed;
   only a confirmed missing session may use the legacy fallback.

For `Read`/`Glob`/`Grep`/`Write`/`Edit`, the host classifies an explicit path
outside the workspace and scratch roots before the low-risk auto-allow rule.
`auto` executes it, while `ask` and `accept-edits` emit
`permissions.request`; denial or cancellation returns `TOOL_DENIED`
without executing the operation. Relative `..` and symlink escapes use the
same classification. Bash's working directory and implicit recursive walks do
not inherit this exception.

Before generic permission evaluation, host-core applies the mode policy:

- Plan and Goal allow `Read`, `Glob`, `Grep`, `BrowserPreview`, `Bash`, and the
  kind's submit tool (`SubmitPlan` / `SubmitGoal`) as applicable to the live
  planning state.
- Plan and Goal deny `Write`, `Edit`, every plugin tool, and unknown tools under
  all permission modes and grants. The host reads the session's **durable** mode
  for this check, so a sidecar claiming `agent` in `tools.execute` cannot widen
  it, and the `*_IN_PLAN` error codes are shared by both kinds.
- Plan and Goal `Bash` follows the resolved permission mode: `ask` and
  `accept-edits`
  emit `permissions.request`; `auto` executes without confirmation and may
  mutate. The host re-resolves the effective shell ID/dialect and requires the
  exact `expectedCommandShellId` and `expectedCommandShellDialect` before
  permission evaluation and again before spawn; it streams stdout/stderr
  separately. A configured shell may fall back to the first available platform
  shell before the turn pin is created, but execution never changes shell
  after the pin.
- Agent applies the normal registered-tool and permission policy.

The visible tool list is not the security boundary; a forged RPC call is
authorized by this host-side matrix.

### result

```ts
type ToolsExecuteResult = {
  toolCallId: string
  ok: boolean
  isError?: boolean
  content: unknown
  durationMs: number
  denied?: boolean
  errorCode?: string
  // Workspace Write/Edit results may include content.details.review. The
  // record is persisted with the tool message and is independent of Git.
  // Bash command failures preserve content.exitCode/stdout/stderr while
  // setting ok=false, isError=true, and errorCode=TOOL_FAILED.
  // The agent runtime forwards isError into the tool transcript without
  // dropping the structured content/details needed for recovery.
}
```

### 5.1 Plan and Goal submission and approval contracts

`SubmitPlan` and `SubmitGoal` are handled as host transitions before generic
tool execution. The host preserves the exact Markdown bytes in a new unique
artifact under the kind's directory before publishing the proposal. For a
temporary Goal, the root is the owning session's scratch directory; for a
project Goal it is the persisted project root. Approval resolves the root from
the stored proposal kind, since approved sessions switch back to Agent mode.
Plan still requires a persisted project. No global workspace fallback is used.

```ts
// Identical shape for both kinds; the tool name selects the kind.
type SubmitPlanParams = {
  title: string;
  markdown: string;
  question: string; // Same-Agent concise approval overview; complete details stay in markdown.
};

type ProposalKind = "plan" | "goal";

type PlanningState = "inactive" | "planning" | "awaiting_approval";

type GlobalPermissionMode = "ask" | "accept-edits" | "auto";

type PlanApprovalAction = "approve" | "reject" | "request_changes" | "schedule";

type PlanProposalStatus =
  | "pending" | "approved" | "changes_requested" | "rejected"
  | "expired" | "interrupted";

type PlanExecutionState =
  | "queued" | "running" | "completed" | "interrupted";

type PlanScheduleState = "scheduled" | "missed" | "claimed" | "cancelled";

type PlanRevisionIntentInput = {
  content: string;
  providerId?: string;
  modelId?: string;
  thinkingLevel: ThinkingLevel | "omit";
  targetKind: ProposalKind;
};

type PlanArtifact = {
  relativePath: string; // `.pi/plan/<unique-name>.md` or `.pi/goal/<unique-name>.md`
  sha256: string;
  sizeBytes: number;
};

type PlanProposal = {
  id: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  // Which contract this approval carries; rows written before the
  // discriminator existed read back as `plan`.
  kind: ProposalKind;
  plan: string;
  markdown: string;
  title: string;
  question: string;
  status: PlanProposalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  action?: PlanApprovalAction;
  targetPermissionMode?: GlobalPermissionMode;
  errorCode?: string;
  artifact?: PlanArtifact;
  version: number;
  executionId?: string;
  executionState?: PlanExecutionState;
  planningProviderId?: string;
  planningModelId?: string;
  executionProviderId?: string;
  executionModelId?: string;
  scheduledFor?: string;
  scheduleTimezone?: string;
  scheduleState?: PlanScheduleState;
  revisionIntent?: PlanRevisionIntentInput & {
    state: "ready" | "started" | "failed" | "submitted";
    turnId?: string;
    errorCode?: string;
  };
};

type PlanExecution = {
  id: string;
  proposalId: string;
  sessionId: string;
  // Which contract was approved; selects the sidecar's execution instruction.
  kind: ProposalKind;
  plan: string;
  title: string;
  question: string;
  artifact: PlanArtifact;
  targetPermissionMode: GlobalPermissionMode;
  executionProviderId?: string;
  executionModelId?: string;
  state: PlanExecutionState;
  hold?: GoalHold; // Host-owned hold; see Goal execution holds above.
};

type PlansPendingResult = {
  plans: PlanProposal[];
  state?: PlanningState;
  // The contract being negotiated: the pending row's kind, else the session's
  // own contract mode. Absent when nothing is being negotiated.
  kind?: ProposalKind;
};

type PlanResolveIdentity = {
  proposalId: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  version?: number;
};

type PlanResolveRequest =
  | (PlanResolveIdentity & {
      action: "approve";
      targetPermissionMode: GlobalPermissionMode;
      executionProviderId?: string;
      executionModelId?: string;
    })
  | (PlanResolveIdentity & {
      action: "schedule";
      targetPermissionMode: GlobalPermissionMode;
      executionProviderId: string;
      executionModelId: string;
      scheduledFor: string;
      scheduleTimezone: string;
    })
  | (PlanResolveIdentity & { action: "reject" })
  | (PlanResolveIdentity & {
      action: "request_changes";
      revisionIntent?: PlanRevisionIntentInput;
    });

type PlanResolutionResult = {
  ok: boolean;
  proposal: PlanProposal;
  state: PlanningState;
  action?: PlanApprovalAction;
  targetPermissionMode?: GlobalPermissionMode;
  execution?: PlanExecution;
};
```

Host notifications:

```text
method: "plans.changed"
params: {
  sessionId: string
  state: PlanningState
  kind?: ProposalKind
  proposalId?: string
  proposal?: PlanProposal
  action?: PlanApprovalAction
  targetPermissionMode?: GlobalPermissionMode | null
  execution?: PlanExecution | null
}

type ToolsOutputParams = {
  sessionId: string
  toolCallId: string
  commandShellId: CommandShellId
  stream: CommandShellOutputStream
  chunk: string
}

method: "tools.output"
params: ToolsOutputParams
```

`plans.changed` is emitted for Plan or Goal entry, submission, resolution,
execution claim/finish, and abort. Its top-level params are exactly the fields
shown; fields not applicable to a transition are omitted, and `kind` names the
contract so the renderer can pick the right mode chip and approval copy without
inspecting the projected state. For `plans.resolve`, the
host emits `targetPermissionMode` and `execution` as JSON `null` when no value
exists. Electron forwards this notification unchanged through
the shared `IPC.event.plansChanged` renderer channel.

`plans.resolve` accepts only an authenticated, still-pending request whose
proposal, session, turn, tool-call, and version match. `approve` requires an
explicit permission mode and atomically commits the `plan_approvals` row to
`status = approved`, assigns `execution_id`, sets `execution_state = queued`,
sets `sessions.mode = agent`, and stores the selected
`sessions.permission_mode`; that selection is not written into app settings
as the next approval default. Ask remains the product default. The same Agent then receives a new provider
request with Agent tools.

`reject` records `rejected` and leaves the session in its contract mode (Plan or
Goal). The absolute
30-minute deadline records `expired` with `PLAN_APPROVAL_TIMEOUT`. Abort, host
restart, sidecar restart, or persistence failure records `interrupted`. Before
serving RPC after startup, the host transactionally interrupts prior pending
approvals and queued/running Plan execution states. Queued/running effective
Goals first settle as blocked with `agent_error:HOST_RESTARTED`; existing holds
are unchanged. Pending, queued, and running work is never replayed;
queued/running interruption after approval leaves the
session in Agent. The process epoch is internal and is not a wire or database
field.

### 5.2 Shell catalog

```ts
type CommandShellId =
  | "windows-powershell"
  | "windows-pwsh"
  | "cmd"
  | "git-bash"
  | "bash";

type CommandShellOption = {
  id: CommandShellId;
  label: string;
  dialect: "powershell" | "cmd" | "posix";
  available: boolean;
  isDefault: boolean;
};

type CommandShellCatalog = {
  configuredId: CommandShellId | null;
  effective: CommandShellOption | null;
  fallback: boolean;
  choices: CommandShellOption[];
};

type CommandShellOutputStream = "stdout" | "stderr";
```

`commandShells.list` returns the host discovery result. Settings writes store
only a catalog ID and reject unknown, unavailable, or wrong-platform IDs with
`COMMAND_SHELL_INVALID`. If a persisted ID later becomes unavailable, the
catalog selects the first available platform shell and sets `fallback: true`.
A Bash request includes the pinned effective ID and dialect from the same turn;
host-core rejects a changed ID or dialect with `COMMAND_SHELL_CHANGED` before
permission evaluation and before spawn. Identity is not an executable path
hash.

## 6. Permission request notification

Host may emit:

```ts
method: "permissions.request"
params: {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  risk: "low" | "medium" | "high"
  argsPreview: unknown
  reason: string
}
```

Electron/UI resolves via:

```ts
method: "permissions.resolve"
params: {
  requestId: string
  decision: "allow-once" | "allow-session" | "deny"
}
```

Local permission behavior (**D636 / ADR 0310**): an unresolved request remains
pending until an explicit decision, cancellation, or host/process shutdown.
The transport does not apply a deadline to `tools.execute`; tool-specific
execution budgets still apply after approval.

`permissions.pending` returns the open requests as Host state (D374/D375):
`{ requests: PendingPermission[] }`, oldest first, optionally scoped by
`sessionId`. Each entry carries the same fields as the `permissions.request`
notification plus `createdAt`. Requests remain listed until settled. A client
that attaches after the notification was emitted reads this list and answers through the unchanged
`permissions.resolve`; the notification path itself does not change.

## 7. Error codes

JSON-RPC errors carry a numeric `code` plus `data.errorCode`, the stable
string from [08-error-codes](08-error-codes.md). Several string codes share a
numeric slot; the string is the contract, the number is transport detail.

| code | errorCode | meaning |
|---|---|---|
| 1000 | INTERNAL | unexpected host failure |
| 1001 | UNAUTHORIZED | missing/invalid handshake or capability |
| 1001 | HOST_SHUTTING_DOWN | the host is draining after EOF and refused the call |
| 1002 | INVALID_PARAMS | schema validation failed |
| 1002 | MODEL_ALIAS_TOO_LONG | provider row alias exceeds 60 code points |
| 1002 | MODEL_BINDINGS_DEGRADED | stored model bindings are unreadable; explicit model-array replacement is refused |
| 1003 | NOT_FOUND | entity missing (legacy slot, kept for old callers) |
| 1006 | RATE_LIMITED | a per-caller budget window was exhausted |
| 1007 | NOT_FOUND | entity missing |
| 1007 | SESSION_NOT_FOUND | the named session does not exist; tool requests never fall back to the global workspace |
| 1008 | CONFLICT | busy/conflict state |
| 1008 | AGENT_BUSY | the session has a running turn |
| 1009 | PLUGIN_INVALID | manifest/validation failure |
| 1010 | PLUGIN_LOAD_FAILED | enable/load failure |
| 1011 | PROTOCOL_MISMATCH | `app.handshake` protocol version mismatch |
| 1012 | PLUGIN_INTEGRITY | package checksum/signature mismatch |
| 1013 | PLUGIN_PERMISSION_DENIED | plugin lacks the permission the call needs |
| 1014 | PLUGIN_NETWORK | marketplace download/catalog fetch failed |
| 1015 | MCP_INVALID | user MCP server definition failed validation |
| 1015 | PLAN_* | every Plan/Goal checkpoint failure (`PLAN_APPROVAL_TIMEOUT`, `PLAN_APPROVAL_STALE`, `PLAN_APPROVAL_INTERRUPTED`, `PLAN_SESSION_NOT_FOUND`, `PLAN_WORKSPACE_REQUIRED`, …) shares this slot; the string code distinguishes them |
| 1016 | SKILL_INVALID | user skill document failed validation |
| 1017 | SUBAGENT_INVALID | user subagent document failed validation |
| 1018 | CAPABILITY_INVALID | agent capability root/scope setting failed validation |
| 1019 | PLUGIN_CANCELLED | the user cancelled a marketplace install while it was downloading |
| 1020 | PLUGIN_MARKET_NOT_PUBLISHED | the platform has the version and is not offering it yet |
| 1021 | PLUGIN_MARKET_ARCHIVED | the plugin was withdrawn from the platform |
| 1022 | PLUGIN_MARKET_NOT_FOUND | the platform does not have that plugin or version |
| 1023 | PLUGIN_MARKET_RATE_LIMITED | the download endpoint asked the client to wait |
| 1024 | PLUGIN_MARKET_NO_SOURCE | no distribution target can serve the package |
| -32029 | HOST_OVERLOADED | RPC dispatcher capacity exhausted |
| -32601 | — | unknown method |
| -32700 | — | unparseable request line |
| 1002 | LIMIT_EXCEEDED | an NDJSON request line over 64 MiB; Electron rejects the write before it reaches the pipe; if the host still sees it, the remainder of the line is drained, the reply keeps the request id when it can be peeked from the prefix, and the stdin reader keeps running |


Tool outcomes (`TOOL_DENIED`, `TOOL_TIMEOUT`, `PATH_OUTSIDE_WORKSPACE`,
`WORKSPACE_PATH_DENIED`, `WRITE_DISABLED_IN_PLAN`, `SHELL_NOT_FOUND`,
`COMMAND_SHELL_CHANGED`, …) are not JSON-RPC errors: `tools.execute` returns
`ok: false` with `errorCode` in the result (§5).

## 8. Concurrency / ordering

1. Requests may be concurrent within the dispatcher cap. Read/search tools may
   run in parallel; `Write`/`Edit` are bounded and FIFO-ordered per session,
   with at most one mutation in flight for a session.
2. Different sessions may continue concurrently across retained project tabs;
   each resolves its own project root and grants
3. Notifications may arrive anytime after handshake
4. `tools.output` preserves stdout/stderr separation and notification order;
   it is scoped to its session/tool call and has no turn or ordering fields;
   final results remain bounded
5. Abort is idempotent and shuts down the complete Bash process tree
6. Plan and Goal approval requests are proposal/session/turn/tool-call/version
   scoped;
   only one pending approval and one queued/running execution exists per
   session, and resolution is serialized by host-core
7. Before RPC service, startup transactionally settles queued/running effective
   Goals as blocked with `agent_error:HOST_RESTARTED`, preserving existing holds,
   then applies the unchanged Plan pending/execution interruption fence.
   Late renderer responses fail closed;
   pending interruption keeps the session's contract mode and an
   already-approved queued/running interruption keeps Agent.
8. A session fork is one host-owned snapshot operation. The source transcript
   is never rewritten, and a handled child write/index failure leaves no
   visible session or orphan transcript file. A process crash follows D119's
   existing orphan-transcript recovery policy.
9. A message-scoped fork is identical except that the canonical snapshot ends
   inclusively at `throughMessageId`. It still remaps message/tool-call ids and
   creates no runtime or revision state, so later child reseed/cache state is
   isolated by the new session id.

## 9. Logging rules

- Never log API keys/secrets
- Tool args may be redacted in audit previews
- Every tools.execute gets trace id = `toolCallId`

## 10. Acceptance

1. Electron spawns host and completes handshake
2. health method returns ok
3. denied tool path returns `TOOL_DENIED`
4. an unresolved permission remains pending until an explicit decision or cancellation
5. switching the selected workspace from A to B does not change the tool root
   of a call issued by session A
6. Protocol v4 `session.endTurn` creates/returns exactly one notification for
   unseen completed/failed turns and none for visible-current, aborted, or
   repeated terminal updates
7. Notification list/unread/read-all/clear round-trip through host-core and
   remain bounded to the newest 200 durable rows
8. Forking an idle session produces an independently mutable child with the
   same active transcript and durable execution configuration while leaving
   the source and its regenerate revisions unchanged
9. Forking through a message excludes every later source row and rejects an
   unknown message without creating a child
10. A forged `requestedMode` cannot authorize a tool against the durable mode;
    Plan and Goal deny Write/Edit/plugin/unknown tools and apply permission
    prompts to Bash according to `ask`/`accept-edits`/`auto`
11. SubmitPlan and SubmitGoal write exact Markdown bytes to a unique
    `.pi/plan/*.md` or `.pi/goal/*.md` file with
    hash/size and structured title/question fields; only matching
    approve/reject/request_changes/schedule responses can resolve the live
    `plan_approvals` row, and a
    submit tool run against the other kind fails with `PLAN_KIND_MISMATCH`
    without writing an artifact
12. Plan and Goal revision, expiry, abort, crash, one-time schedule
    claim/miss/cancel, and stale responses produce the documented durable
    statuses and events; an approved snapshot cannot execute twice
13. Bash validates the pinned shell ID/dialect, streams stdout/stderr, enforces
    the 60s default/bounded override, and shuts down the complete process tree

## Scheduled automation tools

Agent mode advertises on-demand ScheduledTaskList, ScheduledTaskCreate,
ScheduledTaskUpdate and ScheduledTaskDelete tools. They run through
`tools.execute`, including existing permissions and audit records, and reuse
the scheduled RPC domain handlers. List is low risk; mutations require normal
approval in Ask/Accept Edits. Plan/Goal deny all four even under Auto.

The Host rechecks durable session mode and derives project scope from the
calling session, never the foreground workspace or model-supplied paths.
Create binds that scope; list filters it; update/delete require matching scope.
Unknown fields, invalid cadence, empty title/prompt, invalid time and invalid
weekday selections are rejected before mutation. Delete refuses active runs.
Create requires title, prompt and cadence; automatic daily/weekly tasks require
a schedule. Update takes an existing ID and partial fields, preserving all
unspecified configuration. Exact local times remain supported despite the
UI's four period presets. No new DB schema or transport is introduced.

### Scheduled tasks: task-owned execution settings

Desktop create/update may save `workspacePath`, `permissionMode` and a paired
`providerId`/`modelId` on one task. Run now and automatic execution use those
values when present. Missing fields preserve legacy project capture, app-default
model resolution and permission behavior. Invalid permission values and partial
model pairs are rejected before mutation. Conversation tools do not expose these
fields and remain bound to the calling session's project. See ADR 0305.

Tasks also persist optional `thinkingLevel` using the existing session values
(including `off` and `omit`). The full Composer model/reasoning picker and
controller are reused with a task-draft configuration callback. Both manual and
automatic runs apply the saved level. Missing or cleared levels retain the
legacy `off` behavior; no database migration is required.

### Scheduled tasks: independent task dispatch

The Electron runner admits independent due tasks without awaiting another task's prompt setup. Local in-flight ownership is keyed by task ID and Host instance until setup settles; Host remains authoritative for enabled, due and overlap checks. A replaced Host's completion cannot clear its successor's local ownership. Stop prevents new polls; admitted work keeps the existing execution/failure lifecycle. Failures remain observable and the 90-second late policy is unchanged.
### Scheduled tasks: project removal and automations

Removing a project pauses its bound scheduled tasks without deleting their definitions, schedule, workspace binding or run history. Session references in history may become null when the project's conversations are removed. Already admitted task runs block removal even before a conversation turn starts. Tasks belonging to other projects and unbound legacy tasks are unaffected. Explicit resume or Run now may recreate a project from the preserved path; automatic polling cannot do so while paused.
### Scheduled tasks: legacy task maintenance

Agent tools allow title, prompt and pause updates on legacy automatic tasks without a schedule, including an echoed unchanged cadence. These edits do not arm the task or capture the foreground workspace. Explicit enabling, a cadence change or a supplied schedule still follows schedule validation. Resume requires an explicit valid schedule; Manual-to-Hourly retains its existing default interval behavior.
### Scheduled tasks: calendar intent

The optional config_json.calendarConfigured boolean distinguishes an explicitly configured Daily/Weekly calendar from Hourly's internal schedule placeholder. Without the key, legacy Daily/Weekly schedules are treated as configured; legacy Hourly schedules retain their values but require an explicit schedule when converting to Daily/Weekly. Known calendar intent survives Hourly and restart, including midnight. Clearing or replacing the calendar with a different non-calendar placeholder clears intent. This additive extension needs no table/schema migration; older versions ignore it and cannot enforce the new conversion guard. Metadata-only edits and Manual-to-Hourly remain unchanged.
### Scheduled tasks: workspace identity

Stored workspace bindings use the existing project canonicalization contract on both write and read. On Windows, slash direction, case, trailing separators and extended path prefixes do not hide a task from its own project's conversation. The distinction between missing legacy bindings and explicit null remains unchanged. Foreign-project tools cannot list or mutate bound tasks.

### Cloud configuration sync

The Host exposes the `configSync.getState`, `configSync.test`,
`configSync.configure`, `configSync.syncNow`, `configSync.pause`,
`configSync.unlock`, `configSync.approve`, `configSync.reject`,
`configSync.mapProject`, `configSync.listHistory`, `configSync.restore`,
`configSync.changePassword`, and
`configSync.disconnect` methods through the existing Electron Host bridge.
These methods operate on the Host-owned encrypted vault and the explicit
portable-domain adapter registry. They do not expose raw secrets or local
filesystem bindings to the Renderer.

`configSync.test` performs a capability probe against a temporary remote
object and reports whether reliable strong conditional writes are available.
`configSync.syncNow` and the five-minute automatic poll serialize per vault,
reconcile against the last acknowledged base, publish immutable encrypted
objects followed by a conditional head update, and retain unresolved
conflicts/security-sensitive imports as pending state. A failed head
precondition restarts from the newly read head; it never overwrites blindly.

`configSync.listHistory` returns revision IDs, creation timestamps, parent IDs,
and counts without decrypting data in the Renderer. `configSync.restore` requires
an explicit propagation acknowledgement, writes an encrypted local recovery
point, publishes a new head with a CAS, and keeps executable/security-sensitive
entities pending until local approval. `configSync.changePassword` updates the
wrapped-key header with a strong-ETag CAS; it does not revoke copied old vault
keys.

The public result is a redacted state snapshot. `configSync.changed` is a Host
notification carrying that same snapshot. Approval and rejection require the
current entity digest, so a security-relevant edit cannot reuse an older local
decision. Disconnect deletes only local credentials, vault keys, metadata and
staging files; remote objects remain intact.

### Expert Team planning (local Host)

Plan Team Leads retain standard Plan permissions and coordination tools.
`team.getRuntimeContext` returns research purpose and planning/round IDs only
for confirmed research members; Lead context never has research purpose.
Automatic Plan roster launch and the planning round commit atomically, without
user staffing confirmation. The final Plan approval remains user-controlled.
Task create/update enrolls research tasks in the same transaction as assignment.
During an active Plan research round, task creation requires an explicit approved
researcher owner (`ownerMemberName` or `ownerSessionId`). Missing ownership or
Lead ownership is rejected with `TEAM_RESEARCH_INVALID` before any task or
revision is persisted. The Plan Lead's `task_create` schema requires
`ownerMemberName`; `send_message` delivers instructions but never assigns tasks.
Existing unassigned tasks remain readable and can be recovered by the Lead using
`task_update` with the current `expectedRevision` and approved researcher owner;
this atomically enrolls the task in the round. Researchers cannot self-assign,
and must read the new revision before submitting results. Agent backlog tasks
may still be created without an owner. Rejected create/update calls remain
failed tool calls, rather than successful results containing error text.


`team.getPlanning({ teamSessionId, callerSessionId })` returns null without a
round, otherwise planningId, teamSessionId, roundId, phase, workPurpose,
reviewId, totalExpectedTasks, completedResearchTasks, openQuestionsCount,
isReadyForPlanSubmission, pendingMessagesCount, proposalId, results and updatedAt. Results contain
full bounded structuredResult (summary, findings, risks, recommendations and
verifiedSources), task identity, owner identity, submitted task revision and
timestamp. `team_status` and `task_get` include this projection.

`team.submitResearchResult` requires teamSessionId, callerSessionId, planningId,
roundId, taskId, expectedRevision and structuredResult. IDs are bound from the
trusted runtime context, never model-supplied authority. Host checks current
approved research identity, task ownership/non-deletion/dependencies and CAS.
An identical result retry is idempotent; a conflicting retry is rejected.
Completion and Team revision commit together. Per-result bytes are capped at
32 KiB and all results in a round at 128 KiB; each array has at most 32 entries
of 2,000 bytes and summary at most 4,000 bytes. Ordinary task_update completion
cannot bypass research submission.

Lead-only `team.openPlanningQuestion` and `team.closePlanningQuestion` require
teamSessionId, callerSessionId, roundId and questionId. The runtime brackets
asktool waits including cancellation; stop/restart clears cancelled blockers.
SubmitPlan is gated on all expected results and settled questions; mandatory
Team planning requires at least one approved expert research task. Same submission retries return the same proposal.
Rejection reopens aggregation preserving results; approve/schedule uses existing
Plan transitions and closes planning. Researchers remain read-only until a new
Agent execution review explicitly authorizes them.

The sidecar proxy permits only the new planning read/result/question methods,
not arbitrary round creation or trusted review mutations. Before Host-local
execution the parent calls internal `tools.authorizeLocal({ sessionId,
toolName })`; persisted research identity and session mode override sidecar
mode claims. Rust tools.execute enforces the same research boundary. Team
mailbox supports same-Team planning while plugin SessionTask stays Agent-only.

Interrupted/expired proposal recovery returns retained research to aggregation
without replay. Team dissolution deletes planning/purpose KV in the detach
transaction, converting research members to standalone standard Plan while
preserving transcripts/models/permission selections; execution members retain
existing standalone Agent semantics.

Confirmed research assignment persists member session mode Plan alongside the
purpose metadata, so older runtimes cannot expose ordinary Agent writers by
ignoring new context fields. Only confirmed Agent execution assignment restores
member Agent mode; normal execution members and standard contracts are unchanged.

Result receipt alone does not settle a researcher turn. Readiness and SubmitPlan
also require every approved research member's active turn to end. The Lead's
own active synthesis turn is permitted; existing Team activity revisions wake
wait_for_updates after research settlement.

### Expert Team launch route validation

Launch review edits validate enabled providers and configured or cached model
identities without making provider calls. The configured model binding owns
non-empty `thinkingLevels`; deprecated provider compatibility reasoning/level
fields do not override it. `off` and `omit` remain valid (`omit` sends no
provider parameter). An empty configured binding permits canonical manual
thinking requests, with the selected native model's final normalization still
owned by runtime. Catalog-only capability labels do not imply an effort ladder:
without a binding, only `off`/`omit` are accepted. Missing/disabled routes and
unsupported explicit binding levels retain `TEAM_MODEL_SELECTION_INVALID`.
Trusted review edits may update a single member; confirmation always revalidates
the entire review before creating or updating any expert session.

### Ordinary Team task completion claims

`team.updateTask` may include optional `expectedCallerTurnId`, captured by the
runtime rather than exposed as a model parameter. Host checks it against the
caller's current running turn under the mutation lock; a stale identity returns
`TEAM_TURN_INVALID` before changing the task. Legacy clients omitting it remain
compatible.

An explicit in-progress/completed update associates the task with its active
owner turn, or the reporting caller's running turn when the owner is idle.
A completed request returns `task.status = in_progress` until that exact turn
ends successfully. The runtime explains that the claim was recorded and must
not be resubmitted merely because the status is still in-progress. Error and
abort settle associated attempts as failed and cancelled respectively, with a
Team activity notification for the refreshed board. Duplicate/stale terminals
cannot change retries; historical/unassociated tasks remain untouched. A normal
turn end never completes a task lacking a completion claim. Accepted immutable
Plan research results retain their existing atomic result/completion contract.

### Mandatory Expert Team delegation

Expert Team requires `delegate` with at least one named expert. `lead_only` is
rejected before persistence, including attempts to replay historical solo
approvals. Missing review strategy remains delegate for legacy roster reviews;
legacy solo decisions and empty reviews cannot be confirmed or grant authority.
Agent rosters launch only through trusted `team.confirmLaunchReview`; Plan
research rosters launch automatically with `automatic_plan` policy. Model
proxies cannot confirm/cancel/edit reviews.

`team.authorizeLeadTool({teamSessionId,callerSessionId,toolName})` checks current
Host identity and current-turn launch policy before runtime-native tools; it returns
`{authorized:true}` or a structured denial. Read-only discovery/clarification is
available before review. Approved coordination creates tasks and dispatches
current experts. Substantive Lead actions require a recorded current dispatch
whose expert mailbox turn has actually started or completed successfully; an
idle member or queued message is not participation. Cancelled/failed turns and
old dispatches cannot be reused. This predicate does not prove task ownership
or a completed execution contribution. Plan submission independently requires
owned tasks and complete structured research.
Builtin/local tools and direct Team mutations independently check these rules.
New user turns require fresh delegation under the mode-specific launch policy; real approved mailbox
continuations inherit the scope. Goal negotiation retains existing permissions;
Agent execution restores the Team gate. No database migration is needed.

### Expert Team planning launch policy

`TeamLaunchReview.launchPolicy?: "automatic_plan" | "user_confirmed"` is
Host-owned; absent legacy values mean user-confirmed. Plan `team.declareStrategy`
returns materialized researchers and a confirmed automatic launch audit without
pending user approval or synthetic confirmation mail. Research remains read-only
and the Lead must obtain full results before SubmitPlan. New revision/retry
requests also launch automatically. User confirmation is required for the final
Plan artifact and the subsequent Agent execution roster. An automatic Plan audit
is rejected by confirmLaunchReview and never grants Agent execution authority.

Automatic Plan `fork` context uses a Host-owned immutable snapshot through the
current persisted user request plus settled prior history. Live assistant/tool
rows are excluded. The generic running-session fork restriction is unchanged;
member provenance, read-only purpose and failure rollback remain validated.

The Team snapshot exposes a pending review only while its leadTurnId matches the
current Host-owned strategy scope. A completed Lead turn can still await valid
confirmation; superseded pending reviews stay readable by ID but cannot reopen
the current UI. Existing Team activity revisions refresh the shared reader.

### Team Plan inbox submission barrier

The optional additive `TeamPlanningProjection.pendingMessagesCount` counts
Team-origin `message` rows addressed to Lead with `status=queued` and no bound
turn. Queue receipts and ACKs prove durable acceptance, not consumption. User
queued prompts, other origins/targets, terminal/cancelled rows and already
turn-bound messages are excluded. Messages are never discarded by text matching.

Otherwise-ready Team Plan `plans.submit` returns
`{status:"deferred",reason:"team_messages_pending",pendingMessagesCount:N}`
while this inbox is nonempty. No artifact, proposal, version or `plans.changed`
approval notification is published. The runtime terminates the current Lead turn
normally without an error or awaiting-approval state. Existing FIFO continuation
then supplies full authenticated message content to the Lead. The final ready
submission returns the existing `{status:"pending",proposal}` contract.

The final check and artifact/proposal publication share an IMMEDIATE SQLite
transaction. Existing proposal retries retain their identity; missing research,
questions, unsettled experts and normal permission/cancellation errors keep their
existing semantics. Final research readiness also requires an empty unconsumed
Team inbox. Standard Plan and Goal submissions do not use this Team-only yield.

Structured research results already constitute the report. Researchers finish
after submission without a required duplicate completion message; send_message
remains available for substantive supplementary information or clarification.

### Approved Team execution-turn binding and inbox

Approved Team Plan/Goal execution retains its exact running Host turn through
execution-roster confirmation and expert settlement. It does not emit final
agent_end, complete the approval or end the Goal token while waiting.
Confirmation resumes the approved contract; cancellation interrupts it without
publishing a completed Goal report or replaying expert/model work.

The trusted dispatcher calls plans.bindExecutionTurn
({executionId,sessionId,turnId}) only for an approved running Plan with that
session's exact running turn. For Team it also requires current Lead/review
scope. Host stores immutable {sessionId,turnId} under plan-execution-turn-v1
keyed by executionId. Identical retries are idempotent; invalid/stale bindings
return PLAN_EXECUTION_STALE and changed bindings PLAN_EXECUTION_CONFLICT.
This RPC is not model-callable and is excluded from the sidecar reverse proxy.
Goal preserves its existing goal_reports executionId/turn_id exact-turn proof.
Neither execution kind accepts a still-running approval as authority for a
later unrelated turn. Existing schema/process ownership remains unchanged.

team.getLeadExecutionState and team.readExecutionInbox accept
{teamSessionId,callerSessionId,expectedTurnId}; only the current Lead may call,
with current strategy/review scope and the exact approved Plan/Goal turn proof.
These are narrowly exposed internal model-proxy RPCs, not new model tools.
State returns {active,turnId,reviewStatus}; a stale execution is inactive.
Inbox returns {active,turnId,messages} and rejects stale consumption with
TEAM_PLANNING_STALE. Before confirmation it returns no consumable messages.
Eligible messages are the authenticated current review confirmation and current
approved experts' results, bound by persisted source-turn/dispatch identity.

Inbox consumption marks eligible queued unbound messages completed, retires
associated durable turn_queue receipts and persists message IDs in the separate
team-execution-inbox-v1 ledger for {teamSessionId,expectedTurnId}, in one
transaction. It does not set message.turn_id or give the original user execution
mailbox provenance. The team.executionInboxConsumed notification carries
{teamSessionId,turnId,messageIds} so Main removes only corresponding live queue
entries. Unrelated user requests remain queued. Re-reading in the same execution
may return ledger messages again; wait_for_updates suppresses duplicate content
within its owned runtime turn while preserving full results across recovery.

Participation still authorizes substantive Lead tools. TeamFinalAnswer for an
approved execution additionally rejects completion while recorded current
expert dispatches are queued/running, their authenticated results remain
unconsumed, or current decision-owned tasks are `pending`/`in_progress`.
Lead task creation inside the Host-proven active approved execution atomically
enrolls the task ID in that decision's existing `taskIds`, including tasks never
dispatched. Only those non-deleted tasks are checked; older decisions' tasks do
not extend the barrier. Task terminal states are `completed`, `failed`, and
`cancelled`, allowing an honest unsuccessful close. Participation remains a
separate predicate and is not granted by task state or Host notification reads.
Plan research's structured result/inbox submission barrier is separate. Goal
progress and its sole completion report retain the original execution identity.

### Expert preset configuration and launch snapshots

settings.get/set retain their current transport and add optional AppSettings
expertTeam schemaVersion=1, userDefaults and projectOverrides. Scope values are
partial per-role model/provider/thinking/tools/instructions bindings. Host
validates shape, limits, known presets/tools and canonical project identity.
Malformed settings do not partially persist.

Team proposed members may carry presetId from researcher/fullstack/qa/reviewer/
ui/debugger. Launch reviews and member runtime context optionally carry the
resolved expertConfig snapshot. No presetId means the legacy launch behavior.
Host confirmation persists the new member policy in the same transaction as
its route; reused members preserve existing policy. Role tool policy is an
additional restriction at runtime and Host tool authorization, never a grant.

Expert configuration mutations additionally supply expertTeamExpected, the
previous complete expertTeam object or null for first creation. Host compares
this condition under its settings mutex, rejects conflicts, and strips the
metadata before storage. A changed expert configuration without the condition
is rejected; unchanged legacy roundtrips remain readable. Ordinary renderer
settings writes omit expertTeam unless submitted by this dedicated CAS editor.
Main applies the complete committed Host settings to network/menu/developer
side effects, so a partial request cannot reset unrelated runtime policy.

## Plus project context RPCs

| Method | Parameters | Result |
| --- | --- | --- |
| `project.memory.editor.get` | `path` | `{editor: {owner, memory, autoRecordEnabled}}` |
| `project.memory.editor.save` | `path, expectedOwner, expectedMemory, entries` | `{editor}` after owner/snapshot CAS |
| `project.autoMemory.setEnabled` | `path, expectedOwner, enabled` | `{autoRecordEnabled}` |
| `project.autoMemory.agentList` | trusted `sessionId, boundPath` | `{memory, autoRecordEnabled, memoryAlias?}` |
| `project.autoMemory.agentUpsert` | binding plus optional `id`, `title`, `content`, update's `expectedTitle, expectedContent` | current runtime memory state |
| `project.autoMemory.agentDelete` | binding plus `id, expectedTitle, expectedContent` | current runtime memory state |
| `project.history.search` | binding plus literal `query` (1–500 characters), optional `limit` (1–20, default 10) | `{hits, hasMore}` |
| `project.history.context` | binding plus `targetSessionId, messageId`, optional `query` | `{sessionId, title, messages, truncated}` |
| `project.codeSearch` | binding plus optional `action` (`search` default, `status`, `clear`), search `query` (1–500 characters), optional `limit` (1–50, default 20) | `{hits, truncated, index}` |

Agent RPCs resolve the stored session project and reject a stale/mismatched
`boundPath`. The parent proxy additionally requires its opaque launch binding,
rewrites the path from trusted session launch state and forwards only approved
fields. Agent memory writes require opt-in and Agent execution mode; Plan/Goal
are read-only, including code-cache clear. Invalid input and CAS/owner conflicts
are observable errors; no partial memory save is published. History search is
scoped before pagination. Context reads enforce the same current group membership
and exclude deleted sources. Code index scanning runs outside the async worker
and binding is rechecked after the blocking operation.
## Session activity RPCs

Local Desktop resources add `sessionNotes.get({sessionId})` and
`sessionNotes.set({sessionId,content,expectedRevision})`, returning `{note}`.
An existing session without a note reads exact empty content/revision zero;
nonexistent sessions are NOT_FOUND and conflicting writes are NOTE_CONFLICT.

`backgroundProcesses.list({sessionId})` returns `{processes}`: all active jobs
plus latest 100 terminal records. `read({sessionId,id})` returns `{process,
stdout,stderr,stdoutTruncated,stderrTruncated}` and optional execution errorCode,
errorMessage and persistenceError. `stop({sessionId,id})` returns `{process}` and
is idempotent for settled jobs. Cross-session IDs cannot read or stop another
owner. `backgroundProcesses.changed({sessionId,id,revision})` invalidates visible
reads; no command output is broadcast with the event. Explicit stopping remains
effective if its state write fails, while the storage error is reported.

Output notifications include a trailing flush within the existing 250 ms
  throttle, so output followed by silence remains visible before termination.

Background start is the existing authorized `tools.execute` Bash path with
`args.run_in_background: true`; the immediate result is a launch receipt, not
an exit status. Permit/cancellation ownership transfers to the Host job until
its runner tree exits. The ordinary command timeout still applies. EOF/shutdown
joins jobs; startup recovers unfinished rows as interrupted without replay.

Historical Plus P7 rows additionally return optional service metadata using
`BackgroundProcessSummary`: `backgroundKind`, `teamSessionId`, `teamRunId`,
`deadlineAt`, `stopReason`, `stopRequestedAt`, `stopMode`, and
`serviceStopEscalated`. A missing kind remains an ordinary command. Policy
metadata does not prove that a stop completed. Cold-start ownership recovery
records `host_restart` before interrupting active rows, without adopting a PID.
P7 stored no originating platform or stop mechanism; the compatibility reader
omits `stopMode` and does not interpret the raw escalation flag as TERM/KILL.
New Bash `args.backgroundKind: "service"` launches require the authenticated
current Agent Team/run and permission gates in [managed services](team-managed-services.md).
Historical ownership alone grants no launch, PID adoption or replay authority.

### Local Git workspace RPC (Plus)

`workspace.git.get` takes `{projectPath, sessionId?}` and returns `{git}` where
`git` is null for a non-Git directory. `workspace.git.switchBranch`,
`workspace.git.createBranch`, and `workspace.git.createWorktree` additionally
require `{branch, expectedHead, expectedBranch}`; both expected fields are
explicitly nullable. They return `{git}`; createWorktree also returns `{worktree}`.
The shared `GitWorkspaceSnapshot` defines checkout roots, primary path, HEAD,
branch, dirt, local branches with occupied paths and the Git worktree registry.

Host validates the requested path against the owning local session or active
workspace; imported sessions and remote origins are refused. Mutation ownership
also excludes team members. Branch operations reject active turns, Bash tools,
and managed background processes in the checkout or a descendant directory.
Host serializes admission with its state lock. Expected branch and HEAD must
still match when executing; no reset, force checkout or automatic stash occurs.
Worktree targets are allocated by Host under its data directory, never supplied
by the renderer. Git's registry remains the durable source of checkout identity;
no session-mode or database schema field is added. Failures keep existing user
changes and successfully created worktrees recoverable.

Read-only metadata copies validated ownership under the state lock, then releases
it before invoking Git. Mutation lock admission is bounded; Git has per-command
and operation deadlines, bounded output, and owned child cleanup. Effective Git
root must contain the canonical project path; an unrelated `core.worktree`
redirection is refused. Repositories that require executable file filters (such
as LFS conversion) are rejected for checkout mutations rather than silently
producing repository-format files. Metadata remains readable without executing
hooks or filters. A globally installed but unused filter does not block an
ordinary repository.

### Complete session activity summaries

The additive `sessionActivity.get({sessionId,offset?,limit?})` and post-commit
`sessionActivity.changed({sessionId})` serve the owning local Desktop session's
complete canonical history, independently of display windows. The bounded v1
page and monotonic Task settlement contracts are defined in
[Complete session activity projection](session-activity-projection.md).
No protocol-version/schema bump, model call or new plugin capability is added.

### Settled Team Goal report authorization (2026-10-11)

`team.authorizeLeadTool` applies the existing approved-execution settlement
predicate to both `TeamFinalAnswer` and `SubmitGoalReport`. The latter is checked
by the runtime's existing Lead wrapper before the report tool body runs. No RPC
or payload field is added. A rejection includes all pending dispatch IDs and
member names, assigned open task IDs, and the count and identities of unconsumed
current-expert results. It retains the `TEAM_APPROVAL_REQUIRED` prefix and
`wait_for_updates` guidance, and lists each open decision task as member (task
ID). The Lead must dispatch with `send_message`, or use `task_update` to mark
unworkable tasks `cancelled`/`failed` with a reason, then retry. Existing task
completion claims still require their normal terminal settlement. Settlement is
bound to the Host-proven original execution turn, never inferred from a historical
session approval. Post-execution mail does not extend Goal lifecycle authority.


Background timeout visibility (2026-10-11): the existing `errorMessage` on a
`TOOL_TIMEOUT` read states the applied default/explicit limit and the seconds
parameter guidance. The persisted tool-result content records `timeoutMs` and
`timeoutIsDefault`; older rows are not backfilled with invented provenance.
No summary field, migration, RPC or event field is added. Sidecar reads use the
existing opaque project launch binding, forward only `{sessionId,id}`, and
recheck binding generation plus the returned process owner after the await.
Only `read` is admitted; sidecar `list` and `stop` remain unavailable.
Team waits return the scoped terminal detail after an existing changed event;
output/start events only trigger a read and do not finish the wait.

The runtime tracks only successful owned launch receipts across tool rebuilds;
each wait reconciles their unconsumed IDs to avoid missing terminal events
between waits. Disposal revokes the in-memory tracker. Historical listing and
restart replay are not granted by this read capability.


### Team advisory write scopes and send-time HEAD

After an otherwise authorized, successful member Write/Edit, `tools.execute`
may append `content.scopeWarning` with
`{code:"TEAM_WRITE_SCOPE_WARNING",taskIds,message}` when the canonical path is
outside the union of non-empty `writeScopes` on tasks explicitly associated
with the current member turn at their current revision. No raw path is added.
Warnings never change ok/isError, permissions, retry budgets or task status.
Empty scopes, scratch, Bash, failed mutations and unstarted/historical tasks
are excluded. Advisory resolution/storage errors remain visible through
`content.scopeTrackingError` without falsifying a successful mutation. A Team
owner detached during execution leaves a visible `content.scopeTrackingSkipped`
notice and no orphan count.

`team.getBoard` adds optional `outOfScopeWriteCount` and `outOfScopeWrites`
(`{memberSessionId,memberName,count}[]`); new Hosts return zero/empty if clean,
and `team_status` defaults missing legacy fields to zero. Counts are cumulative
for the member in its team, at most once per successful turn/tool-call identity.
Existing KV preserves them across restart; session/team deletion cleans them.
These counts are neither permissions nor semantic completion verdicts.

`team.sendMessage` captures the sender's Host-resolved project HEAD at send
admission outside the state lock through a bounded, hardened read-only Git
probe. Caller project, running-turn identity, Lead user scope and normal Team authority
are revalidated after await; changed turns/scopes return TEAM_TURN_INVALID
before a message or stamp is written.
The Host-only KV stamp is immutable on idempotent replay. Optional `senderHead`
appears in Team mailbox projections (including readExecutionInbox/wait_for_updates),
`session.collaboration.message` and authenticated SessionMessageOrigin,
so live and restored member framing show the same SHA. Message body, provenance
validation and permission ceilings remain unchanged. Non-Git/unborn/legacy
messages omit it; unexpected probe errors log a bounded Host diagnostic without
blocking dispatch. Only SHA is exposed, not paths, Git stderr or secrets.
No new RPC, protocol version or schema migration is introduced.


### Team shared-tree Git advisory

After ordinary authorization and tool admission, Host recognizes common literal
Bash Git command forms: `add -A`/`--all`, `stash` (except `list`/`show`),
`reset --hard`, `checkout .`, `clean`, and `commit -a`/`--all`. When a different
current Team participant owns a non-deleted `in_progress` task with non-empty
`writeScopes`, the result includes `content.gitWarning`:
`{code:"TEAM_SHARED_GIT_WARNING",operations,conflictingTasks,message}`.
Each conflicting task identifies `taskId`, `memberSessionId`, and `memberName`;
no scope paths or command text are copied into diagnostic persistence.

This is a coordination warning, not a permission boundary or a shell sandbox.
It does not change permission prompts, tool admission, FIFO, shell limits,
`ok`, `isError`, `exitCode`, cancellation or timeout behavior. Failed commands
retain their real failure and warning. Background acceptance carries the same
warning without pretending the command has already succeeded. Common quoted
arguments, escaped words, `&&`/`;`/pipeline/newline combinations and Git global
options are recognized lexically. Aliases, variables, interpreter scripts and
other computed command forms are not guaranteed; target-repository inference
is not performed. Use explicit scoped staging and coordinate with other writers.
Read-only status/diff, stash list/show, the caller's own sole writer task,
empty scopes and completed/deleted/other-team tasks do not trigger this warning.

`team.getBoard` and `team_status` add optional `sharedGitWarningCount` and
`sharedGitWarnings` (`{memberSessionId,memberName,count}[]`), with zero/empty
legacy defaults. Counts record advisory-bearing executed/admitted Bash calls,
including failures, at most once per caller/session turn/tool-call identity;
they are separate from successful out-of-scope Write/Edit counts. Existing KV
preserves counts across restart; session/team deletion cleans them. Capture or
storage errors are visible as `content.gitTrackingError` and never change the
Bash result. A detached owner receives `content.gitTrackingSkipped` with no
orphan count. No RPC, protocol version, schema migration, member worktree or
`team_commit` tool is introduced.
## Explicit task dispatch and mailbox age (WP10)

The additive `taskDispatch` send contract, Host-owned age/provenance fields and
queued-only cancellation semantics are defined in [Team task dispatch](team-task-dispatch.md).
### Runtime-only pending Team mailbox metadata

team_status and ordinary Agent Lead wait_for_updates project metadata from
team.listMessages with the caller's own recipient session. The existing Host
authority and response are unchanged. Runtime exposes pendingMessagesCount,
pendingMessageSenders and oldestPendingMessageAgeSeconds; pending wait also
retains count and reason: pending_mailbox_messages. Both tool text and details
exclude the fetched message bodies and raw mailbox rows. Summary reads are
non-consuming: no ACK, receipt removal, provenance change, execution proof or
new RPC/event. Full bodies continue through authenticated role=user delivery or
the existing approved execution inbox as appropriate. Metadata reads validate
current turn/epoch/Team/mode after awaits. An ACKed queued/unbound row is pending;
createdAt is milliseconds encoded as a string, not ISO. Unknown oldest age is
null, including mixed known/unknown pending timestamps.
### Team member activity and interruption (WP9)

`team.getRoster` returns additive `memberActivity` for the Lead and every member;
`team_status` preserves it verbatim. Each item contains session/name, Host
observation time, ten-minute window, latest turn status/duration, last tool
name/time, active Bash ids and managed background process ids/status/start time,
recent completed usage call/token counts, and incoming/outgoing queued Team mail
counts/oldest age. Counts cover first Host-observed usage only; legacy untimed
usage and requests in flight are unknown. There are no report bodies, commands,
paths, Git-derived signals or credentials in this projection.

Queue age uses durable millisecond creation times. A durable queue ACK is
admission, not consumption: queued messages remain counted once until consumed.
Incoming queues never prove recipient execution activity. A member's actual
outbound response does, excluding Host-authored approval/failure notices.

`team.interruptMember({ teamSessionId, callerSessionId, memberName, force?, reason? })`
retains existing Lead-only and stop-only authority. Omitted force is false. Host
turn start, tool, completed reported usage, actual outbound response or background
start/completion within ten minutes requires force. Running managed background
processes and owned foreground Bash protect members regardless of duration.
Default refusal is `TEAM_MEMBER_ACTIVE`. `force:true` requires a trimmed nonempty
reason (maximum 1000 characters) or returns `TEAM_INTERRUPT_REASON_REQUIRED`.
The override bypasses only activity protection, not authority or approval.
The accepted exact-turn stop request is audited as `team_member_interrupt` before
notification; persistence failure emits no interruption. No active turn returns
`{ interrupted: false }`. No inactivity watchdog, shell budget, queue scheduling,
mailbox delivery or execution-token behavior changes. Additive local RPC; no
protocol bump or database migration. See ADR
[team-member-activity-and-interruption-guard](../../adr/team-member-activity-and-interruption-guard.md).
### Expert Team run limits (WP8)

`team.getSnapshot` and `team.getRoster` expose compatible optional `runLimits`
containing the live policy and durable run state. A roster with no started run may
return `runLimits: null`; a snapshot omits it. `team.resume` rejects a still-exceeded
live hard limit with `TEAM_RUN_LIMIT_REACHED`; policy adjustment never unpauses
by itself. Host `team.changed` adds reasons `run-limit-soft` / `run-limit-hard`.
Host-only `team.runLimitPauseRequested({teamSessionId})` asks Main to hold queues
and request safe runtime boundaries; it is not a renderer/model command or an
execution permission. See [Team run limits](team-run-limits.md) for run identity,
clock, notices, Goal interruption and compatible internal stop behavior.
### Team Lead unanswered questions and failed-slot successors (WP11)

`team.registerLeadAsk`, `team.deferLeadAsk`, and `team.ackLeadAsk` require the
actual Lead session and its running turn. Host fixes a 30-minute question wait.
Trusted Main alone reads/resolves/cancels durable asks; resolve atomically
persists a late response and an existing turn_queue user record. New replies
start a new user scope and never bind the former Plan/Goal execution token.
Optional Team pending metadata on AskToolRequest/RACP input requests is display
data, not approval. No ordinary permission or asktool deadline is introduced.

`team.createMember` accepts optional `replaces` for one approved failed slot.
It requires a new unique name and inherits the original confirmed route, role,
configuration and permission mode; route/role/fork overrides fail closed.
Host-only replacement links extend the same decision without changing its
approved review. Replaying the same replacement is idempotent; replacement
chains, another successor, active/queued sources and out-of-scope slots are
rejected with a legal nextStep. The original handle no longer accepts dispatch,
and its sessions/tasks/history remain. The eight-member limit still counts
failed members; full rosters need a new trusted review.

### Ordinary Agent Lead boundary inbox (WP16 S3)

The internal `team.getOrdinaryInboxCapability`, `team.readOrdinaryInbox`,
`team.ackOrdinaryInbox`, `team.getOrdinaryInboxProof` and identity-only
`team.ordinaryInboxPersisted` notification use the exact binding/proof contract
in [ordinary inbox](team-ordinary-inbox.md). Body-bearing reads are restricted
to trusted launch plumbing, never generic model-selected proxy methods or tool
results. Host validates ordinary current-turn authority; runtime epochs remain
separately guarded by Main/AgentHost/Runtime. Plus P6 stores the prepared →
persisted → ACKed journal with JSONL-first recoverable indexing; queue admission
is not runtime/model consumption. Protocol 11 is unchanged.

### Explicit Team service metadata (WP14)

Bash `backgroundKind`, owner/cap/TTL checks and optional service fields on existing
backgroundProcesses list/read/launch projections follow [managed services](team-managed-services.md).
`backgroundProcesses.changed` remains the existing identity-only invalidation;
read/stop remain session scoped. Plus P7 stores explicit ownership; older process
rows do not become services. No shell-budget/FIFO, approved-execution authority
or protocol-version expansion is introduced.

### Team diagnostics and progress hints (WP7)

Malformed strategy, presentation.role and displayName errors name their allowed
values/range. Route/stale-scope/unapproved-dispatch refusals retain their existing
codes/denial conditions with actionable nextStep. Runtime-only
completedMembersWithOpenTasks and completedMemberOpenTaskNextStep derive from
existing roster/task projections; they do not grant authority or settle tasks.


### Bounded Lead pseudo-tool-call recovery (2026-10-13)

For Team Lead Agent/Plan turns, final text whose unfenced trailing fragment
matches `call:<namespace>:<tool>{...}` receives one dedicated runtime recovery
before Host completion authorization. The nudge explains that text did not
invoke a tool and asks for the real tool-calling interface or an ordinary final
answer. Syntax quoted inside fenced code or followed by explanatory body text
does not trigger this rule. The detector parses nested braces and quoted content
without interpreting or executing the text.

The allowance resets with the guard's turn reset. A second matching answer goes
through ordinary Host authorization; it cannot bypass approved task/dispatch/
inbox settlement. This allowance is independent of the existing maximum-three
confirmed-roster settlement nudges. Members and non-Team sessions are outside
this rule. No tools are inferred or executed from textual pseudo calls, and
normal final-answer/event/usage semantics remain unchanged.

## Verified worktree memory aliases

`project.group.context({path})` may additionally return
`memoryAlias: {memory: ProjectMemory, instructions: string}`. Its existing
`context` remains the requested slot's actual group context, including null;
the alias never carries the owner's roots or changes group membership. Presence
is authoritative even for empty memory/instructions. Ordinary responses omit
the additive field. `project.memory.get` resolves the same verified owner as
the fallback memory reader.

`project.autoMemory.agentList` resolves the stored session project after the
existing trusted binding check and returns the same optional alias. File/Git
validation runs outside the Host mutex and SQLite transactions; the Host then
rechecks the session binding before reading memory. Agent callers cannot
substitute the real root as `boundPath`. Alias reads do not migrate or write
`kv`; effective `autoRecordEnabled` is false. Plan/Goal writes retain
`TOOL_DISABLED_IN_PLAN`. Other alias writes (legacy memory setter, snapshot
editor save, setEnabled and agent mutations) are rejected rather than
redirected. Group-id setters keep their existing explicit group semantics.

A missing/invalid projection produces bounded diagnostics without memory bytes
or credentials and preserves ordinary slot ownership semantics. A later
missing alias or failed refresh revokes the previous alias instructions and
notes, including when the prior response was nonempty.
