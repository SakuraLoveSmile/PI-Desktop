# PI-REL-01516: Publish the 0.15.16 unsigned macOS release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01516`; status: 实现中
  (preparation in progress).
- Created: 2026-11-10 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Authorization: after the assisted-update failure was fixed in PR #85, the
  user chose "合并 #85 并发布 0.15.16" on 2026-11-10. That authorizes this
  preparation branch, its commit, push, PR, merge, the `v0.15.16` tag and the
  cloud publication. No local installer build and no installation are
  authorized.
- Baseline: `8f57bb21e8e6b7d0850db9beb0d27988246df6df` (merge of PR #85 into
  remote `main`, 2026-11-10T15:35:05Z).
- Branch: `chore/20261110-PI-REL-01516-release-prep`.
- Worktree:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261110-chore-PI-REL-01516-release-prep`.
- Preparation PR: not created yet.
- Release: none yet.
- Target: remote `main`, tag `v0.15.16`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.15. The only product change since
that release is PI-UPD-1110
([PR #85](https://github.com/SakuraLoveSmile/PI-Desktop/pull/85)): the update
helper ignores the bundle's `chrome_crashpad_handler` when deciding whether the
installed app is idle, so a crash reporter orphaned by an earlier launch no
longer aborts an in-app update with `bundle_in_use`. Every other bundle process
still blocks the exchange.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` keeps the
personal-use unsigned lane: ad-hoc signing only, manual download and
installation. Keep Pi 1.0.1, upstream library manifests, Plus
identity/profiles, schema P10 and the bundled models.dev snapshot unchanged.

The 0.15.16 changelog notes describe only the update fix. The release line
stays `0.15.x`, so the README paragraphs need no edit; `check-release-docs`
confirms it.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.16 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale with the same version and highlight count; update `changelog.test.ts` and `plus-changelog.test.ts`. | Shared package tests and `node scripts/check-release-docs.mjs 0.15.16` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.16` on this branch to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.16; docs check passes. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks; merge into remote `main`. | PR checks green and merge commit present in remote `main`. | 实现中 |
| T4 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.16 --tag`, push the tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.16` publishes the verified assets with `signedMacos: false`. | 未开始 |
| T5 | Verify the published assets and manifest identity, retire the task worktree and local branch, and record evidence. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 未开始 |

## Residual risks

- The helper change is covered by `cargo test -p update-helper` and the hosted
  Rust job, but its packaged effect (an update that survives an orphaned crash
  reporter) only shows in a later real in-app update; that journey is recorded
  as NOT RUN until then.
- The unsigned lane remains unqualified for Gatekeeper and notarization and
  installs manually, as recorded for 0.15.14 and 0.15.15.
