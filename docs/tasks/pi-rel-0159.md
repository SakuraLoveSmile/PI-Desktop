# PI-REL-0159: close retained workstreams and release 0.15.9

Status: 实现中. Project: `fork-pi-desktop`. Created: 2026-10-24, Asia/Taipei.

## Goal and authorization

Finish the retained upstream fixes, Goal verification evidence, and Settings
usability work; integrate them through a PR into remote `main`; publish version
`0.15.9` using GitHub-hosted Actions; safely retire completed local worktrees.
The user explicitly authorized integration and release on 2026-10-24. Remote
branch deletion, real paid providers, production-profile migration, and replacing
the installed application are outside this request.

Preserve current-main Advisor, shared worktree memory, cloud-only installer
builds, and verified draft-publication recovery. The existing release scope is
macOS arm64. `ALLOW_UNSIGNED_MACOS_RELEASE=true` is already configured; retain
that personal-use unsigned lane and state its manual-install/signing limits.

## Source ownership and recovery

Starting remote main: `d424021c5b70771982072bf6ce813c5894395e3c`.

| Input | Original branch | Captured HEAD |
| --- | --- | --- |
| Upstream fixes | `codex/port-upstream-prs-20261022` | `b5d48da96ffb2049a3468e003dc645410549cc1f` |
| Goal evidence | `codex/goal-evidence-20261022` | `34b2038250603a8ad4938568ad49a69c34e534eb` plus captured changes |
| Settings usability | `codex/settings-usability-20261023` | `bb25abc65b29ad075f1ac6dc74039bab55c8f304` plus captured changes |

Verified patches, native indices, untracked files, ignored verification evidence,
manifests and checksums are under the external recovery directory
`/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/_archives/20261024-pi-rel-0159/`.
Committed input histories remain reachable through
`refs/archive/pi-rel-0159/source-{port,goal,settings}`. The primary checkout's
four existing policy-document modifications are preserved separately from the
feature integration; their original fingerprints are in that manifest.

The old local-main history diverges from current remote main. Integrate scoped
commits and captured feature patches onto current main, rather than replacing
the newer tree or replaying thousands of unrelated historical commits. Audit
source-only baseline work before retirement so no independent results are lost.

## Worktrees and exclusive writers

All new worktrees are below
`/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/`.
The shared task stem is `20261024-chore-pi-rel-0159-release-0-15-9`.

| Step | Owner and worktree suffix | Sole write scope |
| --- | --- | --- |
| T1 | Lead, no suffix | upstream-fix integration, task record, final conflicts, release versions/notes/tooling |
| T1.1 | Stop worker, `-stop` | bounded tool-cancellation acknowledgement and controlled-clock public-path regression |
| T2 | Goal worker, `-goal` | required-verification prerequisites, Goal proof/persistence code and corresponding tests/specs |
| T3 | Settings worker, `-settings` | Settings renderer, fixtures, locales, corresponding specs/catalog and test-baseline reductions |
| T4 | Lead and read-only reviewer | final combined-state checks and representative user paths |
| T5 | Lead | PR/main integration, formal tag, Actions/release verification and cleanup |

Initial worker branches use the matching `chore/20261024-pi-rel-0159-release-0-15-9`
stem plus their suffix. The Goal and provider closeout reuse the existing
`-goal` and `-stop` trees on `fix/20261024-pi-rel-0159-goals-team-fixtures`
and `fix/20261024-pi-rel-0159-provider-fixtures`; initial heads remain preserved
in archive refs. The Settings tree is reused on
`fix/20261024-pi-rel-0159-shell-fixtures` for the isolated crash-observation
closeout; its previous Settings branch remains preserved. The lead serially integrates worker commits. Workers
do not push, open PRs, publish, or modify original source worktrees. Existing
host dependency trees and caches are reused; no local dependency installation
or installer packaging is planned. Mutable fixtures, logs, artifacts and any
servers stay owned by the relevant worktree; reserve dynamic ports per suite
and stop only this request's processes.

## Frozen behavior and acceptance

- T1: preserve compacted retry results, correctly budget the provider payload,
  omit only genuinely empty assistant rows, retain AskTool drafts across chats,
  resolve positioned file references safely, reject expired system trust
  anchors, cache unchanged session projections, settle Stop with in-flight
  tools, and avoid permanent recovery pinning on Windows/Linux.
- T2: a bound successful Goal report needs exact-command, integer-zero native
  Bash evidence from its own execution segments. Wait for transcript durability
  before validation; failed persistence, stale ownership and invalid proof must
  remain observable and correctable. Preserve unbound/non-met behavior and
  legacy native result envelopes. The input's required-command binding is a
  necessary prerequisite missing from main: its P9-to-P10 migration adds one
  nullable column, preserves existing NULL rows and immutable plan Markdown,
  and must cover upgrade backup/reopen and rejection by older binaries. Do not
  rewrite historical finalized reports or touch the real user profile.
- T3: complete the existing sixteen-page usability changes using current design
  tokens: exact-setting search and keyboard/IME behavior, narrow category modal,
  reachable editor actions, management lists, shortcut/memory filters, project
  overrides, draft retention, distinct save/refresh outcomes and stale-result
  ownership. Preserve Advisor/shared-memory behavior, defaults and permissions.
- T4: validate the final combined code against its exact source/base SHA with
  applicable static/unit/contract checks, isolated runtime/Electron fixtures
  and actual browser inspection of affected Settings results. Historical tests
  and individual worker green results do not prove combined-state acceptance.
- T5: merge only after CI, PR ancestry and relevant integration E2E gates pass;
  prepare every 0.15.9 version/document surface before tag creation; use the
  repository tag guard and cloud workflow. Verify every job and the published
  manifest, checksums and asset identities. Archive residual unique/ignored
  work and check live path references before cleanup.

## Verification and remaining work

### Integration inventory

- Original upstream fixes were replayed as twelve scoped commits, ending at
  `50880a460`. Review found that the ten-second execution cancellation still
  awaited a hung cancellation RPC. `7d3532b5f` now shares the original deadline
  across execution and acknowledgement, preserves partial output and isolates
  late results. The old code failed three controlled-clock public-path tests;
  the fix passed them and thirty related cases in the worker tree.
- The original branches also inherited unmerged Composer/queue/workspace strip,
  context display, Plan exit, Overview and menu behavior. Nineteen scoped source
  commits, ending at `5df4552cb`, preserve those results. The old `c0c03eddf`
  and new-history `bb25abc65` have identical trees, so this comparison does not
  overwrite later main changes. A bounded 95-file product inventory found no
  additional missing source work.
- Settings worker `dabaa3f7b` is integrated as `9fcee8142`; Goal worker
  `d7000136c` is integrated as `5a0b8133f`. The only Goal conflict was an
  additive unreleased-notes conflict, resolved by retaining both descriptions.
  The final runtime merge retains both Goal persistence and Stop changes.
- The version-preparation script aligned every product surface with `0.15.9`;
  workspace packages remain on upstream `0.16.1`. Nine locale catalogs carry
  matching release highlights. Both READMEs now describe the actual arm64-only,
  unsigned personal-use release lane and the profile upgrade boundary.

### Worker qualification (before final integration)

These results belong to the named worker trees and do not replace the final
combined-candidate gates below.

- Goal: true red/green proof regression; Goal 40, required-verification 13,
  Plus-schema 24 and storage-compatibility 8 Rust tests; Desktop 37,
  host-runtime 38, agent-runtime 58 and shared 17 tests; applicable builds,
  types, formatting and quality/architecture/catalog checks. Real isolated
  Host RPC verified a nonempty P9-to-P10 profile, exact old contract bytes and
  hashes, nullable old bindings, readable upgrade backup, reopen without backup
  replacement and actual P9 refusal of P10 without mutation. No real user data
  or paid provider was used.
- P9 binary SHA256:
  `2c0e95c411fb7162a4af1807f59341a91dc23acb502e6cc8307b92978d20e6e6`;
  P10 binary:
  `1539315b26af23fcbdc692d8ac01267e0e8094f494f3fbfb95708a03fe959250`.
  The compatible shared Cargo target initially reused a different worktree's
  executable; explicit manifest and source-specific rustc metadata forced the
  correct package build before qualification. Detailed identity and logs:
  `-goal/.artifacts/pi-rel-0159-t2/qualification.md`.
- Rollback: P9 cannot read P10. Preserve the current profile and restore the
  verified pre-upgrade profile while the app is stopped before downgrading.
  P10-era writes are absent from that backup; never downgrade schema metadata.
- Settings: 128 focused Node tests and 30 i18n tests; 18 destinations across five
  widths, English/dark and Chinese/light and 200% zoom; isolated preference,
  model, capability, workspace, extension, shortcut, memory, expert-team and
  discovery interactions. The failed-save draft case has real isolated Electron
  red/green evidence. Fake preload boundaries do not prove real account/Host
  persistence. Evidence: `-settings/.artifacts/pi-rel-0159-settings/`.
- Stop: five focused files / 33 tests, runtime build/types and quality gate.
  The pi-agent turn model legitimately emits two `turn_end` events for the tool
  batch and aborted assistant, followed by one `agent_end`; tests preserve that
  exact ordering and next-turn isolation. Evidence: `-stop/.artifacts/pi-rel-0159-stop/`.

### Combined candidate

Passed after all three integrations: decreasing-only test-quality ratchet
(237 files / 8,147 syntax-level assertions and extractions), generated scenario
index (136 suites / 164 executable IDs), architecture budgets and diff checks.
Release-documentation gate passed for `0.15.9`; full JS build, five changelog
tests, 95 English/Chinese documentation pairs and 627 documentation pages also
passed. Remaining combined gates are in progress; no hosted result, merge or
publication is yet claimed.

Final review found a project-switch editor ownership defect in MCP and Skills:
a pending save in project A left its draft open after switching to B, permitting
a later save to target B. `3e25d0d6b` binds drafts to their original path, retires
editors on ownership changes, and rejects stale Skills reads. Public SettingsPage
red/green cases prove no B write, stale-read isolation and retained failed-save
retry behavior. Independent re-review found the issue resolved, with no further
material finding in the Goal/P10 and Stop integration.

At `fcbe16c46` / base `d424021c5`, the final combined Rust source passed
`cargo fmt --all -- --check`, `cargo test -p host-core --locked` (1,277 passed,
one existing ignored case) and workspace/all-target/all-feature Clippy (three
warnings, no errors). No Rust source changed afterward. A source-specific
development build produced Host SHA256
`35f284bc595c7afeda2184a4752c9844965901174856413ffec4fbe66ce2f455`.
The isolated `required-verification`, `goal-team-renderer-ui` and
`composer-mode-menus` suites passed against that clean candidate and binary,
with unchanged-candidate fingerprints and no excluded/skipped cases.

Desktop/runtime-test typechecks and lint also passed there. Full workspace tests
then exposed stale Plus changelog expectations, including a version collision:
upstream already has a 0.15.9 entry while Plus must show its own 0.15.9 notes.
The corrected test keeps the exact Plus prefix, complete cutoff tail and original
upstream object exclusion; a colliding version is allowed exactly once only when
owned by the Plus prefix. The 28 focused changelog tests passed. This changes the
release-catalog expectation without weakening the history boundary. Final JS
checks are rerun after the Settings ownership fix.

Lead browser inspection used production Settings components and generated
styles with an isolated fixture preload: Chinese/light search navigated to and
highlighted the exact context-usage row; the populated Skills screen retained
its scope filters, list controls and collapsed optional discovery. This is
fixture UI evidence, not real account or installed-app validation.

Full workspace verification at `8031d6a6a` passed types and lint but stopped on
eight Desktop tests: seven legacy source-shape assertions after the Settings
split, and one unchanged plugin teardown test whose real 20 ms timer elapsed
before `setImmediate` was scheduled (30.9 ms in the failure). The same unchanged
plugin test passed in isolation. Its correction uses a controlled clock to check
the live page at 19 ms, settle at exactly 20 ms and release the listener, keeping
the original timeout contract. All thirteen plugin-invoker cases passed after
this test-only correction; no plugin runtime behavior changed. `6716600d0`
replaces the seven Settings structural assumptions with mounted user journeys:
release-note open/close/focus, model portal dismissal and focus, independently
reachable MCP control, plugin navigation and native controls, thinking-mode
save/reopen, and the single window shortcut on all three platform catalogs.
The seven focused suites passed 79 cases; four enhanced renderer suites passed.
Independent review verified that the source-assertion baseline only decreases
to 8,139, without new signatures, changed trusted revision or larger budgets.
Initial nightly run
`40077642507` was superseded and canceled for the revised test candidate; it is
not passing validation evidence.

The full workspace command at clean `6716600d06d00140e25e4b5004661ed786ed49cf`
completed once in 119 seconds: 8,207 tests, 8,206 passed, one existing skipped
case, zero failures. HEAD, index and workspace fingerprints were unchanged.
All ten package suites passed, including 4,213 Desktop and 1,868 agent-runtime
cases. The report and full output are `workspace-tests-6716600d.report.txt` and
`workspace-tests-6716600d.log` under the combined evidence directory.

Initial hosted CI `40077612446` exposed only the seven retired Settings source
assertions; Rust and isolated smoke passed. Docs `40077612406` and PR-base
`40077612382` passed. Project-memory `40077612389` passed real Host/Sidecar
isolation but failed the renderer runner's fixed-coordinate hit test after
removing a card and saving. Local `settings-memory` passed on clean `6716600d0`;
that does not supersede the hosted failure. `4d7670eba` corrects a demonstrated
fixture race: after dialog reflow, the runner kept checking the old coordinates.
It now remeasures after an animation frame and requires a stable, currently
hit-tested center before native pointer press/release. A deterministic 40px
movement at that same removal/save/disable path fails with the old helper and
passes with the fix; both full memory modes pass. No product code, hit-test
requirement or timeout budget changed. The original CI log did not retain the
post-failure rectangle, so its exact movement is not asserted retrospectively.
Final exact-SHA hosted validation remains required before merge.

### Expanded hosted E2E closeout

At `761a3c1ce0bf4c5c65d5f0aa18fd303b67ed4aca`, CI `40079380776`,
Docs `40079380806`, PR-base `40079380797` and project-memory
`40079380771` passed. PR integration candidate
`8af6cd3090b8290f9d87f1a767c2bcf829d92f74` has the same executable tree
as that head against base `d424021c5`. The expanded nightly run
`40079399419` passed 103 of 131 isolated suites; nine families failed and
voice passed. Those failures block landing and are retained in
`hosted/nightly-761a-full/`; passing regular CI does not supersede them.

- Transcript fixtures now paint their hidden windows, wait for bounded stable
  frame geometry and mirror the real transcript's disabled native anchoring.
  Original title-drift and disclosure assertions remain; both suites passed
  locally. Linux revalidation remains required.
- Mounted Composer paths exposed real rapid-switch image-draft loss, preview
  focus restoration ordering and cross-project draft ownership defects. The
  owner is saved with its own workspace before loading and validating the new
  owner's snapshot. Real A/A -> B/B -> A/A regression failed before the fix;
  complete paste/history and IME fixtures passed afterward without dropping
  existing cases. The retired source-shape assertion lowers the ratchet to
  8,138, without increasing its trusted baseline.
- MCP control now waits until the recovered switch accepts input and the real
  Host request exists. Storage and Settings scroll fixtures paint offscreen.
  The three original local suites pass with unchanged assertions/timeouts.
- Plugin controls were genuinely clipped on the existing single-row toolbar.
  The existing 32px model trigger now activates earlier below 720px when plugin
  controls are present; its accessible name and menu retain the full selection.
  The isolated app failed 61/62 checks before the fix and passed 63/63 after it,
  including full-control geometry and the accessible model name. The retained
  screenshot was visually inspected; the toolbar remains one row.
- Real Runtime -> Main -> Rust question delivery exposed a strict Host request
  contract violation: runtime-local `turnId`/`createdAt` metadata was forwarded
  into a `deny_unknown_fields` request. `beebfc61f` projects only the existing
  Host fields, retaining local metadata and the outer authoritative turn ID.
  The boundary regression failed before the fix; fifteen pending/relay tests
  and the unchanged real approved-question fixture passed afterward. No Host
  schema or permission boundary changed.
- Provider fixtures now use the direct model list and assert the exact typed
  Plan denial without an extra HTTP request. The cumulative recovery fixture
  checks all 24 requests, twelve independent completed response events, eleven
  ordered durable tool results and every retry context; it expects only the
  nonempty final assistant row, as required by existing persistence behavior.
  The ten-retry ceiling remains. All three provider paths passed, and bounded
  cleanup of only the test-owned process group now exits naturally.
- Subagent controls passed native blur/Enter, bounds, failure and reload paths.
  The notification fixture observes the actual platform's Host -> badge request
  -> bell history: count requests on macOS/Linux and overlay image/label/clear
  on Windows. Native count readback is required when the API accepts it. macOS
  native readback passed all six transitions. Windows native execution is NOT
  RUN; its overlay observation is implemented and unit-covered. Final Linux
  validation is pending; without Unity it must report native badge capability
  as unavailable, not claim a native badge result. Scheduled model selection, persisted reasoning,
  actual next-minute execution and AI CRUD passed through the isolated app.
- The full isolated shell flow passed 197/197 checks on macOS with an unchanged
  source fingerprint. It measures center-aligned toolbar groups, checks the
  simulated platform's control inset and distinguishes hidden Settings frames
  from visible widths. Crash inspection waits for the replacement app document
  before enabling Runtime observation, avoiding Electron 43.6.0's documented
  initial-empty-document inspection issue (#54149 / #54176). Automatic reload,
  same-window chat recovery and diagnostics remain required and passed. This
  establishes the corrected local observation path; it does not prove the old
  Linux splash failure's exact cause. Production recovery logic is unchanged.
- The late-answer recovery path exposed another production defect: a paused
  Team's queue hold stranded the authenticated durable answer. `7042913cf`
  admits only that exact live answer through its own session's Team hold,
  preserving Team pause, other holds and occupied/approval gates. Independent
  review caught promoted mail being steered into that answer turn;
  `eb7d4bd61` prevents that additional path. Both defects have actual red/green
  regressions, including a real steering port, ordinary and Team mail, restore
  state and independent holds. All eighty AgentHost cases passed. The unchanged
  full native recovery flow passed again: exactly one late answer, old token
  rejection, interrupted old Goal, pending new review and no automatic expert
  launch. Restored snapshots gain no new execution authority.
- Goal/Team fixtures now follow enabled approval controls and current Settings
  cards. Temporary Goal recovery uses a real blocked result, explicit acceptance,
  actual atomic report-write failure, restart and UI Retry; legacy closure and
  fallback handling retain their executed Rust coverage. Cloud setup uses the
  real build-receipt writer, never a fabricated attestation. The historical
  baseline `26db5043860db8412a988cdce31362a424eea407` maps to reachable
  `43a4725d64feb9aef33fc0889370d39417c2e712` with identical fixed apps/packages/
  crates trees; ancestry and all three product hashes remain mandatory.
- Final combined-SHA local checks and Linux hosted validation are required
  before landing. Native Windows device acceptance and signed/notarized macOS
  qualification are NOT RUN. Corrected fixtures preserve their behavior
  coverage; no security or persistence guard is weakened. Final run, release
  and cleanup receipts under the recovery directory continue this record after
  its source is tagged; they do not rewrite the immutable released source.

Initial checks: source paths/HEAD/index/dirty state and registered worktrees
inspected; origin main/tags fetched; original source snapshots verified. Remote
0.15.9 tag and Release were absent. No classic protection or ruleset is enabled,
so repository gates must be observed explicitly.

### Exact-candidate Linux follow-up

Clean `2eb1c05f71c1957bca17547289cadffc5d893b2f` passed the full local JS
build, Desktop/runtime-test types, lint, policy, release documentation, catalog
and decreasing-only quality checks (8,123 current signatures). Full workspace
tests passed once: 8,238 tests, 8,237 passed, one existing skipped case, zero
failures; source and index remained unchanged. Its CI `40084445067`, Docs
`40084445050`, PR-base `40084445096` and project-memory `40084445063` all
passed. Nightly `40084446133` completed with 124/131 suites passing across ten
families; its seven failures remain retained and block landing.

- Disclosure geometry had no completed first frame sample on Linux. The
  fixture now establishes a real, inactive visible 800x640 content viewport
  and records surface/sample diagnostics. Its complete local probe passed;
  original real rAF, three stable frames, two-second budget and displacement
  assertions remain. This does not establish the precise OSR internal cause.
- Provider ordering likewise timed out without a result from its hidden
  animation-dependent fixture. A fixed visible 1000x760 content viewport fits
  both local and Xvfb work areas, with native visibility checks and stage
  diagnostics. Original and final full local probes passed, preserving drag,
  rollback, stale refresh, defaults, restart and 200-card performance coverage.
- Advisor's old trigger was actually below the viewport (y=1378-1424 with an
  800px viewport). The fixture now scrolls to and hit-tests the enabled trigger
  and owned visible menu before CDP pointer clicks, and matches the exact
  scenario provider when saving. All three full cases and four app starts
  passed locally; product menu behavior is unchanged.
- Execution-question relay exited during initial Desktop startup, before any
  of its six journeys. The old job omitted the only child-output evidence.
  Startup errors now retain bounded exit/output diagnostics and the default
  evidence directory is inside the existing uploaded artifact scope. A real
  complete overlay build produced a clean 2,040-artifact receipt at
  `40f2cc630b62c60f2ea9c82ec96a4b0bdf4058c9`, then all six real Desktop/Host/
  sidecar/MCP journeys passed. The Linux startup cause is still unproven;
  diagnostics and another actual hosted execution are required.
- The Team overflow failure is a genuine observed 314px/326px surface mismatch,
  but a proposed header explanation was not reproduced by either local font
  experiment. Both experiments passed the original complete layout matrix.
  No speculative product CSS change is retained. Failure-only descendant
  geometry diagnostics will preserve the actual offending element on Linux.
  Approved Goal controls now belong to the selected visible session and wait
  for the measured Auto menu after scrolling. Both complete success/cancellation
  journeys passed locally without changing permissions, assertions or timeouts.
- The shell crash log records about 290 seconds between injection and actual
  process exit, followed by a timeout only 156ms after `renderer.process.gone`.
  An unbounded renderer CDP command crossed the old polling deadline. The
  closeout separates bounded crash injection from the original 90-second
  recovery deadline measured from the actual exit event, retains the suite's
  overall limit, and preserves same-window/new-document/sidebar recovery.
  Native checks passed 197/197 and six external-WebSocket protocol/deadline
  checks passed. Final code preserves the original 420-second script and
  480-second runner limits; injection is additionally bounded at 300 seconds.
  The final post-native changes only tighten the initially proposed 470-second
  limit back to 420 and disambiguate a diagnostic field. Actual local injection
  took 349ms and exit-to-recovery took 883ms, with the same target and new loader.
  The source of the pre-exit delay remains unknown; accompanying Crashpad
  frequency warnings do not establish it.

### Final four-failure closeout

Nightly `40087933878` tested clean `ac58edae6ee49c604181b945c4ad1b2ab185e473`
against `d424021c5b70771982072bf6ce813c5894395e3c`: 127/131 suites passed,
all ten families retained the same candidate, and regular CI, Docs, PR-base
and project-memory checks passed. Shell passed all seven suites, including
197/197 layout checks and the bounded real crash/recovery path. Four failures
remained in Team overflow, pending recovery, question startup and image selection.

- Question startup now has a confirmed Linux cause: a bare Electron script
  reports version `0.0`, correctly rejected by production storage. The fixture
  launches an app directory containing the candidate's real package metadata
  and asserts Electron loaded that version before importing production Main.
  A real 2,040-artifact overlay build and all six Desktop/Host/sidecar/MCP
  journeys passed at `faa8cca44` with the recorded fixture diff. No storage
  validation or startup timeout changed.
- Both Goal approval paths share the selected-session, enabled-trigger and
  measured-menu helper. Recovery keeps trusted native clicks and its original
  deadline; approved execution keeps its existing input path. Complete local
  recovery, success and cancellation journeys passed. Local baseline also
  passed, so the Linux failure is not claimed as locally reproduced.
- Image selection now observes viewport/scroll painting before measuring its
  native hit target. The complete isolated image generation, download, viewer,
  selection continuity, narrow window and editing flow passed locally. The
  original five-second selection deadline and all scenarios remain; baseline
  passed locally and final Linux confirmation is still required.
- Fresh Team evidence identifies the actual progress-row panorama link as
  non-shrinking. The shipped French label reproduces the defect at 320px/150%:
  the disclosure extends 85px beyond the row after the unchanged English and
  Chinese matrices pass. Only that link now shrinks and truncates its text;
  the full accessible name/tooltip, arrow and 24px disclosure remain. Full
  bilingual layout matrices and all four French theme/surface combinations
  passed, including native collapse/reopen and panorama navigation. Eleven
  presentation tests passed. The lead inspected both the red screenshot and
  repaired dark/light screenshots; an independent review found no blocker.

The final combined native Team flow passed again on clean `2c6cac30e`, with a
fresh source-bound overlay receipt. Its hosted CI, Docs, PR-base and
project-memory checks passed. Nightly `40090499119` exposed another intermittent
disclosure fixture failure: zero animation-frame samples in a settling round,
despite a visible 800x640 viewport. That script is identical to the passing
`ac58edae6` version; the old log does not identify the failing round. Electron
43's documented `ready-to-show` event observes initial rendering, whereas
`loadFile` completion alone does not. The fixture now awaits that event,
registered before navigation, with real visible staging content removed before
mounting the measured components. Nine named local phases each observed four
real frames and three stable comparisons; all original geometry assertions and
two-second/sixty-second budgets remain. Independent review found no blocker.
This establishes the missing readiness precondition, not the old Linux
compositor failure's precise internal cause; exact-SHA hosted proof is required.

Linux `4b37e75bb` confirmed that readiness path: transcript passed 8/8 and all
nine disclosure phases recorded four real samples and three stable comparisons.
Its regular CI, Docs, PR-base and project-memory gates passed. The intermediate
nightly was canceled after this targeted evidence, before all families finished;
it is not a 131-suite acceptance result. The superseded `2c6cac30e` run likewise
retains eight completed families (121/123 suites passing) and two failures;
its unfinished shell/voice families are NOT RUN to completion.

That Linux Team run also exposed a separate French aggregate-header overflow
after the progress controls already fit: surface `314/319`. A real installed
Verdana font reproduces the same boundary locally (333px label versus Linux's
334px). The title's automatic minimum width pushes the two 28px header actions
five pixels beyond the panel. The persistent regression failed on old CSS before
the minimal fix: allow only the title text to shrink/ellipsis, retaining its
configured icon, complete status badge, buttons, spacing and font size. The full
native journey, original 120 bilingual combinations and eight default/Verdana
French combinations passed after an actual overlay build; the surface is now
`314/314`, with native refresh and both panorama entries verified. Eleven
presentation tests and applicable static gates passed. Independent review found
no blocker, and the lead inspected repaired dark/light header screenshots.
Original-scale offender JSON and screenshots now survive fixture cleanup under
the existing hosted artifact directory. Final combined-source/Linux validation
is still required.

Nightly `40093157087` completed all ten families on clean `43422f2cbb` against
`d424021c5`: 130/131 suites passed, with unchanged-candidate fingerprints in
every report. Team's eight French layout probes and shell's 197 layout checks
passed; regular CI, Docs, PR ancestry and project-memory gates also passed.
Only pending recovery failed after its process-restart/persistence assertions:
the fixture did not observe the card after renderer reload. This does not
establish durable data loss. `Page.reload` acknowledges before navigation, so
the old readiness check could accept the previous document's control surface.
The closeout now requires a changed `performance.timeOrigin`, the same app URL,
a complete non-booting shell and the selected target's visible pane or active
sidebar row before proceeding. Empty sessions legitimately use the welcome
composer, without a transcript pane. Reload receipts retain both document
identities; failure snapshots preserve navigation and durable ask status before
any attempted recovery. There is no second selection or input refresh to hide
a failure. The original 15-second readiness and card deadlines remain.

The complete isolated native recovery passed, including renderer reload, a
second process restart, old authority rejection, one authenticated late-answer
turn while fresh roster approval remains required. The independent budget flow exposed
another existing fixture readiness gap: the exact old committed script also
failed to launch after its single native confirmation. The helper checked an
`is-entering` class that the component never sets while its real flex-basis
animation moves the control. The original confirmation predicate now waits for
that panel's own animation to finish and for two real painted samples with a
stable hit target. It still sends one trusted click and retains the original
15-second readiness/45-second roster deadlines. The full native budget journey
then passed: soft notice, safe completion across hard pause, held report,
restart, retained pause while disabling policy, explicit Resume and exactly-once
admission. No product persistence, launch authorization, timeout or acceptance
assertion was relaxed. Independent review found no material issue; final hosted
confirmation is still required.

Clean `2c22219ea` has a fresh 2,040-artifact source-bound overlay receipt and a
complete native recovery pass. Its ordinary CI, Docs, ancestry and shared-memory
checks passed. Nightly `40096564091` confirmed all 36 Goal/Team suites, including
pending recovery and the full budget lifecycle, but Provider ordering produced
no result before its existing 60-second watchdog. Its recorded first frame,
interactions and 200-card performance probe all completed; the missing stage is
between Host restart and renderer reload. The exact same local baseline passed,
so a local reproduction or a persistence defect is not claimed. Split timed
Host stop/start and renderer navigation diagnostics now identify that boundary
and retain Electron load/process events and the actual exit signal. No probe,
performance assertion or deadline changed. The existing isolated runner gains
a manual one-family nightly diagnostic entry; the complete nightly dispatcher
and final full-catalog requirement remain unchanged. Focused Linux diagnosis
and another complete final-candidate result are required before landing.

Remaining: final exact-SHA hosted task-candidate and
PR-integration gates, formal release workflow, publication integrity and cleanup.
These remain required. Detailed local logs/reports are in
the integration tree's `.artifacts/pi-rel-0159-integrated/`. Final remote run and
publication receipts will be preserved under the task's recovery directory;
they extend this record without modifying the immutable tagged source.

Hosted validation can use existing CI and the existing nightly dispatcher
(ten isolated fixture families); the latter covers Settings/storage/extensions,
Goals/Team, runtime/provider, sessions, transcript/composer, shell and voice.
Device-specific native Windows behavior and signing/notarization must not be
claimed from Linux fixtures or unsigned cloud artifacts.

Next: finish the remaining fixture verification, integrate serially, review and
validate the combined candidate, then complete the already-authorized
PR/main/tag/release path and cleanup. Record
actual commands, tested SHAs, run URLs/job conclusions and residual limits here.
