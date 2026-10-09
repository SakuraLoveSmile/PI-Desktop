# Context Insights port: local validation

> Historical task-only validation. The local-main integration record below
> supersedes the original uncommitted-candidate delivery state.

Date: 2026-10-09. Delivery state: `待体验` (local validation complete; user acceptance pending).

## Result and route

The native port exposes Context Insights in the sidebar, a Context work-panel
tab, an entry from the Composer usage inspector, and `/context`. It includes
request composition and estimates, actual usage, Step/Turn and Total/Delta
trends, raw/Markdown request browsing, context events, file operations,
ordinary Task-agent context selection and team relationships. Device-local view
defaults are validated and saved without changing provider settings.

The upstream reference is dsh-context 0.66.0, revision
`f60e1a56439badf95927b9a811904d4d5b0b57b8`, Apache-2.0. Ordinary plugin reads
are limited to plugin-owned imported sessions, and trusted extensions lack
functional historical readers and a panel bus. These verified gaps prevent a
complete plugin-only implementation. The native fallback follows the user's
explicit instruction and preserves the plugin trust boundary. See
[the decision](../adr/context-insights-native-port.md) and
[behavior contract](../spec/03-runtime/context-insights.md).

## Candidate and preservation

- Branch: `codex/context-insights-port`, dedicated managed request worktree.
- Base remote main and tested HEAD: `05dc95412028d7e5a9bcedbb03e2d01f795da21a`.
- The implementation is uncommitted (`dirtyCandidate=true`); no commit, push,
  PR, merge or installation was requested or performed.
- Executable identity is recorded by SHA-256 in the local E2E evidence; all
  executable and test-script hashes remained identical throughout the final run.
- Executable-source manifest fingerprint: `134db623506a52787a64ee890c8cfec3b1a232ebc883d0c8b84973104f9c2d24`.
- The primary checkout remains clean on its original local main
  `97c3613f34f2f5be456be643b57856331cadac1d`, still 11 commits ahead of remote
  main. Its tracked source and other worktrees were preserved.

The older delivery workflow still contains a commit-per-change R2 statement.
The applicable AGENTS commit-on-request rule is authoritative; this feature
request did not include a commit instruction. No workflow policy change is
included in the port.

## Checks actually run

| Check | Result and coverage |
| --- | --- |
| Workspace package builds | Direct existing TypeScript compiler built shared, i18n, plugin SDK, agent host/runtime, host runtime, RACP, voice runtime and plugin devkit |
| Desktop typecheck | Direct `tsc -p apps/desktop/tsconfig.json --noEmit`: passed |
| Desktop production bundle | Existing `electron-vite build`: passed; pre-existing large-chunk warnings remain |
| Desktop unit/contract suite | 3928 passed, 0 failed, 1 skipped; skip is the existing published planning-with-files import fixture |
| Runtime/capture/integration suites | Data worker ran 450 tests across 10 affected runtime, extension, delegate, compaction and host-pipeline files: passed |
| Outbox persistence | 3 new rejection/retry/notification regressions plus 9 existing tests: passed |
| Private remote egress | Primary agent ran AgentHost suite: 40/40 passed, including private context suppression |
| RACP contract | Primary agent ran 20 tests: passed |
| i18n catalogs and renderer keys | Primary agent ran 30 tests: passed for all shipped locale catalogs; new non-Chinese secondary locales inherit English |
| Rust Host | Full suite 923/923 passed before final RPC error-tag adjustment; the 4 affected tests passed again after that adjustment |
| Rust formatting/clippy/build | Passed; clippy has two existing too-many-arguments warnings in plugin installation and team roster |
| Native Electron E2E | Final 34/34 passed on the stable executable candidate, using real Electron/Main/Host plus a loopback deterministic provider |
| Style, Biome, release docs, diff/base | Style tokens, 111 configured Biome files, release documentation, `git diff --check`, and PR-base ancestry guard passed |

The pnpm run preflight refused the worktree's referenced hoist layout. Validation
used the existing underlying compilers/runners directly. Compatible dependencies,
Electron and Cargo caches were reused; no second dependency/runtime environment
was installed. Mutable profiles, database, workspace, ports and logs were isolated.

## Native user-path and visual evidence

The final E2E checks actual provider payloads against the fixture's received
model/messages/tool schemas, request start and settlement, usage identity,
metadata omission, selected detail, date/project/search controls, Step/Turn and
Total/Delta controls, pinning, refreshing, work-panel opening, `/context` dispatch,
real pointer Close, Chinese restart, durable recovery, deletion and refused late
writes. The fixture received exactly its expected two model requests; inspecting
or refreshing did not create another request. Authentication fixtures did not
appear in diagnostic contents.

The primary agent personally reviewed overview, work-panel, content-browser and
dialog screenshots at wide and narrow sizes, including Chinese dialog chrome.
At the narrow 760px viewport, the sidebar finishes its normal collapse and the
work panel is 310px wide. Its header starts at 60px; browser content is
304px wide with scrollWidth equal to clientWidth. Text wraps and remains readable.
An earlier screenshot captured the sidebar's exit animation and stale nested
scroll; the final harness waits for stable geometry and resets the owned scroll
container, without changing application layout.

Local artifacts are preserved under `target/context-insights-validation/`:
`e2e/evidence.json`, the final screenshots and layout JSON, desktop-test and
production-build logs, and `source-manifest.sha256`. These are local artifacts,
not shipped product assets. The final harness is
`scripts/e2e-context-insights.mjs` (`test:e2e:context-insights`).

## Compatibility and evidence limits

- Exact captures start with this version. Earlier dispatched prompts/schemas
  cannot be reconstructed from visible history. External Native Pi/remote
  diagnostic capture is not introduced or simulated.
- Retention is a bounded diagnostic sample: at most 40 requests, 160 events,
  120k captured characters per request and 1.2M per session. Omission,
  truncation and retired records are explicit. Billing remains owned by the
  existing Host usage history independently of that sample.
- Logical Pi content estimates and runtime calibration differ from provider
  actuals. Final adapter payloads are shown separately after existing hooks;
  opaque plugin-owned adapters without a payload callback remain explicitly
  Pi-context-only. Credentials and image binaries are redacted; images display
  metadata, not copied request binaries.
- Event filters display actual available PI facts. This port does not introduce
  a new automatic pruning policy, DSH PTC presets or DeepSeek balance access.
  Existing compaction remains the authority. Missing first-token/idle-time
  attribution and unavailable costs remain labelled rather than fabricated.
- File activity uses an explicitly loaded transcript sample (200 initial rows,
  with Load earlier). Token/context sorting of overview cards applies to the
  bounded current page sample; day filtering uses retained request timestamps.
- Validation used macOS and deterministic local endpoints. Real-provider
  pricing/cache behavior, physical devices, Windows/Linux UI, publication and
  installation have not been claimed or tested in this request.


## Local-main integration — 2026-10-09

The user authorized merging this request into local main. The original feature
commit is `7dfc20b49`; the integration candidate incorporates existing local
main `af6e6ce675a2f49077055c0e9d9c22b89213a194` (including project memory,
code search and confirmed-roster recovery). The only content conflict was the
unreleased changelog; both sets of entries are preserved. The Context Browser
also recognizes the existing ProjectMemory, ProjectHistory and CodeSearch tools
as built-ins, with an observable attribution regression test.

Candidate validation and final merge identity are recorded in the local
integration archive. No remote publication or installation is part of this
local-main request. Only this request's worktree and branch are retired after
verified integration, with recoverable source and validation artifacts retained.
