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

Each worktree uses the matching `chore/20261024-pi-rel-0159-release-0-15-9`
branch plus its suffix. The lead serially integrates worker commits. Workers
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

Initial checks: source paths/HEAD/index/dirty state and registered worktrees
inspected; origin main/tags fetched; original source snapshots verified. Remote
0.15.9 tag and Release were absent. No classic protection or ruleset is enabled,
so repository gates must be observed explicitly.

Remaining: final post-fix JS checks and Settings interactions, exact-SHA hosted
task-candidate and PR-integration gates, formal release workflow, publication
integrity and cleanup. These remain required. Detailed local logs/reports are in
the integration tree's `.artifacts/pi-rel-0159-integrated/`. Final remote run and
publication receipts will be preserved under the task's recovery directory;
they extend this record without modifying the immutable tagged source.

Hosted validation can use existing CI and the existing nightly dispatcher
(ten isolated fixture families); the latter covers Settings/storage/extensions,
Goals/Team, runtime/provider, sessions, transcript/composer, shell and voice.
Device-specific native Windows behavior and signing/notarization must not be
claimed from Linux fixtures or unsigned cloud artifacts.

Next: finish T1-T3, integrate serially, review and validate the combined candidate,
then complete the already-authorized PR/main/tag/release path and cleanup. Record
actual commands, tested SHAs, run URLs/job conclusions and residual limits here.
