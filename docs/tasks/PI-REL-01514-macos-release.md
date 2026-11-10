# PI-REL-01514: Publish the 0.15.14 unsigned macOS release with the assisted in-place update

- Project: `fork-pi-desktop`; task ID: `PI-REL-01514`; status: 待体验
  (published; user acceptance pending).
- Created: 2026-11-09 (Asia/Taipei).
- Authoritative record: this file.
- Authorization: on 2026-11-09 the user answered the PI-UPD-1109 delivery report
  with "是的 请按照流程发布新版本". I read that as authorizing the commit, push
  and pull request of PI-UPD-1109, its hosted validation and merge, and the
  preparation, merge, tag and cloud publication of this release. The user then
  authorized this closeout PR ("开收尾 PR"). Final installation of the produced
  DMG remains the user's manual action.
- Baseline: `b6e11df48fe0a51d91d0f7d9ab0286c9ed198576` (merge of PR #80 into
  remote `main`, 2026-11-09T11:36:11Z).
- Branch: `chore/20261109-pi-rel-01514-macos-release` (merged; the local branch
  is deleted, the remote branch is kept).
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261109-chore-pi-rel-01514-macos-release`
  (removed after publication verification).
- Preparation PR: [#81](https://github.com/SakuraLoveSmile/PI-Desktop/pull/81),
  merged as `531e78c100ac2ef7936abe24b421f753d4e0b410` on 2026-11-09T11:46:28Z;
  this is the release source commit.
- Release: [v0.15.14](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.14),
  published 2026-11-09T12:04:57Z from the same source commit.
- Release run: [42611786896](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42611786896),
  all seven jobs successful.
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
there is no schema, IPC channel or stored-format change. PR #79 (the 0.15.13
closeout) also landed since the tag and changes only documents.

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
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`; PR base contains the latest `origin/main`. | 完成 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.14 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.14` publishes the verified assets with `signedMacos: false`. | 完成 |
| T5 | Verify the published assets and manifest identity, retire task worktrees/local branches and retain evidence. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 完成 |

T5 verified the release through the GitHub API digests and sizes, the release
flags and notes, and the three small metadata assets (`release-manifest.json`,
`SHA256SUMS`, `latest-mac.yml`) read with `gh release download --output -` into
the session scratchpad, outside the repository. The DMG and ZIP themselves were
not downloaded, so their content hashes, `hdiutil verify` and the packaged
`piMacSigning` stamp were not rechecked on the published bytes (NOT RUN). The
hosted gate `Verify macOS arm64 artifacts, feed and checksums` (the step of the
`Verify macOS arm64 installer bundle` job that runs `scripts/release-assets.mjs`)
had already hashed both installers from the built bytes and compared their
SHA-512 and size with the feed before upload; the published digests match what it
wrote into `SHA256SUMS`.

## Candidate E2E

The preparation changes no runtime behavior, so its candidate evidence is the
hosted shared verification: the preparation PR's checks and the tag run's reused
`ci.yml` gates, which include the isolated launch, message, approval and restart
smoke. Both were green: PR #81's five checks on `2021c17d7` and the tag run's
three shared verification jobs on `531e78c10` (see the validation record).

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
| 2026-11-09 | `b6e11df48` | GitHub | PR #80 merged with a merge commit, head pinned to `e8bbec82e` | Merge tree equals the PR head tree (`60cc8db13a67`); `origin/main` contains all four PI-UPD-1109 commits. |
| 2026-11-09 | `2185e7e08` | worktree, Node 22 | preparation branch cut from the then-current `origin/main`, rebased onto `b6e11df48` after the merge | Ready |
| 2026-11-09 | uncommitted prep | worktree, Node 22 | `node scripts/release.mjs 0.15.14 --skip-docs-check` | Bumped 7 version files. |
| 2026-11-09 | uncommitted prep | worktree, Node 22 | `node scripts/check-release-docs.mjs 0.15.14`, `node scripts/check-agent-policy.mjs` | Both passed. |
| 2026-11-09 | uncommitted prep | worktree, Node 22 | `vitest run` in `packages/shared` | 55 files, 667/667 passed. |
| 2026-11-09 | `2021c17d7` | GitHub-hosted PR #81 | `docs-check.yml` [run 42610619363](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42610619363) (`Docs checks`, 55s), `pr-base.yml` [run 42610619293](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42610619293) (`Head contains latest base`, 15s), `ci.yml` [run 42610619313](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42610619313) (`JS build / typecheck / lint / architecture / test` 7m30s, `Isolated launch / message / approval / restart smoke / fixture` 3m48s, `Rust host-core format / lint / test` 3m28s) | All five checks passed. PR #81 merged as `531e78c10` at 11:46:28Z with the head pinned; the merged tree equals the tested head tree (`fab14911a34e`). |
| 2026-11-09 | `531e78c10` | preparation worktree, detached at the merged commit, clean | `node scripts/release.mjs 0.15.14 --tag`; push of tag `v0.15.14` | Annotated tag created (object `a48387a9d`, peels to `531e78c10`) at 11:47:02Z and pushed; release run 42611786896 started at 11:47:23Z. |
| 2026-11-09 | `531e78c10` | GitHub Actions run [42611786896](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42611786896) | All release jobs | Success in about 18 minutes: metadata, three shared verification jobs, macOS arm64 build (6m40s; its steps include "Test the macOS update helper"), bundle verification (including `Verify macOS arm64 artifacts, feed and checksums`) and publication (12:04:57Z). |
| 2026-11-09 | release assets | local macOS, read-only: GitHub API plus `gh release download --output -` into the scratchpad, nothing added to the repository | Scripted cross-check of API digests and sizes, `release-manifest.json`, `SHA256SUMS` and `latest-mac.yml`; release flags and notes; re-hash of the three small assets | No mismatch. Seven assets, all `uploaded`: ZIP (136471080 bytes), ZIP blockmap, DMG (138918203 bytes), DMG blockmap, `latest-mac.yml`, `release-manifest.json`, `SHA256SUMS`. The API sha256 digest of each asset except `SHA256SUMS` equals its `SHA256SUMS` line; the five assets in the manifest match it by size and sha256; the feed sizes for the ZIP and DMG equal the API sizes; the three small files re-hash to their API digests. Manifest: version 0.15.14, channel `latest`, `signedMacos: false`, source `531e78c10`, run 42611786896 attempt 1. Release: not draft, not prerelease, latest, `immutable: false`, target `531e78c10`; the notes carry the fixed unsigned notice and list PRs #79, #80 and #81. |
| 2026-11-09 | `531e78c10` | local macOS, Node 22; scratchpad script loading the repository's `ts-import-hooks.mjs` | Fed the published `latest-mac.yml` to the lane's own `selectAssistedAsset(…, "arm64")` and `isAllowedAssetUrl` | Selected `Pi-Desktop-Plus-0.15.14-arm64-mac.zip` with the URL rebuilt from the fixed repository and tag, the feed's sha512 and size 136471080; the URL was accepted, and x64 and ia32 were refused (`asset-missing`). This covers parsing and selection only; the lane's download and hash check on the real ZIP first runs in an update from an installed 0.15.14. |
| 2026-11-09 | release assets | not run | Download the DMG and ZIP; ZIP and DMG sha512 against the feed on the published bytes; `hdiutil verify`; extracted app identity and `piMacSigning`; Gatekeeper | NOT RUN: downloading the installers was not authorized. |
| 2026-11-09 | `531e78c10` | primary checkout | `git merge --ff-only origin/main` | Local `main` synchronized; the checkout stayed clean. |
| 2026-11-09 | preparation worktree (detached at `531e78c10`, clean) | primary checkout | `git worktree remove` (no force), `git worktree prune`, `git branch -d chore/20261109-pi-rel-01514-macos-release` | Removed (the branch was `2021c17d7`). At that moment `git worktree list` showed only the primary checkout. The remote branch is kept. |

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| `2021c17d7` | Version 0.15.14 notes and version surfaces only; no runtime behavior change. | Release docs, changelog tests, shared tests 667/667, PR checks | Merged as `531e78c10` (PR #81); tagged `v0.15.14` and published |

## Delivery and recovery

- Entry point: the [v0.15.14 release](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.14).
  Seven assets were published; `release-manifest.json` records
  `signedMacos: false` and source `531e78c100ac2ef7936abe24b421f753d4e0b410`.
- User path: download the DMG or ZIP from the release and install it manually.
  This is the first release that contains the assisted update lane, so an
  installed 0.15.13 or earlier build still only reports the new version and
  opens the release page. An installed 0.15.14 can update in place to the next
  release when its location is eligible and Automatic is selected; that path was
  not tried on an installed app.
- Not verified: the DMG and ZIP content hashes, `hdiutil verify` and the
  packaged `piMacSigning` stamp on the published bytes (the installers were not
  downloaded), the lane's download and hash check on the real ZIP, replacing a
  bundle in `/Applications` under macOS App Management, Keychain or privacy
  grants after the cdhash changes, native Gatekeeper acceptance and actual
  installation. These are checked when the user installs this release and then
  updates from it.
- Known notes: the published release notes carry the fixed unsigned-lane notice
  ("install updates manually"), which is accurate for this first lane-bearing
  release; from the next release on it should mention the in-app update for
  eligible installs, which is the user's call. The changelog entry date
  2026-11-09 matches the publication date. GitHub's immutable release setting is
  off (API `immutable: false`), so tag and asset immutability rests on the
  process rule below, not on the platform.
- User confirmation: none yet; acceptance remains pending explicit user
  confirmation (已验收).
- Rollback: the preparation commit is tagged, so by process rule the tag and
  the published assets are immutable. Do not replace uploads or move the tag;
  use the documented publication recovery path (runbook section 4.4) only if a
  future run fails after creating a draft.
- Worktree close-out: the preparation worktree and the merged local branch are
  removed and local `main` is synchronized. The remote branches
  `chore/20261109-pi-rel-01514-macos-release` and
  `feat/20261109-pi-upd-1109-assisted-macos-update` are kept; deleting them is
  outside this authorization.
