# ADR 0203: Local MCP Control Plane for Desktop Operations

- Status: Accepted
- Date: 2026-09-09
- Decision: D370 (amended by D372)

## Context

PI-Desktop already has typed Electron-main IPC for projects, sessions, the pi
Agent, workspace views, plugins, settings, and other desktop operations. That
surface is available to the renderer only, so an external Agent cannot drive a
running desktop without a second application-specific integration. The remote
Gateway / WebUI control boundary remains out of scope under baseline decision
#20 and ADR 0004.

## Decision

- Add an optional Streamable HTTP MCP server inside Electron Main. It starts
  only when `PI_DESKTOP_MCP_CONTROL=1` is set and binds to `127.0.0.1`; an
  optional `PI_DESKTOP_MCP_PORT` selects the local port and defaults to 37123.
- Validate any supplied `Origin` against loopback hostnames to prevent DNS
  rebinding from remote web content. Non-browser MCP clients may omit `Origin`.
- Persist a random 256-bit bearer token in the Electron user-data directory and
  publish the current URL, token, PID, and active state in
  `mcp-control.json`. Write the token and manifest with mode `0600` where the
  platform supports POSIX permissions.
- Delegate every exposed call to the existing registered main-process IPC
  handler. Provide named tools for the common project/session/Agent/workspace
  flow and a generic `pi_desktop_invoke` over an explicit, risk-tagged catalog.
  `pi_control_describe` is the discovery surface for that catalog.
- Require `confirm: true` for dangerous generic operations and destructive
  named tools, including `session/configure` (permission mode). `confirm` is an
  agent acknowledgement, not a desktop user prompt. Exclude secret
  get/set/delete channels, provider/OAuth/MCP secret-write paths, settings
  writes, and renderer-only native picker/dialog channels (including
  `plugin/loadDev`). Strip secret-shaped fields from accepted arguments. A new
  IPC handler is not exposed automatically.
- Bind only loopback addresses; `initialize` negotiates `2025-06-18` or the
  compatible `2025-03-26` value and never echoes an unsupported version. Bound
  both the text payload and `structuredContent`. Stop the server with
  `closeAllConnections` before host shutdown and mark the connection manifest
  inactive.
- After successful **mutating** project/session/Agent calls, reuse the existing
  `pi-desktop/session/event/changed` renderer event with additive project and
  selection fields. Reads such as `session/get` do not refresh the visible
  desktop.

## Consequences

An external local Agent can open a project, create or inspect sessions, send a
prompt, observe status, and invoke reviewed desktop operations through a
standard MCP client. The renderer and external Agent converge through the same
IPC handlers and session refresh path, so there is no duplicated authorization
or persistence logic.

The endpoint grants a local client the authority of the running desktop for the
operations it invokes. Loopback binding, opt-in startup, bearer authentication,
bounded requests/results, explicit operation review, and confirmation gates
limit accidental exposure but do not protect against an untrusted process that
can read the user's application-data directory or token. Remote clients,
secret material, native pickers, and remote Gateway semantics remain excluded.

## Amendment (D372)

Narrow the first-version catalog to the project/session/Agent/workspace flow
plus reviewed reads. `session/configure` is dangerous because it can set
`permissionMode: "auto"`. Secret material is stripped from arguments even when
a remaining operation accepts a generic object. The listen address is asserted
to be loopback after bind. Renderer session refresh is mutation-only.

## Verification

`apps/desktop/test/mcp-control.test.mjs` and
`apps/desktop/test/mcp-control-wiring.test.mjs` cover token authentication,
protocol negotiation, tool discovery, project/session dispatch,
dangerous-operation confirmation (including session configure), secret
stripping, catalog exclusions, loopback bind refusal, mutation-only renderer
refresh, and inactive shutdown manifests. E2E-220 records the full Electron
journey; full local desktop E2E remains deferred by repository policy.

## Durable turn observation amendment (2026-09-26)

External schedulers cannot infer successful completion from an idle runtime: an
error, cancellation, or restart also makes the agent idle. Expose the existing
host-owned durable turn state through the additive, read-only `pi_turn_get`
(`turn/get`, host `session.getTurn`) rather than adding a second event service
or granting database access. Match both session and turn identifiers, return
NOT_FOUND for absent or cross-session rows, and keep remote hosts excluded.
The bearer boundary, default-off startup, and persistence schema are unchanged.
The IPC/host protocol specs define the response; targeted host and MCP tests
cover state, identity, and authentication. This does not itself prove an
external scheduler has collected the complete transcript.

## Local on/off preference amendment (2026-09-30)

The control plane no longer needs a launch environment variable to be useful.
The effective value of a launch is the explicit `PI_DESKTOP_MCP_CONTROL` (`0`
or `1`), then the machine-local preference
`<user-data>/mcp-control-settings.json`, then `false`. Only `0` and `1` count as
explicit; any other value is treated as unset.

The preference is a per-machine runtime choice, written through a `0600`
temporary file plus a rename and shaped `{"enabled": boolean}`. It is
deliberately neither synced configuration nor host-core SQLite state — the same
standing as the npm-path preference — and it holds no credential material. The
bearer token and the connection manifest keep their own `0600` files.

`mcpControlGet` and `mcpControlSet({enabled})` expose that state to the
settings surface over the existing preload invoke bridge and the shared
whitelist. They return `{enabled, running, source, connectionFile, error}` and
never the token or the manifest, they drive the same single `McpControlServer`
the environment drives (serialized start/stop, preference saved only after the
listener is confirmed). Environment overrides never rewrite the saved
preference; removing the override restores that preference. These channels
stay outside the reviewed MCP operation catalog so an external client cannot switch off the plane that serves it.
Enabling or disabling never stops, aborts, or cancels an Agent turn, and the
loopback bind, authentication, discovery, and shutdown behavior of the server
are unchanged.

`apps/desktop/test/mcp-control-settings.test.mjs` covers the default-off
preference, immediate discovery on enable, `active: false` on disable,
idempotent repeated and concurrent clicks, environment precedence, a busy port,
a failed preference write, restart persistence, and token-free status and logs;
`apps/desktop/test/mcp-control-wiring.test.mjs` covers the single shared
lifecycle, the renderer-only channel pair, and its absence from the external
catalog.
