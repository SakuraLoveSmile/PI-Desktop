# Live Voice Work Integration Evidence

Status: **partial implementation; the v2 Definition of Done is not met**.
This file separates verified code and test evidence from unimplemented
acceptance work. The attached v2 specification remains the behavioral source.

## Candidate and base

- Request branch: `codex/live-voice-v1`; dedicated worktree:
  `/Users/lan/.codex/worktrees/live-voice-v1/PI-Desktop`.
- Starting commit: `51f815a93bf417fa644406d0bc74ee321aa3ec3a`.
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
| `pnpm build:js` | Passed; VitePress and Electron builds completed. Existing large-chunk and syntax-highlighting warnings remain. |
| `pnpm --filter @pi-desktop/desktop typecheck` | Passed after the Live work bridge changes. |
| `pnpm lint` | Passed, including the desktop style-token check. |
| `pnpm --filter @pi-desktop/host-runtime test` | 67 tests passed. |
| `pnpm --filter @pi-desktop/agent-host test` | 49 tests passed. |
| `packages/agent-runtime/src/turn-target.test.ts` | Exact active-turn target guard tests passed. |
| `pnpm --filter @pi-desktop/voice-runtime test` | 48 tests passed. |
| Targeted `node --test` for Live service/controller/controls/protocol work UI and work scope | 12 tests passed, including removed-session revalidation and escaped terminal summary rendering. |
| `cargo fmt --check` | Passed. |
| `cargo test -p host-core --locked` | 659 tests passed. The first run found a stale schema-v19 assertion; it was updated for v20 and the full suite passed. |
| `cargo clippy -p host-core --all-targets --locked` | Passed. |
| `pnpm docs:check` | Passed: 83 English/Chinese spec pairs and 526 documentation pages; existing ADR format notes only. |
| `node scripts/check-architecture.mjs` | Passed; `call-service.ts` was split by responsibility and is under the repository limit. |
| `pnpm check:agent-policy` | Passed. |
| `pnpm check:pr-base` | Passed with `origin/main` at `2387fa6d4d96`. |
| `git diff --check` | Passed. |

The targeted tests map to these acceptance behaviors; this list does **not**
claim the entire W2 matrix:

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

W2-001—W2-096 coverage is **partial**. W2-015/016, W2-027, W2-041/042,
W2-045, W2-049, W2-081, and the result-summary portions of W2-060 have directly
relevant automated cases. Several cases have only seam-level or unit coverage;
they are not full provider-to-registered-handler-to-terminal-to-wire tests.

## Remaining acceptance work

- Model-driven project/session list, opaque `selectionRef`, open, and create
  flows are not implemented. The classifier currently directs those requests
  to an explicit Desktop selection flow; it does not silently rebind a call.
- Terminal result summaries are visible in the work panel and result queries
  update the operation view, but no provider has the required safe automatic
  feedback scheduler yet. There is no verified wait-for-generation-and-local-
  playback-idle path, spoken terminal result relay, or complete speech-only
  announcement preference flow.
- The complete W2-001—W2-096 automated mapping and full normalized request →
  registered handler → terminal → provider-wire integration fixture have not
  been completed.
- M01—M16 and each Codex OAuth, Gemini Live, Realtime GA, and Realtime compat
  real-account/media journey are `NOT RUN`. No credentials, paid endpoints, or
  audio-device journey were used. Repository policy also reserves
  `verify:ui:*` for explicit user requests; this task used isolated fixtures.
- PR integration validation is still pending the remote run for the updated
  head. The PR is open and has not been merged.
