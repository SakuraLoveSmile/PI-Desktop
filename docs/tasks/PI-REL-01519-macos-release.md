# PI-REL-01519: Publish the 0.15.19 unsigned macOS release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01519`; tier: T2 (release);
  status: 实现中 (preparation committed; PR, candidate and publication
  pending).
- Created: 2026-11-15 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Authorization: on 2026-11-15 the user asked in one message to commit the
  PI-UI-1114 work and then release a new version (`将此次会话内容提交 然后发新版本`).
  The executor put one plan to them (push and pull request for PI-UI-1114, its
  merge with a merge commit on the pinned head, this preparation pull request
  and its merge, a candidate `release.yml` dispatch on merged `main`, the
  `v0.15.19` tag and its push, and the cleanup) and the user answered
  `按计划发布`. That covers those steps. A failed or unexpected gate stops the
  chain and is reported instead of being worked around. Only the user grants
  `已验收`. No local installer build is authorized.
- Baseline: `12d1c842b7a4246f7ca8a04e5f2b78eaba19a6bb` (merge of PR #91 into
  remote `main`, 2026-11-14T19:02:30Z; its tree equals the tree of the PR head
  `35bef0c5d`).
- Branch: `chore/20261115-pi-rel-01519-release-prep`.
- Worktree:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261115-chore-pi-rel-01519-release-prep`.
- Preparation PR: the pull request from this branch into `main` (its number is
  recorded at closeout).
- Release: none yet.
- Target: remote `main`, tag `v0.15.19`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.18 (tag `v0.15.18`, peeled to
`a963980c2`, published 2026-11-14T14:09:01Z and still the latest release on
2026-11-15). The only product change since then is PI-UI-1114
([PR #91](https://github.com/SakuraLoveSmile/PI-Desktop/pull/91), merge commit
`12d1c842b`, change commit `35bef0c5d`): 59 stylesheet references to retired
design tokens are remapped, so the Team panel, the chat Goal report card, the
plugin theme cards and the blur control render the weights, accents and borders
they were written with; the light quiet-text tier goes from `#afafaf` to
`#858585`; two layout defects are fixed; and the desktop `lint` gains three
token guards. It is renderer style, lint guard, test and documentation work: no
Host, schema, persistence, IPC or contract change. Its scope, evidence and risks
are recorded in [PI-UI-1114](PI-UI-1114-visual-polish.md), which this request
leaves untouched; that record moves to its final status in the closeout PR after
publication and acceptance.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` (read
2026-11-15) keeps the personal-use unsigned lane: ad-hoc signing only, no
notarization. Keep Pi 1.0.1, upstream library manifests, Plus
identity/profiles, schema P10 and the bundled models.dev snapshot unchanged.

The 0.15.19 notes describe only PI-UI-1114: two highlights in each of the nine
shipped locales, worded with each locale's own interface terms for Team, Goal
report, subagent, extensions and marketplace. The zh-CN text therefore says
团队面板 and 目标报告 where the draft shown to the user with the release plan
said `Team 面板` and `Goal 报告`; the meaning is unchanged. The notes claim
nothing about light-theme status colours (success, warning, error), which stay
under 4.5:1 and belong to the separate request PI-UI-1115. `README.md` and
`README.zh-CN.md` each gain a 0.15.19 paragraph above the 0.15.18 one; the
release line stays `0.15.x`.

The changelog date is 2026-11-15. If publication slips, move it in all nine
locales and in the `plus-changelog.test.ts` pin together.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.19 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale with the same version and highlight count; update `changelog.test.ts` and `plus-changelog.test.ts`; add the README paragraphs. | Shared package tests and `node scripts/check-release-docs.mjs 0.15.19` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.19` to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.19; the documentation check inside the command passes. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks. | PR checks green; the head contains the latest `origin/main`. | 实现中 |
| T4 | Merge the preparation PR into remote `main` (merge commit, pinned head). | Merge commit present in remote `main`. | 未开始 |
| T5 | Dispatch `release.yml` on `main` with `sign_macos=false` for an unpublished candidate bundle. | Run URL, source/base SHAs, every job conclusion and the artifact identity are recorded. | 未开始 |
| T6 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.19 --tag`, push only `refs/tags/v0.15.19`, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.19` publishes the verified assets with `signedMacos: false`. | 未开始 |
| T7 | Verify the published assets and manifest identity, retire this worktree and local branch, and record the evidence; the closeout PR also moves PI-UI-1114 to its final status. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 未开始 |

No candidate acceptance by the user sits between T5 and T6: the plan the user
approved tags once the candidate and the hosted gates pass. `已验收` after
installing the published build stays the user's.

## Local validation

Run in the worktree with node directly (pnpm is not used in overlay worktrees),
on `12d1c842b` plus this change:

| Check | Result |
| --- | --- |
| `node scripts/release.mjs 0.15.19` | bumped `package.json`, `docs/package.json`, `apps/desktop/package.json`, `apps/pi-host/package.json`, `Cargo.toml`, `Cargo.lock`, `packages/shared/src/protocol.ts`; its own documentation check passed |
| `node scripts/check-release-docs.mjs 0.15.19` | aligned with 0.15.19 (0.15.x line) |
| `packages/shared`: vitest (whole package) | 55 files, 667 tests pass |
| `packages/shared`: `tsc --noEmit` | exit 0 |
| `scripts/check-agent-policy.mjs`; `node --test scripts/release-*.test.mjs scripts/publish-release.test.mjs scripts/require-cloud-build.test.mjs scripts/refresh-macos-release-metadata.test.mjs` | pass; 86 pass, 0 fail |
| `scripts/check-test-quality.mjs` (base `origin/main`, and the CI form); `scripts/generate-scenario-index.mjs --check`; `scripts/check-architecture.mjs --base origin/main`; `scripts/check-style-tokens.mjs` | pass; index current (138 suites, 168 ids); pass, 0 new TS/TSX files; `style tokens OK` |
| `docs/scripts/check-docs.mjs`; `docs/scripts/check-locales.mjs` | 647 pages (this record included); 95 pairs |
| `node --test scripts/e2e-suite.test.mjs scripts/scenario-index.test.mjs scripts/test/*.test.mjs scripts/pi-patch-hash.test.mjs` | 32 pass, 0 fail |

NOT RUN locally: `pnpm lint` (Biome ignores the changed TypeScript files by
configuration), `pnpm build:js`, the desktop typecheck, `check:runtime-tests`,
`pnpm docs:build`, the Rust jobs, the other packages' unit tests and the smoke
E2E; they are hosted-CI jobs. Pull request CI does not run the release-document
step, because it is conditional on the `release_document_version` input that
only `release.yml` passes; the candidate run (T5) is its first hosted run.

Hosted evidence is recorded at closeout: the preparation PR checks, the
candidate run, the release run, and the three nightly-tier `e2e-run.yml`
families (`goals-team`, `shell`, `extensions`) dispatched on `main` at
`12d1c842b` to cover what PI-UI-1114 touched and what pull request CI does not
run.

## Residual risks

- PI-UI-1114 was checked on macOS in the Electron development build, the capture
  rig and four local Electron suites. The packaged macOS build and a real-model
  run are NOT RUN until the published build is installed.
- A candidate bundle runs against the same data directory (`~/.pi-desktop-plus`)
  as an installed app, so quit the installed app first. This release changes no
  schema or migration.
- The unsigned lane remains unqualified for Gatekeeper and notarization, as
  recorded for 0.15.14 through 0.15.18. Whether an installed 0.15.18 updates in
  place depends on its update setting (manual is the default); this request does
  not exercise it.
- The `update-helper` lock test
  (`platform::tests::lock_is_exclusive_until_the_holder_is_dropped`) is known to be
  flaky: it failed the Rust job of release run 43601364521 attempt 1 on
  2026-11-14. One `gh run rerun --failed` at the same SHA is the accepted remedy
  and a second failure stops the chain; a tag is never replaced.
- Light-theme status text (success, warning, error) stays under 4.5:1; it is the
  separate request PI-UI-1115 and is not part of this release.

## Runtime resources

Worktree-local, git-ignored: a `node_modules` overlay of links into the primary
checkout for the repository root and `packages/shared` (its vite cache
directories are real directories inside the worktree). No local process is left
running; the three hosted E2E runs and later release runs live on GitHub.
