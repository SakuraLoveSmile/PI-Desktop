# ADR 0319: Offer the Advisor Tool in Plan and Goal Modes

- Status: Accepted (D642)
- Date: 2026-10-23
- Deciders: PI-Desktop core
- Related: D189, D384 (ADR 0211), `docs/spec/03-runtime/advisor-tool.md`

## Context

The Advisor tool lets a main session consult a second model the user has pinned
in Settings. The consult sends the conversation so far to that model and returns
its advice. The advisor has no tools and cannot act on the host.

Plan and Goal are contract modes. The agent inspects, drafts a proposal, and
leaves the mode only through SubmitPlan or SubmitGoal and the approval boundary
(D189). Their tool set is read-only: inspection tools, plan-safe plugin actions
(ADR 0211), and the submit tool of that kind.

A second opinion is most useful before a proposal is submitted, because it can
catch a flawed plan or an unverifiable goal before the user reviews it. The
contract-mode allowlist did not include Advisor, so the runtime neither declared
the tool nor allowed its calls in those modes.

## Decision

1. In Plan and Goal, a main session declares and executes `Advisor` under the
   same condition as Agent mode: the user has pinned an advisor model. Team
   profiles and subagents still never receive the tool.
2. The consult stays read-only. It runs inside the agent runtime, uses no tools,
   and returns text, so it cannot write the workspace or reach Host. The contract
   modes keep their read-only guarantee.
3. The call never reaches Host. No host permission rule classifies it, and no
   approval prompt appears under any permission mode (`ask`, `accept-edits`,
   `auto`). The pin the user chose is the consent for sending the transcript to
   the advisor provider, and the Settings card states that.
4. `permissions.rs` is unchanged, because no host decision is made for this tool.
   The frozen policy table in `docs/spec/03-runtime/03-tools-and-permissions.md`
   and baseline item 44 list Advisor for Plan, and the operating-mode matrix
   notes that it has no permission row.

## Consequences

- A Plan or Goal session can ask for a review before it submits. The model still
  decides when to submit, and the approval boundary is unchanged.
- Each consult sends the transcript to the advisor provider in these modes too.
  The privacy section of the advisor spec applies without change.
- In Plan and Goal, Advisor appears in the provider tool list only for sessions
  with a pinned advisor model.
- No IPC, Plugin SDK, persistence, or host-core change.

## Alternatives considered

- **Keep Advisor out of contract modes.** Rejected: planning is where a second
  opinion helps most, and a read-only consult does not break the contract-mode
  guarantee.
- **Give Advisor a host permission entry at low risk.** Rejected: the call never
  reaches Host, so the entry would be policy that no code path reads. A per-call
  prompt would add friction without a new safety property, because the pin is the
  consent.
- **Declare Advisor in Plan and Goal but deny execution.** Rejected: the model
  would see a tool that always fails in those modes and spend turns on it.
