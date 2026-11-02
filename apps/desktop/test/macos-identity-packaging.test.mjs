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
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { describeComparisonFailures } from "../../../scripts/macos-identity-gate.mjs";
import {
  resolveMacSigningLane,
  shouldUseSecureTimestamp,
} from "../../../scripts/macos-signing-policy.mjs";

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

test("the packaging lane resolves the signing identity used for update delivery", () => {
  assert.equal(resolveMacSigningLane(["-c.mac.identity=-"], {}), "adhoc");
  assert.equal(resolveMacSigningLane(["--config.mac.identity", "-"], {}), "adhoc");
  assert.equal(
    resolveMacSigningLane(
      ["-c.publish.channel=latest", "-c.mac.forceCodeSigning=true", "-c.mac.notarize=true"],
      {},
    ),
    "developer-id",
  );
  assert.equal(resolveMacSigningLane([], { CSC_LINK: "certificate.p12" }), "developer-id");
  assert.equal(
    resolveMacSigningLane([], { CSC_NAME: "Developer ID Application: Example" }),
    "developer-id",
  );
  assert.equal(resolveMacSigningLane([], {}), "unknown");
  assert.equal(resolveMacSigningLane(["-c.mac.notarize=false"], {}), "unknown");
});

test(
  "the macOS packaging wrapper stamps the signing lane into the package",
  { skip: process.platform !== "darwin" },
  (t) => {
    const scratch = mkdtempSync(join(tmpdir(), "pi-mac-signing-lane-"));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const log = join(scratch, "calls.jsonl");
    const pnpm = join(scratch, "pnpm");
    writeFileSync(
      pnpm,
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.PI_SIGNING_LANE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
    );
    chmodSync(pnpm, 0o755);
    // The wrapper's post-pack UUID check must not depend on whatever release
    // artifacts happen to exist in the checkout running the tests.
    const dwarfdump = join(scratch, "dwarfdump");
    writeFileSync(dwarfdump, "#!/bin/sh\nexit 1\n");
    chmodSync(dwarfdump, 0o755);
    const wrapper = fileURLToPath(
      new URL("../../../scripts/package-macos-identity.mjs", import.meta.url),
    );
    const builderArgs = (args) => {
      execFileSync(
        process.execPath,
        [wrapper, "--mac", "--publish", "never", ...args],
        {
          env: {
            ...process.env,
            GITHUB_ACTIONS: "true",
            RUNNER_ENVIRONMENT: "github-hosted",
            PI_ELECTRON_DIST: join(scratch, "electron-dist"),
            PI_SIGNING_LANE_LOG: log,
            PATH: `${scratch}${delimiter}${process.env.PATH ?? ""}`,
            CSC_LINK: "",
            CSC_NAME: "",
          },
          stdio: "pipe",
        },
      );
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      return calls.at(-1);
    };

    assert.ok(
      builderArgs(["-c.mac.identity=-"]).includes(
        "-c.extraMetadata.piMacSigning=adhoc",
      ),
    );
    assert.ok(
      builderArgs(["-c.mac.forceCodeSigning=true", "-c.mac.notarize=true"]).includes(
        "-c.extraMetadata.piMacSigning=developer-id",
      ),
    );
    assert.ok(
      builderArgs([]).includes("-c.extraMetadata.piMacSigning=unknown"),
    );
  },
);

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
