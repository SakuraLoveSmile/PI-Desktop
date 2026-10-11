# Host-owned Team run limits (WP8)

The Host bounds repeated expert-team validation/fix loops with wall-clock limits.
This applies to ordinary Agent, Plan research, and approved Goal/Plan execution;
standard standalone sessions retain their existing behavior.

## Policy and user path

Settings → Expert team → User scope contains **Team run limits**, using the
existing settings primitives and expert-policy compare-and-swap writer. The
optional additive `expertTeam.runLimits` field is
`{ enabled: boolean, softMs: integer, hardMs: integer }`. Absent legacy policy
means enabled, soft 21,600,000 ms (6 hours), hard 36,000,000 ms (10 hours).
Require `0 < softMs < hardMs <= Number.MAX_SAFE_INTEGER`; `null`, fractions,
unknown fields and incomplete explicit policy are invalid. UI hours convert to
integer milliseconds. Policy is live and user-wide, not a member tool grant.

The run identity is the existing Host-authored `team-strategy-scope-v1` Lead user
turn. A newly admitted non-mail Lead user turn establishes a new run. Mailbox
continuations, pause/resume, provider retries and process restart do not reset
the clock. A request merely queued behind a paused Team cannot reset its budget
or unpause it. A legacy Team starts timing when it first actually executes under
the new code; historical `teams.created_at` is not used.

A run is active when a Lead/member turn is running, Team mail is queued, or the
Team owns pending turn-queue work. Completed, empty, idle Teams never receive a
limit notice or a synthetic wake-up. A hard-paused run stays paused after restart.
Its existing Resume action rejects with `TEAM_RUN_LIMIT_REACHED` while the live
hard policy is still exceeded; first extend or disable the policy, then explicitly
resume. Resume preserves the run identity and elapsed high-water mark. A new
session is an independent run; there is no budget-reset or automatic-unpause UI.

## Clock, persistence and effects

`team/run_limits.rs` owns `team-run-limits-v1` KV records keyed by Team id:
`{ runId, startedAt, elapsedMs, softMessageId, hardReachedAt }`. Wall clock
continues during pause/offline time; persisted `elapsedMs` is a nondecreasing
high-water mark within the run, so clock rollback/restart does not refund elapsed
time. No SQLite schema/version change is required. The RPC server owns a one-second
scheduler, skips missed ticks, and aborts it during shutdown. Delayed Host scheduling
can delay detection; the boundary is not a real-time process-kill deadline.

At soft, transactionally create one Host-authored mailbox wrap-up message with
idempotency key `team-run-limit-soft:<runId>`, and persist its exact id. A matching
`team.changed` notification prompts a localized toast/native banner. The Team panel
retains the status after restart even if a transient native notification was missed.
The message uses the existing authenticated user-role delivery path. Ordinary
Agent mail waits for the current turn to end; approved execution may read this
specific Host-proof-bound message in its existing execution inbox. A model-written
body or idempotency key cannot forge the proof, permissions, or execution scope.

At hard, reuse the existing persisted Team pause and queue hold. A manual
queue pause does not exempt still-running turns from hard enforcement. The Host finishes
any still-running approved Goal execution as `interrupted` through the existing
Plan manager, including token invalidation. Main requests a safe runtime stop at
the next assistant/tool-batch boundary, using the Host-only
`agent.stop({ sessionId, turnId, preserveRunningTools: true })` extension. This
path bypasses the ordinary user-stop peer-abort hook. A provider-only abort
signal fences both request-level retries and outer stream retry backoff, including
infinite retry mode; it never cancels the Agent/tool signal. Stop admission persists
until the next Host-admitted turn. Reopening runtime admission after explicit
Resume does not reset the Host run clock. A model response arriving after hard cannot
admit a new tool batch, while a batch admitted before hard finishes naturally. A foreground tool batch
settles naturally; existing background processes are not stopped, and shell
capacity/FIFO/timeout behavior is unchanged. During pending recovery, the safe
boundary clears recovery before another iteration. Ordinary user Stop retains its
existing behavior. Team panel distinguishes safe finishing from fully paused, and shows an explicit
Resume-ready message when disabling or extending the policy permits recovery.

The scheduler retries safe-stop/Goal settlement for the same paused run after a
failed delivery or restart; repeated requests cannot start a replacement turn.
Mail stays durable and held. No cost estimates or optional LLM-call-count limit
are fabricated; only wall-clock limits are implemented in WP8.

## Compatible projections and verification

`team.getSnapshot` and `team.getRoster` add optional `runLimits`, combining the
policy and durable run state. Old records/consumers remain valid; no execution
token, tool privilege, frozen shell quota, or public renderer IPC is broadened.

Acceptance: E2E-TEAM-bounded-run-limit in the delivery E2E plan. Controlled-clock
Host tests cover the repeating loop, one-shot notice, hard pause, Goal interruption,
token invalidation, restart, explicit resume, fresh user scope, idle Teams, disabled
policy and clock rollback. Runtime fake-provider tests hold a foreground Bash
result while recovery is pending, then verify that safe pause performs no abort
and makes no subsequent model request. Desktop service tests assert queue holds,
no ordinary cancel, and no mailbox wake-up; settings tests assert CAS preservation.
These deterministic tests prove mechanics, not real-provider compliance or a
10-hour real-device run. Real native UI verification belongs to the integration
candidate's final acceptance.
