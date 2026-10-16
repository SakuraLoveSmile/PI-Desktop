# 17. asktool Interactive Questions

## 1. Purpose

`asktool` lets the model pause a turn and ask the user one or more bounded
questions. It is available in Agent, Plan, and Goal mode and is separate from
permission approval: it does not authorize an operation. Ordinary questions have
no validity deadline; the Team Lead wait exception below preserves the unanswered question.

### Host-owned unattended sessions

Sessions default to `interactionMode: "interactive"`. A scheduler may persist
`"unattended"` through session creation/configuration and must verify the
returned policy plus `interactionPolicyVersion: 1` before sending a prompt.
Permission mode is independent of this policy. Omitting the policy preserves
the current value; forks inherit it, and active work blocks changes.
The prompt's `expectedInteractionMode` is compared atomically at Host turn
admission. Schedulers send `"unattended"`; launchers bind admission to the launch
snapshot. A mismatch admits no turn or model request. Policy changes on an
existing Team lead/member cannot weaken the inherited tree policy.

In unattended sessions, model declarations and discovery omit `asktool`.
The final assistant response is checked before any tool lookup, validation, or
execution. A response containing `asktool`, even with malformed arguments or
other tool calls before it, dispatches none of that batch and ends immediately
with non-retriable `INTERACTION_REQUIRED`. No question request or waiter is
created and no further model request is admitted. Retained execute references
cannot create a waiter either. This is runtime enforcement, independent of
prompt compliance or trusted extension success.

The existing terminal `error` state carries durable `errorDetails`:
`{kind: "interaction_required", toolName: "asktool", toolCallId, questions}`.
Questions use the request shape below. Malformed arguments instead carry an
empty question list and `invalidArguments: true`, without arbitrary raw input.
Desktop and headless termination persist these details atomically; `pi_turn_get`
returns them after restart. Clients present these questions in their own user
workflow; the runtime does not answer them or resume automatically.

Multiple calls contribute all questions in call order; `toolCallId` names the
first call and the transcript retains the remaining identities. Any malformed
call invalidates the whole list. Normalized compact UTF-8 JSON is at most
64 KiB, with 1–20 questions, 1–100 options per question and a call identity of
at most 512 UTF-8 bytes. Invalid identities use `invalid-tool-call-id` only as
an invalid marker with `invalidArguments: true`. Invalid details never produce
a question form. Terminal persistence strips unknown metadata and accepts
details only for `error` / `INTERACTION_REQUIRED`.

See [the policy ADR](../../adr/unattended-interaction-policy.md). Ordinary
interactive sessions retain all behavior described below.

## 2. Request shape

The tool accepts a non-empty `questions` array. Each question contains:

- `question`: the prompt text, which may include Markdown;
- `options`: one or more selectable answer labels, each either a Markdown
  string or an object with a required Markdown `label` and optional plain-text
  `description`;
- `multiSelect`: optional; when true, more than one selectable answer is allowed.

Plain string options remain supported. The card renders CommonMark/GFM text
formatting such as emphasis, inline code, paragraphs, and lists. Links render as
non-interactive text, images as alt text, and raw HTML is ignored. Question
text and option labels use the same renderer; optional descriptions remain plain
text. Rendering never rewrites the option value: selection and the model-facing
answer use its normalized source label. The desktop card always adds one extra `Enter another answer`
option with a text field. The model does not need to add a special free-text
choice to the tool arguments.

## 3. Card interaction

Only one question is shown at a time. A small indicator is rendered for every
question and uses three states: unanswered, answered, and skipped. Selecting an
indicator revisits that question. `Next` records an answer when one exists;
otherwise it records a skip. `Skip` explicitly records a skip and advances.
`Decline all` resolves every question as skipped.

For ordinary questions there is no timer, countdown, or automatic expiration. The card remains pending
until the user submits or the turn is stopped. If the turn is stopped while a
card is open, the runtime resolves every remaining question as skipped.
Later ordinary asktool calls in the same assistant tool batch also return
skipped results without registering another waiter or opening a new card.

When an ask arrives, the app shows an in-app toast with a stable localized
prompt title and the first question; background sessions also follow the
existing native notification policy. Ask titles deliberately do not interpolate
the session title, because generated titles may contain tool-call text. The ask
event plays one soft in-app chime; its toast does not play a second one.

## 4. Tool output

The response is the normal tool result returned to the model and persisted with
the tool row. Markdown source is retained in the serialized question and
selected label; rendering is presentation-only. For each question, content is
serialized as:

```text
question text：answer label 1、answer label 2
```

Multiple questions are separated by `\n---\n`. A skipped or unanswered
question keeps the question text and uses an empty placeholder:

```text
question text：
```

## 5. External answering over local MCP (execution ask relay)

Implementation status: specified, not yet implemented or validated. This
additive contract covers ordinary interactive asks only. It does not expose
permission approval or Team-managed questions and does not create a remote
access surface. See [the decision](../../adr/external-ask-answering-over-mcp.md).

- `AskToolRequest` adds optional `turnId` and `createdAt` fields, populated
  when the runtime registers its waiter. Older requests remain valid.
- `pi_asks_pending {sessionId}` is read-only and returns
  `{sessionId, asks:[{requestId, toolCallId, turnId?, createdAt?, questions}]}`.
  Exclude requests marked `teamManaged` or `teamPending`; `native-pi:` sessions
  return no asks. The MCP projection must not inherit the Renderer helper's
  eight-request cap. Status and details use the same filter.
- `pi_agent_status` retains its `{status:{...}}` envelope; Main adds
  `status.pendingInputs:{count,requestIds}`. Runtime `getStatus()` remains
  unchanged. Only live waiters count; no durable unanswered history is invented
  after sidecar restart. Size-limit errors are observable and never presented
  as an empty pending list.
- `pi_asks_resolve {sessionId,requestId,expectedToolCallId,answers,confirm:true}`
  is dangerous. `answers` is an ordered `(null|string[])[]` with exactly one
  entry per question. Each non-null entry contains nonempty strings; ordinary
  single-select questions accept at most one value. Free text and a selected
  label are mutually exclusive for single-select; multi-select can append free
  text. The existing deterministic §4 serialization is preserved.
- Validate confirmation and input shape before dispatch. Bind session,
  request and expected tool-call identity to the same pending waiter; reject
  cross-session/call identity with `ASKTOOL_IDENTITY_MISMATCH` and Team-owned
  attempts with `ASKTOOL_TEAM_MANAGED`. Malformed arguments fail with
  `ASKTOOL_INVALID_ARGUMENT`. Do not use the sole visible question as identity.
- An accepted answer returns `{status:"answered",requestId}`. A request
  already consumed by either surface returns `{status:"not_pending",requestId}`;
  normalize both runtime `ASKTOOL_NOT_FOUND` and AgentHost `NOT_FOUND` only for
  this request-resolution path. Other failures remain failures. A successful
  non-pending result does not prove which answer won or that the turn completed.
- The runtime consumes a waiter at most once; neither the bridge's reentrant
  guard nor an external client's local lock guarantees exclusion against
  Desktop answering. There is no new prompt, turn, session or approval after
  an answer. A delayed request can still apply after its client's timeout;
  pending snapshots are not delivery receipts.
- Named and generic MCP ask resolution record `input.resolved.by` using a
  trusted `MCP_CONTROL_PRINCIPAL` (`subjectId:"mcp-control"`, role controller,
  input/respond capability). Renderer IPC retains DESKTOP_PRINCIPAL. The
  client cannot choose, inject or elevate a principal. Controller bootstrap
  must pass this source through the actual bridge resolution path.
- A resolved ordinary ask disappears through the existing tool-end Renderer
  event; reload reconstructs from pendingInteractive. An empty MCP list alone
  is not evidence that the Renderer card was removed.

The ordinary stop rule in §3 closes current ordinary waiters as skips and
fences later ordinary asktool calls in the same assistant batch before waiter
registration, preserving graceful stop's `completed` settlement. Abort independently
settles `aborted`; Team and preserveRunningTools behavior remains unchanged.
Sidecar restart discards in-memory waiters; external schedulers must retain
their own question history and use durable turn evidence to classify expiry.

The existing ordinary asktool tool-result details add `resolutionKind` with
`answered`, `stopped`, or `aborted`. Ordinary answers, including Decline all,
are answered; graceful-stop cancellation is stopped, and abort cancellation
is aborted. This private waiter consumption marker is persisted alongside
questions, answers and resolvedAt. It does not change model-facing content,
introduce a history API, or persist an answering principal. `session.get` projects optional `message.turnId` from the persisted message
index using the same session and message ID; the associated turn must belong
to that session. Missing index identity stays missing, without guessing from
the active turn or timestamps. An external
scheduler can match session, turn and tool-call identity in a complete
transcript to distinguish a real answer followed by immediate completion
from cancellation. `input.resolved.by` remains event-only evidence.

This format is deterministic, preserves question order, and makes multi-select
answers distinguishable without exposing a renderer-only state object to the
model.

## Team Lead pending questions (WP11)

Only a Team Lead's Host-bound running turn has a 30-minute wait budget. Rust
registers the question durably. Timeout changes it to pending and interrupts
the turn without answering, approving work, or completing a Goal. The same Ask
card remains answerable. A timely answer goes to the current tool and is
acknowledged; a late or orphan-recovered answer is atomically queued as a new
authenticated user turn with identity `asktool-answer:<requestId>`. It carries
no old execution token and requires explicit resume/new approval. Queue-full
failure preserves the pending question. Identical replies are idempotent;
changed replies fail. Stop/Abort cancels questions and fences late registration.
Reload restores pending cards; restart preserves questions and the existing
controller-held queue behavior. Ordinary asks and permission approvals have no
new timeout. See [the decision](../../adr/team-lead-pending-questions-and-replacements.md).
