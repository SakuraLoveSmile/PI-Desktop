# ADR: Ordered subagent model fallback

- Status: Accepted for implementation
- Date: 2026-09-14
- Related: ADR 0062, ADR 0063, ADR 0202, ADR subagent-model-opt-in

## Context

A subagent can select only one model. Its existing bounded provider retries
cannot recover when that model remains unavailable. Restarting the delegated
task on another agent could repeat tools that already changed files.

## Decision

Add optional `fallbackModels` to a definition, the user-subagent record/input,
and the existing internal launch definition. It is an ordered list of
`provider/model` strings in managed Markdown and host RPC, parsed into model
pins in Shared. The existing primary `model` and Task override priority stay
unchanged. Missing lists preserve single-model behavior. An omitted update
preserves the list; `[]` clears it. No database or protocol version changes are
needed for these additive fields; old documents remain valid.

Electron resolves alternatives through the same credential, provider-count,
and model-capability boundaries as primary pins. These bindings are scoped to
their owning definition, even when Task explicitly overrides its primary.
They do not grant `Task.model` access to another definition, or enter the
opted-in model summary. A primary pin that cannot resolve still fails before
launch; an unresolved alternative is reported when reached and skipped.

After the current model's existing retries are exhausted (or a provider error
is non-retryable), the runtime tries the next configured alternative. Each
resolved provider-id/model-id pair is tried at most once per delegation,
excluding the existing retry budget within each model. The same Agent keeps
its system prompt, original task, successful assistant/tool history, tool
scope, counters, and usage. Only the failed assistant request is removed from
model context before `continue()`. It is retained in the visible transcript.
No task or completed tool is replayed by the fallback controller.

The model, adapter, credentials, headers, output cap, and thinking level change
together. Thinking is re-clamped from the definition or original parent
selection for each model; `omit` remains omission. The original abort signal
owns the whole chain. Host/tool failures, missing reports, unexpected thrown
errors, and cancellation do not initiate fallback.

Failed attempts remain visible in child transcript diagnostics and in the
bounded parent report. Lifecycle snapshots retain the final effective model,
thinking, and additive `modelFailures` diagnostics. Exhausting the chain
returns `failed` with the final provider error; it never selects an unlisted
model or silently inherits the parent as recovery.

## Validation

Shared parser and provider-resolution tests, host registry round trips,
real local HTTP tests for continuation/credentials/cancellation, and the
sidecar model suite cover the contract. Required integration suites are
`test:e2e`, `test:e2e:subagents`, and `test:e2e:subagent-models`.
The editor journey separately covers adding, reordering, removing, and
retaining unavailable pins across save/reopen.


### Local verification and remaining integration gates

- Runtime: 200 focused tests passed, including the existing parent-runtime
  suite; Shared: 35 definition tests; Desktop: 100 subagent tests; i18n: 24
  tests; host-core: 13 subagent tests. Typecheck, lint, Rust formatting and
  clippy passed.
- `test:e2e:subagent-models`: passed on the request branch with a real sidecar
  and local HTTP transport, including ordered fallback and live/settled model
  metadata. This is pre-integration evidence.
- `test:e2e`: 19 passed, two project-deletion assertions failed, and two live
  provider scenarios were skipped for missing credentials. An independently
  built, unchanged `a9053531` host reproduced the same two failures.
- E2E: **NOT RUN** to completion for `test:e2e:subagents` on Windows. Rust's
  known-folder lookup ignores the fixture HOME, so the suite now fails before
  registry writes. Alternative validation is the host record/document tests
  and Shared/launch-loader tests. The remaining risk is the complete managed
  registry RPC/save/reopen journey; run this suite under Linux/macOS isolation.
- Full editor interaction/reload and post-integration `main` E2E remain
  outstanding. This request retains its branch and worktree for integration.
