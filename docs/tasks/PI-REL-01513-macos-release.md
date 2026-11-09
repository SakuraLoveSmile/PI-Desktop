# PI-REL-01513: Publish the 0.15.13 unsigned macOS maintenance release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01513`; status: 待体验
  (published; user acceptance pending).
- Created: 2026-11-08 (Asia/Taipei).
- Authoritative record: this file.
- Authorization: on 2026-11-08 the user asked to merge PR #77 (PI-GOAL-1108)
  and publish the release ("请你合并并发布"), accepting the proposed version
  0.15.13 and the unsigned personal-use lane. On 2026-11-09 the user confirmed
  merging the preparation PR, tagging and pushing `v0.15.13` ("继续"), and then
  authorized this closeout PR ("开收尾 PR"). Final installation of the produced
  DMG remains the user's manual action.
- Baseline: `e758c88d918ebc80a82b23f56c031ab9f5f54dc3` (merge of PR #77 into
  remote `main`).
- Branch: `chore/20261108-pi-rel-01513-macos-release` (merged; the local branch
  is deleted, the remote branch is kept).
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261108-chore-pi-rel-01513-macos-release`
  (removed after publication verification).
- Preparation PR: [#78](https://github.com/SakuraLoveSmile/PI-Desktop/pull/78),
  merged as `f9cbc4b37176c31673443bf0bab041d03f168edb` on 2026-11-09T03:56:55Z;
  this is the release source commit.
- Release: [v0.15.13](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.13),
  published 2026-11-09T04:14:00Z from the same source commit.
- Release run: [42559184767](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42559184767),
  all seven jobs successful.
- Target: remote `main`, tag `v0.15.13`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.12. The only product behavior change
since that release is PI-GOAL-1108
([PR #77](https://github.com/SakuraLoveSmile/PI-Desktop/pull/77)): for Goals
without approved verification commands, the Host matches each Goal report
check's command against the Goal's own Bash runs, and the last finished run
decides `passed` or `failed`. Observations stay record-only, Goals bound to
approved verification commands are unchanged, and there is no schema, RPC or
stored-format change. Commit `43dc869ed` (agent policy tooling) also landed on
`main` since the tag and changes no product behavior.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` selects the
existing personal-use unsigned lane: ad-hoc integrity signing only, no
Developer ID or notarization, manual download and installation. Keep Pi 1.0.1,
upstream library manifests, Plus identity/profiles, schema P10 and the bundled
models.dev snapshot unchanged. No local installer build and no installation of
the produced app are authorized.

The 0.15.13 changelog notes describe only the Goal report change. The
manual-update wording for unsigned macOS builds stays in the README release
paragraph, carried over from 0.15.12.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.13 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale, same version set and highlight count; update `changelog.test.ts` and `plus-changelog.test.ts`; refresh both README release paragraphs. | Catalog tests and `node scripts/check-release-docs.mjs 0.15.13` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.13` on this branch to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.13; docs check passes. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`; PR base contains the latest `origin/main`. | 完成 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.13 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.13` publishes the verified assets with `signedMacos: false`. | 完成 |
| T5 | Verify the published assets and manifest identity, retire task worktrees/local branches and retain evidence. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 完成 |

T5 verified the release through the GitHub API digests and sizes, the release
flags and notes, and the three small metadata assets read to the terminal
(`release-manifest.json`, `SHA256SUMS`, `latest-mac.yml`). The DMG and ZIP
themselves were not downloaded, so their content hashes, the ZIP sha512 against
the feed, `hdiutil verify` and the packaged `piMacSigning` stamp were not
rechecked on the published bytes (NOT RUN; the 0.15.12 record carries that
check).

## Candidate E2E

The preparation changes no runtime behavior, so its candidate evidence is the
hosted shared verification: the preparation PR's checks and the tag run's reused
`ci.yml` gates, which include the isolated launch, message, approval and restart
smoke. Both were green: PR #78's five checks on `a7fc37352` and the tag run's
three shared verification jobs on `f9cbc4b37` (see the validation record).

The product change itself was validated on its own candidate (`064813150`): the
Host-transport scenarios `E2E-GOAL-UI-001` and `E2E-GOAL-UI-002` passed 2/2, and
the hosted `ci.yml` run below passed. The Electron UI E2E for that change was
NOT RUN.

## Validation record

| Date | Code revision | Environment | Action | Result |
| --- | --- | --- | --- | --- |
| 2026-11-08 | `064813150` (PR #77 head) | GitHub-hosted, manual dispatch | `ci.yml` [run 42491215756](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42491215756), `docs-check.yml` [run 42492198737](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42492198737) | All jobs `success`; PR #77 merged as `e758c88d9`. No `pull_request` run ever fired because GitHub Actions was disabled when PR #77 opened; `pr-base.yml` was NOT RUN hosted and its script passed locally. |
| 2026-11-08 | `e758c88d9` | worktree, Node 22 | baseline checkout from fetched `origin/main` | Ready |
| 2026-11-08 | uncommitted prep | worktree, Node 22 | `node scripts/release.mjs 0.15.13 --skip-docs-check` | Bumped 7 version files. |
| 2026-11-08 | uncommitted prep | worktree, Node 22 | `node scripts/check-release-docs.mjs 0.15.13`, `node scripts/check-agent-policy.mjs` | Both passed. |
| 2026-11-08 | uncommitted prep | worktree, Node 22 | `vitest run` in `packages/shared` | 55 files, 667/667 passed. |
| 2026-11-08 | `a7fc37352` | local worktree, Node 22 | `node scripts/check-pr-base-main.mjs` with base `e758c88d9` | Passed. |
| 2026-11-08 | `a7fc37352` | GitHub-hosted PR #78 | `docs-check.yml` [run 42492980593](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42492980593) (`Docs checks`, 1m8s), `pr-base.yml` [run 42492980606](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42492980606) (`Head contains latest base`, 16s), `ci.yml` [run 42492980622](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42492980622) (`JS build / typecheck / lint / architecture / test` 8m4s, `Isolated launch / message / approval / restart smoke / fixture` 3m13s, `Rust host-core format / lint / test` 2m43s) | All five checks passed. PR #78 merged as `f9cbc4b37` on 2026-11-09 with the head pinned; the merged tree equals the tested head tree (`234170788ab3`). |
| 2026-11-09 | `f9cbc4b37` | this request's worktree, detached at the merged commit, clean | `ALLOW_UNSIGNED_MACOS_RELEASE` and Actions state rechecked; `node scripts/release.mjs 0.15.13 --tag`; `git push origin refs/tags/v0.15.13` | Variable `true`, Actions enabled; annotated tag created (object `b7e04f730`, peels to `f9cbc4b37`) and pushed; release run 42559184767 started at 03:57:59Z. |
| 2026-11-09 | `f9cbc4b37` | GitHub Actions run [42559184767](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42559184767) | All release jobs | Success in about 16 minutes: metadata, three shared verification jobs, macOS arm64 build, bundle verification and publication (04:14:00Z). |
| 2026-11-09 | release assets | local macOS, read-only: GitHub API plus `gh release download -O -` to the terminal, nothing saved | Cross-check of API digests and sizes, `release-manifest.json`, `SHA256SUMS` and `latest-mac.yml`; release flags and notes; re-hash of the three small assets | ZIP, DMG, both blockmaps and `latest-mac.yml` match in the API, the manifest and `SHA256SUMS`; `latest-mac.yml` sizes match; the three small files re-hash to their API digests. Manifest: version 0.15.13, channel `latest`, `signedMacos: false`, source `f9cbc4b37`, run 42559184767. Release: not draft, not prerelease, latest; the notes state unsigned and not notarized. Two fetches came back empty (one with a TLS handshake timeout) and matched on retry. |
| 2026-11-09 | release assets | not run | Download the DMG and ZIP; ZIP sha512 against the feed; `hdiutil verify`; extracted app identity and `piMacSigning` | NOT RUN: downloading the installers was not authorized. |
| 2026-11-09 | `f9cbc4b37` | primary checkout | `git merge --ff-only origin/main` | Local `main` synchronized; the checkout stayed clean. |
| 2026-11-09 | request worktree (detached at `f9cbc4b37`, clean, no ignored files) | primary checkout | `git worktree remove`, `git worktree prune`, `git branch -d chore/20261108-pi-rel-01513-macos-release` | Removed. `git worktree list` showed only the primary checkout and the worktree root held only `_archives`. The remote branch is kept. |

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| `a7fc37352` | Version 0.15.13 notes and version surfaces only; no runtime behavior change. | Release docs, changelog tests, shared tests 667/667, PR checks | Merged as `f9cbc4b37` (PR #78); tagged `v0.15.13` and published |

## Delivery and recovery

- Entry point: the [v0.15.13 release](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.13).
  Seven assets were published; `release-manifest.json` records
  `signedMacos: false` and source `f9cbc4b37176c31673443bf0bab041d03f168edb`.
- User path: download the DMG or ZIP from the release and install it manually.
  By design (README release paragraph, security spec section 7), Check for
  Updates on an installed ad-hoc build reports 0.15.13 and opens the release
  page instead of installing; this was not tried on an installed app.
- Not verified: the DMG and ZIP content hashes, the ZIP sha512 against the feed,
  `hdiutil verify` and the packaged `piMacSigning` stamp (the installers were
  not downloaded), Check for Updates on an installed app, native Gatekeeper
  acceptance and actual installation. Unsigned installs require manual
  installation.
- Known notes: the 0.15.13 changelog entry carries the preparation date
  2026-11-08 while the release was published on 2026-11-09. GitHub's immutable
  release setting is off (API `immutable: false`), so tag and asset
  immutability rests on the process rule below, not on the platform.
- User confirmation: none yet; acceptance remains pending explicit user
  confirmation (已验收).
- Rollback: the preparation commit is tagged, so by process rule the tag and
  the published assets are immutable. Do not replace uploads or move the tag;
  use the documented publication recovery path (runbook §4.4) only if a future
  run fails after creating a draft.
- Worktree close-out: the request worktree and the merged local branch are
  removed and local `main` is synchronized. The remote branches
  `chore/20261108-pi-rel-01513-macos-release` and
  `feat/20261108-pi-goal-1108-check-observation` are kept; deleting them is
  outside this authorization.
