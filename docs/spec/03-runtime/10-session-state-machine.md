# 10. Session and Plan State Machine

## 0. Durable operating mode versus live planning state

Each session persists exactly one operating mode: `agent | plan`. There is one
pi Agent. Live planning state and execution status are host/runtime projections:

```text
Agent / inactive
  -- user selects Plan while idle OR Agent calls EnterPlanMode --> Plan / planning
Plan / planning
  -- SubmitPlan(title, markdown, question) --> Plan / awaiting_approval
Plan / awaiting_approval
  -- approve(permission mode) --> Agent / queued, same Agent continues
  -- reject | expiry | abort | crash | persistence failure
       --> Plan / planning
Agent / queued
  -- dispatcher starts --> Agent / running
Agent / running
  -- complete | fail | abort --> Agent / inactive
```

Plan retains the permission-mode selector. Its `Bash` policy is `ask` or
`accept-edits` = confirmation and `auto` = no confirmation, so Plan expresses
planning intent but is not a strict read-only security profile. Write/Edit and
plugin tools remain denied by host policy in every Plan permission mode.

Mode and configuration changes through the UI/session API are allowed only
while idle. Approval is not a generic tool permission: it is a separate
host-owned state transition. A host restart interrupts every pending approval
and queued/running execution field without replay; an already-approved
interruption keeps the durable session in Agent.

## 1. Session status

```text
idle <-> running <-> waiting_permission
           \/ aborted
           \/ error
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
 -> turn_start
 -> streaming
 -> (optional tool_loop)
   -> permission_maybe
   -> tool_exec
 -> turn_end
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
11. `EnterPlanMode` and `SubmitPlan` must be the only tool call in their
    assistant batch. `SubmitPlan` preserves exact Markdown bytes in a new
    host-owned `.pi/plan/*.md` artifact and creates one pending
    `plan_approvals` row with structured title/question and artifact fields.
12. Only a matching `plans.resolve` can settle a pending proposal. Approval
    atomically changes the durable mode to Agent, stores the selected explicit
    permission mode, assigns an execution ID, and changes the row's
    `execution_state` to `queued`.
13. Approve and reject are the only resolution actions. Rejection and expiry
    close the pending row, then return the live state to editable Plan/planning
    and grant no execution tools. A pending interruption does the same; a
    queued/running interruption after approval stays Agent.
14. A second prompt, Plan submission, configuration change, or execution is
    rejected while the session has an active turn, pending approval, or
    queued/running execution. Configuration is accepted only while idle.
15. A later Plan turn may revise a rejected/expired/interrupted checkpoint and
    must create a new immutable artifact rather than overwrite the earlier
    snapshot.

## 4. Persistence points

Message persistence is two-step per 04-data-storage §5 (D119): fsync'd
transcript-file line first, index transaction second.

- user message: on accept
- turn run row: on start + terminal `session.endTurn` update
- notification row: same transaction as an unseen completed/error terminal
  update; never for a visible-current result or abort
- assistant/tool messages: on message_end/tool_end
- mode/project fields: on change
- Plan submission: write exact Markdown bytes to a new unique `.pi/plan/*.md`,
  record path/hash/size plus structured title/question, and insert a `pending`
  `plan_approvals` row before the approval event
- Plan approval: approval outcome, mode transition, permission mode, execution
  ID, and `queued` state in one transaction; reject/expiry/interruption retain
  Plan and return live planning to editable state
- startup recovery: transactionally interrupt pending approvals and
  queued/running execution states before serving RPC; abort associated running
  turns and never replay work
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
8. Plan and Agent use one pi Agent; the Composer-left mode chip, UI entry, and
   `EnterPlanMode` converge on the same planning state, and approval resumes
   that Agent in Agent mode
9. Plan policy permits Bash only through the selected permission mode and
   denies Write/Edit/plugins regardless of `auto` or session grants
10. SubmitPlan writes an exact unique `.pi/plan/*.md` artifact with hash/size,
    keeps title/question structured, and only approve/reject can resolve its
    `plan_approvals` row
11. Expiry uses `PLAN_APPROVAL_TIMEOUT`; startup interruption, shell failure,
    and process recovery are fail closed, and restart does not replay pending,
    queued, or running work
