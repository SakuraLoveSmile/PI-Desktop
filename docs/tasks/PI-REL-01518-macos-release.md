# PI-REL-01518: Publish the 0.15.18 unsigned macOS release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01518`; tier: T2 (release);
  status: 实现中 (preparation committed; PR, candidate and acceptance
  pending).
- Created: 2026-11-14 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Authorization: on 2026-11-14 the user asked to ship PI-GOAL-1112 alone as the
  next patch version, chose to start the release preparation after PR #89
  merged, and then authorized in one message the preparation commit, the push
  of this branch, the preparation pull request and the candidate `release.yml`
  dispatch. The merge, the `v0.15.18` tag and the publication each still wait
  for their own explicit word, and only the user grants `已验收`. No local
  installer build is authorized.
- Baseline: `e45294260a44f4de5588e63f382450ced1270247` (merge of PR #89 into
  remote `main`, 2026-11-14T06:22:59Z).
- Branch: `chore/20261114-pi-rel-01518-release-prep`.
- Worktree:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261114-chore-pi-rel-01518-release-prep`.
- Preparation PR: the pull request from this branch into `main` (its number is
  recorded at closeout).
- Release: none yet.
- Target: remote `main`, tag `v0.15.18`, and the cloud release workflow.

## Scope and frozen decisions

Publish the next patch release after 0.15.17 (tag `v0.15.17` on
`9574c37017a68a5dddfd4e59b149780a7bbf67cd`, published 2026-11-11T19:24:43Z). The
only product change since then is PI-GOAL-1112
([PR #89](https://github.com/SakuraLoveSmile/PI-Desktop/pull/89), commit
`10a58044d`): the Goal report opens on the Result and the Next steps, everything
else sits in one collapsed Full report, the duration is active working time, and
a `kind = file` evidence reference that the Host does not check reads as not
checked. It is renderer, locale, style, test and documentation work: no Host,
schema, persistence, IPC or contract change. Its scope and behavior changes are
recorded in [PI-GOAL-1112](PI-GOAL-1112-report-two-block.md), which this request
leaves untouched; that record moves to its final status in the closeout PR after
publication and acceptance.

The live repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` (updated
2026-10-24, read 2026-11-14) keeps the personal-use unsigned lane: ad-hoc
signing only, no notarization. Keep Pi 1.0.1, upstream library manifests, Plus
identity/profiles, schema P10 and the bundled models.dev snapshot unchanged.

The 0.15.18 notes describe only PI-GOAL-1112: two highlights in each of the nine
shipped locales, quoting the shipped in-app labels (Result, Next steps, Full
report) and following each locale's existing wording for the Goal report and the
Host. They say "the Goal report" and claim nothing about the chat report card,
which PI-GOAL-1112 left unchanged. `README.md` and `README.zh-CN.md` each gain a
0.15.18 paragraph above the 0.15.17 one; the release line stays `0.15.x`.

The changelog date is 2026-11-14. If publication slips, move it in all nine
locales and in the `plus-changelog.test.ts` pin together.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add 0.15.18 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale with the same version and highlight count; update `changelog.test.ts` and `plus-changelog.test.ts`; add the README paragraphs. | Shared package tests and `node scripts/check-release-docs.mjs 0.15.18` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.18 --skip-docs-check` to align root/docs/apps versions, Cargo workspace/lock, and `APP_VERSION`. | Every version surface reports 0.15.18; the docs check passes without the skip flag. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks. | PR checks green; the head contains the latest `origin/main`. | 实现中 |
| T4 | Dispatch `release.yml` (`sign_macos=false`) on the preparation branch for an unpublished candidate bundle; the user installs it and tries a real Goal report. | Run URL, source/base SHAs, every job conclusion and the artifact identity are recorded; the user states `已验收`. | 未开始 |
| T5 | Merge the preparation PR into remote `main` (merge commit, pinned head). | Merge commit present in remote `main`. | 未开始 |
| T6 | From a clean checkout of the merged commit, run `node scripts/release.mjs 0.15.18 --tag`, push only `refs/tags/v0.15.18`, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.18` publishes the verified assets with `signedMacos: false`. | 未开始 |
| T7 | Verify the published assets and manifest identity, retire this worktree and local branch, and record the evidence; the closeout PR also moves PI-GOAL-1112 to its final status. | Remote release and manifest identity match the merged source; cleanup reported separately from publication. | 未开始 |

## Local validation

Run in the worktree with node directly (pnpm is not used in overlay worktrees),
after a green baseline at 0.15.17 (release-document check aligned, the two
changelog test files 28 pass):

| Check | Result |
| --- | --- |
| `node scripts/release.mjs 0.15.18 --skip-docs-check` | bumped `package.json`, `docs/package.json`, `apps/desktop/package.json`, `apps/pi-host/package.json`, `Cargo.toml`, `Cargo.lock`, `packages/shared/src/protocol.ts` |
| `node scripts/check-release-docs.mjs 0.15.18` (no skip flag) | aligned with 0.15.18 (0.15.x line); no `.release-changelog-*` directory left behind |
| `packages/shared`: vitest (whole package) and `tsc --noEmit` | 55 files, 667 tests pass; exit 0 |
| `scripts/check-agent-policy.mjs`; `node --test scripts/release-*.test.mjs scripts/publish-release.test.mjs scripts/require-cloud-build.test.mjs scripts/refresh-macos-release-metadata.test.mjs` | pass; 86 pass, 0 fail |
| `scripts/check-test-quality.mjs` (base `origin/main`); `scripts/generate-scenario-index.mjs --check`; `scripts/check-architecture.mjs` (base `origin/main`) | pass; index current (138 suites, 168 ids); pass, 0 new TS/TSX files |
| `docs/scripts/check-locales.mjs`; `docs/scripts/check-docs.mjs` | 95 pairs; 645 pages |
| `node --test scripts/e2e-suite.test.mjs scripts/scenario-index.test.mjs scripts/test/*.test.mjs scripts/pi-patch-hash.test.mjs` | 32 pass, 0 fail |

The release-tooling tests (four of them), test-quality and the scenario index
first failed on a missing module in the overlay (`electron-builder`,
`typescript`); after the dependencies of `apps/desktop` and `packages/agent-runtime`
were linked into the overlay, the same commands passed. No source was changed to
make them pass.

NOT RUN locally: `pnpm lint` (Biome ignores the changed TypeScript files by
configuration, so it processed none of them), `pnpm build:js`, the desktop
typecheck, `check:runtime-tests`, `pnpm docs:build`, the Rust jobs, the other
packages' unit tests and the smoke E2E; they are hosted-CI jobs. Pull request CI
does not run the release-document step, because it is conditional on the
`release_document_version` input that only `release.yml` passes; the candidate
run (T4) is its first hosted run.

## Residual risks

- The report change was validated in PI-GOAL-1112 (hosted CI and 36/36 `goals-team`
  E2E on the merged tree), but the packaged macOS build and a real-model Goal run
  are NOT RUN until the candidate is installed (T4).
- A candidate bundle runs against the same data directory (`~/.pi-desktop-plus`) as
  an installed app, so quit the installed app first. This release changes no
  schema or migration.
- Installing the candidate over the copy in `/Applications` means the formal
  0.15.18 will not appear as an in-app update (same version), so the assisted
  update path stays untested. To exercise it, run the candidate from where it was
  downloaded and keep the installed app in place.
- The unsigned lane remains unqualified for Gatekeeper and notarization, as
  recorded for 0.15.14 through 0.15.17.

## Runtime resources

Worktree-local, git-ignored: a `node_modules` overlay of links into the primary
checkout for `packages/shared`, `apps/desktop` and `packages/agent-runtime`. No
processes are left running.
