# ADR: Explicit Host-managed Team service processes

- Status: Accepted decision; candidate implementation and acceptance are tracked separately
- Date: 2026-10-11
- Related: [managed background processes](session-activity-rail-and-managed-background-processes.md),
  [Expert Team collaboration](plus-expert-team-collaboration.md)
- Scope: WP14 explicit services; WP12 remains conditional

## Context

Managed background Bash remains a timed command with a 60-second default. A
long-lived local service needs an explicit tracked lifetime; `nohup` loses Host
ownership, while removing every timeout would change ordinary commands and hold
shell capacity indefinitely. Host already owns permissions, native process trees,
output, terminal persistence and the permit held throughout process lifetime.

## Decision

Add an explicit `backgroundKind:"service"` Bash declaration, requiring background
launch and forbidding command timeout overrides. Missing kind remains `command`.
The service belongs to the authenticated owner session and confirmed current
Agent Team/run, with a fixed 6-hour TTL. Research and stale/unapproved scopes
cannot launch it. Existing mode, shell, workspace and permission checks apply,
including revalidation after asynchronous admission.

Choose Host 2, Team 1 and session 1 service caps while retaining all original
global/session/shell permits. No new background pool or FIFO is introduced.
Any Team pause stops explicit services, including hard-limit pause; ordinary
background commands retain their existing behavior. Foreground admitted batches
still finish safely.

Stop the exact owned process tree on explicit stop, owner cancellation/removal,
workspace change/deletion, run/Team/Goal end, TTL or Host shutdown. Ordinary Team
end is defined from actual participant work, not a member's completed phase or
the service itself. Unix sends TERM and allows at most 5 seconds before KILL/reap.
Windows uses the existing JobObject force path and reports this limitation.
Renderer reload or viewing another session is not owner deletion.

Plus P7 adds an ownership table rather than inferring service intent from old
background rows. Metadata carries kind, Team/run, deadline, stop reason and actual
platform/escalation. Recovery marks unfinished services interrupted and never
restarts, reattaches or adopts a numeric PID. Output and terminal failures remain
observable; permits release only after owned-tree exit. See the normative
[service contract](../spec/03-runtime/team-managed-services.md).

## Alternatives and threats

- Explicit bounded timeout on an ordinary command remains compatible for finite
  tests. It does not express Team-owned service lifetime.
- Removing all background timeouts is rejected: it changes defaults implicitly.
- Detaching through `nohup` or later PID claims is rejected: it defeats ownership,
  cleanup and reused-PID protection.
- Crash restart/lease takeover is excluded. A timeout is not proof of a crash;
  restart can duplicate work or revive cancelled execution.
- Report prose cannot grant service authority, change a Goal token or increase
  quotas. Scope/turn/route/pause checks must survive every admission wait.
- Persist stop intent before losing owner identity; repeated lifecycle requests
  must be safe under cancellation, deletion, storage refusal and shutdown races.
  EOF/crash force cleanup must never be reported as graceful termination.

## Consequences and acceptance

An explicit service can remain alive beyond the command default while remaining
visible and manageable through Activity. It still consumes scarce shell capacity
and ends with its owning Team/run or TTL, rather than becoming an OS daemon.
The service declaration changes additive launch/persistence contracts without
moving process ownership or weakening permissions.

Acceptance requires real isolated processes, command-default preservation,
caps, pause/end/deletion/TTL races, output failures, exact-tree cleanup and restart
without replay. The decision is adopted; implementation, focused checks, native
candidate presentation and Windows acceptance are separate evidence. This ADR
alone does not establish any of those checks passed or user acceptance.
