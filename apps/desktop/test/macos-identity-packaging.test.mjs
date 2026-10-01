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

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [wrapper, assembler, gate, releaseLane, releaseBuilder, packageSource] = await Promise.all([
  read("../../../scripts/package-macos-identity.mjs"),
  read("../../../scripts/assemble-electron-dist.mjs"),
  read("../../../scripts/macos-identity-gate.mjs"),
  read("../../../scripts/release-macos.sh"),
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

test("Windows and Linux lanes keep the stock distribution", () => {
  assert.match(pkg.scripts["dist:win"], /build-desktop-release\.mjs win/);
  assert.match(pkg.scripts["dist:linux"], /electron-builder --linux/);
  for (const name of ["dist:win", "dist:linux"]) {
    assert.doesNotMatch(pkg.scripts[name], /package-macos-identity/, name);
  }
});

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

test("local lanes sign without a secure timestamp and the release lane keeps it", () => {
  assert.match(wrapper, /-c\.mac\.timestamp=none/);
  assert.match(wrapper, /PI_MAC_SECURE_TIMESTAMP/);
  assert.doesNotMatch(releaseLane, /timestamp=none/);
});

test("the signed release lane packages the independent distribution and the gate", () => {
  assert.match(releaseLane, /-c\.electronDist="\$\{PI_ELECTRON_DIST\}"/);
  assert.match(releaseLane, /-c\.afterPack="\$\(pwd\)\/scripts\/macos-identity-gate\.mjs"/);
  assert.match(releaseLane, /assemble-electron-dist\.mjs/);
  assert.match(releaseLane, /-c\.mac\.forceCodeSigning=true/);
  assert.match(releaseLane, /-c\.mac\.notarize=true/);
});

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
