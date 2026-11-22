# ADR: Local server address from live background process output

- Status: Accepted for implementation
- Date: 2026-11-22
- Related: [managed background processes](session-activity-rail-and-managed-background-processes.md),
  [Host-managed Team services](team-managed-service-processes.md)
- Scope: PI-UI-1121 Batch C, the activity rail's Servers section

## Context

The approved rail design lists a server a session started in the background as
one row: its name, the address it serves and a stop control. A background
process summary has no address. Team `service` processes are rare and may serve
nothing; a plain dev server is an ordinary `command`, which keeps the 60-second
default unless the model passes a longer explicit `timeout` (up to 6 hours).
The only place an address exists is the process's own output, which is untrusted
text: a script can print any URL, including one carrying a token.

## Decision

The Host detects the address while the process runs and reports it as one
optional field of the existing summary; nothing else about processes changes.

- A pure detector in Host core reads each output chunk of both streams. It
  strips ANSI escape sequences first (a dev server may bold the port inside the
  URL), joins a bounded tail of the previous chunk so a URL split across reads is
  still found, and keeps the first match only.
- The grammar is deliberately narrow: `http` or `https`, a loopback host
  (`localhost`, any `127.x.y.z`, `[::1]`), and an explicit port from 1 to 65535.
  `0.0.0.0` and `[::]` are bind-all spellings and read as `localhost`. A URL with
  user information is rejected, and a longer string that merely contains a
  loopback name (`localhost.evil.test`) does not match.
- The stored value is only `scheme://host:port`. Path, query and fragment are
  dropped, so a token printed in a URL never reaches the rail or the browser.
- The address lives in the in-memory output owner of the active job. It is not
  persisted, needs no migration and does not survive a Host restart, which
  already marks unfinished rows interrupted without adopting a process. The
  first detection emits one immediate `backgroundProcesses.changed`.
- `backgroundProcesses.list` adds `address` to a row only while it is `running`
  or `stopping` and its output owner is live. Terminal rows, `read`, `stop`,
  duplicate answers and the Team wait read never carry it.
- `BackgroundProcessSummary.address` is optional in the Rust and shared
  contracts. An older Host sends none and the rail simply has no Servers
  section; an older renderer ignores the field. The renderer validates the value
  again against the same grammar and treats anything else as absent.
- A process is a server in the rail when it is active and has a valid address,
  whatever its `backgroundKind`. It is listed under Servers instead of Live. A
  Team service with no address stays under Live, and a server that ends moves to
  Live's ended group with its normal status.
- The address opens in the work panel's browser tab, the path the Sources rows
  already use with its existing permissions. Stop calls the existing
  `backgroundProcesses.stop`, once per process at a time. No RPC, permission,
  limit, timeout or lifetime changes.

## Alternatives

- Persist the address with a migration: rejected. It means nothing once the
  process is gone, and recovery never reattaches a process.
- Scan `backgroundProcesses.read` output in the renderer: rejected. It moves
  parsing of untrusted text across the process boundary, reads up to 128 KiB per
  row on every change, and loses an early stderr line to tail truncation.
- Take the port from the command line, as the row title does: rejected for the
  address. The command may not bind it, or may choose another port.
- Classify by `backgroundKind:"service"`: rejected. A dev server is a `command`,
  and a Team service may have no URL.
- Accept private-network hosts, paths or non-URL announcements ("listening on
  port 3000"): rejected for now. Each widens what output text can make the
  application display or open.

## Consequences

A server shows in the rail only if it prints its address as a URL, only the
first one, and only while it runs; one that announces a bare port is not found.
A token URL (for example Jupyter's) opens without its token. Because ordinary
background commands keep the 60-second default, a long-lived server stays listed
only when started with an explicit longer timeout or as a Team service; this
decision changes neither. A wrong match (a process that prints a loopback URL it
only connects to) lists that process as a server, where Stop works as for any
process.

Acceptance requires detector grammar tests (ANSI inside the URL, a split read,
userinfo, look-alike hosts, bind-all spellings, port bounds, first match wins),
a real shell test of list, event and stop, renderer validation tests, and a
real-Chromium probe of the section's placement, address, stop and stale-answer
handling.
