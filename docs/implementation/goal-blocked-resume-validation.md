# Goal blocked execution implementation and validation

Date: 2026-10-13

Status: ready for user review. This document records local candidate evidence;
it does not establish release publication or user acceptance.

## Authorized behavior

The approved implementation uses the recommended D1–D9 decisions, including WP6.
Only a valid structured `met` report, reconciled Goal progress and settled
execution-owned Team work may complete automatically. Other normal or error
endings become durable holds. Continue reuses the execution and immutable
contract; explicit acceptance is the only new non-`met` completion path; abandon
and replacement retain interrupted execution semantics without publishing reports.

| Decision | Implemented contract |
| --- | --- |
| D1 | Additive Plus v8 holds, with upstream `interrupted/GOAL_BLOCKED`; no upstream CHECK rebuild |
| D2 | Missing/invalid reports, partial/blocked/unknown verdicts and unsettled current-decision work block; failed/cancelled tasks are terminal |
| D3 | Errors and Host restart block; explicit user Stop stays interrupted |
| D4 | Composer defaults to continuing the held Goal, with an opt-out for ordinary messages |
| D5 | Current selected provider/model is used; the approved permission mode is restored and model changes audited |
| D6 | Approving a replacement Goal supersedes the old hold; only its owned pause and queued dispatches are retired |
| D7 | Historical completed/fallback reports cannot reopen; legacy snapshots are not migrated or rewritten |
| D8 | One report recovery per segment; no extra automatic Goal retry loop |
| D9 | Reuse structured limitations/nextSteps; no new model-authored blockers field |

H was explicitly clarified by the user: the old execution column/CHECK remains
readable, but an old Plus v7 application rejects the upgraded Plus v8 database.
Whole-database downgrade is unsupported. Upgrade tests use isolated fixtures,
not the incident session's private data.

## Source and verification boundaries

Host Core owns settlement, persistence, report publication, hold CAS, pause
ownership and notification truth. Main and headless adapters own turn dispatch,
member cancellation and transcript persistence. Runtime owns approved execution
context and bounded report recovery. Renderer uses production readers and
components, without SQLite access or remote mutation capabilities.

Resume instructions support text and ordinary file references. Image/plugin
attachments retain the draft and ask the user to choose ordinary messaging.
No installed application, real provider, paid API or production database was used.

## Requirement-to-evidence mapping

| Acceptance | Authoritative verification |
| --- | --- |
| A: no report blocks, retains M0–M4, no ready file or completed notification | Native `E2E-GOAL-BLOCKED-001`; Host report evaluation tests; Main notification/barrier tests; UI001 card rendering |
| B: pseudo calls and open decision-owned Team tasks block and pause | Native 003, Host Team authority tests and runtime Lead guard tests |
| C: same execution, preserved contract/context, user supplement, parallel members, met report and segment history | Native 002/004/010; actual child sidecar/proxy in 010; Main persisted-message identity tests; UI001 current-model/default-send interactions |
| D: partial blocks, explicit acceptance retains verdict and labels unverified | Native 005; Host closure summary tests; shared v1/v2 decoder tests; UI001 report/timeline |
| E: abandon/supersede without report or old work replay | Native 006; Host exact-decision queue/pause ownership tests; Main authentic cancellation mirror tests; post-approval change notifications |
| F: held Goal survives restart and can continue | Native 007/010/011; Host initial/resumed boot recovery tests; UI001 restart refresh |
| G: Plan/Stop/legacy snapshots remain compatible | Native 007/009 and unchanged Plan open-task/pseudo scenarios; legacy v7 fixture hashes and decoder; no production incident-data access |
| H: legacy storage encoding, explicit downgrade refusal | Native 009; Plus schema migration tests; user-confirmed downgrade boundary |
| WP6: runtime errors, failed resume and Host restart remain recoverable | Native 008/011; Main rollback tests; Host file/publication failure and startup tests |

The UI lane uses production components, Composer, store, readers and compiled
CSS in isolated sandboxed Electron. Only preload IPC is replaced. Nine action
groups passed at 1000px and 420px; screenshots were personally inspected for
wrapping, visible reasons/progress, all three actions and Composer opt-out.
This proves real rendering and interaction; native lifecycle and Main IPC checks
provide separate persistence/process evidence.

## Executed checks

- Shared: 1322 tests; Agent Runtime: 1761 tests; Host Runtime: 172 tests;
  RACP: 23 tests; i18n: 30 tests; pi-host: 11 tests; Agent Host: 71 tests plus
  the final 42-test notification family after its identity guard.
- Desktop Node: 4085 passed, 0 failed, 1 skipped. Later affected cancellation
  checks: 93 passed. Earlier failure logs remain beside the final logs.
- Direct source builds for every workspace JavaScript package, pi-host and
  Electron main/preload/renderer passed. Desktop and pi-host typechecks and
  the dedicated runtime-test typecheck passed.
- Biome, style tokens, agent-policy sync and the test-quality ratchet passed.
  Retired source-regex baseline entries only decreased.
- Documentation checks: 616 pages and 94 specification pairs passed; VitePress
  build/link checks passed. The scenario catalog covers 127 suites and 160 executable IDs.
- Rust: 1197 passed and 1 pre-existing ignored test; final scoped refinements
  subsequently passed all 161 Team tests and 4 Goal RPC tests. `cargo fmt --check`
  and `cargo clippy -p host-core --all-targets` passed with only two pre-existing
  warnings. No new warning is introduced.
- Native Goal replay: 001–011 passed, including real initial/resumed Host exits,
  a real sidecar child/proxy, explicit close paths, legacy fixture hashes and CAS.
  The original Team scope after an intervening ordinary strategy is exercised
  by the Host service regression, not by the scripted model lane.
- Renderer permission/mode synchronization: final 15 affected tests passed;
  the real UI probe also verifies immediate Agent/Ask display after continuation.
- `verify:ui:*` was not run, as repository policy requires explicit invocation.
  The authorized isolated UI E2E provides the relevant real rendering evidence.

The host pnpm 12 wrapper attempted automatic environment synchronization and
refused linked dependency directories. No installation completed. Validation
used the already provisioned Node/TypeScript/Vitest/Electron tools directly;
build artifacts were generated from this candidate's source.

## Final candidate

Feature-source checkpoint: `77ca82053679a6773d7eb9df0e5fa2a74c6f8838`.
Base remote main: `40e32b0a2a082ababa1c24de28bea98142333da1`.
Host binary SHA256: `03bdd976eb8b36cfeaef6655f4b0529f5ce46e661445a06e3b41cdd5c387404c`.

All feature source was committed through the checkpoint above. The final
local delivery commit also corrects report-summary provenance: blocked,
abandoned and superseded summaries omit closure instead of implying Agent
verification. Its 22 Host hold tests passed. The exact clean final candidate,
base and binary hash are identified in `.review-evidence/final-native.json`.
The relevant native replay, existing Goal/Plan guard suites and isolated UI lane
are rerun on that candidate; raw command results are retained beside the report.

The dedicated worktree is retained for user review. The primary checkout and
local/remote main are unchanged. This is local implementation delivery only;
user acceptance and external publication are separate steps.
Raw command logs, fixture results, binary/source hashes and screenshots are in
`.review-evidence/` in the request worktree; this ignored evidence is separate
from product source. No push, PR, merge, installer or release is authorized here.
