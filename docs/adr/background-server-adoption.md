# ADR: Background commands that start a local server keep running

- Status: Accepted for implementation
- Date: 2026-11-22
- Related: [managed background processes](session-activity-rail-and-managed-background-processes.md),
  [Host-managed Team services](team-managed-service-processes.md); the live
  local server address added by PI-UI-1121 Batch C (D647), which this record
  builds on
- Scope: PI-BG-1122, ordinary background `Bash` commands that turn out to be
  local servers

## Context

A background `Bash` command launched without a `timeout` keeps the 60-second
default and is stopped when it elapses (`timed_out`). A model that starts a dev
server this way sees it vanish after a minute and has to start it again with a
`timeout` of up to 21 600 seconds, which costs a turn, the server's warm state
and its port. The activity rail's Servers section makes the same thing visible:
a row appears and disappears.

The Host already knows when a command has become a server: the address detector
of D647 reads the command's own output and reports the first loopback URL it
prints. A Team `service` lives for a fixed six hours, but it needs an explicit
launch declaration, current Team authority and its own caps (Host 2, Team 1,
owner session 1); an ordinary chat session has none of that.

## Decision

The Host adopts a background command that announces a local server and gives it
a server lifetime. Nothing else about the command changes.

- Eligible: a command launched in the background, without a model `timeout`
  (the Host already records this as `timeout_is_default`), that is not a Team
  service. A foreground command, a command with an explicit `timeout` of any
  value and a Team service are never adopted and behave exactly as before.
- Trigger: the first moment the D647 detector reports an address for the
  command. Adoption happens once. It moves the running deadline to now plus
  21 600 seconds (`MAX_BASH_TIMEOUT_MS`, the largest `timeout` a model may ask
  for, and the Team service lifetime). Elapsed time before adoption is not
  counted again.
- Timing: the execution loop checks right after it has processed an output chunk
  and once more when the deadline fires, so an address printed in the same turn
  as the deadline wins. An address that appears after the default deadline came
  too late: the command was already stopped, as today.
- Slots: an adopted server holds one slot. At most 2 are adopted per session and
  2 per Host. The slot is taken at adoption and returned by an RAII grant owned
  by the execution loop, so exit, stop, timeout, abort and a dropped task all
  return it, and only after the process tree is gone. With no free slot the
  command is not adopted: it keeps its deadline and ends at it. The check
  repeats on later output and at the deadline, so a slot freed in time counts.
- Capacity: the shell permit stays held for the whole run, as for every
  background command (permits are released only after the owned process tree has
  terminated). An adopted server therefore counts against the global shell
  budget and the session's in-flight limit, and the slots keep implicit
  adoption from filling them. Team services keep their own caps and are not
  counted against the slots.
- End message: a server stopped by its extended lifetime reports `timeoutMs`
  equal to that lifetime, `timeoutIsDefault: false` and an `errorMessage`
  naming the server limit. A command that printed an address but found no free
  slot keeps the default message and appends one sentence naming the cap. The
  default and explicit wordings are unchanged byte for byte, and the existing
  result fields are the only ones used.
- Audit: the terminal audit row of the process gains `serverAdoption`
  (`adopted` or `cap_reached`) when it applies.
- Model text: the `Bash` tool description gains one sentence describing the
  rule; every existing "default 60 seconds" sentence stays.
- No new approval path, tool parameter, Host RPC, field, protocol version,
  storage or UI. The Host process list, the rail and the stop control are the
  ones that already exist.

## Alternatives

- Teach the model to pass `timeout` for servers: kept as the model text above
  but not enough on its own. The failure is exactly the model not passing it.
- A new `backgroundKind: "server"` the model declares: rejected. It adds a tool
  parameter, protocol and prompt text, still depends on the model remembering
  it, and overlaps `service`, which carries Team authority this does not.
- Raise the default for every background command: rejected. A hung test or a
  watcher would then live far longer, and the 60-second default is deliberately
  unchanged by the earlier timeout-visibility work.
- Release the shell permit when a command is adopted and track servers in their
  own pool: rejected for now. It breaks the documented rule that permits are
  released only after the process tree has terminated and rewrites the tool
  budget. The slot caps bound the pressure without touching it.
- Detect servers by command text or port flags: rejected. The command may not
  bind that port; only the process's own output says what it serves.
- Make the lifetime or the slot counts settings: rejected. Constants are enough
  until usage shows otherwise, and a setting adds persistence and UI.

## Consequences

- A dev server started without `timeout` stays up, and its Servers row stays
  with it until it exits, the user stops it, the session or workspace goes away,
  the Host shuts down or the six hours pass.
- The approval prompt shows the command and its arguments, not a lifetime.
  Adoption never changes what runs; it only lets a command that has shown itself
  to be a local server run for as long as the model could already have asked
  for, bounded by six hours and two slots, visible in the rail and stoppable
  there. No approval is added because none was ever tied to the timeout.
- A command that prints a loopback URL and then hangs, for example a test run
  that logs the address it queries, now lives up to six hours instead of one
  minute unless it exits or is stopped. This is the same false-positive profile
  as the Servers row (only the URL form, only the first URL) and is visible
  there.
- A server that prints its address after 60 seconds, such as a framework with a
  long first build, is still stopped at the default and needs an explicit
  `timeout`, as today.
- Two adopted servers plus two Team services can hold all four shell permits.
  New shell calls then wait and fail with `HOST_OVERLOADED` after the queue wait,
  which names the holders, until one ends. A session with two adopted servers
  has two of its four in-flight slots left.
- Nothing is persisted. A Host restart already marks unfinished rows interrupted
  and never reattaches a process, so there is no migration and no recovery path.
- Tests: the slot ledger and its grant are unit-tested (caps, release on every
  exit path); real shells cover adoption, no address, explicit `timeout`, no
  free slot, a late address and the stop path against the Host job API with a
  short default; the background limit E2E script adds a server that outlives the
  60-second default beside the existing default and explicit cases.
