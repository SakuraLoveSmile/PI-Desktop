# PI-REL-01515: Publish the 0.15.15 unsigned macOS release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01515`; status: 实现中
  (preparation in progress; tag and publication await the user's word).
- Created: 2026-11-10 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Authorization: after the PI-KP-1110 sidebar fix merged as PR #83, the user
  asked whether a new version could be built, chose "先跑未签名候选，验证后再发
  0.15.15", and on 2026-11-10 confirmed the candidate and said "开始 0.15.15
  发布准备". That authorizes this preparation branch, its commit, push and PR.
  Merge of the preparation PR and the `v0.15.15` tag still need the user's
  explicit word; no local installer build and no installation are authorized.
- Baseline: `18cde6bc3874e63cafa99279d21a3e678de1ef10` (merge of PR #83 into
  remote `main`, 2026-11-10T12:40:08Z).
- Branch: `chore/20261110-PI-REL-01515-release-prep`.
- Worktree:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261110-chore-PI-REL-01515-release-prep`.
- Preparation PR: [#84](https://github.com/SakuraLoveSmile/PI-Desktop/pull/84),
  opened 2026-11-10.
- Release: none yet.
- Target: remote `main`, tag `v0.15.15`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.14. Product behavior changed since
that tag only in PI-KP-1110 ([PR #83](https://github.com/SakuraLoveSmile/PI-Desktop/pull/83)):
a sidebar row that groups checkouts sharing project memory is now hidden only
while an open checkout of that row is archived, so a KaneoPilot dispatch into a
new worktree of a repository whose primary checkout was archived appears with
its task. The setup that reproduced it and the fix were verified by the user in
the unsigned candidate below. PR #82 (the 0.15.14 closeout) also landed since
the tag and changes only documents.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` (read
2026-11-10) keeps the personal-use unsigned lane: ad-hoc integrity signing only,
no Developer ID or notarization, manual download and installation. Keep Pi
1.0.1, upstream library manifests, Plus identity/profiles, schema P10 and the
bundled models.dev snapshot unchanged.

The 0.15.15 changelog notes and the README release paragraph describe only the
sidebar fix. The release line stays `0.15.x`, so the README paragraphs need no
edit; `check-release-docs` confirms it.

## Candidate build (before preparation)

Manual dispatch `gh workflow run release.yml --ref main -f sign_macos=false`
built [run 42819145569](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42819145569)
from `18cde6bc3`; every job succeeded and the publish job was skipped, so no
GitHub Release was created. Artifact
`release-bundle-0.15.14-18cde6bc3874e63cafa99279d21a3e678de1ef10` was downloaded
to `~/Downloads/pi-0.15.14-candidate-18cde6bc3`, its `SHA256SUMS` verified, and
`release-manifest.json` records `kind: candidate`, `signedMacos: false` and the
same source SHA. The user installed this candidate and confirmed the KaneoPilot
dispatch now appears.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.15 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale with the same version and highlight count; update `changelog.test.ts` and `plus-changelog.test.ts`. | Shared package tests and `node scripts/check-release-docs.mjs 0.15.15` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.15` on this branch to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.15; docs check passes. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`. | 实现中 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.15 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.15` publishes the verified assets with `signedMacos: false`. | 未开始 |
| T5 | Verify the published assets and manifest identity, retire the task worktree and local branch, and record evidence. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 未开始 |

## Residual risks

- The packaged-app verification of PI-KP-1110 used the candidate above, not the
  final 0.15.15 installer; the tag build reuses the same shared CI gates and the
  same source tree.
- The unsigned lane remains unqualified for Gatekeeper and notarization and
  installs manually, as recorded for 0.15.14.
