# ADR 0091: Route mid-stream rate limits through the bounded retry

- Status: Accepted
- Date: 2026-08-14
- Deciders: PI-Desktop core
- Related: D233, E2E-149, ADR 0050, D186

## Context

ADR 0050 excluded rate-limit errors from the same-turn stream replay path:
`PROVIDER_RATE_LIMITED` was classified as retriable for the UI's manual
"continue" affordance, but the runtime did not automatically retry it. A
mid-stream HTTP 429 (the stream starts, then the provider terminates it with a
rate-limit status) therefore surfaced directly as a terminal assistant error,
even though the condition is transient and the same-turn path already existed
for `STREAM_FAILED`, `NETWORK_ERROR`, and `TIMEOUT`.

Request-setup 429s are already covered: pi-ai retries them once with an
interruptible backoff that honors `Retry-After` up to the 8-second cap. The gap
was exclusively post-stream, where pi-ai's request wrapper can no longer act.

## Decision

1. `PROVIDER_RATE_LIMITED` joins `STREAM_FAILED`, `NETWORK_ERROR`, and
   `TIMEOUT` in the runtime's same-turn bounded replay path (§5d). A mid-stream
   429 waits 750 ms, the failed assistant is removed from model context, and
   `continue()` is called once with the same visible assistant bubble.
2. The retry budget is unchanged: one same-turn retry per prompt. A second
   429 remains terminal and emits the normal assistant error plus lifecycle
   `error` event with `retryAttempt: 1` and `providerStatus: 429` in the
   details, so the transcript keeps its manual retry action.
3. Authentication, model-selection, malformed-request, and context errors
   still do not enter this path; replaying the request cannot fix them.

## Consequences

- A single mid-stream 429 no longer forces the user into a manual retry or
  regenerate; the turn recovers in place with one bubble and one lifecycle.
- The retry budget stays finite: persistent rate limiting remains visible and
  actionable instead of entering an unbounded loop that consumes quota.
- Diagnostics are unchanged in shape; a retried 429 records
  `errorCode=PROVIDER_RATE_LIMITED` and `retryAttempt=1` in the timing log.

## Alternatives

- Retry rate limits more than once with a longer backoff. Rejected: it
  deviates from the existing bounded mechanism, hides persistent outages
  longer, and the request-setup layer already honors `Retry-After` for
  pre-stream 429s.
- Keep excluding rate limits and rely on the UI's manual retry. Rejected:
  a transient 429 is indistinguishable from a persistent outage to the user
  at the moment it lands, and the same-turn path exists precisely for
  transient post-stream failures.

## References

- `docs/spec/03-runtime/02-agent-runtime.md` §5d
- `docs/spec/03-runtime/08-error-codes.md`
- `docs/spec/06-delivery/04-e2e-test-plan.md` E2E-149
- `packages/agent-runtime/src/runtime.ts`
- Decision D233, ADR 0050, D186
