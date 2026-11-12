# PI-STAB-1111-R1 — Release gates, stability charter and UI evidence

Date: 2026-11-11 (Asia/Taipei). Tier: T2 overall (S2); S3 T0; U1 T1.
Status: 实现中. S2: 实现中 (full negative accepted; clean candidate failed Provider shutdown). S3: 已验收.
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
- S2 hosted negative and clean candidate exercises: authorized; runner DNS is
  restored and the Provider fixture correction passed targeted hosted replay.
  The full negative is accepted as recorded below; the clean candidate failed
  Provider shutdown, so the global-timer attempt is not an accepted fix.
  Temporary Goal failures are removed between exercises.
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
- Real-provider benchmarks, clean-machine installer validation, formal release
  publication and global seven-day/three-round acceptance: NOT RUN.
  U1 renderer-only evidence does not substitute for Host integration; S2's
  isolated hosted Host/IPC fixture results are recorded separately below.
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

## Runner recovery

On 2026-11-11 the user asked how to restore the runner. The main agent verified
the exact image's official APT source configuration against the recorded image
version, and a read-only researcher independently checked mirror priority and
strict update failure semantics. The existing S2 ADR now contains a proposed
provisioning addendum: remove only the Azure mirror entry, preserve the two
existing official HTTPS entries and all trust/source fields, and make any APT
index error stop installation. It includes focused validation, one existing
offline-family environment check, then the original full S2 exercises.

The user explicitly confirmed this addendum and instructed the main agent to
restore the runner and continue S2. Original branch commits/push and candidate
CI authorization remain in force; no merge, tag, publication, live provider or
paid API is authorized. The recovery starts from
`b9128dc51af49380530bf78fec67185c76188316` in the same request worktree. The
worktree's creation date/name remains unchanged across the midnight continuation.

The main agent implemented `scripts/e2e/provision-linux.mjs` and wired the
existing provision step to it. The exact known three-line image list is
validated before mutation; only its Azure line is removed, retaining both
HTTPS lines byte-for-byte. A strict index update precedes the original package
and sandbox commands. The CLI refuses execution outside a hosted Linux runner;
its I/O and command boundaries are tested with disposable files and fake
privileged commands. CI runs the focused regression file alongside existing
release-tool checks. No dependency, DNS resolver, trust field, fixture timeout,
retry or suite classification changed. English/Chinese E2E expectations and
script guidance are synchronized.

Local validation: 6/6 focused provisioning tests and the combined 121 release,
workflow and provisioning tests passed with no failures/skips. Targeted Biome
lint, documentation (646 pages), locale pairs (96), scenario index and unchanged
quality ratchet passed. Independent read-only review found no P1/P2. This does
not prove real APT or hosted recovery; the voice environment check and full S2
negative/clean exercises remain NOT RUN until their actual results are added.

### Official-mirror environment result and diagnostic continuation

The recovery implementation was committed and pushed as
`7adb1301e9673b202a2cb69215f2e13ecf4f3d50`. The existing manual voice-family
environment check [43054850758](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43054850758)
finished `failure` on attempt 1, job `130641441749`. Its log confirms the Azure
entry was removed and APT read the remaining 93-byte HTTPS mirror list.
The Microsoft package source downloaded successfully, while all four Ubuntu
index requests ended with `Temporary failure resolving 'archive.ubuntu.com'`.
The strict update stopped provisioning before install, Host build or fixture
execution. No E2E result or candidate artifact was produced. Run/job identities
and the full log are retained in `.artifacts/s2-release-gate/recovery-voice/`.
The recovery is not verified and this is not S2 negative acceptance.

The accepted addendum's stop condition remains: do not override DNS, fix IPs,
bypass trust or start a full candidate in the known blocked environment. APT's
message alone does not establish failure of the system resolver. The next
evidence-only candidate adds five bounded read-only probes after an index
failure: `getent ahostsv4` for the two official hosts and the working Microsoft
control, plus TLS-verified HTTPS GETs of the two official index URLs with the
body discarded. No APT retry or configuration change occurs; the original error
is rethrown even when diagnostics succeed or fail. One new voice-family run
collects this additional evidence; it cannot convert an APT failure into success.

The diagnostic combination passed 123/123 release, workflow and provisioning
tests, zero failures/skips, and targeted Biome lint. Independent read-only review
found no new P1/P2 and verified the failure, privilege and bounded-probe behavior.
Local mocks do not prove hosted DNS, HTTPS or APT behavior. The new diagnostic
run and the complete S2 negative/clean candidates are NOT RUN at this point.
Documentation (646 pages), locale pairs (96), scenario catalog, agent policy,
architecture and the unchanged test-quality baseline passed for this diagnostic
combination. Remote main still resolves to the recorded base SHA.

### Hosted diagnosis result: upstream DNS blocker

On 2026-11-12 (Asia/Taipei), diagnostic source
`f43bfdb04539d2d40e6d45f8ddaa93ba2003139f` was committed, pushed and checked by
the manual voice run [43057417999](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43057417999).
Attempt 1 finished `failure`, job `130650495061`. Strict APT acquisition failed
as before; all five probes ran afterward, and the original APT error still
failed the job:

| Probe | Actual result |
| --- | --- |
| System resolver: `archive.ubuntu.com` | Exit 2; no address |
| System resolver: `security.ubuntu.com` | Exit 2; no address |
| System resolver: `packages.microsoft.com` | Exit 0; public addresses returned |
| Official archive HTTPS index | curl exit 28; resolution timed out after 10 seconds |
| Official security HTTPS index | curl exit 28; resolution timed out after 10 seconds |

The [Canonical official status feed](https://status.canonical.com/rss), retrieved
after the run, records `DNS - Major Outage` beginning at 2026-11-11 14:26 UTC
(feed publication 14:30:22 UTC). Same-period reports in the official runner-image
repository, [15296](https://github.com/actions/runner-images/issues/15296) and
[15297](https://github.com/actions/runner-images/issues/15297), describe Ubuntu
DNS failures across runner versions. These reports are corroborating evidence,
not a maintainer-confirmed diagnosis of this specific VM. Together with the
runner probes, the evidence supports an upstream DNS outage; it does not
establish a mirror-selector defect. The retrieved feed contains no recovery
evidence and cannot alone establish how long the incident lasts.

The actual installed dependency environment is still not restored. Installation,
Host build and fixture execution were skipped after the failed provision step:
NOT RUN. Full S2 negative/clean exercises and candidate packaging remain
NOT RUN; neither failed voice run satisfies them. No candidate artifact or
publication was produced. The recovery path is stopped under the accepted ADR;
do not rewrite sources, DNS, IPs or trust settings based on this evidence.
When new upstream recovery evidence is available, first validate the existing
voice environment on the intended source, then continue the original full S2
negative/clean exercises if it passes. No blind rerun was dispatched.

The run/job receipts, complete log, five diagnostic results and the fetched
official status XML are retained under
`.artifacts/s2-release-gate/recovery-diagnostics-voice/` (`evidence.json` links
their identities). Independent read-only research found no confirmed
mirror-specific defect; the APT mirror implementation redirects to the ordinary
HTTP/HTTPS connection path. Production code, test assertions, catalog, retries,
signature/TLS checks, signing and packaging remain unchanged by this diagnosis.
The original Goal-blocked fixture still matches its recorded Git blob and
SHA-256. Both hosted runs are terminal, with no further candidate in progress.

This continuation changes only runner failure observability and its documented
evidence. Local checks are listed above; hosted failure behavior was observed,
but fixture/release acceptance is blocked. No PR, merge, tag or release was
created. Preserve both unmerged request worktrees and their evidence until
integration or an explicitly authorized alternative disposition.

### Upstream recovery and current-main continuation

At 2026-11-12 12:08 Asia/Taipei, the main agent checked the official status feed
again. It now records `DNS - Operational` at 2026-11-11 17:19:50 UTC
(2026-11-12 01:19:50 Asia/Taipei). The runner-images issue
[15297](https://github.com/actions/runner-images/issues/15297) is closed with a
comment reporting mitigation. This is new upstream recovery evidence, not a
claim that the fixture VM has passed. The fetched official XML and recovery
receipt are retained in `.artifacts/s2-release-gate/upstream-recovered-voice/`.
The user asked for the next step; existing implementation, branch commit/push
and manual-candidate authorization continues to apply.

Remote main advanced to `9574c37017a68a5dddfd4e59b149780a7bbf67cd` while the
environment was blocked. The main agent fetched and merged it into this
dedicated request branch without rewriting history; all three overlapping files
merged automatically, with no conflict or manual product change. The new main
adds Goal MCP control, v0.15.17 and one scenario ID; no dependency change is
needed. Preserve its code, tests and updated catalog, as well as this request's
release-gate and UI-tool changes. The primary checkout's pre-existing lockfile
edit remains untouched.

The combined tree passed 123/123 release/workflow/provisioning tests with no
failures/skips, the unchanged quality baseline, policy and current scenario
index (138 suites / 168 executable IDs). Fresh hosted validation is still
required: first the existing voice environment check on the refreshed candidate,
then the original deliberate nightly-only failure and clean full-nightly
candidate. No DNS/source/trust override or additional recovery strategy was
introduced. The prior failed runs remain failures and are not reused as passing
acceptance.

Independent read-only review found no P1/P2 in the combined S2 contract. Its
actual catalog/contract evaluation retained 10 families, 133 automated suites
and 18 unique required gates; source/attempt propagation and the audited legacy
digests remain intact. The new MCP scenario is included in goals-team nightly.

### Hosted environment restored; deliberate negative candidate

The refreshed environment check [43153190763](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43153190763)
passed on source `b8782fce8f5822f14d934d84331e91d02c7d5d39`, attempt 1,
job `130966983028`. Provisioning, dependency installation, the candidate Host /
Desktop build, sidecar and voice fixture all succeeded. Artifact `13914916006`
(`e2e-nightly-voice`) was downloaded and its report independently checked:
1/1 suite passed, `candidateUnchanged=true`, the exact source SHA and base main
`9574c37017a68a5dddfd4e59b149780a7bbf67cd` matched, with no timeout or unexpected
skip. Receipts, complete log and artifact remain in the recovered-voice evidence
directory. This establishes the hosted environment prerequisite, not the full
S2 positive or negative acceptance.

The next ordinary branch commit introduces the approved deliberate failure only
in the nightly-only `goal-blocked-ui` entry point, immediately after its imports
and before temporary resources or Electron are created. Its catalog remains
unchanged. The manual Release candidate must retain successful metadata and all
old CI jobs, fail only the intended nightly suite/family, then block the nightly
summary: the always-running summary must fail, while build and aggregation are
skipped. Manual publication is skipped in both exercise
lanes and cannot itself prove the gate. After this run, remove the deliberate
line with an ordinary commit and verify the script against its original blob
and SHA-256 before running the clean candidate. No retry, catalog exclusion,
assertion reduction or test-quality baseline change is permitted.

### Negative exercise blocked by Provider fixture shutdown

The deliberate candidate [43153816675](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43153816675),
source `756f7d6331a15431854b9eae26e7d6d5fc46b389`, attempt 1, passed metadata,
catalog, the complete shared JS and Rust CI jobs, and the old smoke E2E.
Composer, transcript and extensions nightly families passed. The intended
`goal-blocked-ui` error was observed in the goals-team log at entry line 13.
However, settings-storage also failed, making this an invalid negative exercise.

Job `130970570757` and artifact `13916000485`
(`e2e-nightly-settings-storage`) establish 13/14 suites passed and only
`provider-order` failed. The downloaded report matches the exact source and
base-main SHA, with `candidateUnchanged=true`, no skips or exclusions. The failed
suite returned code 1 after 60,900 ms; outer `timedOut=false`. Its inner Electron
process reached the existing 60-second watchdog and was killed with SIGKILL:

- `interactions-complete`: 897 ms.
- `performance-complete`: 910 ms; all 200-card performance metrics were reported.
- Last phase: `host-stop-start`: 910 ms, no pending RPC methods.
- No `host-stopped` or final probe result before the watchdog; the missing-result
  assertion failed at `scripts/e2e-provider-order.mjs:170`.

The main agent requested cancellation after retaining this unexpected failure.
The run finished `cancelled` on attempt 1; goals-team, runtime-provider and
sessions were cancelled, and later families did not start. The always-running
summary correctly failed on the incomplete/failed family inventory. The build,
aggregate and publication placeholders are `cancelled` with zero steps, not
successful or accepted skipped-gate evidence. Packaging/publication are NOT RUN.
This cancelled run is neither the required single-failure negative acceptance
nor a clean candidate. The clean full-nightly candidate remains NOT RUN.

Complete settings, goals-team, summary, JS, metadata and catalog logs, exact
run/job/artifact identities and the downloaded settings report are retained in
`.artifacts/s2-release-gate/recovered-negative/`; `evidence.json` marks the
exercise unaccepted. No new run was dispatched into this blocker.

An independent read-only analyst confirmed the stop call belongs to the fixture
`Host` in `scripts/e2e/host.mjs`, not production `HostProcess.stop()`. Its two
existing three-second waits should terminate or fail under normal event-loop
scheduling; they do not alone explain the 60-second silence. A stalled Electron
loop, process-exit delivery or reader cleanup remains unproven. DBus and bundle
warnings also appear in passing suites and are not established causes. Product
sorting, model persistence, data loss and the unresolved S1 GPU root cause cannot
be inferred from this failure.

Both fixture files match `origin/main` and the old `98e228879` baseline. The
historical commit `1ea5168665799da5f7c3941ca65712002265acc1` (2026-10-24) already
records a Linux run completing interactions/performance but reaching the
watchdog before a restart result. This is a recurring symptom, not proof of an
identical root cause or a defect introduced by the S2 changes.

The temporary Goal failure is removed in an ordinary restoration commit. The
script again matches original Git blob `5c3afeb8b4003d62edff857663a83ad0bab06fa3`
and SHA-256 `a1b238783bdce626134e0446ffb08c19d108f01b9e9c39a8a8ad946c276babe7`.
No assertion, timeout, retry, catalog classification, baseline or product code
was changed to address the Provider failure. The restored executable tree is
the locally validated refreshed candidate; no passing hosted result is claimed
for the restoration commit.

Under the user's R8 (record out-of-plan findings; do not fix them incidentally),
Provider work is recorded only. The proposed next package, not yet authorized,
is bounded fixture diagnosis in `scripts/e2e-provider-order.mjs` and
`scripts/e2e/host.mjs`: record kill/exit/close, the existing wait boundaries and
reader shutdown, keeping the existing watchdog and all assertions, then use one
isolated settings-storage run to distinguish the failure paths. A minimal
fixture fix may follow only after its root cause is supported and scope is
authorized; product-code changes require a separate briefing. No implementation
of that proposal, new Electron launch or further CI run occurred.

Restoration checks passed: Node syntax, scenario catalog, the unchanged quality
baseline, 647 documentation pages, 96 locale pairs and diff whitespace. Source
comparison confirms all tracked content outside this task record is identical
to refreshed candidate `b8782fce8f5822f14d934d84331e91d02c7d5d39`. Its 123 local
tests are documented above; the failed hosted result is retained separately.

### Authorized Provider fixture diagnosis

On the following continuation the user explicitly authorized the recorded
fixture diagnosis and minimum fixture fix. This is the requested R8 scope
extension, limited to `scripts/e2e-provider-order.mjs` and
`scripts/e2e/host.mjs`, relevant verification and this shared task record.
Product-code changes still require a briefing first. Existing branch
commit/push and isolated hosted validation authorization remains in force;
there is no new PR, merge, tag, release, paid-provider or running-app permission.
This fixture package is T1 within the overall T2 request.

The implementation worker exclusively owns the two fixture files. The main
agent owns documentation, integration, checks and pinned hosted runs. A
read-only analyst checks lifecycle hypotheses independently, and a read-only
reviewer verifies the actual diagnostic diff before hosted validation. No
concurrent writers share a file.

First add evidence without changing the stop policy: optional fixture lifecycle
reporting around the existing signals, exit waits, child exit/close/error and
reader cleanup, routed through the Provider probe's existing stage format.
The outer Linux probe may observe only its owned Electron/Host PIDs with a
bounded asynchronous process-status query before the unchanged watchdog.
Do not collect full command lines, environments, credentials or user processes.
Preserve the existing 60-second Electron watchdog, two three-second cleanup
waits, all assertions, catalog coverage, retries and quality baseline.

Run the existing settings-storage family once on a new pinned diagnostic SHA
containing current main. Use the observed stop phases to support or reject
specific causes; an unreproduced failure is not proof of a fix. Apply only a
confirmed fixture correction, then revalidate the affected behavior before
resuming S2's full negative and clean candidates. Any required product change
returns to the user with evidence instead of expanding this package silently.

The read-only lifecycle check found no hidden EOF/drain wait in the NDJSON
reader: its close method synchronously clears buffers and its own listeners.
The fixture waits for child `exit`, not `close`, so an inherited stdout pipe
alone cannot establish this failure's cause. Version-specific research also
found that Electron 43.6.0 does not wrap the promises timer in its JavaScript
`activateUvLoop` adapter, but its native libuv timer-start interrupt mechanism
is enabled. That difference alone does not justify replacing timers or changing
the stop policy. Actual stage/event evidence remains the next discriminator.

Initial local checks passed: six isolated runner/scenario tests, both fixture
source syntax checks, the evaluated generated Electron-main template's syntax,
targeted Host-helper Biome lint, the unchanged quality baseline and scenario
catalog. These checks did not start Electron, the Rust Host or a real provider;
hosted lifecycle evidence is still NOT RUN for the new diagnostic source.

Final diagnostic review found no remaining P1/P2. The process observer now
excludes exited Electron/Host PIDs, terminates its in-flight child on fixture
close and suppresses late callbacks. The main agent independently evaluated the
actual parent-observer body against injected process/timer boundaries: exited
Host exclusion, owned PID selection, in-flight cleanup, late callback suppression,
exited Electron exclusion and visible diagnostic errors all passed without
starting a process. The original watchdog, wait budgets and outcome assertions
remain unchanged. These are observability and ownership checks, not a claimed
Provider shutdown fix or a substitute for the hosted family run.

### Provider diagnostic result and resumed S2 exercise

Diagnostic source `023b9bbb28a5dcef2081c078669ba938a8adc680` was committed,
pushed and validated by [43158438407](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43158438407),
attempt 1, job `130983738890`. Settings-storage passed 14/14 suites. Artifact
`13917386326` was downloaded and independently checked against that exact SHA
and current base main `9574c37017a68a5dddfd4e59b149780a7bbf67cd`:
`candidateUnchanged=true`, all suites passed, no unexpected skips or timeouts.
The complete log, report and identities remain in
`.artifacts/s2-release-gate/provider-shutdown-diagnostics/`.

The Provider trace completed the old missing path: stop began at 913 ms,
SIGTERM returned at 914 ms, child exit/close and reader cleanup completed at
917 ms, and the outer `host-stopped` followed at 918 ms. The new Host was ready
at 931 ms, renderer reload completed and the persistence probe reported
`restart=true`. Final cleanup also completed. The 55-second observer and
60-second watchdog did not trigger; their failure-only path remains covered by
isolated boundary verification, not actual ps execution in this successful run.

The old hang was not reproduced, and no underlying cause or root-cause fix is
claimed. Only the reviewed lifecycle diagnostics have been added; no speculative
timer, signal or product change was made. Retain that uncertainty as a stability
risk while continuing the original S2 acceptance on current code. This full
family pass satisfies the immediate prerequisite, not the complete release gate.

The following ordinary exercise commit again adds only the approved temporary
nightly-only Goal failure. Require all original CI gates and every other
automated suite to succeed, the intended nightly failure and summary to fail,
and build/aggregation to remain unstarted. Remove the temporary line with an
ordinary byte-verified restoration commit before the clean full candidate.
No test retry, exclusion, weakened assertion or baseline change is introduced.

### Diagnostic negative: shutdown failure reproduced

The full negative candidate [43159433831](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43159433831),
source `fbdca8c1e2bd7d5faf43ae4cea3d5088a5e7510c`, attempt 1, reproduced
`provider-order` in settings-storage job `130988535484`. The run is allowed to
complete its full family inventory; this extra failure already prevents its
acceptance as the required single-failure negative exercise. All original JS,
Rust and smoke CI gates passed. Final family and gate conclusions follow below.

Settings artifact `13917508201`, digest
`sha256:66d574300e47f126497c958da77f19b8277e74504c029b1b3f2710a9a3491466`,
was downloaded and checked: exact source/base main, `candidateUnchanged=true`,
13/14 passed, only `provider-order` failed in 60,881 ms, outer `timedOut=false`,
no unexpected skips. Its unchanged internal 60-second watchdog sent SIGKILL.

New lifecycle evidence reaches `host-signal-end` at 911 ms (`SIGTERM` sent),
then `host-exit-wait-start` with the original 3,000 ms budget. No child exit or
wait-end event follows. At 55,030 ms the parent observer reports Electron PID
5753 as `Sl / poll_s`, and Host PID 5789 as `Z` (zombie). The Host has exited
but its Electron parent has not reaped it; this excludes a Host refusing SIGTERM
and an already-entered reader-close wait. It does not by itself identify every
Electron/Node scheduling race. Full logs, report and run identities remain in
`.artifacts/s2-release-gate/provider-diagnostic-negative/`.

Independent version-specific source review supports a bounded fixture hypothesis:
Electron 43.6.0 wraps callback/global timers with `activateUvLoop`, which also
registers a Node callback scope; Node 24.20.0 promises timers insert internal
timeouts directly. Native timer-start interrupts are conditional and are not
equivalent to that callback scope. The next isolated differential retains the
promises timer and explicitly activates the loop before fixture stop, solely as
a temporary diagnostic. A supported correction would use Electron's normal
global callback timer for the same waits, without private APIs, extra heartbeat,
retry, longer timeout or assertion change. Root-cause validation is pending;
no product code is changed.

Before that diagnostic, the temporary Goal failure is removed by an ordinary
commit and checked against original blob
`5c3afeb8b4003d62edff857663a83ad0bab06fa3` and SHA-256
`a1b238783bdce626134e0446ffb08c19d108f01b9e9c39a8a8ad946c276babe7`.
The original candidate continues against its immutable source SHA.

The following temporary differential candidate changes only the two Provider
fixture stop call sites to activate the embedded Node loop immediately before
the unchanged `Host.stop()`. It records Electron/Node versions, retains promises
timers and both 3,000 ms budgets, and runs the existing isolated settings-storage
family on hosted Linux. This private Electron call is diagnostic-only and must
be removed before the supported callback-timer candidate or any final delivery.
The full negative run remains pinned to its original source; the differential
does not repair or replace its failed evidence.

The explicit-wake diagnostic source is
`a139ad28d5609cf8ace0592ca5f10af7633892a6`, hosted run
[43161654134](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43161654134),
attempt 1. It passed the existing settings-storage family 14/14, job
`130994052787`, artifact `13918506609`, digest
`sha256:a149a3aa30df4ab3d31a7fabffa98cc1e439a74ab2f7d0de1fc7c0ba5d63a261`.
The supported candidate removes that private call and wrapper entirely.
`Host` instead builds its existing delay Promise with a dynamically resolved
`globalThis.setTimeout`, allowing Electron's normal embedder wrapper to run.
SIGTERM/SIGKILL, two 3,000 ms waits, the 60-second parent watchdog, assertions,
sorting, persistence and product code are unchanged. Provider stages retain
runtime version metadata so the actual hosted binary can be identified.

Two behavior regressions in `scripts/test/host-fixture.test.mjs` control only
the embedded global timer and external child boundary. They verify normal exit
without SIGKILL, both exact timeout budgets, TERM then KILL on missing exit,
reader cleanup and the existing visible failure if the child still has not
exited. Both fail against the original promises-timer helper at the timer
boundary and pass after the candidate correction. The before/after TAP records
are in `.artifacts/s2-release-gate/provider-timer-differential/`; the before TAP
uses the test's initial filename. Its first invocation failed on absent shared
build output, not the intended baseline; that log is retained separately.
Only this worktree's shared package was then compiled with the provisioned
TypeScript executable, with no installation, Electron or Host launch.

The new test was moved into the existing CI `scripts/test/*.test.mjs` glob;
an independent review identified the initial root-level placement as a P2
coverage gap. No workflow, suite catalog, retry, baseline or assertion was
altered to accommodate it. The final existing CI script-runner group passed
27/27, including both new regressions. Source/generated-template syntax,
targeted lint, unchanged quality baseline, current scenario index, 647 docs,
96 locale pairs and whitespace checks passed. Independent final review closed
the test-discovery issue and found no remaining P1/P2. The actual supported
callback-timer hosted replay is still required before acceptance.

The completed diagnostic negative has all ten family reports and 131/133 suites
passed: exactly `goal-blocked-ui` and `provider-order` failed. All reports match
the immutable source and base main, `candidateUnchanged=true`; there are no
outer timeouts or unexpected skips. Existing catalog-declared live/environment
exclusions are unchanged and are not counted as their own acceptance evidence.
Eight families passed, goals-team and settings-storage failed, and always-summary
job `130995907959` failed. Build `130995985085`, aggregate `130995985958` and
manual publication `130995985786` are genuinely skipped with zero steps.
The gate blocked build, but this remains an unaccepted negative exercise because
the extra Provider failure was not intentional. All ten downloaded reports,
artifact digests, job identities and the independent inventory audit are retained
in its `evidence.json`.

The explicit-wake differential independently matches its exact source/base and
has no timeout, exclusion or skip. Runtime metadata confirms Electron 43.6.0
and Node 24.20.0. Stop began at 848 ms; child exit, wait-end, reader cleanup and
`host-stopped` completed at 854 ms; the new Host was ready at 867 ms, renderer
reload at 918 ms, and the final probe reported restart/persistence true. Together
with the zombie failure and versioned source, this supports the fixture wake
mechanism. A single differential pass is not proof that every scheduling race
is gone; retain the full candidate gates and the normal supported-timer replay.

The reviewed version-specific sources are
[Electron timer wrapping](https://github.com/electron/electron/blob/v43.6.0/lib/common/init.ts#L47-L60),
[Node callback-scope activation](https://github.com/electron/electron/blob/v43.6.0/shell/common/api/electron_bindings.cc#L92-L112),
[promise timer insertion](https://github.com/nodejs/node/blob/v24.20.0/lib/timers/promises.js#L53-L81)
and [conditional native timer scheduling](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/timers.js#L432-L443).

A fresh `git fetch origin main` still resolves to
`9574c37017a68a5dddfd4e59b149780a7bbf67cd`, already an ancestor. Commit and push
the supported timer correction, then use one fixed-SHA settings-storage replay
before resuming S2's complete deliberate-negative and normal candidates. No
temporary private Electron call or deliberate Goal failure remains in this
supported source. No merge, tag, publication or running-app operation occurred.

### Supported fixture correction passed; full exercise resumed

Supported source `f2061ea2df148d4e23d050034c90d2644879471b` passed
[43162752158](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43162752158),
attempt 1, settings-storage job `130997525504`, 14/14 suites. Artifact
`13918503639`, digest
`sha256:a895cd9d2b7024da649b167447148ab5c2b6bec72c78ac4d1a622eecdbe77c4a`,
was downloaded and independently checked: exact source/base main,
`candidateUnchanged=true`, no timeout, exclusion or skip. All receipts and the
complete fixture log are in `.artifacts/s2-release-gate/provider-global-timer/`.

Actual versions remain Electron 43.6.0 / Node 24.20.0. Stop began at 969 ms;
SIGTERM returned at 970 ms; exit, original wait completion, reader cleanup and
`host-stopped` completed at 974 ms. The new Host was ready at 992 ms, renderer
reload at 1,059 ms, and every sorting/model/persistence probe passed with
`restart=true`. Final Host cleanup also completed at 1,078 ms. No 55-second
observer or 60-second watchdog fired. No private activation call remains.

The observed failure, isolated activation differential and supported timer
replay support the fixture-only correction. This does not claim to fix every
Electron scheduling race or the unresolved S1 GPU root cause. The existing full
nightly release gate stays mandatory. Main-agent architecture checks also passed
on the committed source, including all 13 added TS/TSX files; the primary
checkout still has only its original 25-line lockfile deletion.

Resume the authorized complete negative candidate by adding only the same
nightly-only Goal entry throw, before resource creation. Preserve all catalogs,
assertions, waits and retries. Require metadata, old CI and every other automated
suite to pass, with the intended family and summary failed and build/aggregate
skipped. Save all ten reports before restoring the exact original Goal bytes
with an ordinary commit. Only then dispatch the clean full candidate.

### Complete negative gate accepted

The full negative [43163796274](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43163796274)
completed as `failure` on source `cd5f8e4f2eef4bb0d2ccd00fa29090cf2775d3f9`,
attempt 1, base main `9574c37017a68a5dddfd4e59b149780a7bbf67cd`.
All ten family reports were downloaded and independently audited against that
source's exact catalog: 132/133 automatic suites passed, only the deliberate
`goal-blocked-ui` failed. Every report has the expected head/base and
`candidateUnchanged=true`, no outer timeout or unexpected skip. Existing
catalog-declared manual/live/environment exclusions remain unchanged.

Metadata `131000843352`, JS `131000922046`, Rust `131000921993`, original smoke
`131000922253` and catalog `131000922055` all passed. The new graceful-exit and
escalation-budget regressions were confirmed in the actual JS CI log, not only
the local command. Nine nightly families passed, including settings-storage.
Goals-team `131000979365` has 35/36 passed and exactly the approved entry-error
marker. Always-summary `131009624641` failed specifically on that family.
Build `131009688287`, aggregate `131009688651` and manual publication
`131009689497` are skipped with zero steps. Publication is skipped by manual
policy in either lane; build and aggregation prove the blocking behavior.

The independent audit checks all nineteen exact job names/conclusions (eighteen
gates plus manual publication), complete suite coverage and original run/attempt
identity. Artifact IDs/digests, report hashes, job inventory, JS and Goal logs
and the real summary error are retained in
`.artifacts/s2-release-gate/global-timer-negative/`, especially
`release-gate-evidence.json`. This is the required accepted negative exercise;
the earlier extra-failure/cancelled runs remain unaccepted historical evidence.

The following ordinary restoration removes only the temporary Goal throw and
updates this record. The script is checked against original Git blob
`5c3afeb8b4003d62edff857663a83ad0bab06fa3` and SHA-256
`a1b238783bdce626134e0446ffb08c19d108f01b9e9c39a8a8ad946c276babe7`;
all executable content then matches supported source `f2061ea2d`.
The fresh main fetch is still `9574c3701` and already an ancestor. Dispatch the
normal full candidate on the restored SHA with `sign_macos=false`, requiring
all old CI, ten nightly families, summary, native macOS arm64 build and bundle
aggregation to pass. No tag, GitHub Release, updater publication or running-app
operation is authorized by this candidate exercise.

### Clean candidate disproved the timer-only correction

Restoration source `5687f0de619ae5720ac0d881c892978840562a52` was pushed and
dispatched as normal candidate
[43166962228](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43166962228),
attempt 1. Metadata and every original CI gate passed. The full Goal family,
including the restored real `goal-blocked-ui`, also passed. The full run is
retained to finish its remaining families; it is already ineligible as a clean
acceptance because settings-storage job `131012413215` failed.

The downloaded settings report independently matches the exact SHA and base
main, with `candidateUnchanged=true`, 13/14 passed, only `provider-order` failed
in 61,033 ms, no outer timeout or unexpected skip. At 963 ms SIGTERM returned
true, followed by the original 3,000 ms wait-start. At 55,016 ms the parent
observed Electron PID 5924 as `Sl / poll_s` and Host PID 5959 as `Z`; the original
60-second watchdog then killed Electron. The trace contains no child-exit or
wait-end event. Full logs and the report are in
`.artifacts/s2-release-gate/global-timer-positive/`.

This counterexample disproves the sufficiency of the global-timer change. Its
prior targeted and complete-negative passes remain real results, but they do
not establish a root-cause fix. The timer replacement remains an unaccepted
attempt during diagnosis, not a delivered solution. No new candidate is blindly
retriggered on the same code. The accepted negative still demonstrates the
release gate; positive acceptance and packaging remain unsatisfied.

Independent source review does not support assuming an ordinary dynamic ESM
import creates a separate global realm. Under the existing user-authorized
two-fixture scope, add non-scheduling identity checks between the CJS main and
ESM helper, and record the actual existing timer's construction, registration,
callback, resolution and race continuation. Compare only reference booleans and
safe timer metadata; never serialize globals or function bodies. Expand the
existing 55-second owned-process observation to thread state/wchan, retaining
its two-second command bound and a bounded output buffer. Preserve both three-
second deadlines, sixty-second watchdog, signals, assertions and catalog.
No extra heartbeat, retry, polling loop, private-API fix or product change.

The fixture worker exclusively owns the same two source files, root owns this
record, tests and pinned CI evidence, and independent analysis/review remains
read-only. Evidence must precede another correction. A product or frozen-boundary
change still returns to the user before implementation.

The complete normal run finished `failure`, with all ten reports retained and
independently checked: 132/133 passed, exactly `provider-order` failed, all nine
other families passed, no outer timeout or unexpected skip. Metadata, original
CI and catalog passed. Summary `131020320146` failed on settings-storage;
build `131020386798`, aggregate `131020386503` and manual publication
`131020387718` are skipped with zero steps. Installer packaging is NOT RUN.
`blocked-candidate-evidence.json` explicitly records `candidateAccepted=false`;
this normal failure is not counted as the planned negative or a green candidate.

The next diagnostic source passes CJS reference snapshots through one optional
internal fixture argument. The helper emits only reference-equality booleans,
function names, Timeout counts and `hasRef()` metadata. It adds synchronous
before/after construction, registration, original callback and resolve-return
stages around the same existing Promise and timer. An `after-resolve` stage
only means the resolver returned; `exit-wait-end` is required to show the race
and await resumed. No additional Promise, timer, scheduler, heartbeat or retry
was introduced. `ps -L` observes only the same owned live PIDs at 55 seconds;
the command still has a two-second limit, with 16 KiB bounded output to fit
thread rows. Observer cancellation and late-result suppression are unchanged.

The root's final existing CI script-runner group passed 28/28. The added test
uses a controlled timer replacement to prove the identity snapshot detects an
actual change and the trace remains JSON-serializable without an injected
synthetic private marker. It starts no process. The two existing graceful-exit
and escalation/deadline regressions remain unchanged. Source/generated-template
syntax, targeted Host-helper lint, unchanged quality baseline, current scenario
index, 647 docs, 96 locale pairs and whitespace checks passed. Independent
review found no P1/P2 in the implementation or additional regression.
Actual diagnostic Electron/Host/ps execution on this new source is NOT RUN
until the following pinned hosted settings-storage check. There is no product,
IPC/RPC, database, dependency, packaging or signing change.

### Timer-phase observations and production shutdown control

Diagnostic source `f3a36b6aee027aface0f4f5b567c257d9598b146` ran twice:
[43170818827](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43170818827)
and [43172091820](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43172091820),
each attempt 1. Both settings-storage reports independently match that source,
base `9574c37017a68a5dddfd4e59b149780a7bbf67cd`, the exact immutable catalog and
an unchanged clean candidate. Both passed 14/14 with no outer timeout or
unexpected skip. Evidence, full logs, artifact identities/digests and report
hashes are in `.artifacts/s2-release-gate/provider-timer-phases/` and
`provider-timer-phases-replay/`.

Both use Electron 43.6.0 / Node 24.20.0. All CJS/ESM global, Promise and callback
timer reference comparisons were true. Each existing deadline registered a
referenced Timeout. Actual child exit won the first race in 4 ms (838 ms and
876 ms respectively); neither run exercised the three-second callback or
55-second process observation. These are unreproduced diagnostic passes, not
evidence that the earlier shutdown defect is fixed. No further identical-code
replay is scheduled merely to obtain green results.

Under the authorized fixture investigation, the next temporary control uses
the real `HostProcess` public API in the same CJS-to-ESM and renderer-Promise
context. Only the Provider fixture changes: bundle its production transport,
use `handshake`, `call`, `onExit` and `dispose`, and preserve all original UI,
200-card, reload, persistence and outer-watchdog assertions. A clean intentional
`onExit` is required; `dispose` returning alone cannot count as process exit.
No private product fields, production source changes, new timer, callback
boundary, retry or polling loop. The existing bounded 55-second OS observation
may inspect only Electron and its direct children.

This control deliberately exercises the production EOF / eight-second grace /
one-second force-kill path. It does not replace or validate the original fixture's
SIGTERM / three-second / three-second contract. It is diagnostic only, must not
land as a stealth deadline change, and cannot satisfy the original positive S2
candidate acceptance. A production-path failure requires a product-risk report
before implementation. The fixture worker owns only the Provider script; root
owns this record, combined checks and the pinned hosted control. Root will
review the actual diff before committing this temporary experiment.

The implemented control retains each generation's exit record and stop Promise,
requires the previous generation's successful exit before replacement, and
asserts a distinct public generation after restart. Finally reuses the same
stop Promise, preserves failures and emits every generation's result before
exiting. Root built the transport bundle without constructing a Host; bundle,
outer script and generated CJS syntax passed. All three existing Host-helper
tests passed, as did the unchanged test-quality inventory, current scenario
index, 647 documentation pages and whitespace checks. These local checks do not
prove runtime shutdown; hosted execution of this control remains NOT RUN until
the following pinned run.
Independent read-only review of the final diff found no P1/P2. Only the
Provider fixture and this record change; the original Host helper and all
product, workflow, catalog, assertion-budget and test-baseline files remain at
their prior source. The fetched `origin/main` is still the recorded ancestor.
