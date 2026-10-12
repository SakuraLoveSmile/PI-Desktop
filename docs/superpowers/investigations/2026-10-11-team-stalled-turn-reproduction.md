# WP3b: Team member silent-turn investigation

Status: implementation complete; waiting for user experience confirmation. The historical E7 stall was not reproduced on the chosen base. No product watchdog or automatic abort was added.

## Candidate and boundaries

- Branch: `fix/team-stalled-turn-reproduction`.
- User-authorized local base: `25602d52d510e98a3c8a6ac5d50fe42992c2d103`.
- Remote baseline observed by the parent: `05dc95412028d7e5a9bcedbb03e2d01f795da21a`.
- Worktree: `/Users/sakurasep/.codex/worktrees/team-stalled-turn-reproduction/PI-Desktop`.
- The test calls the production `DesktopAgentRuntime.prompt` entry point with `executionProfile=team`, `isLead=false`, and `workPurpose=execute`. The actual pi Agent loop, provider wrappers and runtime recovery wiring remain real. Only the provider event stream and Host RPC boundary are fakes.
- No live session, real provider, user data directory or installed Desktop instance was accessed. Dependencies were reused by reference; candidate package output was rebuilt locally without installation.

## Observable baseline

`runtime-team-silent-member.test.ts` contains two bounded attempts:

1. **Two completed empty replies.** The provider ends both replies without visible text or a tool call. The member makes exactly two provider requests, emits one retriable `EMPTY_MODEL_RESPONSE`, emits one `agent_end`, and reports `isRunning=false`. Member turns do not pass through the lead completion authority gate.
2. **Empty reply followed by an open stream.** The first reply completes empty. The next provider stream starts and never emits a terminal event. A controlled clock advances the existing stream idle budget; the wrapper aborts that request. The prompt rejects with retriable `STREAM_FAILED`, the assistant ends in error, and runtime status reports `isRunning=false`.

The second attempt uses `PI_DESKTOP_STREAM_IDLE_TIMEOUT_MS=30000`, the existing supported minimum, and fake timers. It does not wait thirty seconds in real time or introduce a new product default. The default provider idle budget remains 180000 ms. The test removes its override and restores real timers after cleanup.

An additional zero-event variation (no `start` event in the hanging request) reached the same `STREAM_FAILED` rejection. It did not leave the member runtime running either.

## Existing owner behavior and adjacent finding

The provider stream already has an idle watchdog: the stream function installed by `DesktopAgentRuntime` wraps `createProviderRetryStream` in `withStreamIdleTimeout` from `provider-retry.ts`. This is different from a Team/queue-level stalled member marker: `team_status` and `TurnQueue` do not gain a new marker or notification here.

A completed empty response is classified at `message_end`. It gets one no-output recovery; a second completed empty response becomes `EMPTY_MODEL_RESPONSE`. An open provider stream has not completed, so it reaches the stream watchdog and `STREAM_FAILED` rather than `EMPTY_MODEL_RESPONSE`.

The open-stream attempt also exposed an existing adjacent provider recovery failure: after the watchdog, `retryPendingProviderFailure` rejects with `Cannot retry a provider stream without its failed assistant message`. This premature rejection prevents the intended shared transient retry sequence. The public prompt boundary still rejects with `STREAM_FAILED` and finalizes an assistant error, and its runtime status is idle. `sidecar.ts` converts rejected prompts into terminal error envelopes; the existing Agent Host ingestion closes an active turn on that error. These sidecar/Host steps were inspected, not exercised cross-process by this investigation.

A separate provider recovery fix, if requested, should address the ownership of the failed assistant suffix during nested no-output recovery and prove zero-event/start-only stream retries at the real Agent loop boundary. This investigation does not pin that incidental error wording as a required contract or silently modify it.

## Conclusion and remaining uncertainty

The historical turn that stayed `running` after 22:55 is not explained by either fake-provider path on the current local base. Under WP3b's stop rule, two bounded attempts without reproducing E7 end this package as an investigation. There is no evidence here for choosing an inactivity duration, adding a Team watchdog or aborting a member.

The build used by the historical session remains unknown. The original Host state and its terminal event delivery were not reproduced; source inspection is not evidence that the historical error envelope was delivered. A future investigation needs a sanitized event sequence/build identity or a new isolated reproduction that leaves either the runtime or persisted Host turn running after its provider outcome.

## Validation

Commands run using the already provisioned toolchain:

- Workspace TypeScript build of `shared`, `plugin-sdk`, `plugin-devkit`, `racp`, `voice-runtime`, `agent-host` and `agent-runtime`: passed.
- Focused two-attempt test: 2 passed.
- Related silent-answer, collaboration and provider retry suites: 4 files, 66 tests passed (`.review-evidence/wp3b-targeted.log`).
- Root Biome lint passed (121 configured files); test-quality inventory passed against the local base (8437 existing source/CSS entries, unchanged; new runtime test stays below 800 lines). See `.review-evidence/lint.log` and `.review-evidence/test-quality.log`.
- A path-specific Biome invocation processed no files because test files are excluded by repository configuration; it was replaced by the configured root lint command.

`check-pr-base-main.mjs` passed: the recorded remote baseline is an ancestor of the local candidate.

No executable product behavior changed. A new Electron or Rust candidate E2E run is not claimed: the authorized investigation uses the real runtime loop with fake boundaries, and no Host code was changed. No push, pull request or merge was performed.
