# PI-STAB-1111-R1 — Release gates, stability charter and UI evidence

Date: 2026-11-11 (Asia/Taipei). Tier: T2 overall (S2); S3 T0; U1 T1.
Status: 实现中. S2: 实现中 (hosted exercise blocked by runner DNS). S3: 已验收.
U1: 待体验 (local native repeatability verified).

## Goal, identity and authorization

This is the single task record for S2, S3 and U1 of the user's stability/UI
convergence plan. The user closed S1 by explicit residual-risk acceptance and
requested this round. S1's original failures and accepted limitations remain in
[PI-STAB-1111](PI-STAB-1111-nightly-ui-audit.md), carried forward from diagnostic
branch commit `cc5c74e1b` as documentation only. Its optional diagnostic code
was not copied. Closing S1 neither proves the GPU/Viz root cause nor waives a
release gate or the global stability thresholds.

- Base/native-capture HEAD: `98e2288795eae251af747940515cb9e219a72447`; a fresh
  `git fetch origin main` on this round still resolved `origin/main` to that SHA.
  Subsequent candidate commit/run identities are recorded below.
- Branch: `chore/20261111-pi-stab-1111-r1-stability-gates`.
- Worktree: central `fork-pi-desktop` root, directory
  `20261111-chore-pi-stab-1111-r1-stability-gates`. Integration target: `main`.
- The user confirmed the concrete [S2 ADR](../adr/release-candidate-nightly-gate.md)
  on 2026-11-11, authorizing implementation of the release-policy change (R4).
- The user confirmed S3's default A/B inventory on 2026-11-11.
- The user authorized this U1 round's isolated capture and necessary fixture
  corrections/revalidation: two runs of twelve scenes on one candidate, then
  `verify:ui:compare --assert-identical`. D6 remains applicable to later rounds.
- After reviewing the concrete delivery and readable screenshot details, the
  user replied "ok, continue" on 2026-11-11. This authorizes this request branch's
  commits/push and the S2 negative/clean manual candidate exercises with
  `sign_macos=false`, producing Actions candidate artifacts only. PR, merge,
  formal tags, release publication, real providers, paid APIs and the user's
  running application remain outside this authorization. No board/roadmap edits.
- Preserve the primary checkout's pre-existing `pnpm-lock.yaml` modification.
  Preserve the unmerged S1 diagnostic worktree and its unique code/evidence.
  Existing provisioned dependency symlinks are reused without installation.
- Preserve assertions, timeouts, catalog exclusions, test-quality baselines,
  signing and packaging bodies. No product UI redesign or new dependency.

## Scope and acceptance

S2 requires shared CI and every automated nightly family on the exact candidate
SHA before packaging. Missing, skipped, cancelled or failed evidence blocks
release. Scheduled failures must be visible in Actions. Recovery must retain
all original provenance/artifact protections while understanding the original
source-version gate contract. Acceptance needs a hosted negative exercise where
metadata and all old CI gates are green but one nightly-only suite fails and
build/aggregate/publication are skipped, followed by a clean passing candidate.

S3's one-page [charter](../spec/06-delivery/09-stability-charter.md) owns the
confirmed A/B inventory, freeze rules, four stability thresholds, four UI
thresholds and owner-approved feature exception traceability. Its matching
Chinese page and navigation are synchronized. This document package is 已验收;
it does not declare the seven-day/three-round program complete.

U1 freezes twelve audit scenes, deterministic fixture inputs and one comparison
command. Two independent same-source/same-environment runs must have zero
changed RGBA pixels. Each scene must actually render its production surface in
the viewport. The tool supplements Host/IPC and interaction E2E; it cannot prove
live product behavior. A build-only run does not satisfy native acceptance.

## Implementation and ownership

- Main agent owns this record, ADR, shared specs, U1 harness integration and
  native verification. The U1 renderer worker initially owned only
  `scripts/ui-capture/renderer.tsx` and `fixtures.ts`; that handoff is complete.
- S2 workflow worker owns the release/nightly/recovery workflows and
  `nightly-e2e-summary.mjs` with tests; work is complete and handed back.
- S2 recovery worker owns `recover-release-publication.mjs`, its tests,
  `release-gate-contract.mjs` and readable audited legacy fixtures/tests; work is
  complete and handed back.
- S2 runbook worker owns only both release-runbook locale pages; work is complete
  and handed back. Root integrates shared workflow/E2E docs and script guidance.
- An independent reviewer checks the actual combined changes. A researcher
  checks version-specific Electron/Chromium APIs read-only. No child may
  delegate further. Writers never concurrently own the same file.

S2 now calls reusable nightly from Release with `metadata.source_sha`. The
catalog validates full SHA identity and retains existing catalog validation;
all families run the existing nightly tier (smoke + nightly, only manual
excluded), with existing parallelism and fail-fast policy. Build depends on
both CI and nightly. An always-running summary inventories the exact current
run attempt's catalog/family jobs, writes their conclusions and SHA in Actions,
and fails closed with an error annotation. It sends no external message.

The `nightly-v1` recovery contract reads workflows and catalog from the original
run's immutable source SHA. It requires the original six gates plus catalog,
every actual nightly family leaf and summary; only publication may have failed.
Contents API metadata, base64 length, Git blob identity and UTF-8 are checked.
Legacy six-gate recovery accepts only the ADR's audited baseline release/CI
SHA-256 pair. Unknown contracts cannot silently fall back. Artifact identity,
digest, original run/attempt, manifest and publication protections remain.
Revalidation needs a complete workflow attempt, not mixed-attempt results.

U1 lives in `scripts/ui-capture/`: real components and capture-rig seeds, fixed
API-edge fixtures, scene manifest, isolated native shell, source/environment
receipts and exact-pixel comparer. `verify:ui:capture`, `verify:ui:compare` and
`test:ui-tools` now exist; AGENTS, script guidance and the E2E plan reference
real commands. The shell does not start production Main/Host/runtime, read a
user profile or call a provider. It uses sandbox/context isolation, fresh
HOME/XDG/app/Chromium directories, blocks non-fixture requests, and rejects
unexpected APIs, page errors, missing content and native failures. Each scene
has a fresh renderer/session. A Host-free identity opt-out leaves default E2E
Host fingerprinting intact. Product components/styles/Composer logic and the
documentation screenshot publisher are unchanged.

## Validation actually run

| Check | Actual result |
| --- | --- |
| `node --test scripts/release-*.test.mjs scripts/publish-release.test.mjs scripts/require-cloud-build.test.mjs scripts/refresh-macos-release-metadata.test.mjs` | PASS, 100; root rerun, isolated filesystem/Git and fake API boundaries; no remote writes or installers |
| `node --test scripts/ui-capture/capture.test.mjs scripts/e2e-suite.test.mjs` | PASS, 10; boundary isolation, subprocess failure, output/symlink and identity protection |
| Provisioned Pillow Python, `-B -m unittest discover -s scripts/ui-capture -p 'test_*.py'` | PASS, 11; real temporary PNGs, one-pixel/source/environment/incomplete-evidence rejection |
| `node scripts/ui-capture/typecheck.mjs` | PASS, 0 diagnostics; Desktop program plus fixture entries, no emit |
| Native capture probes and final independent pair | PASS after bounded corrections; `acceptance-a` and `acceptance-b` each captured 12/12 scenes |
| `verify:ui:compare --assert-identical`, provisioned `PI_UI_PYTHON` | PASS, same source/environment, 12/12 scenes with zero changed RGBA pixels; direct 1440x1000 DPR1 images |
| `node docs/scripts/check-docs.mjs` | PASS, 646 pages, existing non-failing ADR section notes |
| `node docs/scripts/check-locales.mjs` | PASS, 96 English/Chinese specification pairs |
| `node scripts/generate-scenario-index.mjs --check` | PASS, 138 suites / 167 executable IDs |
| Agent-policy check | PASS; workflow-spec byte budget retained |
| Test-quality/architecture/diff checks | PASS; committed candidate `003c220ee` was rechecked against `origin/main`, including all 10 added source files; unchanged baselines |
| Full VitePress build after the hosted dead-link repro | PASS, 29.74 s; output only in this worktree's `.artifacts/s2-release-gate/docs-build`; no dead-link exception added |
| `node --test apps/desktop/test/ci-workflow.test.mjs` after synchronizing the approved dependency contract | PASS, 15; both exact dependency assertions now require nightly as well as metadata and shared CI; quality inventory unchanged |
| Combined release-tool and Desktop workflow tests after restoring the exercise entry point | PASS, 115 tests, zero failures/skips; `.artifacts/s2-release-gate/clean-unit-tests.tap` |
| `pnpm test:ui-tools` and explicit `pnpm run test:ui-tools` | FAILED before the test process: pnpm 12 automatic installation rejects the provisioned symlinked hoist directory. No dependency replacement completed; direct Node entry-point evidence is above |

System Python lacks Pillow. The already provisioned interpreter is
`/Users/sakurasep/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`;
use `PI_UI_PYTHON` for comparison. No dependency was installed.

Native evidence is under `.artifacts/ui/` in this worktree, never in the primary
checkout or published docs. Electron is 43.6.0 / Chromium 150.0.7871.250; the
native host is macOS arm64. Failed probes never write a success manifest:

1. `probe-01`: failed during mount because real live-voice controls use their
   own API boundary. Added a disabled status and explicit subscription stubs;
   unexpected calls still throw. No live voice session was started.
2. `probe-02`: correctly rejected actual Retina DPR2 against the fixed DPR1
   contract. Renderer mounting succeeded; no API error was hidden.
3. `probe-03`: calling Electron emulation before a live RenderView caused
   SIGSEGV. Versioned native source exposes an unchecked RenderView dereference;
   retained the failed evidence rather than adding a GPU bypass.
4. `probe-04` and `probe-05`: timed out before harness scene execution. A
   one-second sample of this tool's own process in `probe-05/main-sample.txt`
   identifies AppKit's crash-restoration modal before `app.whenReady()`.
   A child-only volatile `-ApplePersistenceIgnoreState YES` argument avoids
   restoring existing native state; no persistent preferences were changed.
5. `probe-06`: the first scene rendered and produced a directly captured
   1440x1000 PNG. Closing that scene triggered Electron's default all-windows
   shutdown before scene two. The scene loop now explicitly owns application
   shutdown and cleans debugger/window resources without masking errors.
6. `probe-07`: PASS, all twelve scenes after the lifecycle correction.

Final capture commands, executed independently on one stable local candidate:

```bash
node scripts/ui-capture/capture.mjs --output .artifacts/ui/acceptance-a
node scripts/ui-capture/capture.mjs --output .artifacts/ui/acceptance-b
PI_UI_PYTHON=/Users/sakurasep/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 node scripts/ui-capture/compare.mjs --before .artifacts/ui/acceptance-a --after .artifacts/ui/acceptance-b --output .artifacts/ui/acceptance-comparison --assert-identical
```

`acceptance-comparison/report.json` records `sourceIdentical: true` and
`identical: true`. Each of 12 scenes has 0 changes / 1,440,000 RGBA pixels.
The HEAD/base are the SHA above; both dirty-source fingerprints are
`1bfa90cc6215ce628807b65e26c58b2658bfd8fb714f82d8074252aae12c0679`.
Both manifest SHA-256 values are
`e3a4d84e47c41127690daf7dbecff0c4d4afc8fd94919f9990e6ad5a53e98dac`.
Root inspected the contact sheet and the full production-surface images;
no blank or wrong-scene capture was accepted. Normal scrollable content and
existing title ellipses remain baseline behavior. The twelve comparison panels
are the review entry point. At the time this native result was recorded, only
this record and the linked-dependency invocation notes had changed afterward.
The subsequent hosted corrections and candidate SHAs are listed below. These
images remain evidence for the measured local snapshot, not a new-HEAD capture.

The user found the contact sheet too small to review. Existing original PNGs
were cropped without resizing into `acceptance-readable/` for Team, Goal and
Composer details, with source hashes and crop coordinates in `provenance.json`.
No new capture occurred. Explain that U1 repeats the same UI to validate the
tool; visual changes will be reviewed in the later UI packages.

The harness now uses Chromium debugger metrics and direct PNG screenshot
commands; Electron's `capturePage()` uses physical Retina scale in this version.
There is no resizing, masking, tolerance, screenshot retry or weaker dimension
assertion. Frame/asset synchronization and scene visibility checks remain.
Prior independent review defects (root placement, unsafe output ancestor,
unneeded Host reads, platform initialization and Goal-report fixture) remain
fixed. Independent final review found no new P1/P2 in S2 or the final CDP,
AppKit-argument and window-lifecycle corrections. Review did not substitute for
the root's actual native runs or pixel comparison.

## Remaining work and NOT RUN

- U1 local repeatability is verified and ready for user review. This proves
  renderer fixture evidence on this macOS environment, not Host integration,
  Linux capture behavior or cross-machine pixel identity.
- S2 hosted negative and clean candidate exercises: authorized but blocked by
  runner DNS; no valid negative or positive result is claimed. The temporary
  failure was removed and the script verified byte-for-byte against the original.
  All assertions, catalog classifications and old CI gates remain. Always specify fork repository
  `SakuraLoveSmile/PI-Desktop` in GitHub CLI calls; the CLI's default points to
  upstream and must not be used as fork evidence.
- Native sandbox-extension diagnostics and existing dependency `use client`
  bundle warnings are retained. Any actual native failure still fails capture.
- The pnpm script wrapper cannot be called successfully with this environment's
  shared hoist symlink; direct Node invocations of the same package-script code
  are documented and were used for actual acceptance. Do not install or replace
  the shared dependency environment to hide this limitation.
- Architecture's added-file accounting uses committed `base...HEAD`. After the
  authorized implementation commits, its gate passed against `origin/main`
  with 10 added source files included; no baseline or allowance changed.
- Real-provider benchmarks, product Host integration, installer/clean-machine
  validation, release publication and global seven-day/three-round acceptance:
  NOT RUN. Renderer-only evidence does not substitute for them.
- Authorized branch commits, pushes and manual candidate runs are recorded
  below. Keep this active worktree and its evidence; post-integration cleanup
  remains mandatory once authorized integration and checks complete.

## Hosted exercise progress

The authorized branch contains implementation commits `7633cb5b7` (S2),
`289fedc05` (S3) and `003c220ee` (U1), followed by the deliberate negative
entry-point commit `5dc45d109a8f0e2d7eeb2e09817bd9077e9d9ca4`.
The first manual candidate [43044445998](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43044445998)
failed before the intended negative test: its old JS CI build found two U1
documentation links outside VitePress's site root. Rust CI passed. This is a
defect introduced by this package, not an accepted negative-exercise result.
The main agent retained the log and requested cancellation of the invalid run
to avoid spending runners on the same build failure.

The English/Chinese E2E introductions now reference the repository instructions
as a literal file path, rather than an invalid site route. The full local
VitePress build passed with its original dead-link enforcement. The corrected
negative candidate must run as a new commit; no same-SHA rerun or retry is
counted as green evidence. Local run/job receipts and the failed build log are
retained in `.artifacts/s2-release-gate/`.

The second candidate [43045528219](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43045528219),
SHA `4296c714b49e9e068090818a18e2b5adb99e7d71`, passed the full cloud build,
typechecks, lint, policy/release/architecture/quality checks and Rust CI. Its
Desktop unit run reported 4,372 passes, two failures and 12 existing skips.
Both failures were exact `build.needs` assertions in
`apps/desktop/test/ci-workflow.test.mjs` that still expected only
`metadata, verify`. They were missed in the initial S2 synchronization; this is
another package-introduced validation defect. The main agent cancelled the
invalid run and retained its complete log. Neither invalid run is acceptance.

Both assertions now require the exact stronger approved contract
`metadata, verify, nightly`; no assertion was removed, loosened or skipped.
The file's 15 tests and the unchanged 237-file / 8,120-assertion quality ratchet
passed locally. Independent read-only review found no P1/P2 and verified that
remaining old-contract references belong to audited legacy fixtures or
deliberate rejection cases. A new source commit requires a fresh hosted
negative exercise before the clean candidate.

The latest candidate [43047754114](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43047754114),
SHA `cd7f6657109fc3840489e3fbd6f955b3d23c6a65`, passed metadata, catalog,
the complete shared JS CI job and the Rust CI job. Desktop reported 4,374
passes, zero failures and the same 12 existing skips. Its smoke and first three
nightly jobs never left Linux dependency provisioning. The downloaded Goal job
log repeatedly reports `Temporary failure resolving 'azure.archive.ubuntu.com'`
during both APT index and package acquisition. The main agent cancelled this
run after the repeated preparation stall; it finished `cancelled` on attempt 1.
Its always-running nightly summary failed on incomplete/cancelled coverage.
This is observable fail-closed behavior, not the required deliberate-suite
negative acceptance. No fixture result or candidate package was produced.

Under R8, the unexpected runner networking problem is recorded without changing
runner provisioning, DNS, dependencies, timeouts, retries or catalog coverage.
The run's identity/jobs and complete Goal/JS logs are retained under
`.artifacts/s2-release-gate/runner-dns-blocker/`. Public DNS resolution and the
GitHub status page were readable at the observation time; neither establishes
DNS health inside these runners. Do not attribute this blocker to the unresolved
S1 GPU defect: no E2E suite started.

The branch's following ordinary restoration commit removes the temporary
negative line. The restored script matches original Git blob
`5c3afeb8b4003d62edff857663a83ad0bab06fa3` and SHA-256
`a1b238783bdce626134e0446ffb08c19d108f01b9e9c39a8a8ad946c276babe7`.
The final local combination passed 115 release/workflow tests, syntax and
scenario checks. No history was rewritten and no intentionally failing entry
is left at the branch tip.

S2 remains 实现中. First restore the hosted fixture environment, then obtain
a new deliberate nightly-only failure with every old CI gate and other suite
green, followed by a clean full-nightly candidate whose cloud build/aggregation
succeed. Both accepted exercises, normal candidate packaging and formal
publication are NOT RUN. No further run was dispatched into the known blocker.
The clean restoration commit has not been cloud-validated. No PR, merge, tag or
release was created; both active unmerged worktrees and local evidence remain.
