# 06. Desktop Release Runbook

> Plus uses `SakuraLoveSmile/PI-Desktop` for release feeds. Configure the fork
> signing identity and Apple team explicitly; upstream credentials are not
> defaults. Historical upstream mirror automation below remains upstream-only.
> Unsigned builds are not signed/notarized release evidence. Formal tags require
> signing by default; the repository variable `ALLOW_UNSIGNED_MACOS_RELEASE=true`
> explicitly permits a personal-use unsigned Release. Such releases require
> manual download and installation and do not qualify Gatekeeper or notarization.
> Packaged metadata uses `pi-desktop-plus`, so electron-updater keeps the Plus
> cache separate as `pi-desktop-plus-updater`.

> Current cloud release scope: macOS arm64 only for both manual candidates and
> formal tags. Intel macOS, Windows, Linux, and standalone pi-host release
> artifacts are not built by this workflow. Existing application and packaging
> support for those targets is unchanged; macOS signing/notarization remains the
> detailed qualification lane below.
> Cross-references: [milestones](01-mvp-milestones.md) · [process model](../03-runtime/07-process-model.md) · [security](../05-security/01-security.md)

## 1. Build lanes

Installer and release packages are built only on GitHub-hosted Actions runners.
Local development compilation remains supported; installer commands (including
unpacked `pack --dir`) and their wrappers require `GITHUB_ACTIONS=true` and
`RUNNER_ENVIRONMENT=github-hosted`. Self-hosted runners are not a packaging lane.
Do not set these values locally to bypass the guard.

| Lane | Entry point | Signing | Result |
|---|---|---|---|
| Development | `pnpm dev`, `pnpm build:js`, Cargo development commands | none required | local development output |
| Cloud candidate | Manual `release.yml` dispatch | unsigned by default; optional macOS signing | verified macOS arm64 Actions bundle only |
| Formal release | Push `v<version>` after its preparation PR merges | Developer ID + notarization by default; explicit opt-in for unsigned personal-use builds | verified, immutable GitHub Release with macOS arm64 assets only |

`scripts/release-macos.sh` is retired and exits with cloud-workflow guidance.
There is no local installer or publication fallback when cloud validation fails.

### 1.1 macOS packages use an independently identified Electron

Every cloud macOS packaging lane uses an independently assembled
Electron distribution instead of the stock one.
`scripts/package-macos-identity.mjs` runs `scripts/assemble-electron-dist.mjs`,
which compiles `apps/desktop/build/electron-main-stub.c` against the pinned
official framework and swaps the linked main executable into a copy of that
distribution. It then invokes electron-builder with
`-c.electronDist=<that copy>` and
`-c.afterPack=scripts/macos-identity-gate.mjs`. The gate fails the build when the
main executable's `LC_UUID` collides with the official Electron distribution or a
supplied reference (`PI_IDENTITY_REFERENCE`), when the declared application id or
the Local Network usage description is wrong, or when the host sidecar is missing
from the bundle. No macOS lane can reach electron-builder without those flags, so
there is no silent fallback to the stock distribution.

Why this exists: electron-builder renames Electron's prebuilt main executable
rather than relinking it, and Chromium's LLD linker derives `LC_UUID` from the
linked content, so every fork of one Electron release keeps the same UUID as the
official application. macOS attributes Local Network privacy to the code signature
together with that UUID, so sharing it costs this application its own permission —
measured here as no prompt, no privacy-pane entry, and dropped LAN requests
(ADR plus-independent-application-identity).

Consequences: a macOS package now needs a working `clang` toolchain, the assembler
runs offline (it uses the `node_modules/electron/dist` the pinned dependency
already provides and never downloads a source tree), and the Rust sidecar must be
built first (`pnpm run build:host-release`) or the gate stops the build. Windows
and Linux lanes are untouched: the wrapper forwards their arguments straight to
electron-builder.

On macOS, `pnpm dev` creates and reuses a fingerprinted branded Electron host
bundle under `.cache/electron-dev/`. Its bundle name, executable, identifier,
and ICNS resource are development-only Pi-Desktop-Plus values, so AppKit shows
Pi-Desktop-Plus in the application menu and uses the canonical icon in the native
About panel. The runtime also applies `build/icon_1024.png` to the Dock. Stock
files under `node_modules` are never modified. Windows/Linux development keeps
the normal electron-vite executable. Windows Main nevertheless registers the
same `cn.sakura.pi-desktop` AppUserModelID used by the NSIS package before
Electron readiness, preventing the stock host identity from owning native
notifications or taskbar groups. The Windows package additionally pins the
`Pi-Desktop-Plus` executable and Start menu shortcut names. The launcher sets
`PI_DESKTOP_DEV=1` so runtime packaging checks keep update delivery disabled
and preserve developer workspace defaults despite the branded executable name.
The first `pnpm dev` on Electron 43+ downloads the Electron binary on demand
(the package no longer installs it during `pnpm install`). Clean cloud runners
explicitly fetch that pinned Electron binary before building or running E2E.
Unsigned cloud lanes explicitly select `mac.identity=-` for a complete ad-hoc
signing pass, including the resource seal. Disabling certificate discovery alone
skips final signing and leaves the independently linked executable with an
incomplete linker signature. Ad-hoc signatures do not provide Developer ID or
notarization qualification. Unsigned cloud lanes do not request a secure
timestamp. Every signed lane, including signed candidates and formal releases,
requires the secure timestamp used for notarization.
Packaged lanes use `build/icon.icns` through electron-builder on macOS and
`build/icon.ico` for the Windows executable and native window icon. The
renderer imports the same PNG through `BrandLogo`. The PNG is canonical;
`scripts/make-icon.py` derives the multi-size Windows ICO, the 512px
Windows/Linux package PNG, the
transparent monochrome `build/tray-icon-mac.png` template, and the iconset/ICNS
when macOS `iconutil` is available, without overwriting the canonical source.

## 2. Prerequisites (release lane)

1. Repository Actions access and permission to dispatch a candidate. Formal
   publication additionally requires authorization to push the version tag.
2. Configure all six macOS signing secrets in §4.6 for a signed candidate or
   the default signed formal release. A formal unsigned personal-use release
   requires `ALLOW_UNSIGNED_MACOS_RELEASE=true` instead. The certificate and
   signing TeamIdentifier must belong to the fork operator and match the
   configured identity.
3. GitHub-hosted native runners with the pinned Node/pnpm, Rust, Electron and
   lockfile dependencies. No prebuilt local output is a release input. The
   workflow checks runner architecture and compiles the native host on it.

## 3. What the build ships

- Electron app with hardened runtime + entitlements
  (`build/entitlements.mac.plist`: V8 JIT, unsigned-executable-memory,
  library-validation disable for Electron helpers and plugin native addons,
  and microphone input for plugin capture after user grant — ADR 0257), plus
  `NSLocalNetworkUsageDescription` and `NSMicrophoneUsageDescription` in
  Info.plist (via `apps/desktop/package.json` → `mac.extendInfo`). The local
  network string is required so macOS 15+ prompts for Local Network access and
  grants it to both the Chromium main process and the `ELECTRON_RUN_AS_NODE`
  agent sidecar — without it, LAN provider requests from the sidecar fail with
  `EHOSTUNREACH` even though the main process's Test Provider fetch succeeds
  (issue #573).
- `Resources/bin/pi-desktop-host-core` — Rust host binary (release build).
- Windows NSIS builds include an x64 `pi-desktop-host-core.exe` statically
  linked to the MSVC CRT, so a clean Windows x64 or Windows 11 ARM64
  (x64-emulated) installation does not need a separate Visual C++
  Redistributable before the local service can start.
- `Resources/agent-runtime/` — bundled sidecar, executed with
  `ELECTRON_RUN_AS_NODE=1` (no separate Node shipped).
- `Resources/licenses/` — notices that must remain distributable when the
  corresponding dependency's build-only source tree is pruned.
- `Resources/app.asar` — Electron Main, preload, renderer output, and only the
  runtime-resolved production modules. Renderer libraries are already present
  in Vite output and are not copied again as raw package trees.
- Chromium locale packs for English, Simplified Chinese, Traditional Chinese,
  Turkish, German, Spanish, French, and Korean. Product catalogs remain bundled
  independently of Chromium locales.
- App icons `build/icon.icns` and `build/icon.ico` (derived from canonical
  `build/icon_1024.png` by `scripts/make-icon.py`).
- macOS menu bar template `build/tray-icon-mac.png`, derived from the dark PI
  mark with a transparent background; Windows/Linux use the product PNG tray
  resource.

## 4. Release steps

### 4.1 Mandatory release version-surface gate (D164 + D260)

**Every product release that bumps a stable app version and cuts a tag MUST
first update every version-bearing surface: the shipped-locale in-app product
changelog and the version numbers stated in project documentation.** Tagging a
stable version while any surface still describes an older version is a
**release process failure**: packaged builds cannot show "what's new" without a
network fetch, the READMEs advertise a stale release line, and GitHub
auto-generated release bodies are **not** a substitute (extends D120 /
ADR 0022).

Surfaces in scope:

| Surface | Requirement |
|---|---|
| `packages/shared/src/plus-changelog.ts` | Newest-first Plus stable-version notes in English and every shipped locale; preserve upstream catalogs |
| `packages/shared/src/changelog.ts` and `changelog-*.ts` | Merged catalog remains aligned across locales; register newly shipped locales here |
| `packages/shared/src/changelog.test.ts` | New stable version first in the expected version list |
| `package.json`, `apps/*/package.json`, `docs/package.json` | Same app version |
| `packages/*/package.json` | Keep the upstream version line; package versions must agree with each other (ADR plus-version-line) |
| `Cargo.toml` workspace version, `Cargo.lock` host-core version, `packages/shared/src/protocol.ts` `APP_VERSION` | Same app version |
| `README.md`, `README.zh-CN.md` | Current `<major>.<minor>.x` release line and accurate product/development claims |
| `apps/desktop/electron/main/settings-operation-metadata.json` | Metadata validated by the release-documentation gate |

Blocking preparation:

1. Add short user-facing Plus notes for the stable version in
   `plus-changelog.ts`, with the same versions and highlight counts in every
   shipped locale. `changelog.ts` merges these entries with upstream history;
   do not overwrite upstream catalogs to record a Plus release.
2. For a preview such as `x.y.z-rc.1`, catalog the stable `x.y.z` being previewed,
   not the prerelease identifier. Update `changelog.test.ts` and both READMEs.
3. Run `node scripts/release.mjs <version>` on the dedicated request branch to
   prepare the version files. This command does not commit, build installers,
   push, or refresh models.dev. Review resource updates explicitly; the tagged
   tree's checked-in models.dev snapshot is packaged unchanged.
4. Pass `node scripts/check-release-docs.mjs <stable-version>` and the shared
   changelog tests on the prepared source. The documentation checker compiles
   the TypeScript catalog into a temporary directory. When preparation checks
   must run in cloud, `--skip-docs-check` is preparation-only; the reused cloud
   CI gate still validates release documentation and must pass before merge.
   This option cannot be used with `--tag`.
5. Commit the preparation on the request branch, open its PR and merge into
   `main` after the required cloud checks. GitHub-generated web release notes
   never replace the in-app catalog.

### 4.2 Cloud candidate build

For a candidate of current `main`:

```bash
gh workflow run release.yml --ref main -f sign_macos=false
```

A request branch may be selected with `--ref <request-branch>` before merge.
The preflight pins the resolved full 40-character source SHA; every subsequent
job checks out that same commit. Keep the run URL, source/base SHAs, every job
conclusion and the final artifact identity with the validation record. A queued
or dispatched run does not prove a successful build.

Manual dispatch defaults to `sign_macos=false`. Set it to `true` only with the
six signing secrets configured. Both variants run the same shared CI barriers,
the macOS arm64 build and asset aggregation. They produce
`release-bundle-<version>-<source-sha>` in Actions only: no GitHub Release is
created and no public updater feed is published. Unsigned artifacts are debug
candidates and do not establish Gatekeeper/notarization qualification.

### 4.3 Formal tag and publication

After the version-preparation PR has merged, check out the exact merged commit
in a clean worktree, then:

```bash
node scripts/release.mjs <version> --tag
git push origin v<version>
```

Tag mode validates documentation, refreshes `origin/main`, verifies that the
clean checked-out commit already belongs to it, and requires the tag to be
absent locally and remotely. It creates an annotated tag only; it never bumps
files or commits. Network verification failures block tagging. Never replace an
existing tag or bypass this check with a manual tag on an unmerged branch.
Pushing the tag starts `.github/workflows/release.yml`.

The formal preflight rejects tag/app/Cargo/protocol version mismatches, a tag
that resolves to another commit, or a source not contained in freshly fetched
`origin/main`. Stable SemVer uses the `latest` channel. Named prereleases such
as `alpha`, `beta` and `rc` use their own updater channel and are published with
`prerelease=true` and `make_latest=false`; malformed or unsafe channels fail.
Formal tags require all six signing secrets by default and fail early if any are
missing. To publish an unsigned personal-use formal release, set the repository
Actions variable explicitly:

```bash
gh variable set ALLOW_UNSIGNED_MACOS_RELEASE --body true -R SakuraLoveSmile/PI-Desktop
```

The variable defaults to unset/false; remove it or set it to `false` to restore
the signed-only formal release policy. The manual `sign_macos` input remains
independent: explicitly requesting `sign_macos=true` still requires all six
secrets. The preflight freezes this opt-in in `allow_unsigned_macos` metadata so
the aggregate and publication jobs use the same decision. An unsigned Release
records `signedMacos: false`, is labeled unsigned and not notarized, and requires
manual download and installation for updates. macOS security settings remain
unchanged; Gatekeeper and automatic in-app installation are not qualified.
Unsigned manual candidates remain Actions-only and cannot be promoted directly
to a formal release.

The workflow executes these barriers in order:

1. **Metadata:** pin source SHA, version, channel, release kind and signing
   policy. Fetch `main` without changing the candidate checkout.
2. **Shared verification:** reuse `ci.yml` at that source for JS build,
   typecheck, lint, architecture/test-quality gates, tests, runtime-test
   typecheck, Rust fmt/clippy/tests, isolated smoke and release-script behavior
   tests. The full release-documentation gate runs after dependency install.
3. **Native build:** build Desktop for macOS arm64 on `macos-15`. Fetch the
   pinned Electron binary on the clean runner. Packaging uses `--publish never`;
   only the final publication job may write a Release. Both signing lanes must
   pass strict signature/resource integrity checks on the loose app and the
   actual ZIP/DMG apps before uploading artifacts.
4. **Aggregate:** require exactly `dist-mac-arm64` with its DMG and ZIP, both
   blockmaps, and `<channel>-mac-arm64.yml`; reject missing, unexpected,
   duplicate or unsafe paths. Check updater version, actual SHA512/size, then
   emit the canonical `<channel>-mac.yml`, `release-manifest.json` and
   `SHA256SUMS`. The manifest records source repository/SHA, run URL/id/attempt,
   version, channel, kind, signing policy and every asset's name/size/SHA256.
5. **Publish (formal tags only):** `scripts/publish-release.mjs` revalidates
   the bundle and remote tag/main identity, creates a draft, uploads every
   asset, verifies remote SHA256 digests and sizes, then publishes. A published
   release is immutable: existing assets are never overwritten. A failed draft
   remains for inspection; a retry must match its exact source and manifest
   identity and may reuse only identical uploaded assets. A mismatched draft
   blocks publication. Do not delete or replace it automatically.

### 4.4 Recover a failed publication

Use recovery only when the original tag run completed its shared CI, native
build and aggregation gates successfully, but the publish job failed after
creating a draft or uploading assets. For example, run `40063318462` passed all
six required gates and uploaded all seven assets into draft `422526425`; its
publisher then failed because GitHub's release-by-tag endpoint does not return
draft releases. The recovery workflow locates drafts through the paginated
release list and checks the matching draft again by its numeric ID.

Run the recovery workflow from current `main` with the original run ID:

```bash
gh workflow run recover-release-publication.yml --ref main \
  -f release_run_id=40063318462 -R SakuraLoveSmile/PI-Desktop
```

Recovery accepts only a completed failed/cancelled tag-push run for this
repository, with a canonical version tag, matching source SHA, all six required
gates successful, a failed/cancelled publish job, and one unique, unexpired
`release-bundle` artifact. The metadata step runs
`node scripts/recover-release-publication.mjs --run-id <release_run_id>` and
pins the unique artifact by its immutable numeric ID. The publish step downloads
that artifact and runs
`node scripts/recover-release-publication.mjs --run-id <release_run_id> --artifact-id <artifact_id> --directory dist`
on a GitHub-hosted runner. It verifies that the manifest's `build.runAttempt`
matches the original run's current `run_attempt`, so a bundle from a different
attempt cannot be substituted. Recovery uses the publisher code checked out
from the dispatch's current `main` SHA. It preserves the original tag, version,
source SHA, manifest and matching draft, and does not rebuild or overwrite
assets. Any `ALLOW_UNSIGNED_MACOS_RELEASE` opt-in must still be enabled and is
frozen across recovery steps when the original release is unsigned.

Recovery is not for build, test, aggregate, identity, digest or partial-run
failures. A draft or asset mismatch remains in place for inspection and blocks
recovery; never delete or replace it to make the workflow proceed.

The sole packaging lane uses native `macos-15` arm64 and verifies `uname -m`
before building the Rust host on the same runner.
Signed lanes pin `CSC_NAME` to the configured certificate common name, force
signing and notarization of the app, separately notarize/staple the DMG, then
verify code integrity, configured identity, Gatekeeper and both stapled tickets
before upload (§4.6–§5). These checks apply whenever signing is selected; the
explicit unsigned personal-use lane is recorded as unqualified.


Every builder invocation receives the explicit `-c.publish.channel=<channel>`
from preflight, including prereleases; feed names are not inferred from the
version string alone. After signed DMG notarization/stapling changes its bytes,
`scripts/refresh-macos-release-metadata.mjs` regenerates the external DMG blockmap
and refreshes that channel's macOS feed SHA512/size before verification/upload.
It uses electron-builder's installed blockmap implementation with an explicit
external output, and verifies that generating the map leaves the signed DMG
bytes unchanged. Aggregation then checks the final stapled artifact's hashes.

The macOS arm64 lane has explicit DMG/ZIP names (§6), including blockmaps, and
rejects unlabelled or wrong-architecture artifacts. The DMG retains
its branded 720×440 drag-to-Applications window with only the app and Applications
link. The ZIP contains `Pi-Desktop-Plus.app` at its root. Neither ships an
opening-help note or executable first-launch helper.

The current release workflow does not build Linux, Windows, Intel macOS or
standalone pi-host artifacts. Existing platform-specific packaging and update
behavior described below remains application capability documentation, not a
claim that those artifacts are present in current candidate bundles or releases.
The macOS arm64 input and final bundle inventory are checked by
`scripts/release-assets.mjs`, rather than inferred from a successful build job.

### 4.4 Documentation site deployment

The release workflow does not deploy the documentation site. Vercel Git
Deployments are disabled in `docs/vercel.json`, so changes to documentation
sources do not automatically update the production site. Deployments must be
initiated manually in Vercel when required.

### 4.5 CNB mirror trigger

After an upstream GitHub Release is published or updated,
`.github/workflows/mirror-to-cnb.yml` starts the CNB pipeline at
`aixk/Pi-Desktop`. GitHub Release remains the canonical artifact source; CNB
is a copy of the same tag for users who pull from
https://cnb.cool/aixk/Pi-Desktop.

The job:

- runs only on `vastsa/PI-Desktop`
- fires on `release` `published` / `edited`, and on `workflow_dispatch` with
  an explicit tag such as `v0.14.6`
- sends event `api_trigger_mirror` and `MIRROR_TAGS` set to that tag
- uses repository secret `CNB_MIRROR_TOKEN` and fails
  closed if the secret is empty
- builds the JSON body with `jq` so a missing tag cannot produce an empty
  `MIRROR_TAGS` value on a manual run

Re-running the workflow for the same tag is safe if the CNB pipeline is
idempotent. It does not rebuild desktop artifacts and does not change
electron-updater feeds.

### 4.6 GitHub Actions secrets for macOS signing

Create these under GitHub → repository `SakuraLoveSmile/PI-Desktop` → Settings →
Secrets and variables → Actions. Never commit the p12, password, Apple ID, or
app-specific password. Never `echo` these values in CI.

| Secret | Value |
|---|---|
| `CSC_LINK` | Base64 of the exported Developer ID Application `.p12` (Certificate + Private Key). electron-builder also accepts a file path, but CI uses the secret body. |
| `CSC_KEY_PASSWORD` | Password used when exporting that `.p12` |
| `APPLE_ID` | Apple ID email that belongs to team `${APPLE_TEAM_ID}` |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from https://appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | The fork operator's Apple Developer team ID, matching the signing certificate |
| `MAC_SIGNING_IDENTITY` | Developer ID Application certificate common name, including its team suffix |

Encode the p12 locally (do not paste the output into chat or the repo):

```bash
base64 -i developer-id-application.p12 | pbcopy
```

On Linux use `base64 -w0 developer-id-application.p12`. Files that must never
enter git: `*.p12`, `*.cer`, `*.p8`, `*.mobileprovision`.

### 4.7 macOS signing observability and timeouts

`electron-builder` prints one line before signing — `signing
file=release/mac-arm64/Pi-Desktop-Plus.app platform=darwin type=distribution
identityName=...` — and then nothing until the phase is over. Three mechanisms
hide in that gap, and the macOS lanes now expose all three:

| Point in the phase | What happens | How it is visible |
|---|---|---|
| Walk | `@electron/osx-sign` walks `Pi-Desktop-Plus.app/Contents` and collects every Mach-O file plus nested `.app` and `.framework` bundles | `DEBUG=electron-osx-sign*` prints `Walking... <dir>`; `scripts/macos-bundle-inventory.mjs` prints the same bundle's counts right after packaging |
| Per-file signing | `codesign --force --sign <identity> --timestamp --entitlements ... <file>` runs serially, deepest file first, the app bundle last | `DEBUG=electron-osx-sign*` prints `Signing... <file>` and `Executing... <file> codesign ...`; the codesign shim times every invocation. If a keychain ever refuses to hand the key to a wrapped `codesign`, `PI_SIGNING_NO_CODESIGN_SHIM=1` runs the phase without the shim |
| Silent retry | A failing pass is retried up to three more times with a 5s/10s/15s backoff and no log line | The watchdog's `codesign-calls` and `failures` lines expose repeated passes |
| App notarization | `@electron/notarize` zips the app, uploads it, and waits for Apple's queue (`mac.notarize=true`) | `DEBUG=electron-notarize*` prints `zipping application to`, `attempting to upload file to Apple`, `notarization success`, then electron-builder prints `notarization successful` |
| DMG notarization | The DMG carries its own signature, so the next step submits it again with `xcrun notarytool submit --wait` | The same watchdog keeps that wait observable and bounded |

`scripts/macos-signing-watchdog.mjs` wraps both long phases. It forwards every
child line with a `[sign] ` prefix and keeps the child's exit code, so the
failure semantics of the lane do not change. stdout and stderr are forwarded as
two independent streams, so their relative order can differ from a direct run,
and the child receives no stdin. It prints a heartbeat while the
child is silent (elapsed time, phase, last file, active codesign target), dumps
diagnostics when the phase produces no output and no codesign activity for
`PI_SIGNING_STALL_SECONDS` (the last file, the `ps` state of the signing
processes, the codesign log tail), and reports per-file codesign timings — call
count, total, p50, p95, maximum, and the slowest files — in a `[sign] summary`
block. The knobs:

| Setting | Default | Effect |
|---|---|---|
| `PI_SIGNING_TIMEOUT_SECONDS` | 2400 (CI: 1800 packaging, 1200 DMG) | Hard limit for the wrapped phase: diagnostics are dumped, the process group is killed, and the step exits 124 instead of hanging |
| `PI_SIGNING_STALL_SECONDS` | 300 | Silence with no codesign activity for this long triggers one diagnostics dump; the phase keeps running, because Apple's notarization queue is a legitimate wait |
| `PI_SIGNING_HEARTBEAT_SECONDS` | 60 | Heartbeat interval while the child produces no output |
| `DEBUG` | `electron-osx-sign*,electron-notarize*` | Namespaces that expose walking, per-file signing, and notarization progress |

`DEBUG` lists only the two namespaces that sanitize their own command lines,
because `electron-builder`'s namespace is not safe here: builder-util prints
every spawned command through a stem list that does not cover
`security set-key-partition-list -k <p12 password>`. On top of that the watchdog
redacts the values of `CSC_KEY_PASSWORD` and `APPLE_APP_SPECIFIC_PASSWORD` at any
length, the values of `CSC_LINK` and `APPLE_ID`, and any `--password` or `-k`
argument, from everything it emits — including the diagnostics, whose process
view prints `comm` only and never `argv`, and the summary, which carries counts
and redacted target paths. GitHub additionally masks every value that comes from
a secret.

Measured on the maintainer machine, one macOS arm64 bundle needs 93 `codesign`
invocations (91 signing, 1 verification, 1 entitlement display) and about 49s of
`codesign` wall time; only 16 of those files are Mach-O code and 5 are nested
bundles. `@electron/osx-sign` also signs binary resources — 33 `.pak` files plus
`.nib`, `.dat`, `.bin`, `.png`, `.icns`, and `app.asar` — because its walk
selects every file that looks binary, not only Mach-O. Excluding exactly those
data files with `mac.signIgnore` would remove roughly three quarters of the
calls, but it changes what the release artifacts carry and needs a notarized
release to validate, so it is deliberately not enabled.

`scripts/macos-signing-diagnostics.sh` records the runner baseline before the
certificate is imported: system version, `codesign --version`, keychain
identities/list/default, `xcrun --find notarytool`, and the reachability and
latency of `http://timestamp.apple.com/ts01`. The Developer ID identity is
expected to be absent at that point, because electron-builder imports it from
`CSC_LINK` while packaging; only `--require-identity` makes a missing identity
fatal.

Signer status: `@electron/osx-sign@1.3.3` is pinned exactly by
`app-builder-lib@26.15.3` and no override applies to it. Its
`signApplication()` awaits one `codesign` per file; it has no batch or parallel
path and no option or environment variable that enables one. A faster signer
therefore needs the `mac.sign` replacement hook, which is a rewrite rather than
a configuration switch, so the lane keeps the pinned signer and the diagnostics
above.

## 5. Verification gates

Every macOS lane, including unsigned candidates and opted-in personal-use
releases, must pass `scripts/verify-macos-release.sh --integrity-only
apps/desktop/release` before upload. It requires exactly one loose app, ZIP and
DMG, checks that each app has a resource seal, runs `codesign --verify --deep
--strict` on each app and `codesign --verify --strict` on each bundled Host.
It extracts the ZIP into a temporary directory and mounts the DMG read-only,
detaching it on success or failure. A detach failure fails the gate and retains
the scratch directory for diagnosis. No installed application or security
setting is modified.

Unsigned artifacts are not Gatekeeper-qualified. The default signed lane must
also pass the Developer ID/team, notarization and staple checks below; the
integrity-only mode does not replace those checks.

Two separate notarization submissions exist, because Apple notarizes one
artifact per submission and electron-builder only covers the app:

| Artifact | Submitted by | Ticket |
|---|---|---|
| `Pi-Desktop-Plus.app` (inside the ZIP) | electron-builder `-c.mac.notarize=true` | stapled by electron-builder |
| `Pi-Desktop-Plus-<version>-<arch>.dmg` | `scripts/notarize-and-staple-macos-release-dmg.sh` (`notarytool submit --wait`) | stapled by the same script after `status: Accepted` |

A DMG that was never submitted has no ticket, so stapling it fails with
`Could not find base64 encoded ticket ... Error 65`. Stapler retries are only
allowed after Apple returns `Accepted`.

The GitHub-hosted verification steps run after every signed release build:

```bash
for APP in apps/desktop/release/mac-*/Pi-Desktop-Plus.app; do
  codesign -dv --verbose=4 "$APP"          # identity + hardened runtime flags
  codesign --verify --deep --strict --verbose=2 "$APP"
  spctl --assess --type execute --verbose=4 "$APP"
  xcrun stapler validate "$APP"
done
xcrun stapler validate apps/desktop/release/*.dmg
```

To read the Apple notarization log for a submission (the Release workflow does
this automatically when a submission is not accepted):

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID"
```

### 5.1 Package footprint gate

Inspect every native-runner package before publication and record all
compressed artifact formats, unpacked application, ASAR, Electron
framework/runtime, locale, and unpacked-native sizes. Compare them with the
previous stable release; an unexplained increase above 15% blocks publication
until reviewed.

The package inventory must confirm:

- exactly one `Resources/agent-runtime/sidecar.js` and one target-native Rust
  host binary
- no raw renderer packages such as Mermaid, Shiki, React, KaTeX, or Lucide
  under packaged `node_modules`
- no dependency `*.map`, test, example, declaration, or second agent-runtime
  tree in ASAR
- required third-party license and notice files remain in ASAR or
  `Resources/licenses` when their non-runtime package trees are pruned
- only the configured English, Simplified Chinese, Traditional Chinese,
  Turkish, German, Spanish, French, and Korean Chromium locale packs

The first audited optimized package establishes the platform baseline. Keep
per-platform measurements rather than applying one budget to different
Electron target layouts.

The first macOS arm64 baseline was captured on 2026-07-30 from an unsigned
`electron-builder --dir` package. Sizes below sum regular-file bytes so they
remain comparable across filesystems; the compressed artifact is not
applicable to this directory-only validation build.

| Inventory | Bytes | MiB |
|---|---:|---:|
| Unpacked application | 251,724,810 | 240.1 |
| `Contents/Frameworks` | 218,567,792 | 208.4 |
| `Contents/Resources` | 33,102,807 | 31.6 |
| `Resources/app.asar` | 20,944,962 | 20.0 |
| `Resources/app.asar.unpacked` native payload | 137,336 | 0.1 |
| Historical English and Simplified Chinese Chromium locale packs baseline | 1,033,673 | 1.0 |
| Agent sidecar | 3,258,983 | 3.1 |
| Rust host | 7,160,000 | 6.8 |

The pre-optimization unpacked regular-file total was 559,355,716 bytes
(533.4 MiB). The audited package is 307,630,906 bytes smaller, a 55.0%
reduction. Its curated renderer output is 14.1 MiB, down from 20.5 MiB.

#### Renderer output budget

The renderer bundle carries three standing controls. Regressing any of them
shows up as renderer growth in the table above and must be explained before
publication:

- **Minification is explicit.** `electron-vite` hard-defaults the renderer
  preset to `minify: false`, unlike plain Vite, so
  `apps/desktop/electron.vite.config.ts` sets `minify: "esbuild"`. Removing it
  silently doubles emitted JS.
- **Legacy font formats are stripped.** The `pi-drop-legacy-font-fallbacks`
  plugin removes `woff` and `truetype` `src` entries before Vite registers
  them as assets. The bundled Chromium supports `woff2` universally, so those
  faces would be emitted and never served.
- **Brand marks are renderer-sized.** `src/assets/brand/logo-{light,dark}.png`
  are the renderer assets. `build/icon_1024.png` and `build/logo_dark.png` are
  electron-builder installer icons and must not be imported by the renderer.

Renderer output measured on 2026-08-26 after applying these three controls,
against the same tree at `v0.10.8`:

| Renderer group | Before | After |
|---|---:|---:|
| JavaScript (120 chunks) | 12.53 MiB | 7.72 MiB |
| `woff2` | 15.71 MiB | 15.71 MiB |
| `woff` + `ttf` legacy fallbacks (40 files) | 0.78 MiB | 0 |
| PNG brand assets | 1.23 MiB | 0.27 MiB |
| CSS | 0.42 MiB | 0.35 MiB |
| **Total `out/renderer`** | **31 MiB** | **24 MiB** |

The renderer no longer emits any application font face. D598 / ADR 0298 removed
the four bundled families (Geist, Inter, Noto Sans SC, LXGW WenKai), so the only
`woff2` files left in `out/renderer` are KaTeX's math glyphs. Measured on this
machine from a clean `pnpm install --frozen-lockfile`, with and without the
removal:

| Renderer group | Bundled fonts | After D598 |
|---|---:|---:|
| JavaScript (121 chunks) | 9.04 MiB | 9.04 MiB |
| `woff2` (23 → 19 files) | 15.71 MiB | 0.24 MiB |
| CSS (1 file) | 0.48 MiB | 0.48 MiB |
| PNG brand assets (4 files) | 0.08 MiB | 0.08 MiB |
| GIF (2 files) | 0.05 MiB | 0.05 MiB |
| **Total `out/renderer`** (152 → 148 files) | **25.36 MiB** | **9.89 MiB** |

The entire difference is the four deleted faces, at the sizes the build reports:
`lxgw-wenkai.woff2` 8,016.75 kB, `noto-sans-sc.woff2` 7,782.07 kB,
`inter.woff2` 352.24 kB, and `geist.woff2` 69.65 kB — 16,220.71 kB, which is the
whole 15.47 MiB drop in the total. Chinese text now renders from the system tier
(`PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`), so no glyph coverage is
lost to subsetting: no face ships.
The other two controls are unchanged: minification stays explicit, and the
legacy `woff`/`truetype` strip stays because KaTeX still declares those sources.

The three-controls table above is the `v0.10.8` record and predates the removal,
so its `woff2` row is no longer current.

Manual smoke on a clean profile (`PI_DESKTOP_DATA_DIR=$(mktemp -d)`):

1. `pnpm dev` launches with `Pi-Desktop-Plus` in the macOS application menu and the
   canonical icon in both the Dock and native About panel; no Electron brand is
   visible.
2. App launches from DMG install, window appears, and the application-menu,
   About-panel, and Dock branding match the development lane.
3. Empty home and expanded/collapsed sidebar show the canonical Pi-Desktop-Plus
   logo; composer prompt rows have no leading brand icon; New task and
   project/Temporary create controls use the message-plus session icon.
4. Onboarding checklist appears; configure provider; one streamed chat turn.
5. One permissioned tool call (Write) allow + deny paths.
6. Quit/relaunch → session history restored, window bounds restored.
7. `~/.pi-desktop-plus/logs/` contains categorized NDJSON under `app/`, `host/`,
   and `agent/`; key lifecycle, tool, provider, plugin, and error records are
   available without dedicated timing files.
8. With network access disabled, the shell still starts; English/Chinese
   switching, syntax highlighting, shell highlighting, KaTeX, Mermaid
   fallback/rendering, host health, and sidecar health continue to use packaged
   local assets.

## 6. Current cloud release artifacts

The Release workflow builds only the macOS arm64 target on GitHub-hosted Actions.
Installer commands remain guarded against local and self-hosted execution.

```text
Runner: macos-15 (native arm64)
Input group: dist-mac-arm64
Inputs: Pi-Desktop-Plus-<version>-arm64.dmg, its .blockmap,
        Pi-Desktop-Plus-<version>-arm64-mac.zip, its .blockmap,
        <channel>-mac-arm64.yml
Final bundle: those four assets plus <channel>-mac.yml,
              release-manifest.json, and SHA256SUMS
```

The macOS arm64 package includes the native `bin/pi-desktop-host-core` binary.
macOS signing and notarization are mandatory for formal tags by default; the
documented personal-use opt-in publishes an unsigned, not notarized package.
Rollback and installer upgrade qualification remain separate release hardening
work.

The application still contains Windows and Linux support, and the packaging
scripts retain their target implementations. Those targets are paused in the
cloud Release workflow: they are not built, attached, or published by candidate
runs or formal tags under the current scope.
Standalone pi-host bundles are also absent from new releases. Remote-host
bootstrap that downloads matching-version pi-host assets is therefore
unavailable from these releases; the runtime and source capability remain.

### 6.1 Existing platform behavior outside current release output

The portable Windows ZIP target does not write `latest.yml`. The Windows
release helper builds NSIS and ZIP separately and stamps the ZIP app metadata
with `piDistribution = "zip"`; packaged ZIP runs use notify-and-link delivery.
Legacy portable executables remain manual when `PORTABLE_EXECUTABLE_FILE` is
present. NSIS keeps the in-app download and quit-and-install lane. Data stays
in the existing application data directory. Users extract the ZIP and launch
`Pi-Desktop-Plus.exe` directly, so the package does not run a self-extracting
wrapper or request administrator execution.

RPM targets pass `_build_id_links none` to FPM. Bundled Electron binaries live
under `/opt/PI-Desktop`; omitting global `/usr/lib/.build-id` links prevents
collisions with other applications that bundle the same Electron binaries.

The ASAR asset contains the Electron application archive, not a complete Linux
distribution. To repackage it, place it as the application archive in the
target Electron resources layout together with the native host and other
resources from the target package, then launch it with:

```bash
electron Pi-Desktop-Plus-<version>-linux-<arch>.asar
```

The following describes existing target behavior; it is not a current cloud
release build matrix. When those targets return to the release workflow, run the
corresponding platform smoke checks before publishing them.

Shell smoke on each native runner:

1. Confirm no File/Edit/View/Window/Help menu appears inside the window.
2. Verify F10 and Shift+F10 remain available to focused content.
3. Execute application and editing shortcuts from a focused editor.
4. Minimize, maximize, restore, and close from the custom controls.
5. Relaunch with `PI_DESKTOP_START_MAXIMIZED=1`; confirm the initial
   maximize/restore glyph matches the queried native state.
6. Verify unknown menu/window IPC actions fail with the window open and closed.

## 7. Known limitations

The following target-specific notes describe existing application and packaging
behavior; they do not indicate that these targets are included in current cloud
release bundles.

- Linux deb/rpm and the Windows portable ZIP remain notify-and-link update
  modes. Packaged macOS, Windows NSIS, and Linux AppImage use in-app
  `electron-updater`.
- Linux x64 and arm64 packages are built on Ubuntu 22.04 (native `ubuntu-22.04`
  and `ubuntu-22.04-arm` runners), so host-core needs glibc 2.35 or newer
  (Ubuntu 22.04, Debian 12, Fedora 36+). Each tag job runs
  `scripts/check-linux-host-glibc.mjs` and refuses a binary that needs a
  newer glibc.
- Linux arm64 microphone capture works on Raspberry Pi boards only:
  `@picovoice/pvrecorder-node` classifies Linux arm64 by `/proc/cpuinfo` CPU
  part. Speech-to-text (`transcribe-cpp` ships a `linux-arm64-cpu-vulkan`
  bundle) and every other feature work on any arm64 Linux device.
- Rollback and staged rollout remain open release work. Prereleases have
  separate named feeds and never become GitHub latest. Existing unsigned macOS
  installs may need one manual signed DMG installation before in-app updates
  succeed; obtain that installer from the cloud release.
