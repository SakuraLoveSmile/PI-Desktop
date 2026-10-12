# Explicit Host-managed Team services (WP14)

## Launch and authority

Bash adds optional `backgroundKind:"command"|"service"`. Missing/legacy values
remain `command`: default 60 seconds and bounded `timeout` overrides are unchanged.
A service requires `run_in_background:true` and rejects any `timeout`/`timeoutMs`;
its fixed Host-owned TTL is 21,600,000 ms (6 hours). It cannot promote an existing
command or adopt a PID based on prose, stdout or later claims.

The owner must be an authenticated current Agent Team Lead or approved member in
an exact running Agent turn and confirmed current Team/run. Research members,
paused/hard-paused Teams, replaced members, stale routes and excessive permission
scope fail closed. Ordinary Bash/workspace/shell permission and mode gates apply.
After approval/admission waits the Host revalidates the captured scope under the
same lock as process insertion.

Active `starting`, `running` and `stopping` services count against Host 2, Team 1
and owner session 1 caps, and retain the existing global 16/session 4/shell 4
permit for their entire lifetime. This is not a WP12 background pool, shell-limit
increase, FIFO change or new approval bypass.

## Owned lifetime and stopping

The Host owns the live child/process-group handle and captured Team run; numeric
PIDs are display data, never sufficient stop/adoption authority. Any Team pause,
including automatic hard-limit pause, requests stop of explicit services. Ordinary
background commands retain WP8 behavior, and already-admitted foreground batches
still finish safely. Viewing another chat/project or reloading renderer does not
stop a service.

Services stop on explicit owner stop, owner cancellation/removal, changed owning
workspace, owner session deletion, Team/run replacement/end, captured Goal
execution terminal state, TTL expiry and Host shutdown. For an ordinary Team,
end means no running participant turn, owned queued work, unsettled mail or open
shared task; a service itself does not keep the Team alive. A completed member
phase alone is not Team completion. Goal end uses the captured execution identity.

Unix stop sends TERM to the owned process group, waits at most 5 seconds, then
KILLs/reaps survivors. Windows uses the existing JobObject force mechanism and
reports it truthfully. Normal application shutdown gives the Host up to 8 seconds
to complete TERM escalation and reaping before its transport forces termination.
A runner losing its Host control pipe during a crash uses the safety force path,
not a promise of graceful exit. Release permits only after actual owned tree termination.
Repeated cleanup is idempotent, preserves output and retains observable failures.
Deletion must not erase still-live owner evidence merely to make cleanup pass.

The first persisted stop intent/reason is retained. Reasons are `explicit_stop`,
`team_paused`, `run_replaced`, `member_removed`, `owner_workspace_changed`,
`session_deleted`, `team_ended`, `goal_ended`, `ttl_expired`, `host_shutdown`,
`host_restart` and `owner_cancelled`. They distinguish lifecycle stop from a timed
ordinary command or unexpected crash; no automatic restart is performed.

## Persistence, metadata and UI

Plus P7 adds `background_service_ownership` keyed by the existing background
process ID. It captures Team/run, launch turn, deadline, optional Goal execution,
the owner's persisted project-path snapshot, stop intent and actual escalation
outcome. A legitimate command cwd in another registered project root is not an
owner-project change. Existing rows remain ordinary commands;
restart marks unresolved ownership interrupted without looking up/adopting a PID
or launching a replacement. Upstream schema/protocol versions remain unchanged.

List/read/launch projections add optional `backgroundKind:"service"`,
`teamSessionId`, `teamRunId`, `deadlineAt` (RFC3339), `stopReason`,
`stopRequestedAt` (RFC3339), `stopMode:"unix-term-then-kill"|"windows-job-force"`
and terminal `serviceStopEscalated:boolean`. Existing process owner-session
read/stop checks and output/result semantics remain authoritative.

The existing Activity process panel labels service kind, owner, deadline and stop
reason using localized text. It retains the current layout, grouped statuses,
output reading and stop controls. A lifecycle stop is not rendered as a fabricated
command timeout, successful exit or graceful Windows termination.

## Acceptance

`E2E-TEAM-managed-service-lifecycle` uses isolated production Host/runtime and real local
child/grandchild processes. Keep a service alive past 60 seconds; verify an ordinary
command still times out around 60 seconds. Verify caps with existing permits,
manual/hard pause, owner cancel/end/delete/workspace change, Goal end, TTL under a
controlled domain clock, TERM escalation/tree exit, output-storage refusal,
repeated cleanup and restart with zero replay. Record platform results separately:
Unix validation cannot establish Windows JobObject/tree behavior. Component tests
and native candidate captures cover service metadata and localized rendering;
no user profile, production service or paid provider is the default fixture.

New service launches persist `stopMode` in the existing KV namespace
`background-service-stop-mode-v1`, in the same transaction as the process and
ownership rows. Historical rows without that record keep `stopMode` absent;
reopen never infers their stop mechanism from the current operating system.
