# PI-REL-01514: Publish the 0.15.14 unsigned macOS release with the assisted in-place update

- Project: `fork-pi-desktop`; task ID: `PI-REL-01514`; status: 实现中
  (preparation PR in review; publication pending).
- Created: 2026-11-09 (Asia/Taipei).
- Authoritative record: this file.
- Authorization: on 2026-11-09 the user answered the PI-UPD-1109 delivery report
  with "是的 请按照流程发布新版本". I read that as authorizing the commit, push
  and pull request of PI-UPD-1109, its hosted validation and merge, and the
  preparation, merge, tag and cloud publication of this release. Final
  installation of the produced DMG remains the user's manual action.
- Baseline / release source: `b6e11df48fe0a51d91d0f7d9ab0286c9ed198576` (merge of
  PR #80 into remote `main`, 2026-11-09T11:36:11Z). The tag source will be the
  merged preparation commit.
- Branch: `chore/20261109-pi-rel-01514-macos-release`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261109-chore-pi-rel-01514-macos-release`.
- Target: remote `main`, tag `v0.15.14`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.13. The only product behavior change
since that release is PI-UPD-1109
([PR #80](https://github.com/SakuraLoveSmile/PI-Desktop/pull/80)): a packaged
macOS build stamped `piMacSigning = "adhoc"` whose bundle sits in an eligible
location can update in place. Main downloads the ZIP from the fixed GitHub
repository, checks its SHA-512 and size, stages and verifies it, and on the
user's restart click a bundled helper swaps the two bundles and relaunches,
keeping one backup. Automatic updates stay opt-in (the default stays Manual),
the install never starts on an ordinary quit, and the lane never clears
`com.apple.quarantine`. Developer ID builds, Windows and Linux are unchanged;
there is no schema, IPC channel or stored-format change.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` (read on
2026-11-09) selects the existing personal-use unsigned lane: ad-hoc integrity
signing only, no Developer ID or notarization, manual download and
installation. This is the first release that contains the lane, so it is
installed by hand; the first in-app update is the release after it, and the lane
counts as qualified only after two consecutive real releases (E2E-196d, runbook
section 7). Keep Pi 1.0.1, upstream library manifests, Plus identity/profiles,
schema P10 and the bundled models.dev snapshot unchanged. No local installer
build and no installation of the produced app are authorized.

The 0.15.14 changelog notes and the README release paragraph describe only the
assisted update.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.14 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale, same version set and highlight count; update `changelog.test.ts` and `plus-changelog.test.ts`; refresh both README release paragraphs. | Catalog tests and `node scripts/check-release-docs.mjs 0.15.14` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.14` on this branch to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.14; docs check passes. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`; PR base contains the latest `origin/main`. | 未开始 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.14 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.14` publishes the verified assets with `signedMacos: false`. | 未开始 |
| T5 | Verify the published assets and manifest identity, retire task worktrees/local branches and retain evidence. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 未开始 |

## Candidate E2E

The preparation changes no runtime behavior, so its candidate evidence is the
hosted shared verification: the preparation PR's checks and the tag run's reused
`ci.yml` gates, which include the isolated launch, message, approval and restart
smoke.

The product change was validated on its own candidate (`e8bbec82e`, the PR #80
head): the `pull_request` runs of `ci.yml` (JS build, typecheck, lint,
architecture, tests, the isolated smoke, and the Rust job that now also tests
`update-helper`) and a manual `release.yml` candidate dispatch (unsigned,
Actions artifacts only) that builds the macOS arm64 package with the helper and
runs the helper tests, including the macOS integration test, on the shipping
runner. The Electron CDP E2E suites and the installation journey of E2E-196d
(manual first install, then an in-app update from this release to the next) were
NOT RUN.

## Validation record

| Date | Code revision | Environment | Action | Result |
| --- | --- | --- | --- | --- |
| 2026-11-09 | `e8bbec82e` (PR #80 head) | GitHub-hosted, `pull_request` | `ci.yml` [run 42607691738](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607691738), `docs-check.yml` [run 42607691586](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607691586), `pr-base.yml` [run 42607691539](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607691539) | All jobs `success`: JS build / typecheck / lint / architecture / test; isolated launch, message, approval and restart smoke; Rust format / clippy / `cargo test -p host-core -p update-helper --locked` (host-core 1295 passed, update-helper 29 passed on Linux); Docs checks; PR base. |
| 2026-11-09 | `e8bbec82e` (PR #80 head) | GitHub-hosted, manual dispatch | `release.yml` candidate (`sign_macos=false`) [run 42607731531](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607731531) | Preflight, the shared `ci.yml` barriers, Build macOS arm64 and Verify macOS arm64 installer bundle `success`; Publish skipped (candidate: unsigned, Actions artifacts only). On the macOS runner the step "Test the macOS update helper" passed (`cargo test -p update-helper` 33/33, `assisted-update-macos.test.mjs` 6/6 with the real `ditto`, `codesign` and `open`), and the packaged app, its ZIP and its DMG each contain `Contents/Resources/bin/pi-desktop-update-helper` with valid signatures. |
| 2026-11-09 | `b6e11df48` | GitHub | PR #80 merged with a merge commit, head pinned to `e8bbec82e` | Merge tree equals the PR head tree; `origin/main` contains all four PI-UPD-1109 commits. |
| 2026-11-09 | `2185e7e08` | worktree, Node 22 | preparation branch cut from the then-current `origin/main`, rebased onto `b6e11df48` after the merge | Ready |
| 2026-11-09 | uncommitted prep | worktree, Node 22 | `node scripts/release.mjs 0.15.14 --skip-docs-check` | Bumped 7 version files. |
| 2026-11-09 | uncommitted prep | worktree, Node 22 | `node scripts/check-release-docs.mjs 0.15.14`, `node scripts/check-agent-policy.mjs` | Both passed. |
| 2026-11-09 | uncommitted prep | worktree, Node 22 | `vitest run` in `packages/shared` | 55 files, 667/667 passed. |

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| Preparation commit | Version 0.15.14 notes and version surfaces only; no runtime behavior change. | Release docs, changelog tests, PR checks | Pending merge, tag and publication |

## Delivery and recovery

- Not verified yet: the hosted preparation checks, the tag run, native
  Gatekeeper acceptance and actual installation. Unsigned installs require
  manual installation, and this first lane-bearing release is installed by hand.
- Not verified on a real install: replacing a bundle in `/Applications` under
  macOS App Management, and Keychain or privacy grants after the cdhash changes.
  These are checked when the user installs this release and then updates from it.
- User confirmation: none yet; acceptance remains pending explicit user
  confirmation (已验收).
- Rollback: once tagged, the tag and the published assets are immutable. Do not
  replace uploads or move the tag; use the documented publication recovery path
  (runbook section 4.4) only if a run fails after creating a draft.
