# PI-REL-01511: Publish the 0.15.11 macOS maintenance release

- Project: `fork-pi-desktop`; status: 实现中.
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
- Preparation head, base, PR and integration candidate: pending.
- Tag source, formal workflow and asset verification: pending.
- Merge, publication and cleanup: pending; these are tracked separately from
  user acceptance. Only explicit user feedback establishes 已验收.
- Previous PI-UP-1101 checks describe the previous source. The new release
  workflow will independently validate the exact tagged source; historical
  results are not reported as rerun here.

Next: validate preparation, commit and publish its PR, pass current-source
gates, merge, create the fresh tag, then verify cloud publication and cleanup.
