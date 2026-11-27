# PI-REL-1132: prepare release 0.15.27

Status: 待体验 (preparation is complete and verified on the request branch; merge, tag and publication need the user's word). Project: `fork-pi-desktop`. Created: 2026-11-27, Asia/Taipei.
Tier: T2 (release surfaces). Baseline: `a202fbf3b` (`origin/main`, merge of #113).
Branch: `chore/20261127-pi-rel-1132-plus-0-15-27`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261127-chore-pi-rel-1132-plus-0-15-27`.

## Scope

Ship the sidebar restyle (PI-UI-1129, #113) and the E2E fixture repair (PI-TEST-1131, #112) as stable `0.15.27`. This request only prepares the version surfaces; it does not build an installer, tag or publish.

## Change

`node scripts/release.mjs 0.15.27` rewrote the version line on every watched surface: `Cargo.toml` workspace version, `Cargo.lock` host-core entry, `package.json`, `apps/desktop/package.json`, `apps/pi-host/package.json`, `docs/package.json`, and `packages/shared/src/protocol.ts` `APP_VERSION`.

`packages/shared/src/plus-changelog.ts` gained a `0.15.27` entry in all nine shipped locales (en, zh-CN, zh-TW, tr, de, es, fr, ko, pt-BR) with the same three highlights, newest first, above the unchanged `0.15.26` entry. The notes describe the sidebar the user now sees: one icon column for every row kind, five destinations above the list, an update-only footer pill, and one scroll region whose folded projects report hidden running work or a pending permission.

`packages/shared/src/changelog.test.ts` and `packages/shared/src/plus-changelog.test.ts` now expect `0.15.27` first; the per-index expectations shift by one and the cutoff assertions move to `catalog[21]` / `slice(21)` / `slice(0, 20)`. No assertion was weakened: the same versions, dates, highlight counts and upstream-cutoff boundary are still pinned.

The `README.md` and `README.zh-CN.md` release line already reads `0.15.x`, so no documentation line changed; `docs/spec/06-delivery/06-release-runbook.md` §4.1 lists the remaining surfaces and the checker reports all of them aligned.

## Validation

- `node scripts/release.mjs 0.15.27`: version surfaces rewritten, then the embedded documentation gate reported alignment and printed the tag steps.
- `node scripts/check-release-docs.mjs 0.15.27`: `Release documentation is aligned with 0.15.27 (0.15.x line).`
- `packages/shared` vitest: 56 files, 671 tests, all pass (changelog and Plus overlay catalogs included).
- `tsc -b packages/shared`: clean. Biome: 150 files, no fixes.

## Not run

- Installer, signing and publication: only GitHub-hosted Actions runners build those, and they need the tag this record does not push.
- The desktop unit suite and Electron E2E: this diff changes version strings, changelog data and the two changelog tests; cloud checks repeat them on the pull request.

## Next steps (each needs the user's word)

1. Merge the preparation pull request after its cloud checks pass.
2. On the merged commit, `node scripts/release.mjs 0.15.27 --tag`, then push only `v0.15.27`.
3. Let the release workflow build, sign and publish; record its run id here afterwards.

## Risks

- The changelog translations are mine; a native reader may prefer different wording. They carry the same three facts in every locale and the catalog test only pins counts.
- `ALLOW_UNSIGNED_MACOS_RELEASE` is untouched: the formal release keeps the signed lane unless the repository variable says otherwise.
