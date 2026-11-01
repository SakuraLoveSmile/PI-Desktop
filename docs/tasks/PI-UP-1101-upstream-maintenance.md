# PI-UP-1101: Adopt verified upstream maintenance fixes

- Project: `fork-pi-desktop`; status: 待体验 (code validated; merge tracked separately).
- Created: 2026-11-01 (Asia/Taipei).
- Authority: this record. The user authorized merging useful PRs after the
  read-only upstream audit, including the necessary branch, PR and gated merge.
- Baseline / target: `feb1a40e5a523a2935bf9434f36005aa99d1d91a` / remote `main`.
- Integration branch: `fix/20261101-pi-up-1101-upstream-maintenance`.
- Worktree root: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261101-fix-pi-up-1101-upstream-maintenance`.
- Upstream audit revision: `d2c85a95a599002672e1592df7bc58fb11f8d79b`.
- Evidence directory: `/tmp/pi-up-1101-artifacts` (logs, isolated fixtures and
  hashes of the four pre-existing dirty primary-checkout policy documents).

## Scope and frozen decisions

This request adopts selected maintenance PRs, not a full upstream-main sync.
The existing `docs/project/upstream-sync.md` ancestry-preserving procedure
continues to govern full synchronizations. Record each selected PR and source
revision; do not manufacture an ancestry bridge that falsely marks other
upstream features as integrated. Preserve original work and source attribution
while adapting it to the current Plus architecture.

| PR | Source merge / head | Required behavior |
| --- | --- | --- |
| vastsa/PI-Desktop#2046 | `0f9928fe0352e0368146af70dbcc1f4dfc0ac672` | Plugin commands cannot replace/remove another owner's entry; same-owner updates remain valid. |
| vastsa/PI-Desktop#1885 | `b9d5e45226936c1bad3c045da46849231a6ddab2` | Torn transcript/checkpoint tails do not prevent subsequent valid writes and recovery. |
| vastsa/PI-Desktop#1978 | `78e128ac9c93cbf975319078c39589701c1422c7` | Drain issued checkpoint writes across settlement/shutdown; serialize later turns per session. |
| vastsa/PI-Desktop#1994 | `4eea56e7f6caa9e7212b18de4988275a6e0f90aa` | Include cache buckets in context occupancy without losing the provider-total guard. |
| vastsa/PI-Desktop#1944 | `2bdd8c86843ed6fdd08b75ca85e2abf90f7fdd2c` | Recover malformed tool-call context on Continue without rewriting durable user history. |
| vastsa/PI-Desktop#2035 | `ceab9be7dc934b43160c2611cf8ba4e9f59f7a4f` | Preserve images and MCP resources in parent/delegate resumed tool results. |
| vastsa/PI-Desktop#1973 | `00a1a0ea90e952fabb67d638ac74eae3a8fe0342` | Persist/replay assistant block and function-call signatures across runtime rebuilds. |
| vastsa/PI-Desktop#1981 | `3684cc4063d94619b63b725afdaa212e9f545169` | Apply stream-idle timeout per provider attempt, excluding retry backoff. |
| vastsa/PI-Desktop#1967 | `70b3354efdcb5cfd89b4b352e8d5b296eb1baabf` | Chinese IME slash input produces one slash, retaining composition recovery and draft isolation. |
| vastsa/PI-Desktop#1986 | `d9ebcf14fbd467533b519fa945d585b9b359025c` | Count git apply only in command position, not incidental read-only text. |

Keep Plus identity, update feed, profiles, schema P10, Team/Goal approval and
durable turn boundaries, memory-owner/CAS checks, configurable shortcuts, and
existing data semantics. No Pi upgrade, dependency installation, user-profile
access, paid provider calls, installer build, release, or version change.

Deferred as reviewed: duplicate AskTool/memory implementations; large Goal,
review-history and file-lease features; MCP SSE with a removed session/list
registration; storage-format optimizations with unresolved upstream checks;
open external feature PRs requiring a separate contribution-scope decision.

## Implementation ownership and integration

All worktrees share the task stem above; suffixes below are responsibility
worktrees based on the same clean baseline. Only the named owner writes its
files. No agent starts a service against a user profile or delegates further.

| Step | Owner / worktree suffix | Exclusive implementation and acceptance |
| --- | --- | --- |
| T1 | Lead / none | Plugin ownership, torn-tail handling, shared context occupancy helper/runtime estimates and their tests. Preserve the frozen D355 renderer formula. Maintain shared exports, task record, paired specs, changelog and final integration. |
| T2 | Runtime worker / `-runtime` | Agent runtime/session/delegate recovery, replay helper, retry/watchdog and patch-command classification plus runtime tests and isolated runtime E2E scripts. Own `packages/agent-runtime/src/runtime.ts`; preserve Plus Team/Goal hooks. |
| T3 | Persistence worker / `-persistence` | Checkpoint writer lifecycle and Host-runtime tests/E2E; provider replay's shared message types, Electron persistence, Rust session/plugin-session serialization and tests. Shared `AssistantProviderReplay` contract follows #1973 v1 exactly; no SQL migration. |
| T4 | IME worker / `-ime` | Existing Composer/input/draft/completions wiring, regression tests and IME/paste E2E. Preserve all layout/styles/tokens and existing input recovery. |
| T5 | Lead + independent reviewer | Integrate reviewed commits serially, run final combined checks and relevant candidate E2E, publish one PR, inspect all job conclusions and merge only a passing integration candidate. |

T1-T4 may run independently. T2 typechecking requires T3's optional replay
types; T2 tests can run via existing Vitest transpilation before integration.
T1 owns shared exports; T3 owns `packages/shared/src/types/messages.ts` only.
Specs/changelog/package-level command wiring are lead-owned to avoid overlap.
Reuse the provisioned dependency trees via worktree-local workspace link
overlays. Do not run a package manager inside an overlay. Each worktree owns
its generated outputs and tests; final Host/E2E state belongs to the lead's
task scratch directory. Hosted clean-lockfile gates remain authoritative.

## Acceptance and validation

For every fix, first run an observable regression against old behavior, then
run the same test after the change. Preserve failing baseline logs. Cover
normal plugin updates and collisions; UTF-8 crash tails; pending/in-flight
checkpoint settlement; cached usage and automatic compaction; malformed calls
then Continue; delegate resume with image/resource content; provider signature
round-trips; retry-backoff then active stream; IME composition then command
menu; incidental git/apply text then later valid work.

Run applicable targeted suites, JS builds/typechecks, lint, architecture and
test-quality ratchets, paired documentation/scenario checks, and Rust format /
tests. Record exact commands and results below. Candidate E2E uses the request
worktree or its exact SHA on GitHub-hosted Actions after latest `origin/main`
is incorporated; never use local main as an integration scratch branch.
`verify:ui:*` and live providers are excluded. Hosted gates must pass before
remote merge; record tested head/base/integration SHA and run URLs.

## Adaptations and review

- Keep the installed Pi 1.0.1 dependency family and the current runtime
  deduplication policy. Add finalized-batch validation outside provider retries
  instead of importing a newer Pi identity implementation.
- #2035 needs the small MCP text/resource projection prerequisite from #1878;
  one helper now serves live and restored parent/delegate results. Provider
  signature capture/replay from #1973 covers parent sessions only, as upstream;
  delegate signature capture/replay is not claimed.
- #1994 adapts runtime budgeting and delegate preparation only. Local D355
  explicitly freezes a renderer formula different from upstream; the renderer
  source and tests remain unchanged. Runtime provider output already includes
  reasoning, so runtime budgeting does not add that bucket twice.
- Preserve Plus durable-turn identity, Team admission/Stop/observer hooks and
  context-insights. The runtime hotspot shrinks from 9,787 to 9,747 lines before
  the small review corrections; no parallel legacy recovery path was added.
- Independent review found interactive delegates bypassing malformed-batch
  validation and real quoted/global-option git-apply commands being missed.
  Both were reproduced with failing behavioral tests and corrected. Reviewer
  rechecked the integrated fixes and found no remaining landing blockers.
- Retire three source-regex assertions and one source-only IME case. Native
  Chromium composition plus Electron paste/history paths replace the IME
  assertions; real Rust transcript tests replace the read-API assertion.
  Lower `scripts/test-quality-baseline.json` against the same immutable task
  base; no new source assertion or raised inventory ceiling is introduced.

## Execution evidence before final candidate

- Initial primary checkout: only `AGENTS.md`, `CLAUDE.md`,
  `docs/spec/06-delivery/03-ai-development-workflow.md`, and
  `docs/spec/06-delivery/05-change-checklist.md` were dirty. Their before hashes
  are stored in `/tmp/pi-up-1101-artifacts/primary-before.json`.
- Selected upstream CI results were inspected during intake; they are upstream
  evidence only. Source-attributed task commits begin at `d04f92ec4` and include
  the integrated implementation and review corrections through `788083f67`.
- T1 red baselines: plugin ownership 4 failed / 2 passed; torn transcripts
  2 failed / 25 passed; cached parent compaction 3 failed / 2 passed;
  delegate anchor 1 failed / 19 passed; shared occupancy 2 failed / 10 passed.
  Green: 6 plugin cases, 27 Rust transcript tests, 25 runtime cases, 12 shared
  cases and the broader 30-case desktop batch all passed.
- T2 red: 20 failed / 64 passed plus git-command 6 failed / 9 passed. Green:
  22 suites / 343 cases plus 3 supplementary suites / 62 cases. Production
  offline sidecar hosted-search (7 scenarios) and retry-idle (3 scenarios)
  passed. Review corrections separately went red (2 and 4 failing cases), then
  green (80 and 89 relevant cases respectively).
- T3: checkpoint lifecycle red 5 failed / 2 passed, then 7 passed; shutdown
  pipeline red 1 failed / 4 passed, then 5 passed; signed call-only row red
  1 failed / 16 passed, then 17 passed. Full host-runtime 195, desktop
  persistence 53 and focused Rust session 97 tests passed. Controlled-RPC/disk
  checkpoint restart and ordering E2E passed; this is not native Rust/UI proof.
- T4: real Chromium native composition reproduced premature slash rewriting
  before the change and passed after it. Production Electron paste/history
  scenarios, 57 targeted Node tests, typecheck and production JS build passed.
- Integrated implementation `6568a7db8`: all nine workspace TS builds,
  Desktop and runtime-regression typechecks passed. Rust format, Clippy and
  27 transcript cases passed. The local full Rust run was interrupted when
  unrelated tests attempted an external plugin catalog; its partial log is
  not a passing result. Final targeted session tests and hosted CI remain
  separate acceptance evidence.
- Paired documentation structure/locales passed; generated scenario catalog
  has 138 suites and 167 executable IDs. The test-quality inventory only
  decreases. Logs are under the evidence directory, including per-worktree
  red/green records.

## Final candidate and landing evidence

- PR: [SakuraLoveSmile/PI-Desktop#68](https://github.com/SakuraLoveSmile/PI-Desktop/pull/68).
- Validated code candidate: `46a89f7ff75b23897cc471e2783ac5ce7dcf90bf`;
  base: `feb1a40e5a523a2935bf9434f36005aa99d1d91a`. The candidate was clean,
  with the empty workspace-diff digest, throughout build and E2E.
- Local environment: macOS, Node 22.23.2, provisioned dependency overlays,
  isolated temporary profiles/workspaces, localhost model fixtures. Native Host
  SHA256: `7fea9889cefc174885bbc35fe93f626474843d71a2bf6c3240c3849e0896eb73`.
- Final combined tests: runtime 372, host-runtime 195, shared usage 12 and
  Desktop 95 (674 JS cases); catalog/checker tests 25; Rust sessions 97 and
  transcript 27. All passed. All nine workspace builds, complete native
  Host/Desktop build, Desktop/runtime-regression typechecks, configured lint,
  architecture, test-quality, paired docs and generated scenario checks passed.
- Fourteen isolated E2E suites passed: five smokes; native Chromium IME;
  production Electron paste/history/restart; checkpoint RPC/disk lifecycle;
  production sidecar hosted search and retry-idle; Team member interrupt and
  open-task gate; temporary Goal; Plus curated plugin installation/restart.
  Sources, base, binary and compiled artifact hashes remained unchanged.
- Hosted integration candidate:
  `b395a420e47b5f272573253532980fb62b6ca52b`. Its entire tree equals the validated
  code candidate. The downloaded E2E build receipt and result both identify
  this merge ref, not only the branch head.
- [CI run 41289537588](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41289537588):
  JS build/typecheck/lint/architecture/full workspace tests, Rust format/Clippy/
  full tests, and five isolated Linux smoke suites all passed. Rust reported
  1,280 passed and one existing ignored case. Hosted Node: 24.22.1.
- [Docs run 41289537573](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41289537573)
  and [PR-base run 41289537533](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41289537533)
  passed. The earlier interrupted local full Rust run is superseded by this
  complete hosted result; it is not reclassified as a local pass.
- This final record update changes documentation only. Keep its executable tree
  identical to the validated code candidate, re-attest the final source head,
  and wait for all checks on the final PR head before merging. Final run links
  and merge SHA are discoverable from the PR above; they are not guessed here.
- Durable evidence archive:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/.archives/20261101-pi-up-1101/`.
  It retains logs, command inventories, local/hosted build receipts, E2E results,
  pre-existing primary-file hashes and worker patch-equivalence evidence, with
  `SHA256SUMS`; `/tmp/pi-up-1101-artifacts` is the working copy.

No Windows-device/OS candidate-window verification, real provider calls,
installer build, release or installed-user-instance change is claimed. The
provider-signature slice remains parent-only. User acceptance is still pending;
only explicit confirmation grants 已验收.

## Delivery and recovery

After gated merge, synchronize primary main without changing its four dirty
documents. Preserve needed evidence outside task worktrees, verify integrated
commits and no active task processes, then remove this request's worktrees and
merged local branches. Remote branch deletion is not authorized. No app
installation/restart or production-data change is part of this task.
