# 08. Error Codes

> Source of truth: `packages/shared/src/errors.ts` (`ErrorCodes`). Codes in
> §3.6 are reserved (documented ahead of emission); everything else is live.

## 1. Goal

Provide one stable error vocabulary across:

- Renderer UI
- Electron IPC
- Rust host RPC
- Node pi sidecar bridge

## 2. Error object

```ts
type AppError = {
  code: string            // stable machine code, e.g. TOOL_DENIED
  message: string         // English UI/default message
  details?: unknown
  retriable?: boolean
  source?: "renderer" | "electron" | "host" | "agent" | "plugin"
  causeCode?: string      // nested/transport code if mapped
  traceId?: string
}
```

Rules:

1. `code` is immutable once published
2. `message` is English source text (i18n key may map separately)
3. UI should prefer i18n key derived from `code` when available

## 3. Code registry

### 3.1 App / protocol

| code | retriable | meaning |
|---|---|---|
| `PROTOCOL_MISMATCH` | no | handshake/protocol version mismatch |
| `HOST_UNAVAILABLE` | yes | Rust host not running/reachable |
| `HOST_OVERLOADED` | yes | bounded host RPC/tool capacity is full; retry after backpressure |
| `AGENT_UNAVAILABLE` | yes | pi sidecar not running/reachable |
| `APP_DEGRADED` | yes | app running with limited capabilities |
| `INTERNAL` | maybe | unexpected internal failure |
| `INVALID_ARGUMENT` | no | request schema/args invalid |
| `UNAUTHORIZED` | no | capability/auth boundary rejected call |
| `NOT_FOUND` | no | entity not found |
| `CONFLICT` | maybe | state conflict / busy resource |
| `TIMEOUT` | yes | generic timeout |

`HOST_UNAVAILABLE` is reserved for a missing or broken host process/transport,
not ordinary admission pressure. RPC capacity returns `HOST_OVERLOADED`, and
an admitted shell that cannot start because the OS is temporarily out of
process resources returns `PROCESS_RESOURCE_EXHAUSTED`. Host-core's control
stdio is isolated from Tokio's dynamic blocking pool so the latter condition
does not turn temporary thread pressure into a host process exit.

### 3.2 Agent / session

| code | retriable | meaning |
|---|---|---|
| `AGENT_BUSY` | no | session already has active turn |
| `AGENT_NOT_FOUND` | no | session missing |
| `TURN_NOT_FOUND` | no | turn id invalid |
| `TURN_ABORTED` | no | turn aborted by user/system |
| `MODEL_NOT_CONFIGURED` | no | no usable model selected, or provider rejects the selected model as unknown |
| `PROVIDER_ERROR` | yes | upstream provider failure |
| `PROVIDER_UNAUTHORIZED` | no | bad/missing provider credentials |
| `PROVIDER_RATE_LIMITED` | yes | provider rate limited |
| `CONTEXT_TOO_LARGE` | no | prompt/context still exceeds the safe model budget after recovery, the second provider overflow occurred, or automatic recovery is disabled |
| `CONTEXT_COMPACTION_FAILED` | no | automatic retained-tail recovery could not prepare, persist, or fit a checkpoint, or manual checkpoint summary generation / durable append failed; the guarded next provider request does not start |
| `STREAM_FAILED` | yes | provider stream was terminated, closed prematurely, or otherwise ended before a complete response; one same-turn retry may precede the terminal event |
| `EMPTY_MODEL_RESPONSE` | yes | the model ended its turn with no tool call and no visible text twice: once as streamed, once after the automatic re-run (spec 02-agent-runtime §5e) |

### 3.3 Workspace / tools / permissions

| code | retriable | meaning |
|---|---|---|
| `WORKSPACE_REQUIRED` | no | no workspace bound |
| `PATH_OUTSIDE_WORKSPACE` | no | path escapes sandbox |
| `TOOL_NOT_FOUND` | no | unknown tool |
| `TOOL_DENIED` | no | permission denied / mode forbidden |
| `TOOL_TIMEOUT` | yes | tool execution timeout |
| `TOOL_FAILED` | maybe | tool executed but failed |
| `PROCESS_RESOURCE_EXHAUSTED` | yes | shell process could not start because the OS temporarily exhausted process resources |
| `SHELL_NOT_FOUND` | no | no effective platform shell is available after catalog fallback; message carries guidance |
| `COMMAND_SHELL_CHANGED` | no | pinned shell ID or dialect changed before execution |
| `COMMAND_SHELL_INVALID` | no | settings supplied an unknown, unavailable, or wrong-platform shell ID |
| `PERMISSION_TIMEOUT` | no | permission prompt timed out (mapped to deny) |
| `PERMISSION_REQUIRED` | no | waiting for user decision |
| `WRITE_DISABLED_IN_PLAN` | no | Plan hard-deny for Write |
| `EDIT_DISABLED_IN_PLAN` | no | Plan hard-deny for Edit |
| `PLUGIN_DISABLED_IN_PLAN` | no | Plan hard-deny for every plugin tool |
| `PLAN_APPROVAL_REQUIRED` | no | SubmitPlan is waiting for a separate plan approval |
| `PLAN_APPROVAL_TIMEOUT` | no | absolute 30-minute plan approval deadline expired |
| `PLAN_APPROVAL_STALE` | no | response does not match the live proposal/session/turn/tool-call/version |
| `PLAN_APPROVAL_INTERRUPTED` | no | pending approval closed during abort, crash, or persistence failure |
| `PLAN_ARTIFACT_WRITE_FAILED` | no | host could not write exact bytes to a new `.pi/plan/*.md` artifact |
| `PLAN_EXECUTION_INTERRUPTED` | no | approved queued/running Plan execution stopped without replay |
| `PLAN_REQUIRES_INTERACTIVE_SESSION` | no | unattended/scheduled Plan run cannot request approval |

### 3.4 Secrets / settings

| code | retriable | meaning |
|---|---|---|
| `PROVIDER_SECRET_MISSING` | no | enabled provider requires an API key |
| `SECRET_STORE_UNAVAILABLE` | maybe | OS secure storage unavailable (reserved) |
| `SETTINGS_INVALID` | no | settings payload invalid (reserved) |

### 3.5 Plugins

| code | retriable | meaning |
|---|---|---|
| `PLUGIN_NOT_FOUND` | no | plugin id missing (reserved) |
| `PLUGIN_INVALID` | no | manifest/package invalid |
| `PLUGIN_LOAD_FAILED` | maybe | enable/load failed |
| `PLUGIN_DISABLED` | no | plugin disabled (reserved) |
| `PLUGIN_PERMISSION_DENIED` | no | plugin lacks declared/granted permission (reserved) |
| `PLUGIN_COMMAND_NOT_FOUND` | no | command id missing (reserved) |
| `PLUGIN_CRASHED` | yes | plugin runtime crashed (reserved) |
| `PLUGIN_CONTRACT_MISMATCH` | no | unsupported manifest/api version (reserved) |

### 3.6 Reserved detail codes (not yet emitted)

Finer-grained provider/tool distinctions documented for future mapping.
Until emitted, implementations use the canonical parent code shown.

| reserved code | canonical parent today | notes |
|---|---|---|
| `PROVIDER_BASE_URL_INVALID` | `PROVIDER_ERROR` | endpoint invalid (400) |
| `PROVIDER_PROTOCOL_MISMATCH` | `PROVIDER_ERROR` | wrong protocol profile |
| `PROVIDER_MODEL_NOT_FOUND` | `MODEL_NOT_CONFIGURED` | unknown model id (404) |
| `PROVIDER_TIMEOUT` | `TIMEOUT` | network/server timeout (retriable) |
| `PROVIDER_UNSUPPORTED_CAPABILITY` | `PROVIDER_ERROR` | tools/vision unsupported |
| `PROVIDER_DISABLED` | `MODEL_NOT_CONFIGURED` | provider disabled |
| `WORKSPACE_PATH_DENIED` | `PATH_OUTSIDE_WORKSPACE` | ignore/denylist block |
| `TOOL_BINARY_CONTENT` | `TOOL_FAILED` | refused binary dump |

Historical aliases (never use in new code): `PROVIDER_AUTH_FAILED` →
`PROVIDER_UNAUTHORIZED`; `PROVIDER_STREAM_INTERRUPTED` → `STREAM_FAILED`;
`WORKSPACE_OUTSIDE_ROOT` → `PATH_OUTSIDE_WORKSPACE`; `SECRET_MISSING` →
`PROVIDER_SECRET_MISSING`; `SHELL_UNAVAILABLE` → `SHELL_NOT_FOUND`;
`SHELL_IDENTITY_STALE` → `COMMAND_SHELL_CHANGED`; `PLAN_APPROVAL_EXPIRED` →
`PLAN_APPROVAL_TIMEOUT`. Truncation is not an error: a bounded tool result
carries a marker naming which end survived and where the rest is, or reports
the bounded window in sibling result fields
(see [16-tool-result-limits](16-tool-result-limits.md)).

## 4. Mapping rules

### Host RPC numeric → AppError.code
See `06-host-rpc-protocol.md` numeric table.  
Example: host `1004` → `TOOL_DENIED`.

### Provider exceptions
Node sidecar maps provider SDK errors into:

- `PROVIDER_UNAUTHORIZED`
- `PROVIDER_RATE_LIMITED`
- `MODEL_NOT_CONFIGURED` (provider rejects the selected model with 404)
- `PROVIDER_ERROR`
- `NETWORK_ERROR`
- `STREAM_FAILED`

An exact `terminated` provider message and equivalent premature stream-close
messages map to `STREAM_FAILED`. A post-response transient failure may be
retried once by the runtime; the second failure remains terminal.

### Permission timeout
UI/host timeout emits `PERMISSION_TIMEOUT` internally, tool result presented as denied (`TOOL_DENIED`) to agent.

### Shell and Plan checkpoint failures

`SHELL_NOT_FOUND` is returned only when catalog fallback finds no available
platform shell. `COMMAND_SHELL_CHANGED` never retries with a different shell;
the turn must obtain a fresh effective ID/dialect. `PLAN_ARTIFACT_WRITE_FAILED`
never creates an approval row. `PLAN_APPROVAL_TIMEOUT` applies only to the
absolute pending deadline;
`PLAN_EXECUTION_INTERRUPTED` identifies an already-approved queued/running
execution interrupted by abort or host recovery.

## 5. UI handling guidelines

| class | UI behavior |
|---|---|
| auth/config (`PROVIDER_SECRET_MISSING`, `MODEL_NOT_CONFIGURED`) | assistant error message with settings CTA |
| permission denials | inline tool card state |
| retriable provider/network | assistant error message with retry action |
| internal/host unavailable | degraded banner + recovery tip |

Message-bound provider failures never use a toast or floating global banner.
The assistant error message shows a localized summary and stable code, with an
accessible details disclosure containing the redacted provider response,
provider ID, and model ID. Provider detail is capped at 600 characters and
common credential/header values are redacted before event emission or
persistence. When available, the details disclosure and timing logs may also
show bounded `phase`, `providerStatus`, `providerCode`, `providerWaitMs`,
`streamMs`, and `retryAttempt` fields.

## 6. i18n key convention

```text
errors.<code>
errors.<code>.action
```

Examples:

- `errors.PROVIDER_SECRET_MISSING`
- `errors.PROVIDER_SECRET_MISSING.action`
- `errors.HOST_UNAVAILABLE`

## 7. Acceptance

1. Every IPC failure returns `AppError.code`
2. No raw untyped string-only failures on main paths
3. Plan hard-denies use explicit tool-specific codes; Bash is never denied by
   Plan solely because of the operating mode and instead follows permission
   policy
4. Host numeric codes map to stable string codes
5. Invalid shell settings, no-effective-shell/stale-pin, artifact-write,
   expiry, scheduled-rejection, and restart-interruption paths map to stable
   codes; only the documented pre-turn catalog fallback is allowed and no work
   is replayed
