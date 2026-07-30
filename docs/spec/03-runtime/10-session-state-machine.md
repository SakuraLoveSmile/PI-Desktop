# 10. Session and Plan State Machine

## 0. Durable operating mode versus live planning state

Each session persists exactly one operating mode: `agent | plan`. There is one
pi Agent. Live planning state is a host/runtime projection:

```text
Agent / inactive
  -- user selects Plan while idle OR Agent calls EnterPlanMode --> Plan / planning
Plan / planning
  -- ExitPlanMode(structured plan) --> Plan / awaiting_approval
Plan / awaiting_approval
  -- approve(permission mode) --> Agent / inactive, same Agent continues
  -- request_changes(feedback) --> Plan / planning, same Agent revises
  -- reject | timeout | abort | crash | persistence failure --> Plan / stopped
```

Plan retains the permission-mode selector. Its `Bash` policy is `ask` or
`accept-edits` = confirmation and `auto` = no confirmation, so Plan expresses
planning intent but is not a strict read-only security profile. Write/Edit and
plugin tools remain denied by host policy in every Plan permission mode.

Mode changes through the UI/session API are allowed only while idle. Approval
is not a generic tool permission: it is a separate host-owned state transition.

## 1. Session status

```text
idle ⇄ running ⇄ waiting_permission
          ↘ aborted
          ↘ error
```

| status | meaning |
|---|---|
| `idle` | no active turn |
| `running` | model/tool turn active |
| `waiting_permission` | blocked on user permission decision |
| `aborted` | terminal for current turn (then returns idle) |
| `error` | terminal for current turn (then returns idle) |

## 2. Turn lifecycle

```text
accept_prompt
 → turn_start
 → streaming
 → (optional tool_loop)
   → permission_maybe
   → tool_exec
 → turn_end
```

## 3. Transition rules

1. Only one active turn per session
2. New prompt rejected with `AGENT_BUSY` while running/waiting_permission
3. Abort from running or waiting_permission is allowed
4. Permission timeout moves to tool denied, then agent may continue or end based on runtime handling
5. Session status returns to idle after terminal turn states are persisted
6. Changing the renderer's active project/session does not transition or abort
   any background session
7. A tool transition retains the originating session's persisted project root;
   it never adopts the newly active project's root
8. `session.endTurn` moves only a `running` turn to terminal. In that same
   transaction, unseen `completed` inserts `task.completed`, unseen `error`
   inserts `task.failed`, and a result already visible in the focused current
   chat or any `aborted` turn inserts no notification (D117). Repeated terminal
   calls are no-ops.
9. Fork is allowed only while the source is idle. The child begins idle with
   no turn or waiting-permission state. Electron returns `AGENT_BUSY` for its
   active runtime guard and normalizes the host's persisted running-turn
   `CONFLICT` fallback to the same IPC error. Neither path produces a partial
   child.
10. Supplying `throughMessageId` changes only the snapshot boundary. Assistant
     Fork/Edit still creates a new idle session id with no shared turn,
     permission wait, runtime, or provider-cache state (D134).
11. `EnterPlanMode` and `ExitPlanMode` must be the only tool call in their
    assistant batch. `ExitPlanMode` creates one host-owned pending approval;
    the same session cannot start another plan proposal while one is pending.
12. Only a matching `plans.resolve` can settle a pending proposal. Approval
    atomically changes the durable mode to Agent and stores the selected
    explicit permission mode before the waiting tool call succeeds.
13. Requesting changes returns feedback to the same Agent and stays Plan.
    Reject, timeout, abort, crash, stale responses, and persistence failure
    stay Plan and grant no execution tools.

## 4. Persistence points

Message persistence is two-step per 04-data-storage §5 (D119): fsync'd
transcript-file line first, index transaction second.

- user message: on accept
- turn run row: on start + terminal `session.endTurn` update
- notification row: same transaction as an unseen completed/error terminal
  update; never for a visible-current result or abort
- assistant/tool messages: on message_end/tool_end
- mode/project fields: on change
- Plan submission: durable pending approval row before the approval event
- Plan approval: approval outcome, mode transition, and permission mode in one
  transaction; feedback/reject/timeout/interruption retain Plan
- fork snapshot: new transcript file plus one child session/index transaction;
  source persistence remains untouched; a message-scoped snapshot ends
  inclusively at the selected message

## 5. Acceptance

1. Busy session cannot start second concurrent turn
2. Abort is idempotent
3. waiting_permission is visible in UI status
4. sessions in two retained project tabs may run independently without
   transcript-event or workspace-root crossover
5. each unseen completed/failed turn produces exactly one notification record
   while a visible-current result or aborted turn produces none
6. an idle fork starts as an independent idle session; a busy source cannot
   produce a child
7. a message-scoped fork excludes later rows and begins with no source runtime
   or provider-cache state
8. Plan and Agent use one pi Agent; UI entry and `EnterPlanMode` converge on the
   same planning state, and approval resumes that Agent in Agent mode
9. Plan policy permits Bash only through the selected permission mode and
   denies Write/Edit/plugins regardless of `auto` or session grants
10. plan approval failure and process recovery are fail closed
