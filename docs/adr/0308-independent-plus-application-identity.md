# ADR 0308: Independent Pi-Desktop-Plus Application Identity

- Status: Accepted
- Date: 2026-09-26
- Amends for this fork: ADR 0278, ADR 0094, ADR 0204

## Context

The initial branding patch mixed Pi-Desktop-Plus copy with PI-Desktop package
identity, data roots, and update sources. Its macOS helper could not open the
generated bundle, existing development caches could prevent launch, and the
release checks disagreed with artifact names. Changing only the display name
would also create separate Electron locks over the same host database.

The user authorized the independent-install plan. Existing PI-Desktop data
and installations must remain intact; this is not an in-place upgrade.

## Decision

- The product name is `Pi-Desktop-Plus`, production ID is
  `cn.sakura.pi-desktop`, and macOS development ID adds `.dev`.
- Electron profiles use `Pi-Desktop-Plus` and `Pi-Desktop-Plus Dev`. Host data
  defaults to `~/.pi-desktop-plus` or `~/.pi-desktop-plus-dev` for desktop
  development. Explicit profile/data overrides retain their existing meaning.
- Standalone host-core and pi-host use the Plus data root. SSH-installed
  pi-host binaries, bootstrap state, logs and pidfile live under
  `~/.pi-desktop-plus/pi-host`; remote host data uses the parent Plus root.
- Windows executable/shortcut and macOS bundle names use the product name.
  Linux package, executable, desktop and icon identifiers use `pi-desktop-plus`.
- Release metadata, update links, remote-host artifacts and issue URLs use
  `SakuraLoveSmile/PI-Desktop`. There is no upstream binary-feed fallback.
- Packaged metadata uses `name=pi-desktop-plus`, giving electron-updater its
  own `pi-desktop-plus-updater` cache instead of the old product cache.
- Signed macOS releases require the fork operator's explicit identity and
  team configuration. Missing credentials or signature/team mismatches fail
  the signed lane. Unsigned local builds do not require signing credentials.
- Existing profiles are neither imported, moved nor deleted. Protocol names,
  package module names, database schema and Plugin SDK contracts stay stable.

## Alternatives

An in-place rename preserving the old app ID and data roots would retain an
upgrade chain but would not provide independent installations. It was not
selected. Automatically copying profiles would introduce credential and
database migration risks beyond the requested rename.

## Consequences

Plus starts with fresh data and fresh OS permissions. Old installations can
coexist, but explicitly pointing both products at the same data directory is
still an operator override, not a supported concurrent-write arrangement.
The fork needs its own release artifacts and signing credentials before a
signed release can be qualified. Source tests and unsigned builds do not
prove notarization, native Windows/Linux acceptance, or live update delivery.
