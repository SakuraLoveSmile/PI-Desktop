# ADR: Explicit Host-managed Team service processes

- Status: Proposed; no service mode is implemented
- Date: 2026-10-11
- Related: [managed background processes](session-activity-rail-and-managed-background-processes.md),
  [Expert Team collaboration](plus-expert-team-collaboration.md)
- Scope: WP14 proposal only; adoption requires a separate lifecycle decision

## Context

Managed background Bash currently keeps the command timeout: 60 seconds when
omitted, with an explicit bounded override. WP5 makes the applied limit and
timeout outcome visible. A daemon launched with no override is therefore still
a timed command; `timed_out` does not establish a crash or a dead lease holder.

Using `nohup` to escape this lifecycle creates processes that the Host cannot
track or clean up as part of a Team. Conversely, removing the timeout from every
background command would silently change existing behavior and let ordinary
jobs retain shell capacity indefinitely.

The current Host exclusively owns process admission, output, terminal results,
permissions and persistence. A process lifetime holds its existing shell permit.
The proposed service mode must remain in that ownership boundary; neither a
renderer process launcher nor an untracked shell daemon is an alternative.

## Decision

Do not change the current Bash defaults or add a service capability in this
proposal. First exercise WP5 and the reliability candidate, then decide whether
an explicit service declaration is needed. The ordinary background-command
contract remains authoritative until that decision and implementation.

The preferred candidate is an explicit process kind whose service lifetime is
owned by the Host and attached to an authenticated session and Team run. A
service must be declared before launch; a command cannot upgrade itself through
stdout, model text or a subsequent PID claim. Its launch must still pass the
ordinary shell, workspace and permission checks. A model cannot confer user
approval, change an execution token or adopt another process.

### Required contract before adoption

1. Define the typed launch discriminator and its permission/UI meaning. Missing
   or legacy values must remain ordinary timed background commands. Explicit
   service mode would remove the implicit 60-second deadline only for that
   launch; explicit user cancellation and Host shutdown remain authoritative.
2. Persist the service kind, owner session, Team/run identity and cleanup state
   with an upgrade path for existing background rows. Never infer service kind
   from a command name, `nohup`, absent timeout or recovered process status.
3. Specify pause, Team completion, cancellation, member removal, project switch,
   session deletion, renderer reload, Host restart and application shutdown.
   The proposed Team service is cleaned up when its owning Team pauses or ends;
   it does not survive as an orphan under a detached member session.
4. Use Host-owned child/process-group handles with bounded graceful shutdown and
   an explicitly chosen escalation policy. Preserve output and a truthful
   terminal reason. A reused numeric PID is not sufficient ownership proof.
5. Keep restart recovery no-replay: mark unresolved services interrupted, do not
   restart automatically, and do not attach arbitrary OS processes. Any later
   reattachment proposal needs independently authenticated identity and an ADR.
6. Define capacity before launch. WP12 is conditional and has no approved
   background-pool size. Do not invent an unlimited pool, alter the four-shell
   interactive limit, or silently stop counting services against existing
   admission merely to make this mode usable.
7. Present the service kind, owner and state through the existing activity UI.
   A service stopped by Team lifecycle is distinct from a command timeout or a
   crash. Preserve session-scoped read/stop authority and diagnostic redaction.

## Alternatives

- **Explicit timeout on existing background Bash:** available now, bounded and
  compatible. Prefer it when the service only needs to run during a finite test.
  It still requires the owner to observe and clean up the managed process.
- **Host-owned explicit service kind:** addresses the tracked lifetime directly,
  but changes launch and persistence contracts and requires all lifecycle cases
  above. This is the preferred proposal, not an implemented capability.
- **Remove every background timeout:** rejected because it changes defaults and
  resource lifetime for ordinary commands without explicit service intent.
- **Use `nohup` or detach outside Host ownership:** rejected because it hides
  resources from the owner and makes Team/session cleanup unverifiable.
- **Automatic crash restart or lease takeover:** not in this proposal. A timeout
  is not evidence of a crash; restart can duplicate work and revive cancelled
  executions. Such behavior would need its own authority and recovery decision.

## Consequences

Local service work continues to use explicit bounded background timeouts while
this ADR remains proposed. No new permission, process boundary, persistence
migration, quota or user-visible launch control is delivered by this document.

Adoption requires fake-provider and real isolated-process acceptance: track an
explicit service past 60 seconds, keep ordinary commands timing out at 60,
stop the exact owned service at pause/end, preserve terminal output, handle
repeated cleanup idempotently, and recover from Host restart without replay.
Test timeout and cancellation races and reused-PID protection. No real provider,
user installation or production service is a default test environment.
