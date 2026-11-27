# PI-REL-1132: prepare release 0.15.27

Status: 已验收 (prepared, merged, tagged and published as `0.15.27`; the user confirmed the release outcome on 2026-11-27). Project: `fork-pi-desktop`. Created: 2026-11-27, Asia/Taipei.
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

## Published

- Preparation pull request: #114 merged into `main` as `08d6694fa` at 2026-11-27 06:56:10Z after its five cloud checks passed.
- Tag: `v0.15.27` (annotated) created on that commit by `node scripts/release.mjs 0.15.27 --tag`, pushed alone; `git rev-list -n 1 v0.15.27` resolves to `08d6694fa`.
- Release workflow run [45955118617](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45955118617): all seven jobs green — version/signing gate, Rust host-core, JS build·typecheck·lint·architecture·test, isolated smoke, Build macOS arm64, Verify installer bundle, Publish verified GitHub Release.
- Release: [v0.15.27](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.27), published 2026-11-27 07:08:48Z, not a draft and not a pre-release. Assets: `Pi-Desktop-Plus-0.15.27-arm64.dmg` (139,034,416 bytes, `fc674a78…`), its blockmap, `…-arm64-mac.zip` (136,579,604 bytes, `01d9990e…`), its blockmap, `latest-mac.yml`, `release-manifest.json` and `SHA256SUMS`. Every digest in `SHA256SUMS` matched the asset digest GitHub reports.
- Signing lane: personal-use ad-hoc. The workflow selects `-c.mac.identity=-` because `ALLOW_UNSIGNED_MACOS_RELEASE=true` (four of the six signing secrets are absent), so the bundle carries a complete ad-hoc seal with no Developer ID and no notarization. The first install stays a manual download that Gatekeeper asks to open; later updates arrive through the assisted in-app lane.
- Follow-up on this record: branch `docs/20261127-pi-rel-1132-release-record` (worktree `…/20261127-docs-pi-rel-1132-release-record`) over `08d6694fa`.

## Remaining decisions

- A signed and notarized release needs the four missing signing secrets configured first; the tag for that release must use a new version, because `v0.15.27` is published.
- The `README.md` release line stays `0.15.x`; nothing else claims the previous version.

## Not run originally

- Installer, signing and publication were left to the cloud lane; this record's preparation did not build, tag or publish.
- The desktop unit suite and Electron E2E: this diff changes version strings, changelog data and the two changelog tests; cloud checks repeat them on the pull request.


## Risks

- The changelog translations are mine; a native reader may prefer different wording. They carry the same three facts in every locale and the catalog test only pins counts.
- `ALLOW_UNSIGNED_MACOS_RELEASE` is untouched: the formal release keeps the signed lane unless the repository variable says otherwise.
