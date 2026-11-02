# PI-REL-01512: Publish the 0.15.12 unsigned macOS maintenance release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01512`; status: 待体验
  (published; user acceptance pending).
- Created: 2026-11-02 (Asia/Taipei).
- Authoritative record: this file.
- Authorization: the user authorized the complete delivery of the PI-UPD-1102
  fix: push, PR, merge, and the 0.15.12 unsigned release. Final installation of
  the produced DMG remains the user's manual action.
- Baseline / release source: `b28a3c25179eaf7af683161feb9b4e801cdac253`
  (merge of the PI-UPD-1102 fix into remote `main`).
- Branch: `chore/20261102-pi-rel-01512-macos-release`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261102-chore-pi-rel-01512-macos-release`.
- Preparation PR: [#72](https://github.com/SakuraLoveSmile/PI-Desktop/pull/72),
  merged as `5a55d4eec423f8db434281ae090125568d2d006b`.
- Release: [v0.15.12](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.12),
  published 2026-11-02T06:54:41Z from the same source commit.
- Release run: [41401074053](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41401074053),
  all seven jobs successful.
- Target: remote `main`, tag `v0.15.12`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.11. The only behavior change since
that release is PI-UPD-1102: unsigned and ad-hoc macOS packages use manual
notify-and-link update delivery, while Developer ID-signed builds keep the
in-app lane.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` selects the
existing personal-use unsigned lane: ad-hoc integrity signing only, no
Developer ID or notarization, manual download and installation. Keep Pi 1.0.1,
upstream library manifests, Plus identity/profiles, schema P10 and the bundled
models.dev snapshot unchanged. No local installer build and no installation of
the produced app are authorized.

The release keeps the packaged `piMacSigning` stamp from PI-UPD-1102. The
0.15.12 notes must therefore state that unsigned macOS updates are manual; do
not repeat the previous release's wording that implied in-app installation was
still attempted.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.12 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale, same version set and highlight count; update `changelog.test.ts`; refresh both README release paragraphs. | Catalog tests and `node scripts/check-release-docs.mjs 0.15.12` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.12` on this branch to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.12; docs check passes. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`; PR base contains the latest `origin/main`. | 完成 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.12 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.12` publishes seven verified assets with `signedMacos: false`. | 完成 |
| T5 | Verify the published assets (SHA256/size, updater feed, manifest identity, ZIP CRC/app integrity), synchronize local `main`, retire task worktrees/local branches and retain evidence. | Remote release and manifest identity match the merged source; cleanup report separate from publication. | 完成 |

User path after publication: download the 0.15.12 DMG from the GitHub Release,
install it manually (Gatekeeper may require the documented personal-use
confirmation), and from that build onward unsigned releases are reported as
manual updates instead of failing in Squirrel. Acceptance remains pending
explicit user confirmation.

## Validation record

| Date | Code revision | Environment | Action | Result |
| --- | --- | --- | --- | --- |
| 2026-11-02 | `b28a3c251` | worktree, Node 22.23.2 | baseline checkout | Ready |
| 2026-11-02 | uncommitted prep | worktree, Node 22.23.2 | `node scripts/release.mjs 0.15.12` | Bumped 7 version files; release docs aligned with 0.15.12 (0.15.x line). |
| 2026-11-02 | uncommitted prep | worktree, Node 22.23.2 | `vitest run src/changelog.test.ts` | 5/5 passed |
| 2026-11-02 | uncommitted prep | worktree, Node 22.23.2 | `node scripts/check-release-docs.mjs 0.15.12`, `check-agent-policy-sync.mjs` | Both passed. |
| 2026-11-02 | `cd51aab99` / `f57d8abd8` | GitHub-hosted PR #72 | First hosted `JS build / typecheck / lint / architecture / test` run | Failed: `plus-changelog.test.ts` still expected 0.15.11 as the newest entry. Fixed the expectation in `f57d8abd8`; no product code changed. |
| 2026-11-02 | `f57d8abd8` | GitHub-hosted PR #72 | Re-run of all five PR checks | All passed before merge; PR merged as `5a55d4eec423f8db434281ae090125568d2d006b`. |
| 2026-11-02 | `5a55d4eec` | clean detached worktree | `node scripts/release.mjs 0.15.12 --tag`; `git push origin v0.15.12` | Annotated tag created and pushed; release workflow run 41401074053 triggered. |
| 2026-11-02 | `5a55d4eec` | GitHub Actions run 41401074053 | All release jobs | Success: metadata, three shared verification jobs, macOS arm64 build, bundle verification, and publication. |
| 2026-11-02 | release assets | local macOS arm64 | Download and verify ZIP, DMG, `latest-mac.yml`, `release-manifest.json`, `SHA256SUMS` | ZIP `302acd59...` and DMG `0b7642cf...` match the manifest/SHA256SUMS; ZIP sha512 matches the feed; `hdiutil verify` passed; extracted app is 0.15.12 with `piMacSigning = "adhoc"`. |
| 2026-11-02 | final `origin/main` `5a55d4eec` | primary checkout | `git merge --ff-only origin/main` | Local `main` synchronized; the four pre-existing user-modified files kept their before/after SHA-256 values. |

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| `cd51aab99` | Version 0.15.12 notes and version surfaces only; no runtime behavior change. | Release docs, changelog tests, PR checks | Merged as `5a55d4eec`; tagged `v0.15.12` and published |
| `f57d8abd8` | Pin 0.15.12 in the Plus catalog-overlay test after CI caught the stale expectation. | Shared tests 667/667, PR checks | Included in the same merge and release |

## Delivery and recovery

- Entry point: the [v0.15.12 release](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.12).
  Seven assets were published; `release-manifest.json` records
  `signedMacos: false` and source `5a55d4eec423f8db434281ae090125568d2d006b`.
- Not verified: native Gatekeeper acceptance, actual installation, and in-app
  update behavior on a signed lane. Unsigned installs still require manual
  installation.
- User confirmation: none yet; acceptance remains pending explicit user
  confirmation (已验收).
- Rollback: the preparation commit is tagged, so assets and the tag are
  immutable. Do not replace uploads or move the tag; use the documented
  publication recovery path only if a future run fails before publication.
- Worktree close-out: this worktree and the merged local release branch are
  retired after the closeout merge; local `main` is synchronized. Remote branch
  deletion is outside this authorization.
