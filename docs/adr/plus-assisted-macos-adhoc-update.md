# ADR: Ad-hoc macOS builds update in place through an assisted installer

- Status: Implemented candidate
- Date: 2026-11-09
- Task: PI-UPD-1109
- Amends: [ADR 0022](0022-application-update-delivery.md) and
  [ADR 0289](0289-signed-macos-github-releases.md), including their
  PI-UPD-1102 amendments; the "Application update security" section of the
  [security spec](../spec/05-security/01-security.md); and the frozen decision
  of task PI-UPD-1102 that an unsigned install cannot update in-app. The
  reversal is limited to macOS builds stamped `piMacSigning = "adhoc"`.
- Related: [ADR 0177](0177-user-configurable-outbound-proxy.md) (outbound proxy),
  [ADR 0309](0309-remove-macos-first-launch-artifacts.md) / D634 (no
  quarantine-clearing helper),
  [plus-independent-application-identity](plus-independent-application-identity.md),
  decisions D120, D450, D628 in the
  [decisions log](../spec/08-meta/decisions-log.md)

## Context

Plus releases stay unsigned until a Developer ID Application certificate
exists. `ALLOW_UNSIGNED_MACOS_RELEASE=true` makes every tag release an ad-hoc
build, and since PI-UPD-1102 such a build is stamped `piMacSigning = "adhoc"`
and kept on notify-and-link delivery. Every update therefore means downloading
a DMG and replacing the app by hand.

That restriction is not a policy preference. electron-updater's macOS updater
passes the downloaded ZIP to Squirrel.Mac as part of the download, and
Squirrel.Mac validates the new bundle against the running app's designated
requirement. An ad-hoc requirement is that build's own cdhash, which no later
build can satisfy: on 2026-11-01 an installed 0.15.10 downloaded 0.15.11 and
all five install attempts were rejected with a code-signature error
(PI-UPD-1102). `downloadUpdate()` can never succeed for an ad-hoc build, and the
security spec forbids unsigned packages from entering that lane.

Squirrel is only one way to replace an app bundle. The maintainer's KaneoPilot
app (public repository `SakuraLoveSmile/KaneoPilot`, `docs/build-release.md`,
section "App 内获取更新") updates ad-hoc macOS builds in place with its own
installer: a hash-checked download from a fixed GitHub repository, a verified
copy staged next to the installed app, a quit handshake, an atomic exchange of
the two bundles, and a retained backup. It never compares the new app with the
old app's signature requirement, and its documented trust anchor is the HTTPS
GitHub release.

This ADR adopts that shape for PI-Desktop-Plus and states what it gives up.

## Decision

1. **Scope.** The assisted lane serves only a packaged macOS build whose
   packaged manifest says `piMacSigning = "adhoc"` (the stamp the single macOS
   packaging entry point writes) and whose running app bundle is eligible: not
   under an App Translocation path, not on a read-only volume, not reached
   through a symlink, and the bundle and its parent directory are writable by
   the current user. Every other macOS build keeps today's behavior:
   `developer-id` uses electron-updater and Squirrel.Mac unchanged, and
   `unknown` or ineligible installs use notify-and-link and say why. Windows and
   Linux are unchanged.
2. **Renderer contract.** The lane reports `mode = "in-app"` while the
   preference is Automatic, so the update banner and Settings reuse the existing
   checking, downloading, downloaded and restart states. `UpdateState` gains
   three optional fields: `delivery`, set to `"assisted"` whenever the install
   can use this lane (a capability, independent of the preference, so the UI can
   show the trust notice of decision 10); `assistedBlockedReason`, the first
   eligibility rule an ad-hoc install fails (`translocated`, `read-only`,
   `not-writable` or `symlink`), so Settings can say what to change; and
   `assistedInstallFailed`, set when the earlier in-place install of the offered
   version did not take effect, so the UI offers "Try again" and the release
   link instead of repeating the install. No IPC channel is added, and the
   renderer still cannot supply a URL, hash or path.
3. **Discovery.** Discovery stays electron-updater's check against the fixed
   feed, with `allowPrerelease = false` and automatic download disabled; no
   second feed is introduced. Main selects the one ZIP entry named exactly
   `Pi-Desktop-Plus-<version>-<arch>-mac.zip` for the running architecture and
   fails closed when it is missing; the fork's tag lane publishes arm64 only, so
   arm64 is the only qualified architecture. Main builds the download URL from
   the fixed repository and the discovered tag
   (`.../releases/download/v<version>/<file>`); an absolute URL from the feed is
   never used.
4. **Download.** Main downloads through Electron's network stack, so the
   user's outbound proxy setting applies (ADR 0177). Redirects are followed only
   to GitHub's HTTPS asset hosts, no credential is sent, and the size is capped
   at 1 GiB. The stream is hashed while it is written: the SHA-512 and size in
   the feed must match, otherwise the partial file is deleted and the update can
   be retried. A partial file is never installable, a download is cancelled on
   quit or dispose, and results of a superseded download are ignored.
5. **Staging and verification.** Main extracts the verified ZIP with
   `ditto -x -k` into a hidden directory next to the installed app, on the same
   volume. The staged result is refused unless it holds exactly one app whose
   `CFBundleIdentifier` equals the running app's, whose
   `CFBundleShortVersionString` equals the offered version and is strictly
   higher than the running version, whose executable matches the running
   architecture, and which passes `codesign --verify --deep --strict` (integrity
   only, not identity). A staged bundle carrying `com.apple.quarantine` is
   refused; the lane never clears the attribute, so D634 stays in force.
6. **Install handshake.** Installation starts only from the user's explicit
   restart action and never on an ordinary quit (`autoInstallOnAppQuit` stays
   off for this lane). Main copies the update helper out of the bundle, starts it
   detached, and quits through the existing shutdown path. The copy is a plain
   file copy, which does not carry `com.apple.quarantine` even when the bundled
   helper does (an app unpacked from a browser download may carry it on every
   file). Main writes the helper's commit file once the sidecar and host-core
   shutdown has finished, immediately before Main exits; a cancelled or failed
   quit leaves no commit file, and the helper then does nothing. The helper
   waits at most two minutes for the app to exit: if the app is still running
   then, it changes nothing and exits, and the next launch treats that as no
   fault, so a quit that completes later cannot install the update.
7. **Helper.** A new Rust crate, `crates/update-helper`, builds
   `pi-desktop-update-helper`, shipped in `Contents/Resources/bin/` next to
   `pi-desktop-host-core`. It waits for the app to exit, checks the commit file
   against its job, takes a per-target file lock, confirms that the installed
   app is the one the job was prepared for, and refuses to continue while any
   process still runs from inside the bundle after a bounded wait (then it
   reopens the old app). It re-verifies the staged app, exchanges the two
   bundles atomically with `renamex_np(RENAME_SWAP)`, relaunches with
   `open -n`, and writes a result file. If the exchange or the relaunch fails it
   swaps back, except when the new app may already be running. It has no
   network, SQLite or credential access, never elevates privileges, and acts
   only on job files Main created in the update cache with owner-only
   permissions. The helper is started by Main and outlives it on purpose; it
   exits on its own after the exchange or the rollback, and the next launch
   reads its result file and removes the job directory. It adds no link to the
   frozen Renderer → Preload IPC → Electron Main → host-core / agent runtime
   chain: Main stays the only owner of the update client, and the renderer never
   talks to the helper.
8. **Backups.** The swapped-out app stays as a hidden backup next to the
   installed app. Only one backup is kept: once the new version is confirmed
   running, Main removes older backups, and only directories recorded by earlier
   jobs.
9. **Preference.** `updatePreference` keeps its meaning. Automatic runs the
   assisted lane: scheduled checks and the download happen on their own, and the
   install waits for the user's click. Manual keeps notify-and-link. An eligible
   ad-hoc install defaults to Manual, so enabling the lane is an explicit
   choice; an ineligible install cannot select Automatic.
10. **Trust model.** The trust anchor is the fixed HTTPS GitHub repository.
    The package's SHA-512 comes from the same release as the package, so it
    detects truncation, corruption and an asset swapped on its own, but it is not
    an independent signature and it does not defend against a compromised
    repository or release. Squirrel's Developer ID chain does not exist for
    ad-hoc builds. The UI states this on the lane.
11. **First adoption.** Builds that predate the lane cannot update themselves.
    The first release that contains it is installed by hand; the first in-app
    update is the one after it.
12. **Out of scope.** The Developer ID path, Windows, Linux, delta updates,
    downgrade, silent install, new package types and notarization are untouched.
    An independent release signature is reserved, not built.

## Consequences

Positive:

- Unsigned releases update from inside the app after one confirmation, and a
  failed swap restores the old app.
- No new feed, token or network host: the lane reuses the fixed repository and
  the ZIP and `latest-mac.yml` assets the unsigned lane already publishes.

Costs:

- The trust model is weaker than Developer ID (decision 10), and the security
  spec's rule that unsigned packages must not enter the in-app lane is replaced
  by the rules of this lane.
- A new process role and crate. The helper is one more executable that must be
  signed ad-hoc inside the bundle and pinned by the packaging footprint test.
- Every ad-hoc update changes the app's cdhash, so macOS may ask again for
  Keychain access or privacy permissions after an update, as it can after a
  manual replacement. This has not been measured.
- Replacing the bundle of an app that lives in `/Applications` may be refused
  by macOS (App Management protection). The helper then keeps the old app,
  reopens it and reports the failure, and the next launch shows "Try again" and
  the release link. This has not been measured on a real install.
- There is no post-launch health check: the helper rolls back only when the
  relaunch itself fails. A new version that starts and then crashes leaves the
  retained backup for a manual restore.
- The downloaded package is not persisted across an app restart: a restart
  before the user clicks restart downloads it again.
- One extra app copy of disk next to the installed app.

Records changed with this ADR (each spec page with its zh-CN mirror): the
security spec section "Application update security", the process model, the
architecture overview and repository structure, the UX interaction patterns,
the release runbook, E2E-196d, the PI-UPD-1102 amendments in ADR 0022 and ADR
0289, task PI-UPD-1109, and a pointer in PI-UPD-1102. The decisions-log rows
D120, D450 and D628 are not edited because no default changes (decision 9).

Verification. Done with the implementation: unit tests for lane selection, the
URL, redirect, size and hash rules, the staging refusals, the commit ordering,
recovery and the renderer states; Rust tests on temporary bundles for the
helper; a macOS integration test that drives the real helper binary and the
real `ditto`, `codesign` and `open` tools against a temporary ad-hoc bundle
(`assisted-update-macos.test.mjs`, also run by the release job on the shipping
runner before packaging). Still required before this ADR becomes Accepted, none
of it run yet: the packaged-candidate scenario E2E-196d on a GitHub-hosted
macOS runner, and two consecutive real releases (a manual first install, then
an in-app update), each published only on the user's explicit word.

## Alternatives considered

- **Keep notify-and-link.** No new risk, but every unsigned release needs a
  manual DMG install, which is the problem. It stays as the fallback for
  ineligible installs and for users who choose Manual.
- **A fixed self-signed code-signing certificate with the existing Squirrel
  path.** It would keep electron-updater and give a stable designated
  requirement, which would also keep Keychain and privacy grants across updates.
  It is unverified here (it needs a spike), the first install would still be
  manual, certificate custody and expiry become a new operational duty, and a
  self-signed identity gives no Gatekeeper standing. It can be layered on later:
  the helper could then require the staged app to satisfy the running app's
  designated requirement.
- **Subclass electron-updater's macOS updater to skip Squirrel.** It ties the
  fork to unexported library internals and still needs a custom installer.
- **A shell-script helper.** No compile step, but no atomic exchange and hard to
  test; the Rust helper keeps the exchange and its failure cases testable.
- **Run the helper from the old app's Electron binary with
  `ELECTRON_RUN_AS_NODE`.** The process would load frameworks from a path that
  is renamed under it.
- **Sparkle or another updater framework.** A large native dependency plus key
  management for a single lane.

## Reserved follow-ups

An independent release signature, a manifest signature verified with a public
key shipped in the app, would close the repository-compromise gap of decision
10. It is deliberately not part of this change; revisit it after the lane has
shipped.
