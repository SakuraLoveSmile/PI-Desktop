# Live Voice Work Integration Evidence

Status: **P0—P6 implementation is present; the full v2 Definition of Done is
not met**. P7 behavior mapping and cross-boundary integration coverage remain
partial, and the real-provider/device matrix has not run. The attached v2
specification remains the behavioral source.

## Candidate and base

- Request branch: `codex/live-voice-v1`; dedicated worktree:
  `/Users/lan/.codex/worktrees/live-voice-v1/PI-Desktop`.
- Phase-2 implementation base: `1ec74701f` (the v1 implementation commit).
- Latest fetched `origin/main`: `2387fa6d4d96be3ec67638f37255c23f4c52d367`;
  it is an ancestor of the request head.
- Existing pull request: [#1161](https://github.com/vastsa/PI-Desktop/pull/1161),
  open on `codex/live-voice-v1`. This task updates that PR and does not merge it.
- The worktree has an untracked `PI-Desktop-Live-Voice-v1-Spec.md`; it is not a
  task deliverable and is excluded from the change.

## Implemented paths

### Binding and provider ingress

- The user selects a local Desktop session and context-sharing preference in
  the existing Live controls. Main resolves the session and freezes the
  `LiveWorkBinding` to the new call. Missing sessions fail closed; `remote` and
  `pi-native` sources return `LIVE_WORK_BACKEND_UNSUPPORTED`. The Main work port
  rechecks the call binding and Host session metadata before work operations.
- A call without `workTarget` keeps the voice-only profile. The provider can
  submit only `delegate_to_work_session({ instruction })`; Main takes the
  session identity, binding revision, and operation identity from trusted call
  state.
- Codex native delegation continues through the existing Renderer DataChannel
  and `liveVoiceReportDelegation` IPC. Gemini and Realtime parse complete
  function calls, validate the declared tool and arguments, and send a single
  provider-native `received` or `rejected` receipt. Realtime GA and compat
  retain distinct audio/session profiles.
- The call-scoped ledger deduplicates identical request IDs, rejects changed
  parameters under the same ID, bounds candidate capacity, and is discarded
  when the call closes. Work admitted before call closure remains owned by
  AgentHost/Host.

### Classification and Host admission

- `packages/host-runtime/src/live-work/` contains strict intent validation,
  bounded context projection, operation ledger, result projection, and the
  coordinator. Classification uses the bound session's configured text model
  with tools disabled. Context-disabled calls do not read prior messages;
  recent operation context carries only bounded operation IDs and status facts.
- The coordinator returns the provider receipt before classification and does
  not dispatch when the local receipt was not sent. It routes work through the
  existing `AgentHostBridge` and registered prompt/steer handlers, or the
  existing durable Host queue. Voice messages retain their preallocated
  `userMessageId` and `voiceOrigin`.
- Steer uses the captured `expectedTurnId` and is checked in Main and again by
  the sidecar/runtime after Host I/O. Graceful stop and immediate abort carry
  the frozen turn ID; Main and the sidecar compare it at the active-run owner.
  Stop failure never becomes a new prompt or queue item.
- Session metadata is rechecked immediately before dispatch so deletion,
  source change, or call closure during classification cannot start work in a
  stale scope. Queue entries and voice provenance are persisted by host-core;
  schema v20 migrates v19 queue rows without dropping them.
- Only authoritative Host turn-terminal events settle operations. The summary
  projector reads the exact terminal turn, filters unrelated/tool/user
  content, bounds output, and uses an honest status fallback. A result query
  reads the latest terminal operation for this call or an explicit operation
  reference, and does not create a turn. Route/rejection reasons and bounded
  terminal summaries are visible in the Live work panel.

### Project/session selection and feedback

- Project/session list intents use existing Host metadata. Responses expose at
  most 20 labels and opaque `selectionRef`s scoped to call, binding revision,
  and a 60-second lifetime; raw paths and session IDs stay in Main. Opening a
  unique session navigates through the existing renderer. Duplicate labels
  remain an explicit panel choice. Creating requires a listed registered
  project and a user click in the Live panel, uses existing defaults, and does
  not change the current call's work binding.
- Feedback is held in a bounded eight-item queue, deduplicated, and coalesced
  on overflow. It waits for provider generation, user speech, and local
  playback to be idle, then applies a 700 ms quiet window and three-second
  speech gap. Stale automatic speech is downgraded after 15 seconds; silent
  mode suppresses automatic announcements while explicit status/result
  queries can still speak. Shared terminal turns produce one final feedback
  item, while all linked operations receive the same feedback delivery status.
- Gemini Live and Realtime use PCM output-credit drain. Codex work calls route
  the remote audio element through a local Web Audio analyser; if monitoring
  fails or its AudioContext is not running, Main keeps feedback held. The
  analyser observes renderer output samples before the output device; it
  cannot prove that a person heard the audio.

### Main changed areas

- Main/provider integration: `apps/desktop/electron/main/live-voice/`,
  `apps/desktop/electron/main/live-voice-ipc.ts`,
  `apps/desktop/electron/main/agent-host-bridge.ts`, and
  `apps/desktop/electron/main/ipc/agent-ipc.ts`.
- Renderer controls and localized labels:
  `apps/desktop/src/features/voice/live/`, Composer integration, shared Live
  DTOs, and `packages/i18n` locales.
- Host/Runtime admission and provenance:
  `packages/host-runtime/src/live-work/`, `packages/agent-host/`,
  `packages/agent-runtime/src/sidecar.ts`, `packages/shared/`, and
  `crates/host-core/src/{db.rs,db/,turn_queue.rs,sessions.rs}`.
- Product/evidence docs: the English and Chinese Live work spec, E2E plan,
  navigation, storage spec, and queue ADR.

## Automated evidence

| Check | Result |
|---|---|
| `pnpm --filter @pi-desktop/shared build` | Passed after the additive playback-activity DTO. |
| `pnpm --filter @pi-desktop/voice-runtime build` | Passed with the playback signal helper. |
| `pnpm --filter @pi-desktop/host-runtime test` | 75 tests passed. |
| `pnpm --filter @pi-desktop/voice-runtime test` | 51 tests passed. |
| `pnpm --filter @pi-desktop/i18n test` | 27 tests passed. |
| `pnpm --filter @pi-desktop/desktop typecheck` | Passed after rebuilding shared and voice-runtime. |
| `pnpm --filter @pi-desktop/desktop test` | 3,038 tests passed across the full desktop suite. |
| Targeted Live Voice `node --test` | 15 tests passed, covering Main service, selection scope/UI, controller path, and playback-activity IPC. |
| `pnpm build:js` | Passed; docs, workspace packages, Electron main, preload, and renderer built. Existing chunk-size and VitePress highlighting warnings remain. |
| `pnpm lint` | Passed, including style-token validation. |
| `pnpm docs:check` | Passed; 83 English/Chinese specification pairs and 526 documentation pages verified. Existing ADR format notes remain. |
| `pnpm check:agent-policy`, `pnpm check:pr-base`, `node scripts/check-architecture.mjs`, and `git diff --check` | Passed on the phase-2 candidate; `origin/main` at `2387fa6d4d96`. |
| AgentHost, agent-runtime, and Rust regression suites | Passed on the v1 candidate; no files in those packages changed in phase 2. |

The directly exercised W2 behaviors are mapped below. A mapped test proves
only the named seam and assertions, not a complete provider-to-device journey.

- No-work-scope voice-only behavior and explicit work-scope forwarding:
  `apps/desktop/test/live-voice-service.test.mjs`.
- Declared tool parsing and provider-specific receipt encoding:
  `packages/voice-runtime/src/live/protocol.test.ts`.
- Receipt-before-classification, no dispatch after receipt delivery failure,
  Host queue routing, stale steer rejection, duplicate request handling,
  early terminal correlation, query-result without a second turn, and call
  closure during classification:
  `packages/host-runtime/src/live-work/coordinator.test.ts`.
- Context opt-out, bounded prior operation facts, and request-preserving context
  caps: `packages/host-runtime/src/live-work/context.test.ts`.
- Exact-turn result summary and honest fallback:
  `packages/host-runtime/src/live-work/result-summary.test.ts`.
- Durable queue provenance, v19 migration, and malformed provenance reporting:
  `crates/host-core/src/turn_queue.rs` tests.
- Bound session source/call checks and session deletion during Host lookup:
  `apps/desktop/test/live-work-scope.test.mjs`.
- Legacy session-wide calls and stale exact-turn rejection at the sidecar run
  owner: `packages/agent-runtime/src/turn-target.test.ts`.
- Escaped terminal summary rendering:
  `apps/desktop/test/live-work-operations.test.mjs`.
- Call-scoped, expiring selection references and stale session revalidation:
  `apps/desktop/test/live-work-scope.test.mjs`; panel actions:
  `apps/desktop/test/live-work-operations.test.mjs`.
- Feedback debounce, speech gap, silent mode, stale downgrade, overflow, and
  deduplication: `packages/host-runtime/src/live-work/feedback-scheduler.test.ts`.
- Provider generation plus local Codex playback gating and shared-turn
  feedback status: `apps/desktop/test/live-voice-service.test.mjs`.
- Codex local output signal threshold and strict playback-activity IPC:
  `packages/voice-runtime/src/live/playback-monitor.test.ts` and
  `apps/desktop/test/live-voice-ipc-media.test.mjs`.

Direct or partial test mappings include W2-001, W2-005, W2-007, W2-009—016,
W2-027, W2-041/042, W2-045, W2-049/050, W2-060/061, W2-063/064, W2-073—076,
W2-081, W2-086—089, and W2-093. The mapping is **not complete**: the remaining
W2-001—W2-096 cases still need an explicit case-level audit, and the current
tests do not provide one normalized request → registered handler → terminal →
provider-wire integration fixture per adapter profile.

## Remaining acceptance work

- Cross-boundary integration currently uses deterministic seams and protocol
  encoders; it does not exercise a full normalized request → registered Agent
  handler → authoritative terminal event → provider wire path for each of
  Codex, Gemini, Realtime GA, and Realtime compat.
- W2-001—W2-096 still need a complete case-level mapping and uncovered-case
  audit. This implementation does not claim all 96 behaviors pass.
- M01—M16 and each Codex OAuth, Gemini Live, Realtime GA, and Realtime compat
  real-account/media journey are `NOT RUN`. No credentials, paid endpoints, or
  audio-device journey were used. Repository policy also reserves
  `verify:ui:*` for explicit user requests; this task used isolated fixtures.
- Codex playback monitoring verifies renderer output samples before the device,
  not physical output completion or human audibility. Real playback buffers,
  WebSocket/provider behavior, and race behavior must be confirmed by the
  isolated manual matrix.
- PR integration validation is still pending the remote run for the updated
  head. The PR is open and has not been merged.
