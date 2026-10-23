/**
 * Contract tests for the macOS packaging lanes that give this fork an independent
 * Electron identity.
 *
 * The behavior these lanes produce cannot be proven by a unit test — it needs a
 * macOS host, a signed bundle and a real Local Network prompt (see
 * `E2E-MAC-local-network-manual-discovery`). What a test *can* pin is the wiring
 * that was repeatedly gotten wrong while building it: the flags every macOS lane
 * must pass, the checks the pre-sign gate must keep, and the packaging policy that
 * must never leak into the release lane.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeComparisonFailures } from "../../../scripts/macos-identity-gate.mjs";
import { shouldUseSecureTimestamp } from "../../../scripts/macos-signing-policy.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [wrapper, assembler, gate, releaseBuilder, packageSource] = await Promise.all([
  read("../../../scripts/package-macos-identity.mjs"),
  read("../../../scripts/assemble-electron-dist.mjs"),
  read("../../../scripts/macos-identity-gate.mjs"),
  read("../../../scripts/build-desktop-release.mjs"),
  read("../package.json"),
]);
const pkg = JSON.parse(packageSource);

test("every macOS lane packages through the identity-aware entry point", () => {
  assert.match(pkg.scripts.pack, /package-macos-identity\.mjs --dir/);
  assert.match(pkg.scripts["dist:mac"], /package-macos-identity\.mjs --mac --publish never/);
  for (const name of ["pack", "dist:mac"]) {
    assert.match(pkg.scripts[name], /pnpm run build:host-release/, name);
  }
  // `dist` delegates its macOS branch so the lane is covered there too.
  assert.match(releaseBuilder, /runMacIdentityLane/);
  assert.match(releaseBuilder, /package-macos-identity\.mjs/);
});

// Stock Windows/Linux distribution and forwarded channel/architecture are
// exercised at the builder process boundary in release-builder-arguments.test.mjs.

test("the wrapper always supplies the distribution, the gate and a post-check", () => {
  assert.match(wrapper, /-c\.electronDist=\$\{electronDist\}/);
  assert.match(wrapper, /-c\.afterPack=\$\{gate\}/);
  // `pnpm run <script> -- <args>` forwards a bare `--`, and electron-builder's
  // parser ignores every option after it, which once packaged the stock identity.
  assert.match(wrapper, /arg !== "--"/);
  // A hook or flag that silently does nothing must not pass unnoticed.
  assert.match(wrapper, /mainExecutableUuid\(/);
  assert.match(wrapper, /verified \$\{packaged\.length\} packaged bundle/);
});

test("notarization requests retain secure timestamps independently of unrelated builder flags", () => {
  for (const args of [
    ["-c.publish.channel=beta", "-c.mac.forceCodeSigning=true", "-c.mac.notarize=true"],
    ["--config.mac.notarize", "true", "--arm64"],
  ]) assert.equal(shouldUseSecureTimestamp(args, {}), true);
  assert.equal(shouldUseSecureTimestamp([], {}), false);
  assert.equal(shouldUseSecureTimestamp([], { PI_MAC_SECURE_TIMESTAMP: "1" }), true);
  assert.equal(shouldUseSecureTimestamp(["-c.mac.notarize=false"], {}), false);
});

// The retired release-macos.sh path is exercised by macos-release-lane.test.mjs;
// the live identity wrapper/gate remain covered below and by executable identity
// fixtures, while signing and DMG phase ordering are covered by the dedicated
// macos-release-verification.test.mjs and macos-signing-watchdog.test.mjs suites.

test("the assembler preserves bundle-relative symlinks and refuses a shared UUID", () => {
  assert.match(assembler, /run\("ditto", \[officialDist, out\]\)/);
  assert.doesNotMatch(assembler, /cpSync\(/);
  assert.match(assembler, /assertFrameworkLinksAreRelative\(out\)/);
  assert.match(assembler, /linkedUuid === officialUuid/);
});

test("the pre-sign gate enforces the identity and the host sidecar", () => {
  assert.match(gate, /EXPECTED_APP_ID/);
  assert.match(gate, /host sidecar is missing from the bundle/);
  // Signing happens after this hook, so a candidate is legitimately unsigned here.
  assert.match(gate, /DEFERRED_TO_SIGNING/);
});

test("the pre-sign gate fails closed when a source UUID is unverifiable", () => {
  assert.match(
    describeComparisonFailures({
      unverifiableSources: [{ role: "input", path: "/missing/Electron.app" }],
    }),
    /source-identities-readable: main executable UUID unavailable for input \/missing\/Electron\.app/,
  );
  assert.equal(describeComparisonFailures({ unverifiableSources: [] }), null);
});
