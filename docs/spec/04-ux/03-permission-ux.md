# 03. Permission UX

## 1. Goal

Make high-risk local actions visible, interruptible, and predictable.

## 2. Mode matrix

| Mode | Read/Glob/Grep | BrowserPreview | Write/Edit | Bash | Plugins |
|---|---|---|---|---|---|
| Agent | allow | allow | permission policy | permission policy | registered risk policy |
| Plan | allow | allow | deny | `ask`/`accept-edits`: confirm; `auto`: allow | deny |

Decision source: **D003/D170/D171**.

Plan keeps this permission-mode control visible. It is planning intent, not a
strict read-only security profile: a Bash command can mutate workspace or
scratch state when the user selects Auto. Write/Edit/plugin tools are denied by
the host before a permission card, regardless of grants or Auto.

## 3. Decision types

- `allow-once`
- `allow-session` (scoped by toolName, **D006**)
- `deny`

No `allow-always` in MVP.

## 4. Permission card states

```text
pending → allowed_once
pending → allowed_session
pending → denied
pending → timeout_denied
```

- A request is keyed by both `sessionId` and `requestId`.
- Each session has at most one pending request because its agent loop is
  paused, while different sessions may wait for independent approvals at the
  same time.
- Replacing or resolving one request never removes another session's request
  or a newer request in the same session.

## 5. Timeout

- Default timeout: **120 seconds**
- On timeout: auto `deny`
- UI shows timeout state explicitly
- Agent receives tool error result: user denied / timed out

## 6. Card content requirements

Must show:

1. tool name
2. risk level
3. short reason
4. args preview (redacted if needed)
5. workspace context
6. actions: Allow once / Allow for session / Deny

The card is rendered inline only in its originating session's transcript.
Background requests remain pending without opening an overlay, changing the
active page/project/session, or moving keyboard focus. Opening that session
reveals its card with the original absolute countdown deadline.

Resolving a request never initiates navigation. Any resulting tool artifact is
recorded in the same session's retained work-panel context. If that session is
backgrounded before completion, the artifact must not open or resize the
visible panel; explicitly returning to the session restores its retained panel
open state, tabs, active tab, and Browser resource without a transient panel
open/close cycle in the intervening conversation.

## 7. Composer interaction while pending

- user may continue editing text
- sending another prompt in same session is blocked while turn waits on permission
- Abort concurrently cancels the turn and explicitly denies the matching host
  permission request; late cleanup cannot clear a replacement request
- another session remains independently editable/runnable and its own pending
  request is unaffected

## 8. Session grants surface

Active session grants (toolName, grantedAt, clear action) remain runtime-owned.
A durable grants-management surface is deferred until a host-backed settings
schema exists; Settings must not render a control that cannot persist or affect
the permission runtime.

## 9. Plan checkpoint approval card

Plan approval is not a generic tool permission card. It is rendered inline in
the originating session after `SubmitPlan(title, markdown, question)` causes
host-core to preserve the exact Markdown bytes in a new immutable
`.pi/plan/*.md` artifact.

The card shows the structured title and question, an opener for the exact
artifact path, the current status, and the absolute deadline. It offers only:

- **Approve** with an explicit target permission mode (`Ask`, `Accept edits`,
  or `Auto`; default `Ask`)
- **Reject**, which stops the run and leaves Plan active

The card has distinct `pending`, `resolving`, `approved`, `queued`, `running`,
`rejected`, `expired`, and `interrupted` states. Approval is enabled only for a
matching live proposal/session/turn/tool-call/version request and the deadline
is exactly 30 minutes from creation. Renderer reload may restore a pending row
without resetting its deadline. Startup interruption marks pending and
queued/running work interrupted before RPC service, offers no stale action, and
never replays it. Expiry uses `PLAN_APPROVAL_TIMEOUT`. An already-approved
interrupted run keeps the session in Agent.

## 10. Acceptance

1. Plan denies Write/Edit/plugins in every permission mode
2. Plan Bash prompts under Ask and Accept edits and runs without confirmation
   under Auto, with the mutation tradeoff visible
3. Agent mode uses the normal high-risk permission policy
4. timeout becomes deny in UI + tool result
5. allow-session suppresses repeat prompts for same toolName only
6. concurrent session requests remain isolated and never take over the visible
   conversation or its work panel; post-approval artifacts remain assigned to
   the request's originating session
7. Plan approval displays title/question, opens the immutable artifact, shows
   expiry/status, and sends the selected permission mode only on approval; no
   inline Markdown/hash/byte-size or feedback action is required
8. reject, expiry, abort, crash, stale response, and persistence failure leave
   pending Plan work in Plan with no execution capability
9. host restart interrupts pending/queued/running work without replay and keeps
   already-approved interrupted sessions in Agent
