# PI-REL-01511: Publish the 0.15.11 macOS maintenance release

- Project: `fork-pi-desktop`; status: 待体验 (published; user acceptance pending).
- Created: 2026-11-01 (Asia/Taipei).
- Goal / authorization: publish a new installer containing the maintenance
  fixes landed by PI-UP-1101. The user's release request authorizes the
  preparation PR, gated merge, fresh version tag and cloud publication.
- Baseline: `0de3a8731f40350fcc1408bd54727c828353dc57`; target: remote `main`.
- Branch: `chore/20261101-pi-rel-01511-macos-release`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261101-chore-pi-rel-01511-macos-release`.
- Evidence: `/tmp/pi-rel-01511-artifacts`; durable closeout archive:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/.archives/20261101-pi-rel-01511/`.

## Scope and frozen decisions

The latest published stable release is 0.15.10. Publish unused patch version
0.15.11 without replacing existing tags or assets. Release notes cover only
the ten maintenance backports since that release, including the parent-only
provider-signature scope. Keep Pi 1.0.1, upstream library manifests at 0.16.1,
Plus identity/profiles and schema P10 unchanged. No models.dev refresh.

The existing release workflow builds macOS arm64 DMG/ZIP only. The live
repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true` selects the existing
personal-use lane: complete ad-hoc integrity signatures, no Developer ID or
notarization, and manual download/install. Do not modify the installed app,
user profiles, security settings, provider credentials or running instances.
No local installer build or `verify:ui:*` run is authorized by this task.

Synchronize inherited worktree location/naming clauses with the user's current
rules, including the paired policy entry points and delivery documentation.
Preserve the primary checkout's four pre-existing policy-document edits and
their index state; their initial hashes and binary diffs are in the evidence
directory. Ordinary worktree-path policy synchronization does not import the
rest of those uncommitted edits.

## Ownership and acceptance

The lead is the sole writer for release files, notes, this record and policy
path synchronization. A read-only scout independently checked the release
delta/version surfaces; a separate reviewer checks the final diff. No agent
starts a service, uses real profiles/providers or delegates further.

1. All app/Cargo/protocol versions agree on 0.15.11. All nine shipped locales
   contain accurate, newest-first notes with aligned highlight counts. Existing
   library versions, dependency lockfile and upstream catalogs remain intact.
2. Release-documentation and shared catalog tests pass locally using the
   provisioned dependencies by reference. The changed catalog expectation only
   adds the new stable version; no coverage or validation gate is weakened.
3. Preparation passes hosted exact-candidate checks and PR integration gates
   before merge. The existing E2E-067B acceptance remains accurate; this task
   changes release content/version metadata, not UI interaction or contracts.
4. The exact clean merged source is tagged through `scripts/release.mjs`.
   The formal cloud workflow passes every required job, publishes all assets,
   and its manifest, checksums and remote release identity match that source.
5. Synchronize primary `main` while retaining its original edits and staging;
   retain recoverable evidence, then remove this task's worktree/local branch.
   Remote branch deletion is outside the request.

## Validation and delivery

- Local environment: macOS arm64, Node 22.23.2, provisioned root/shared
  dependencies referenced by symlink. No dependency installation or local
  installer packaging completed. The local pnpm wrappers refused symlinked
  dependency state before running package scripts; direct existing tool
  equivalents below supplied the actual test/check results.
- `node scripts/release.mjs 0.15.11` and
  `node scripts/check-release-docs.mjs 0.15.11`: passed.
- Direct provisioned Vitest, from `packages/shared`, ran all 55 files / 667
  cases successfully. Initial 12 failures were stale release-list/cutoff
  expectations in `plus-changelog.test.ts`; add the new version and move the
  preserved history assertions by one. No tests or checks were removed or
  weakened. The expected-version changes implement the new catalog contract.
- Policy mirror check and 11 release-version-check tests passed. Direct
  documentation scripts verified 95 locale pairs and 629 pages (existing
  non-blocking ADR-format warnings remain). Test-quality ratchet, generated
  scenario index (138 suites / 167 executable IDs), PR-base and diff whitespace
  checks passed. No behavioral source/CSS assertion was added.
- Independent review of the release diff and the incremental catalog-test
  correction found no remaining blockers. Primary user-edit hashes remained
  unchanged. Final code diff before the record update:
  `7ad887f91decfbdc6f85a7e0f2be8b31d11f772c578e31ed2a36da5f6bbde111`.
- Preparation [PR #69](https://github.com/SakuraLoveSmile/PI-Desktop/pull/69)
  head: `9cbfd523ff79903fccfdee2857fb33ead12146a7`; base:
  `0de3a8731f40350fcc1408bd54727c828353dc57`. All five current-head checks passed:
  [CI](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41292906395),
  [Docs](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41292906390),
  [PR base](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41292906391).
- Hosted integration candidate `8ef9ca437c89c0b79923afe39af37956624404b9`
  has the same complete tree as the preparation head. Downloaded build and
  result receipts identify that candidate, a clean workspace and unchanged
  artifacts; all five isolated smoke suites passed. Rust: 1,280 passed / one
  existing ignored case. Workspace Vitest: 4,076 passed (the shared package's
  generated output is also collected by existing CI); Desktop: 4,243 passed /
  five existing skips; docs: 11 passed. Environment: Ubuntu, Node 24.22.1.
- Gated merge and release source:
  `a35b75d779a53c9d7b0023aa0cb08d1885cfde69`, with the same full tree as the
  validated integration candidate. The guarded release helper created fresh
  annotated tag `v0.15.11`, which was pushed successfully.
- Formal [release workflow](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/41293723895)
  passed all seven jobs against that exact source: metadata, JS, Rust, isolated
  smoke, macOS arm64 build, installer aggregation and publication. Tagged-source
  smoke receipts record
  source and fetched main both as the release SHA above; preflight's comparison
  base remains `0de3a8731f40350fcc1408bd54727c828353dc57`. Test totals match the
  preparation run. The native build ran on GitHub-hosted `macos-15` arm64 and
  strict app/Host signatures and resource seals passed in loose, ZIP-extracted
  and DMG-mounted forms. No notarization assessment is claimed.
- [v0.15.11](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.11)
  was published on 2026-11-01 at 09:51:34 UTC as the stable latest release.
  Its seven assets include DMG, ZIP, their blockmaps, updater metadata,
  `release-manifest.json` and `SHA256SUMS`. The publication job verified remote
  asset digests and sizes before publishing the draft. Independent download
  verification passed for all seven assets: remote SHA256/size, complete
  `SHA256SUMS`, manifest source/build identity and updater SHA512/size. ZIP CRC,
  app ID/version, DMG `hdiutil verify`, extracted app/Host strict resource seals
  and arm64 executables also passed on local macOS. The app was neither
  installed nor launched; existing user profiles and security settings were
  not accessed or changed.

  | Installer | Bytes | SHA256 |
  | --- | ---: | --- |
  | [DMG](https://github.com/SakuraLoveSmile/PI-Desktop/releases/download/v0.15.11/Pi-Desktop-Plus-0.15.11-arm64.dmg) | 138557348 | `8699bd36b5bc9fee258b2b46fc1c4914d81b983dad7d74c7151be7236bcbb651` |
  | [ZIP](https://github.com/SakuraLoveSmile/PI-Desktop/releases/download/v0.15.11/Pi-Desktop-Plus-0.15.11-arm64-mac.zip) | 136143409 | `848e4307e5ddab25915fc3839deab51729efc48b081989cc23df9d26a89abd5d` |
- Primary main already fast-forwarded to the release source; all four original
  user-file hashes and empty staged diff were verified unchanged. Recovery
  copies, original binary diffs and the synchronization receipt are retained.
- Publication and cleanup remain separate from user acceptance. Only explicit
  user feedback establishes 已验收.
- Previous PI-UP-1101 checks describe the previous source. This release's own
  workflow independently validated the exact tagged source; historical
  results are not reported as rerun here. Windows/Linux/Intel installers,
  Developer ID/notarization, Gatekeeper/Finder acceptance, automatic installer
  updates and real providers were NOT RUN / outside this release lane.

## Closeout and experience

The record-only closeout follows the preparation merge and publication. It
changes no executable source or immutable tag. Its PR must pass the current
documentation/base gates; no repeated runtime tests are needed for this
documentation-only receipt. After merge, synchronize main and retire this
task's local branch/worktree. Preserve the remote source branch.

The durable archive above retains the verified downloaded installers,
manifests, raw job logs, source/build/E2E receipts and recoverable primary user
edits. `final-delivery.json` is the mechanical end-state receipt: merged
closeout, local/remote main, no remaining task checkout/local branch and
unchanged primary user-file hashes/staging. It is evidence linked by this
authoritative task record, not a second task plan.

Next: manually download/install the Apple Silicon build and assess the fixes.
User installation/experience remains pending and does not block publication.
