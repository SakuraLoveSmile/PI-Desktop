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
- Each supported macOS architecture must carry a Plus main-executable UUID
  distinct from the stock Electron input and from the official PI-Desktop app.
  The identity change happens while the candidate is constructed, before final
  signing; an installed or already signed bundle is never patched.
- The selected supported route is an independently linked Electron main
  executable supplied to electron-builder through `electronDist`. Rewriting
  `LC_UUID` in a signed bundle, an `afterSign` hook that alters binary bytes, an
  Electron version change to obtain a different UUID, and a native launcher
  rewrite are all excluded.
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

## Identity qualification record (2026-09-30)

Apple TN3178 documents network-subsystem confusion when differently identified
applications reuse a main executable UUID, and TN3179 states that Local Network
identity uses code signing together with the main executable UUID. Read-only
inspection of the installed bundles found both installed main executables
reporting the same arm64 UUID, while the Plus bundle carries its own
`cn.sakura.pi-desktop` identifier, product name, `NSLocalNetworkUsageDescription`
and a valid Apple Development signature. That qualifies the *signature* and
*identifier* facts only. It does not prove causality for any Local Network
failure: no packet capture, HTTP response, native alert or settings entry was
observed for the current candidate, and the earlier September evidence concerned
a different build.

`scripts/macos-executable-identity.mjs` is the read-only qualification gate for
candidate and input paths. Per architecture slice it reports a missing UUID, a
wrong application identifier, a duplicate main-executable UUID against a supplied
reference, a missing or failing signature, or a qualified independent identity,
and it checks `NSLocalNetworkUsageDescription` presence. UUIDs belonging to
libraries are informational: only the main executable's UUID decides the
collision verdict. The verifier never writes, signs or patches anything, and it
reports a signature category rather than a signing-authority string.

Consuming an independently linked distribution requires an `electronDist` entry
that this fork does not declare yet, so that route is blocked on the build host
until an Electron source tree and the GN/Ninja toolchain exist; obtaining either
needs network access and explicit operator authorization. A read-only feasibility
probe recorded the exact blocker and the observed values. Until a candidate
passes the gate, the macOS Local Network repair stays **in progress**: the manual
intent, the supplemental trigger and their automated coverage are in place, while
the native alert, the independent System Settings entry and a real LAN HTTP
response remain unverified.
