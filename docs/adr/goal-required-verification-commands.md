# ADR: Approval-bound Goal verification commands

- Status: Accepted for implementation
- Date: 2026-10-19

## Context

An external task controller freezes verification commands in an approved plan.
The Agent may describe successful checks in prose while omitting formal report
checks. A structurally valid `met` draft then finalizes before the controller
can discover the gap. Prompt instructions cannot enforce completeness, and
editing a completed report would break its identity and audit trail.

## Decision

Add optional `requiredVerificationCommands` to Goal approval. Host validates
and persists it in the same approval transaction, returns it on execution
descriptors, and checks every submitted draft before persistence. The list is
owned by the approver and cannot be changed or removed by replaying approval.
Main, MCP and sidecar preserve the binding; the execution prompt exposes the
requirements without making model-authored text authoritative.

Every required command needs exactly one original-text check with a consistent
integer exit code and result. A `met` claim requires all to pass. Honest
non-met checks may express not-run/blocked with a concrete reason. Expected
validation errors reach the running Agent through the existing tool-error
path, allowing a corrected submission in the same execution.

Use additive Plus migration P10 for nullable
`plan_approvals.required_verification_commands_json`. Old rows remain NULL;
no upstream migration, contract Markdown or historical report is changed.
The executable limits and exact error semantics live in the IPC, Host RPC and
storage specifications and their contract tests.

## Consequences

Bound Goals cannot finalize an incomplete successful draft merely because the
prompt was ignored. Ordinary Goals remain compatible. New controllers must
check the approval schema before initiating a paid model turn and must not
silently fall back to prompt-only requirements. Upgrading P9 takes the normal
verified database backup; older binaries refuse the P10 profile.

The 2026-10-22 evidence repair additionally checks bound successful drafts
against durable native Bash results owned by the same execution segments.
Runtime exposes usable call IDs; Host accepts native integer exit codes in
the runtime result envelope and legacy bare result, and returns correction
errors while the Agent is still running. Model prose and shell names cannot
substitute for evidence. Controllers still verify report identity and source
snapshots. Already
completed incomplete reports require a separately authorized execution;
they are not rewritten or silently marked passed.

## Alternatives

Stronger prompts alone leave the original failure possible. Reusing `plan_json`
would change the artifact's hashed Markdown. A new arbitrary report mutation
API would enlarge the write surface and invalidate completion history. A
Host-owned execution-evidence ledger is not needed: the existing durable
transcript and exact execution-turn ownership supply the native proof.
