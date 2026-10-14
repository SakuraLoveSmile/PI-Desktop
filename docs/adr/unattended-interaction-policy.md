# ADR: Host-owned unattended interaction policy

- Status: Accepted for implementation
- Date: 2026-10-14
- Amends: [Interactive questions](0077-asktool-interactive-multi-question-flow.md)
- Related: [asktool specification](../spec/03-runtime/17-asktool-questions.md)

## Context

External schedulers run Plan and Review sessions without an operator in the
Desktop UI. Tool auto approval does not answer questions: `asktool` can still
create an indefinite waiter. A prompt instruction cannot enforce that boundary.
Trusted extensions also fail open when loading or handling a hook fails, so
they cannot supply the required guarantee.

## Decision

The Rust Host owns a durable `interactionMode` session policy. It defaults to
`interactive`; an external scheduler explicitly selects `unattended` through
session creation/configuration. Session responses report the stored policy and
`interactionPolicyVersion: 1`. Clients requiring this guarantee must verify an
explicit receipt before prompting. Missing support is an error, never a
fallback to prompt instructions. Omitted configuration preserves the current
policy, forks inherit it, and active work fences policy changes.

Prompt admission accepts `expectedInteractionMode`. The Host compares it with
the stored policy atomically when beginning the turn; a mismatch rejects before
any model request. Launchers also use their policy snapshot as this admission
condition, so configuration changes cannot admit a stale runtime. Schedulers
requiring unattended execution send this condition on every prompt. Existing
Team leads or members reject policy changes that would split the inherited
policy; newly created Team and collaboration sessions inherit their parent.

The runtime removes `asktool` from model declarations and discovery in an
unattended session. Before the agent loop can dispatch any tool in a completed
assistant response, it checks the entire response for `asktool`. A forbidden
call ends that response as a non-retriable `INTERACTION_REQUIRED` error. It
preserves the assistant content and usage but dispatches no tool from that
batch, creates no question waiter or `asktool_request`, and admits no next model
request. Invalid arguments and calls absent from the catalog are checked at
this same boundary. A retained execute reference must also refuse the wait.
Extensions cannot replace this enforcement boundary.

The error details are `{kind: "interaction_required", toolName: "asktool",
toolCallId, questions}` using the existing `AskToolQuestion` shape. Invalid
arguments carry `questions: []` and `invalidArguments: true`; arbitrary raw
arguments are not copied to error metadata. The first terminal owner persists
the details atomically with the existing `error` turn state. Both Desktop and
headless paths retain them, and `pi_turn_get` exposes them after restart. A late
completion or abort cannot overwrite the settled error.

All `asktool` calls in one response contribute questions in call order, retaining
the first call's identity in `toolCallId` and every call in the transcript. Any
invalid call invalidates the whole question list. Normalized details are limited
to 64 KiB of compact JSON in UTF-8, 20 questions, 100 options per question, and
512 UTF-8 bytes for the call identity. An invalid identity is represented only
by the `invalid-tool-call-id` marker with `invalidArguments: true`; consumers
must not treat it as a valid question request. Only an `error` terminal with
`INTERACTION_REQUIRED` can persist these details, and unknown fields are removed.

Plus schema P8 adds `sessions.interaction_mode` and `turns.error_details_json`
on the independent Plus track. The shared `PRAGMA user_version` chain does not
change. Existing sessions retain interactive behavior, with an upgrade backup
and the normal newer-schema downgrade refusal.

## Consequences

KaneoPilot can deterministically turn the intercepted questions into planning
input or a blocked Review report without another model call. Ordinary Plus
questions retain their existing UI lifecycle. The guarantee covers the built-in
`asktool`; it is not a sandbox for arbitrary shell programs or third-party tools
that implement their own interaction.

The alternative of only hiding a tool declaration leaves stale or fabricated
calls to ordinary tool-not-found recovery. Blocking only one valid call with a
hook also leaves mixed batches and hook failure behavior. The complete-response
boundary avoids both gaps without modifying the upstream agent loop.
