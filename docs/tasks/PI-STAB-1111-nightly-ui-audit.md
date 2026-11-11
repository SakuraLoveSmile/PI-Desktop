# PI-STAB-1111 — Nightly fixture diagnosis and UI baseline audit

Date: 2026-11-11 (Asia/Taipei). Tier: T1. Status: 实现中.

## Current scope and authorization

Continue S1 from landed `main` at
`98e2288795eae251af747940515cb9e219a72447`. The user authorized closing the
investigation with at most two Linux CI experiments, each testing a distinct,
evidence-based hypothesis. Retain all failures. If neither experiment can
reproduce or classify the original GPU/Viz failure, stop speculative attempts
and report S1 unresolved. A green diagnosis is not a root-cause repair.

- Branch: `fix/20261111-pi-stab-1111-capture-closure`.
- Worktree: central `fork-pi-desktop` root, directory
  `20261111-fix-pi-stab-1111-capture-closure`.
- Integration target: `main`. The authorized S1 branch may be committed,
  published and used for manual diagnostic CI. A new merge or release still
  requires the user's explicit instruction on a reviewable result.
- Preserve every assertion, timeout and test-quality budget. Product-code
  findings require a briefing before implementation. No changes to frozen
  boundaries, workflows, release policy, boards or roadmaps.
- Real providers, paid models and the running user application are not test
  targets. S2–S7 and U1–U6 remain outside this package. Preserve the primary
  checkout's pre-existing `pnpm-lock.yaml` modification.

## Historical evidence and delivered package

- Historical run `42924146284`: goals-team 35/36; `goal-blocked-ui` failed with
  GPU exit 133 and `UnknownVizError`. Nine interaction groups precede capture,
  but the old log cannot distinguish wide from narrow capture failure. No
  fatal stack or OOM evidence identifies the native cause. A green run and the
  first red run used the same source revision and runner image; the Goal
  runner/renderer scoped diff from that revision to the original baseline
  `6c57182920d18b163ee8b6dcc4fdcc0de0ee8471` is empty.
- Dedicated baseline run `42976431136`: goals-team 35/36. Goal passed;
  `expert-team-settings` failed waiting for Subagents. An isolated local repro
  identified the detached navigation rail at 560px in the light-theme fixture:
  the cached target was detached and the current directory remained closed.
- PR [#87](https://github.com/SakuraLoveSmile/PI-Desktop/pull/87), landed as
  `98e2288795eae251af747940515cb9e219a72447`, repaired that fixture race using the
  real compact-directory entry and added capture-failure stage/probe evidence.
  Assertions and limits were preserved. Local Goal/settings fixtures and an
  injected capture rejection passed their respective acceptance checks.
- Candidate `0f8d2c9948cc5cd181e492bcaf40e303d99af691` passed complete
  goals-team/nightly runs [42985037823](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42985037823)
  and [42986729654](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42986729654),
  both 36/36. PR integration gates passed. The candidate, synthetic merge and
  landed commit share tree `900f6b1c1ff5fbf310fa6f9217c801f989c9a282`.
  Post-merge CI [43004768761](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43004768761)
  and docs [43004768597](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43004768597)
  passed; landed smoke was 5/5 without skips, with a clean, unchanged candidate.
- Those green runs did not reproduce the original GPU failure. Earlier
  `disabled_software` snapshots did not establish that `gpu-info-update` had
  occurred, so they are not conclusive evidence of the active rendering backend.
  Fixed-version Electron/Chromium source defines `UnknownVizError` as a generic
  Viz copy failure, not proof that the first frame was missing.
- The previous worktree and local branch were safely removed after verified
  evidence archival. The old remote branch remains. Verified evidence archive:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/.archives/20261111-pi-stab-1111-nightly-ui-audit`.
  Its manifest covers 236 files; the bundle preserves the candidate and merge
  ref, and `followup/` retains post-merge validation and cleanup records.

## U0 read-only audit (delivered)

All 12 requested screen categories were inspected with isolated fixture images.
Three P2 findings remain recorded only: inconsistent run-state presentation,
ambiguous model/off wording, and file errors without cause or recovery guidance.
The archived `snapshot/.artifacts/pi-stab-1111/u0-audit-evidence.json` identifies
images and limitations. No UI change was made.

The initial capture attempted public model discovery twice with a fake key;
both failed. This violated R6 and was reported and stopped. No user credentials
or inference calls were observed. Later capture used loopback fixtures. A local
Team suite failure waiting for editable Composer was recorded without repair;
its screenshots do not establish a passing suite.

## Current diagnostic package and ownership

1. Main agent: Goal runner, catalog diagnostic argument, task record and relevant
   E2E specification. Keep all nine interaction groups, original two captures,
   capture order, the 60-second native child limit and 480-second suite limit.
2. Worker: `scripts/e2e/capture-diagnosis.mjs` and
   `scripts/test/capture-diagnosis.test.mjs`. Run six independent cold profiles;
   retain all output and exits, atomically publish progress, clean temporary
   profiles, and fail the diagnosis if any trial fails. Children remain in the
   isolated suite's process group. Evidence declares `purpose: diagnosis` and
   `acceptanceEvidence: false`.
3. Read-only analyst/researcher: historical evidence and fixed-version Electron
   behavior. Independent reviewer: actual combined changes before publishing.

Experiment 1 observes whether GPU/Viz exits while a copy request is outstanding.
It preserves capture ordering without a paint barrier or backend switch. Record
in-memory frame metadata, capture/GPU state, valid-after-update GPU information,
shared memory, Chromium logs and full native stdout/stderr. No raw memory dump.
A temporary catalog argument invokes this mode through the existing Linux CI
workflow; no workflow or gate changes are part of this task. Remove the argument
before final ordinary acceptance runs.

Experiment 1, [43011758246](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/43011758246),
tested `a87463f6058a3ac1828af4e944f2b3ce735b8543` against the current base.
Candidate/build source and Host hashes agree; the candidate was clean and
unchanged. The full family passed 36/36. All six cold trials retained nine
interaction groups and two captures, exited zero without timeout and recorded
no GPU/renderer exit. GPU information was observed after its update event and
reported software compositing, with a live GPU process. These are passing
diagnostic samples; the native crash was not reproduced.

One new distinction: trial 01 began its narrow capture at 1,764 ms with a 420px
window while its last paint still measured 1000px. A 420px frame was observed
before capture completed at 1,793 ms. The other five trials already had a 420px
frame at capture start. Stale frame metadata alone does not explain the crash:
this sample also passed. Raw artifacts, logs and hash/inventory verification are
retained under `.artifacts/pi-stab-1111-capture-closure/first/`.

Experiment 2 therefore tests frame ordering with an explicit diagnostic-only
`--capture-frame-barrier`: one invalidate and a bounded wait for a new nonempty
frame matching content size before each original single capture. Timeout or
destruction fails; event listeners and timers must be released. The two capture
calls, all interaction/layout assertions, process limits and backend selection
remain unchanged. The barrier is not enabled in ordinary runs or experiment 1.
It is a hypothesis comparison, not an accepted repair. If the native failure is
still absent after this second experiment, stop rather than run further samples
or choose a speculative backend change.

## Validation and completion

Passed locally on the second combined executable source: 17 Node helper
and suite-dispatcher tests; outer/helper/test syntax; generated native CJS
syntax in ordinary and both diagnostic modes; test-quality (237 files / 8,120
existing syntax-level assertions); agent policy; documentation structure (642
pages) and locale pairs (95); and whitespace checks. Mechanical checks use the
primary checkout's existing TypeScript read-only via `NODE_PATH`; no dependency
or lockfile was changed. The diagnostic catalog argument requires regenerating
the two existing scenario indexes; the final catalog check passes (138 suites /
167 executable IDs). Independent review found no blocker for either diagnostic
experiment and separately passed all eight frame-helper tests and syntax checks.
Cancellation may leave the last atomic summary at `running`; use the outer
suite result for its final termination. Paint observation, GPU information
queries and logging may affect timing, so green results cannot rule out a race.

Experiment 2 executable candidate has not run Electron or Linux CI yet: NOT RUN.
Test-quality baseline remains unchanged. Full workspace/Rust tests, packaging,
real providers and the running user application: NOT RUN; no product or runtime
implementation is changed.

S1 remains unresolved. A proven minimal repair must pass two consecutive
complete ordinary goals-team/nightly runs on one final commit, followed by
scheduled nightly evidence after authorized integration. Diagnostic runs cannot
satisfy those two acceptance runs. The entire stability program's seven-day and
real-model criteria are separate from this S1 package.

Keep the current worktree and its evidence while this investigation is active.
Record each experiment's exact SHA, fetched base, candidate receipt and result
before deciding the next action.
