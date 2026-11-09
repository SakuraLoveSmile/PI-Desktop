# PI-REL-01513: Publish the 0.15.13 unsigned macOS maintenance release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01513`; status: 实现中
  (preparation PR in review; publication pending).
- Created: 2026-11-08 (Asia/Taipei).
- Authoritative record: this file.
- Authorization: on 2026-11-08 the user asked to merge PR #77 (PI-GOAL-1108)
  and publish the release ("请你合并并发布"), accepting the proposed version
  0.15.13 and the unsigned personal-use lane. Final installation of the produced
  DMG remains the user's manual action.
- Baseline / release source: `e758c88d918ebc80a82b23f56c031ab9f5f54dc3` (merge of
  PR #77 into remote `main`). The tag source will be the merged preparation
  commit.
- Branch: `chore/20261108-pi-rel-01513-macos-release`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261108-chore-pi-rel-01513-macos-release`.
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
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`; PR base contains the latest `origin/main`. | 未开始 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.13 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.13` publishes the verified assets with `signedMacos: false`. | 未开始 |
| T5 | Verify the published assets and manifest identity, retire task worktrees/local branches and retain evidence. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 未开始 |

## Candidate E2E

The preparation changes no runtime behavior, so its candidate evidence is the
hosted shared verification: the preparation PR's checks and the tag run's reused
`ci.yml` gates, which include the isolated launch, message, approval and restart
smoke.

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

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| Preparation commit | Version 0.15.13 notes and version surfaces only; no runtime behavior change. | Release docs, changelog tests, PR checks | Pending merge, tag and publication |

## Delivery and recovery

- Not verified yet: the hosted preparation checks, the tag run, native
  Gatekeeper acceptance and actual installation. Unsigned installs require
  manual installation.
- User confirmation: none yet; acceptance remains pending explicit user
  confirmation (已验收).
- Rollback: once tagged, the tag and the published assets are immutable. Do not
  replace uploads or move the tag; use the documented publication recovery path
  (runbook §4.4) only if a run fails after creating a draft.
