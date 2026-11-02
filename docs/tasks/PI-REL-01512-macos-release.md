# PI-REL-01512: Publish the 0.15.12 unsigned macOS maintenance release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01512`; status: 实现中.
- Created: 2026-11-02 (Asia/Taipei).
- Authoritative record: this file.
- Authorization: the user authorized the complete delivery of the PI-UPD-1102
  fix: push, PR, merge, and the 0.15.12 unsigned release. Final installation of
  the produced DMG remains the user's manual action.
- Baseline / release source: `b28a3c25179eaf7af683161feb9b4e801cdac253`
  (merge of the PI-UPD-1102 fix into remote `main`).
- Branch: `chore/20261102-pi-rel-01512-macos-release`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261102-chore-pi-rel-01512-macos-release`.
- Target: remote `main` for the preparation PR, then tag `v0.15.12` and the
  cloud release workflow.

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
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`; PR base contains the latest `origin/main`. | 未开始 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.12 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.12` publishes seven verified assets with `signedMacos: false`. | 未开始 |
| T5 | Verify the published assets (SHA256/size, updater feed, manifest identity, ZIP CRC/app integrity), synchronize local `main`, retire task worktrees/local branches and retain evidence. | Remote release and manifest identity match the merged source; cleanup report separate from publication. | 未开始 |

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

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| pending | Version 0.15.12 notes and version surfaces only. | pending | Not authorized yet |

## Delivery and recovery

- Entry point: the GitHub Release `v0.15.12` DMG/ZIP assets.
- Not verified: native Gatekeeper acceptance, actual installation, and in-app
  update behavior on a signed lane. Unsigned installs still require manual
  installation.
- Rollback: revert the preparation commit if it has not been tagged; after
  publication, do not replace assets or move the tag. Restore the previous
  `latest-mac.yml` only through the documented recovery procedure if the
  workflow fails before publication.
- Worktree close-out: after publication verification, archive evidence,
  synchronize local `main`, then remove this worktree and the merged local
  branch. Remote branch deletion is outside this authorization.
