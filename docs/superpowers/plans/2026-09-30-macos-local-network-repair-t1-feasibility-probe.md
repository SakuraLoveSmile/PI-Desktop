# macOS local-network repair — T1 feasibility probe: independently linked Electron main executable

> Status: **feasibility conclusion only — BLOCKED**. No Electron source build
> was attempted, no bundle was modified, no packaging entry point was changed,
> and no certificate label, e-mail address, token, key, or team identifier is
> reproduced anywhere in this document.
>
> Date: 2026-09-30. Worktree:
> `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop-worktrees/macos-local-network-repair-t1-t3`
> (branch `codex/macos-local-network-repair-t1-t3`, base `aef7aad66`).
> Host: macOS 27.0 (build 26A428), arm64. Node v22.23.2.
> Companion deliverable: `scripts/macos-executable-identity.mjs` (read-only
> verifier) with `apps/desktop/test/macos-executable-identity.test.mjs`.

## 1. Question this probe answers

Pi-Desktop-Plus is assembled from the stock Electron distribution. If the main
executable of the packaged app carries the same Mach-O debug-symbol UUID as the
independently built/installed Electron inputs, then macOS cannot distinguish the
fork's main executable by that build identity. The repair route under
consideration was to build or relink an **independently linked Electron main
executable** and feed it into packaging.

This probe records what actually exists on this host for that route. It is a
conclusion, not an implementation.

## 2. Observed identity evidence (why the route was proposed)

All values below were produced by the read-only verifier in this task. UUIDs are
Mach-O build identifiers, not credentials.

| Slice | Bundle | `CFBundleIdentifier` | Main executable UUID | Signature category |
| --- | --- | --- | --- | --- |
| candidate | `/Applications/Pi-Desktop-Plus.app` | `cn.sakura.pi-desktop` | `4C4C44B6-5555-3144-A187-35A40BAD7A39` | apple-development (verified) |
| candidate | `<primary>/apps/desktop/release/mac-arm64/Pi-Desktop-Plus.app` | `cn.sakura.pi-desktop` | `4C4C44B6-5555-3144-A187-35A40BAD7A39` | apple-development (verified) |
| input | `<primary>/node_modules/electron/dist/Electron.app` | `com.github.Electron` | `4C4C44B6-5555-3144-A187-35A40BAD7A39` | adhoc (verification failed: `missing-resource-envelope`) |
| reference | `/Applications/PI-Desktop.app` | `net.aiuo.pi-desktop` | `4C4C44B6-5555-3144-A187-35A40BAD7A39` | developer-id (verified) |

Observed verdicts (three independent runs):

- `--candidate /Applications/Pi-Desktop-Plus.app --input <electron dist> --reference /Applications/PI-Desktop.app`
  → `duplicate-main-executable-uuid`, exit 1, 2 duplicate main-executable UUIDs
  (input + reference), 9 shared library UUIDs (informational only).
- `--candidate <primary>/apps/desktop/release/mac-arm64/Pi-Desktop-Plus.app --input <electron dist>`
  → `duplicate-main-executable-uuid`, exit 1.
- `--candidate /Applications/PI-Desktop.app --reference /Applications/Pi-Desktop-Plus.app`
  → `wrong-application-id`, exit 1 (failure precedence: application id is
  checked before the duplicate-UUID check).

Mechanical cause, verified in the installed `app-builder-lib@26.15.3`:

- `out/electron/electronMac.js:218` — `doRename(path.join(contentsPath, "MacOS"), productName, appPlist.CFBundleExecutable)`
  renames `Contents/MacOS/Electron` to `Contents/MacOS/Pi-Desktop-Plus`. It is a
  file rename; the binary is never relinked, so its Mach-O UUID is preserved.
- `out/electron/electronMac.js` `moveHelpers(...)` renames `Electron Helper*.app`
  to `<productName> Helper*.app` and their executables in the same way, so helper
  UUIDs are preserved as well.
- `otool -L` on both the stock electron main executable and the packaged Plus
  main executable reports the same single framework dependency,
  `@rpath/Electron Framework.framework/Electron Framework` — the main executable
  is linked against, and loads, the framework shipped next to it.

The 9 shared library UUIDs (Electron Framework, `chrome_crashpad_handler`,
Mantle, ReactiveObjC, Squirrel, and the four helper executables) are reported as
**informational only** by the verifier and are never treated as a collision,
because every Electron app built from the same release shares them.

## 3. Electron version: declared vs installed vs cached

| Probe | Command | Observed |
| --- | --- | --- |
| Declared range | `node -e 'console.log(require("./apps/desktop/package.json").devDependencies.electron)'` | `^43.4.1` |
| Lockfile resolution | `grep -n 'electron@' pnpm-lock.yaml` | `2791: electron@43.6.0:` and `7105: electron@43.6.0:` |
| Installed package | `node -e 'console.log(require("electron/package.json").version)'` | `43.6.0` |
| Extracted distribution | `cat <primary>/node_modules/electron/dist/version` | `43.6.0` |
| Download cache | `ls ~/Library/Caches/electron/<sha256>/` | `electron-v43.6.0-darwin-arm64.zip` (123643358 bytes) |

Findings:

- The declared range is `^43.4.1`; the **exact resolved and installed version is
  `43.6.0`**, and the cached and extracted distributions are the same `43.6.0`
  arm64 build. Declared range, lockfile, installed package, extracted dist, and
  cached zip agree.
- `electronDist` and `electronVersion` are not declared in the build config, so
  `app-builder-lib` resolves the version from the installed package:
  `out/electron/electronVersion.js:52 computeElectronVersion()` reads
  `node_modules/electron/package.json` → `43.6.0`.
- When this probe ran, this task worktree's `node_modules/electron/` held no
  `dist/` and no `path.txt`, so it had no extracted Electron distribution of its
  own; the extracted distribution used by packaging lives in the primary
  checkout. That was environment information, not a defect. The later E2E step of
  the same task extracted `dist/` in the worktree from the existing local cache
  (`electron-v43.6.0-darwin-arm64.zip`), which changes nothing about the verdict
  below: the block is the missing source checkout and toolchain, not the binary.

## 4. Source checkout and build toolchain on this host

| Probe | Command | Observed |
| --- | --- | --- |
| Xcode developer dir | `xcode-select -p` | `/Applications/Xcode-beta.app/Contents/Developer` |
| Xcode version | `xcodebuild -version` | `Xcode 27.0`, build `27A5237l` |
| macOS SDKs | `xcodebuild -showsdks` | `macOS 27.0` (`-sdk macosx27.0`) only |
| Compiler | `clang --version` | `Apple clang version 21.0.0 (clang-2100.3.30.1)`, target `arm64-apple-darwin27.0.0` |
| `gn` | `command -v gn` / `gn --version` | **not installed** (`gn: command not found`) |
| `ninja` | `command -v ninja` / `ninja --version` | **not installed** (`ninja: command not found`) |
| `autoninja`, `gclient`, `gn.py` | `command -v <tool>` | **not installed** |
| `depot_tools` | `ls ~/depot_tools` | `No such file or directory` |
| Python | `python3 --version` | `3.11.4` |
| Debug-symbol tooling | `command -v dwarfdump` | `/usr/bin/dwarfdump` (Apple LLVM 21.0.0) |
| Signing tooling | `command -v codesign` | `/usr/bin/codesign` |
| Electron source checkout | `ls -d ~/electron ~/src/electron ~/Documents/Code/electron ~/Library/Caches/electron/src` | all four **absent** |
| Electron source marker | `mdfind -name electron.gyp` | no results |
| Electron cache contents | `find ~/Library/Caches/electron -maxdepth 3` | only the `electron-v43.6.0-darwin-arm64.zip` payload directory |
| Platform | `sw_vers`, `uname -m` | macOS 27.0 (26A428), `arm64` |

Two independent probes were used for the same blocker — a `PATH` lookup for
`gn`/`ninja`/`depot_tools`, and a filesystem/Spotlight search for an Electron or
Chromium source checkout (`electron.gyp`) — and both agree. Per the repository
rule, no further retry was attempted after the second, different piece of
evidence.

## 5. Disk space

| Command | Filesystem | Size | Used | Available |
| --- | --- | --- | --- | --- |
| `df -h /` | `/dev/disk3s1s1` | 460Gi | 13Gi | **114Gi** (11%) |
| `df -h /System/Volumes/Data` | `/dev/disk3s5` | 460Gi | 308Gi | **114Gi** (74%) |

114 GiB is free. A Chromium/Electron checkout plus `gclient sync` and an
`out/Release` tree is a multi-tens-of-GiB undertaking, so free space is plausibly
sufficient but was **not** verified against a real checkout, and disk is not the
blocking factor on this host.

## 6. `electronDist` / `afterPack` assembly prerequisites

### 6.1 What `apps/desktop/package.json` declares today

Observed from the worktree (read-only):

- `build.appId`: `cn.sakura.pi-desktop`; `build.productName`: `Pi-Desktop-Plus`.
- `build.electronDist`: **not declared**. `build.afterPack`: **not declared**.
  A repository-wide search for `electronDist`/`afterPack` finds only policy
  references (`docs/adr/0289-signed-macos-github-releases.md:53`,
  `docs/adr/0278-canonical-application-id.md:30,49`,
  `docs/spec/08-meta/decisions-log.md` D450/D443) which forbid `afterPack` /
  `afterSign` adhoc signing. Nothing in the packaging path can currently point at
  a custom Electron distribution.
- `build.mac`: `target` `dmg` + `zip`, `hardenedRuntime: true`,
  `entitlements`/`entitlementsInherit` `build/entitlements.mac.plist`,
  `gatekeeperAssess: false`, `artifactName`
  `Pi-Desktop-Plus-${version}-${arch}-mac.${ext}`, `extraResources` for
  `bin/pi-desktop-host-core` and `tray-icon-mac.png`, `extraDistFiles` for the
  macOS open command and help text.
- `build.mac.extendInfo` already declares `NSLocalNetworkUsageDescription`,
  `NSMicrophoneUsageDescription`, and `NSBonjourServices`
  (`_http._tcp`, `_https._tcp`).
- `build.asar`: `smartUnpack: false`; `build.asarUnpack`, `electronLanguages`,
  `directories`, `publish`, `extraMetadata`, `files`, `dmg`, `win`, `nsis`,
  `deb`, `rpm`, `linux` are all declared.
- `scripts.pack` / `scripts.dist` / `scripts.dist:mac` are unchanged by this
  task; they run `electron-vite build` and then `electron-builder`.

### 6.2 Would an independent Electron distribution directory satisfy electron-builder?

Yes, if its layout is what `app-builder-lib@26.15.3` expects (read from the
installed dependency, not from documentation):

- `out/electron/ElectronFramework.js` accepts `electronDist` as a `.zip`, as a
  directory containing `electron-v<version>-<platform>-<arch>.zip`, or as a
  **directory treated as an already-unpacked Electron distribution**; in the last
  case it copies the source directory into the app output directory.
- `out/macPackager.js:347 getElectronSrcDir(dist)` resolves a custom unpacked
  distribution as `path.resolve(projectDir, dist, "Electron.app")`, so the
  directory must contain `Electron.app` at its top level.
- `out/configuration.d.ts:451` types `electronDist` as
  `Hook<PrepareApplicationStageDirectoryOptions, string> | string | null`.
- `ELECTRON_OVERRIDE_DIST_PATH` is **not** supported by the installed
  `@electron/get` 5.1.0 / `app-builder-lib` 26.15.3 (no reference in either
  package). The only lever for a custom distribution is the `electronDist`
  build field, or replacing `node_modules/electron/dist` itself.
- `out/electron/electronMac.js` then rewrites the copied distribution: it
  renames the main executable and the helper apps, writes the app and helper
  plists (including `ElectronAsarIntegrity`), and deletes `LICENSE` and
  `LICENSES.chromium.html` with `unlinkIfExists`.

### 6.3 What must stay intact in a custom distribution

Reasoned from the behavior above; each item is a requirement, not a measurement:

- **`Electron.app` at the top level of the dist directory**, with
  `Contents/{Info.plist,MacOS,Frameworks,Resources,PkgInfo}` — electron-builder
  copies this tree and patches it in place.
- **`Contents/Frameworks/Electron Framework.framework`** (plus Mantle,
  ReactiveObjC, Squirrel, and `chrome_crashpad_handler`) — the main executable's
  only framework dependency is `@rpath/Electron Framework.framework/Electron
  Framework`, so removing or replacing it independently of the main executable
  produces a bundle that cannot launch.
- **All helper apps** (`Helper`, `Helper (Renderer)`, `Helper (Plugin)`,
  `Helper (GPU)`, and where present `Helper EH` / `Helper NP` / `Login Helper`).
  Their names are derived from the app's bundle name at runtime; `electronMac.js`
  documents this dependency ("Electron uses the application name (CFBundleName)
  to resolve helper apps"), so renaming or dropping them breaks helper startup.
- **`Contents/Resources`** including the app resources and any `.asar` payload —
  electron-builder writes `ElectronAsarIntegrity` into the plist and expects that
  payload.
- **`Contents/Info.plist`** as the template the packaging step rewrites
  (`CFBundleIdentifier`, `CFBundleExecutable`, helper plists, extended info).
- **The `version`, `LICENSE`, and `LICENSES.chromium.html` siblings** of
  `Electron.app` for distribution completeness. Note that electron-builder itself
  does not read the dist `version` file for version resolution — it reads the
  installed `node_modules/electron/package.json` — and it deletes the two license
  files from the staged output.
- **Debug-symbol UUID consistency**: every Mach-O in the distribution (main
  executable, helpers, framework, dylibs) must come from the *same* build. The
  main executable and the framework are loaded together and are compiled against
  each other; mixing a rebuilt main executable with a stock framework (or vice
  versa) leaves a bundle whose UUIDs no longer describe one build. The verifier in
  this task is the tool that measures exactly this: same-UUID main executables
  between candidate and input are a failure, while same-UUID libraries are
  expected and informational.

None of this was exercised: no build, no packaging run, and no bundle was
modified.

## 7. Verdict

**BLOCKED — do not continue the source-build route on this host.**

Reasoning, in order of severity:

1. **No Electron/Chromium source checkout exists anywhere on this host.**
   `~/electron`, `~/src/electron`, `~/Documents/Code/electron`, and
   `~/Library/Caches/electron/src` are all absent, and a Spotlight search for
   `electron.gyp` returns nothing. `~/Library/Caches/electron` holds only the
   downloaded `electron-v43.6.0-darwin-arm64.zip` payload.
2. **The GN/Ninja build toolchain is absent.** `gn` and `ninja` are not
   installed (`command not found`), and neither are `autoninja`, `gclient`,
   `gn.py`, or `depot_tools`.
3. Toolchain version risk is secondary but real: the only available compiler
   toolchain is Xcode 27.0 beta with the macOS 27.0 SDK, while the pinned Electron
   `43.6.0` expects its own supported toolchain matrix.

**The precise missing artifacts, and the exact command that cannot run today:**

- a source checkout: `git clone https://github.com/electron/electron` plus
  `gclient sync` (or `script/bootstrap`-equivalent) producing an `electron/src`
  tree; and
- the build toolchain that checkout drives: the `gn` and `ninja` binaries
  (`depot_tools` on `PATH`, or `$ELECTRON_BUILD_TOOLS`-equivalent caches).

Concretely, the first failing command is `gn --version` / `gn gen out/Release`
(`gn: command not found`), because no checkout and no GN/Ninja exist.

**Second-order blocker for the packaging half of the route:** even with a rebuilt
distribution, this repository's `build` config declares no `electronDist`, and
the installed electron-builder has no `ELECTRON_OVERRIDE_DIST_PATH` fallback.
Consuming a rebuilt distribution therefore requires an explicit `electronDist`
addition to the electron-builder config — a packaging entry-point change that
this task explicitly did not authorize and did not perform.

Disk (114 GiB free) and the presence of `codesign`/`dwarfdump` are not blockers.

Per the repository rule on repeated blockers, no third attempt was made: two
independent probes (PATH lookup, filesystem/Spotlight search) agreed on the same
missing-toolchain / missing-source conclusion, and the alternatives that remain
(installing `depot_tools`, cloning `src`, `gclient sync`) require network access,
tens of GiB, and explicit user authorization, which this read-only probe does not
have.

### Options handed back (not implemented)

- **Authorize a source route**: install `depot_tools` (`gn`, `ninja`), clone
  `electron/src`, run `gclient sync`, build `out/Release`, and then decide how the
  resulting distribution is consumed (`electronDist`, or a replacement of
  `node_modules/electron/dist`). Cost: network access, tens of GiB, an Electron
  build of significant wall-clock time, and a packaging-config change.
- **Treat the duplicate main-executable UUID as an accepted condition** and
  gather separate evidence about whether it actually affects macOS local network
  permission attribution. That question is not answered by this probe: the
  verifier reports identity facts only.

## 8. Assurances and scope limits

- **No Electron source build was attempted.** This document is a feasibility
  conclusion; the source-build route has no working implementation.
- **No bundle was modified.** The verifier only reads: it runs
  `plutil -convert json -o -` (stdout only), `dwarfdump --uuid`,
  `codesign --verify --deep --strict`, and `codesign -d --verbose=2`, and reads
  files. No UUID was rewritten, no adhoc signature was applied, no `_CodeSignature`
  or `CodeResources` was touched.
- **No packaging entry point was changed.** `apps/desktop/package.json`, `pack`,
  `dist`, `dist:mac`, any signing lane, and `scripts/verify-macos-release.sh` are
  untouched. The primary checkout was read only.
- **No TCC / network privacy database, macOS account, VM, or `/Applications` app
  was touched or replaced.**
- **No credential material is reproduced.** This document reports signature
  *categories* only ("apple-development", "developer-id", "adhoc"); the verifier
  deliberately parses and discards `codesign -d` authority text, and one unit test
  asserts that an authority string fed into it never reaches the report. No
  certificate label, e-mail address, token, key, or team identifier appears here.
- Files created by this task (the only ones it is allowed to write):
  `scripts/macos-executable-identity.mjs`,
  `apps/desktop/test/macos-executable-identity.test.mjs`, and this document.

## 9. Command log (read-only)

```bash
# Declared vs installed Electron
node -e 'console.log(require("./apps/desktop/package.json").devDependencies.electron)'
grep -n 'electron@' pnpm-lock.yaml
node -e 'console.log(require("electron/package.json").version)'
cat "<primary>/node_modules/electron/dist/version"
ls ~/Library/Caches/electron/<sha256>/

# Toolchain
xcode-select -p
xcodebuild -version
xcodebuild -showsdks
clang --version
command -v gn ninja autoninja gclient gn.py
ls ~/depot_tools
python3 --version
dwarfdump --version

# Source checkout
ls -d ~/electron ~/src/electron ~/Documents/Code/electron ~/Library/Caches/electron/src
mdfind -name electron.gyp

# Disk
df -h /
df -h /System/Volumes/Data

# Packaging declarations
node -e 'const p=require("./apps/desktop/package.json");console.log(p.build.appId,p.build.productName,p.build.electronDist,p.build.afterPack)'
grep -rn "electronDist\|afterPack" --include=*.json --include=*.mjs --include=*.md .
sed -n '95,232p' node_modules/.pnpm/app-builder-lib@26.15.3*/node_modules/app-builder-lib/out/electron/ElectronFramework.js
sed -n '186,232p' node_modules/.pnpm/app-builder-lib@26.15.3*/node_modules/app-builder-lib/out/electron/electronMac.js
sed -n '344,356p' node_modules/.pnpm/app-builder-lib@26.15.3*/node_modules/app-builder-lib/out/macPackager.js
sed -n '1,60p' node_modules/.pnpm/app-builder-lib@26.15.3*/node_modules/app-builder-lib/out/electron/electronVersion.js

# Identity measurement (read-only)
node scripts/macos-executable-identity.mjs \
  --candidate /Applications/Pi-Desktop-Plus.app \
  --input "<primary>/node_modules/electron/dist/Electron.app" \
  --reference /Applications/PI-Desktop.app
node scripts/macos-executable-identity.mjs \
  --candidate "<primary>/apps/desktop/release/mac-arm64/Pi-Desktop-Plus.app" \
  --input "<primary>/node_modules/electron/dist/Electron.app"
node scripts/macos-executable-identity.mjs \
  --candidate /Applications/PI-Desktop.app --reference /Applications/Pi-Desktop-Plus.app
otool -L "<primary>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
otool -L "<primary>/apps/desktop/release/mac-arm64/Pi-Desktop-Plus.app/Contents/MacOS/Pi-Desktop-Plus"
```
