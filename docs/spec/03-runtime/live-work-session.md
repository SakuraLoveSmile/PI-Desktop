# Live Voice Work Session Integration

> Status: In progress; acceptance requires the automated and manual evidence
> listed in the delivery plan. Live Voice provider bindings and work-session
> bindings are separate scopes.

## Purpose

Live Voice may submit a bounded work request to the existing local PI-Desktop
Agent session selected by the user. The Live provider remains a voice interface;
the existing Agent Runtime continues to own file, shell, MCP, plugin, skill, and
subagent work under the session's current model and permission policy.

## Scope and authorization

- A call without a `workTarget` remains a voice-only call.
- Enabling work access is an explicit renderer action. Main resolves the
  selected local session and creates a call-scoped `LiveWorkBinding`; a provider
  tool request cannot choose a session, project path, model, mode, or permission.
- A call's work binding does not follow sidebar selection. Opening another
  session is navigation only; changing the work target requires a new call.
- The first implementation accepts local desktop sessions. Native Pi and
  remote work sessions stay unavailable until their Host surfaces implement the
  same scoped controls and terminal events.
- Context sharing is an explicit work-call option. When disabled, the intent
  classifier receives the current request and bounded work-state metadata but
  does not read prior session messages.

## Candidate and routing flow

Each provider exposes only `delegate_to_work_session({ instruction })`. Main
validates the tool name and arguments, freezes the call scope, registers a
bounded operation identity, and returns a short `received / not_started`
receipt before intent classification or Agent admission. Identical provider
request IDs are not dispatched twice; changed content under the same ID is
rejected.

A read-only one-shot classifier uses the selected work session's configured
model with tools disabled. Its strict output is passed to deterministic
routing. Conversation and status requests do not create turns. A clear
constraint on the observed active turn may steer that exact turn. An explicit
independent task uses the Host-owned queue. Ambiguous routing, stale turns, and
unavailable sessions fail closed; steer failure never falls back to prompt or
queue. A result query reads the latest terminal operation recorded for the
current call, or the explicitly referenced operation, and shows its bounded
summary without starting another turn.

## Existing Host and Agent ownership

Work submission uses the existing AgentHost and registered Agent handlers. The
Host queue remains the only queue and applies its existing capacity, order,
delivery, and cancellation behavior. Voice user messages carry an optional
`voiceOrigin` containing the call and operation IDs. Existing messages without
that metadata remain valid.

Stop and abort requests include the observed turn ID and are checked at the
actual run owner. Ending a Live call closes its candidate scope and media but
does not cancel work already accepted by the Agent or Host queue. Permission,
Plan, Goal, and AskTool decisions stay in their existing UI and policy paths.

Only the Host's authoritative turn-terminal event settles the Live operation.
Message completion, tool output, or a provider response ending is not proof
that the work finished. Missing evidence remains unknown; completion alone
does not imply tests passed.

## UI and current capability boundary

The existing Live panel displays the fixed work target, whether bounded context
sharing is enabled, current operation admission/execution state, bounded route
or rejection messages, and exact terminal summaries. It also provides actions
to view the bound session, stop its observed running turn, or cancel its exact
queued item. It uses the normal session picker/create flow for explicit desktop
selection before a call.

The current implementation does not expose model-driven project/session
selection or create/open intents through `selectionRef`. It also does not yet
deliver terminal-result summaries through each provider's safe feedback
scheduler, so result summaries are currently visible in the Live work panel
and are not automatically spoken. These remain acceptance gaps and must not be
represented as completed behavior.

## Privacy and resource limits

- No provider-supplied path, session identity, raw IPC operation, permission
  flag, or arbitrary tool schema crosses the work boundary.
- Context projection includes only bounded plain user/assistant text after
  filtering tool output, attachments, and prior voice-origin messages.
- Live captions are transient and are not inserted as work-session messages.
- Call cancellation controls only unaccepted candidates and Live feedback; it
  is not an Agent cancellation signal.
- Per-call candidate identities and operation views are bounded and discarded
  when the call closes. Existing Host persistence owns accepted queue entries
  and user-message provenance.

## Validation references

The implementation and test evidence are tracked in
[`../../implementation/live-work-evidence.md`](../../implementation/live-work-evidence.md).
The representative user path and automated coverage status are listed in
[`../06-delivery/04-e2e-test-plan.md`](../06-delivery/04-e2e-test-plan.md).
