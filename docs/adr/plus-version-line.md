# ADR: Plus releases use their own version line, and `packages/*` follow the upstream sync

- Status: Accepted
- Date: 2026-10-03
- Amends: D260 in the [decisions log](../spec/08-meta/decisions-log.md), which
  lists every workspace `package.json` as a version surface a release bumps

## Context

PI-Desktop-Plus and upstream PI-Desktop both ship releases from `0.15.x`, and
each release names a different tree. Two things tie a version number to
tooling:

- `scripts/release.mjs` bumps every `package.json` under `apps/` and
  `packages/` (plus the root and `docs/`), and `scripts/check-release-docs.mjs`
  fails unless all of them equal the app version.
- Upstream does the same at its own releases, so the `packages/*` manifests are
  among the lines every upstream sync merges. A Plus release that edits them
  conflicts on each of them at the next sync, and the resolution is always
  upstream's number.

Naming Plus releases had three candidates:

- Follow upstream's numbers. One number would then name two different trees,
  and a Plus release would have to wait for an upstream release to exist.
- Mark the fork with a prerelease suffix such as `0.16.0-plus.1`. Every hyphenated
  version is a prerelease in the release flow: `release.yml` publishes a tag
  containing `-` as a GitHub prerelease, and the updater always sets
  `allowPrerelease = false` (ADR 0022 item 3) so installs only ever move to the
  latest stable release. A Plus build with such a version would never be
  offered to Plus users.
- An independent semver line.

## Decision

Plus keeps an independent semver line, and only the surfaces that describe the
app carry it.

1. **App version line.** The Plus release number is its own plain
   `<major>.<minor>.<patch>`. It does not encode the upstream version of the
   tree, and it never carries a prerelease or build suffix for the sake of
   telling the fork apart.
2. **App surfaces.** The root `package.json`, `docs/package.json`,
   `apps/*/package.json`, the Cargo `[workspace.package]` version, the
   `host-core` entry in `Cargo.lock`, and `APP_VERSION` in
   `packages/shared/src/protocol.ts` carry the Plus release version. The
   release workflow reads the tag against `apps/desktop/package.json` and the
   host package from `apps/pi-host/package.json`, both app surfaces.
3. **Library manifests.** `packages/*/package.json` keep the version of the
   upstream tree the last sync merged. They are workspace-internal libraries
   that are never published or shown to users, so the number is only a
   bookkeeping label. A release does not edit them, and a sync takes upstream's
   value without a conflict.
4. **Tooling.** `scripts/release.mjs` bumps the app surfaces only.
   `scripts/check-release-docs.mjs` requires the app surfaces to equal the
   release version and `packages/*` to agree with each other. A partly merged
   sync, where some libraries moved and others did not, still fails the
   preflight.

## Consequences

- A Plus release never touches `packages/*/package.json`, so the manifests are
  not a recurring source of sync conflicts.
- After a sync, `packages/*` show which upstream release the tree was last
  merged from, while the app version shows which Plus release it is. They
  drift apart on purpose.
- A release made before this decision bumped every manifest. The first sync
  after it adopts upstream's library versions and leaves the app surfaces on
  the Plus line, so the preflight passes with the two groups at different
  numbers.
- Tools that assume one version across the whole workspace need the same
  split. None in this repository does beyond the two scripts above.
- A stable Plus release still follows the runbook's version-surface gate
  (D164, D260) for everything else: the in-app changelog, the README release
  line, the models.dev snapshot, and the Cargo and `APP_VERSION` surfaces.

## Alternatives

- Follow upstream's version numbers. The same number would name different
  trees, and the Plus release cadence would depend on upstream's.
- A `-plus.N` prerelease suffix. The release flow and the updater treat it as a
  prerelease, which changes publication and update behavior for every Plus
  user.
- Keep bumping `packages/*` with the app. Every sync would conflict on all of
  them, and each conflict would be resolved to upstream's number anyway.
