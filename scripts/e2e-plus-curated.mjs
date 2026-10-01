#!/usr/bin/env node
/**
 * Plus Curated Channel E2E runner (E2E-PLUS-CURATED).
 *
 * Verifies:
 * - Local fixture lane for curated channel in debug/fixture mode.
 * - Discovery of curated catalog entries with review metadata.
 * - Installation with ExpectedMarketplace pin validation.
 * - Persistence of review metadata across host restart.
 * - Rejection of unreviewed or mismatched versions on the curated channel.
 */
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { hostBinaryCandidates, resolveHostBinary, Host } from "./e2e/host.mjs";
import { assert, shortJson } from "./e2e/assert.mjs";

const root = resolve(process.cwd());
const runRoot = mkdtempSync(join(tmpdir(), "pi-plus-curated-e2e-"));
const dataDir = join(runRoot, "data");
const fixtureDir = join(runRoot, "fixture");
const packagesDir = join(fixtureDir, "packages");
const pluginSourceDir = join(runRoot, "demo-plugin-src");

mkdirSync(dataDir, { recursive: true });
mkdirSync(packagesDir, { recursive: true });
mkdirSync(pluginSourceDir, { recursive: true });

// 1. Create fixture marker
const markerPath = join(fixtureDir, "plus-curated-fixture-v1.json");
writeFileSync(
  join(fixtureDir, "pi-desktop-plus-curated-fixture-v1.json"),
  JSON.stringify({ schemaVersion: 1, fixtureRoot: fixtureDir, packagesDir: packagesDir }, null, 2),
  "utf8"
);
writeFileSync(
  markerPath,
  JSON.stringify({
    schemaVersion: 1,
    fixtureRoot: fixtureDir,
    packagesDir: packagesDir,
  }, null, 2),
  "utf8"
);

// 2. Create tiny zip package
const pluginManifest = {
  schemaVersion: 1,
  id: "demo.plus-curated",
  name: "Demo Plus Curated Plugin",
  version: "1.0.0",
  description: "Curated plugin test fixture",
  author: "Plus Team",
  main: "index.js",
  permissions: [],
};
writeFileSync(join(pluginSourceDir, "manifest.json"), JSON.stringify(pluginManifest, null, 2), "utf8");
writeFileSync(join(pluginSourceDir, "index.js"), "module.exports = {};\n", "utf8");

const packagePath = join(packagesDir, "demo.plus-curated-1.0.0.zip");
execSync(`zip -0 -q -r "${packagePath}" manifest.json index.js`, { cwd: pluginSourceDir });

const packageBytes = readFileSync(packagePath);
const packageSha256 = createHash("sha256").update(packageBytes).digest("hex");
const packageSizeBytes = packageBytes.length;

// 3. Create fixture catalog
const catalogPath = join(fixtureDir, "catalog.json");
const catalogUrl = `file://${catalogPath}`;
const fixtureCatalog = {
  schemaVersion: 2,
  providerId: "pi-desktop-plus-curated",
  catalogId: "pi-desktop-plus-curated",
  name: "Pi-Desktop Plus Curated Plugins",
  policyVersion: "plus-curated-v1",
  plugins: [
    {
      id: "demo.plus-curated",
      name: "Demo Plus Curated Plugin",
      description: "Curated plugin test fixture",
      author: "Plus Team",
      latestVersion: "1.0.0",
      latestShasum: packageSha256,
      updatedAt: "2026-10-01T00:00:00Z",
      permissionSummary: [],
      versions: [
        {
          version: "1.0.0",
          publishedAt: "2026-10-01T00:00:00Z",
          shasum: packageSha256,
          url: `file://${packagePath}`,
          sizeBytes: packageSizeBytes,
          permissions: [],
          review: {
            decision: "approved",
            policyVersion: "plus-curated-v1",
            reviewedAt: "2026-10-01T00:00:00Z",
            risk: "low",
          },
        },
      ],
    },
  ],
};
writeFileSync(catalogPath, JSON.stringify(fixtureCatalog, null, 2), "utf8");

// Set environment for host
process.env.PI_DESKTOP_PLUS_CURATED_FIXTURE = "1";
process.env.PI_DESKTOP_CAPTURE = "1";
process.env.PI_DESKTOP_PLUGIN_MARKET_URL = catalogUrl;

const results = [];
function record(name, pass, details = "") {
  results.push({ name, pass, details });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${details ? " - " + details : ""}`);
}

async function run() {
  const hostBin = resolveHostBinary();
  console.log(`Running Plus Curated E2E with host: ${hostBin}`);

  let host = new Host(hostBin, dataDir);
  await host.start();

  try {
    // Switch channel to plus
    await host.call("settings.set", {
      pluginMarketSource: "plus",
    });
    await host.call("market.refresh", { force: true });

    // Test 1: Market search in curated channel
    const searchRes = await host.call("market.search", { query: "curated" });
    assert(Array.isArray(searchRes.plugins), "search should return plugins array");
    const found = searchRes.plugins.find((p) => p.id === "demo.plus-curated");
    assert(found, "demo.plus-curated should be found in curated catalog");
    assert(found.latestVersion === "1.0.0", "latest version should be 1.0.0");
    assert(found.latestShasum === packageSha256, "latest shasum should match package sha");
    record("E2E-PLUS-CURATED-SEARCH", true, "Found curated plugin in search");

    // Test 2: Market detail
    const detailRes = await host.call("market.getDetail", { id: "demo.plus-curated" });
    assert(detailRes.plugin, "detail should return plugin");
    const v1 = detailRes.plugin.versions.find((v) => v.version === "1.0.0");
    assert(v1, "version 1.0.0 should be in versions");
    assert(v1.review?.decision === "approved", "review decision should be approved");
    assert(v1.review?.policyVersion === "plus-curated-v1", "policy version should match");
    record("E2E-PLUS-CURATED-DETAIL", true, "Review metadata present in detail");

    // Test 3: Install with ExpectedMarketplace pin
    const pin = {
      source: "plus",
      catalogUrl: catalogUrl,
      version: "1.0.0",
      shasum: packageSha256,
    };
    const installRes = await host.call("market.install", {
      id: "demo.plus-curated",
      version: "1.0.0",
      enable: true,
      autoUpdate: true,
      grantedPermissions: [],
      expectedMarketplace: pin,
    });
    assert(installRes.result?.plugin?.id === "demo.plus-curated", "installed plugin id matches");
    assert(installRes.result?.plugin?.marketplace?.review?.decision === "approved", "installed review decision matches");
    record("E2E-PLUS-CURATED-INSTALL", true, "Installed curated plugin with valid pin");

    // Test 4: List installed plugins and check review persistence
    const listRes = await host.call("plugins.list", {});
    const installed = listRes.plugins.find((p) => p.id === "demo.plus-curated");
    assert(installed, "installed plugin must appear in plugins.list");
    assert(installed.marketplace?.review?.decision === "approved", "review preserved in summary");
    assert(installed.marketplace?.review?.policyVersion === "plus-curated-v1", "policy preserved");
    record("E2E-PLUS-CURATED-LIST", true, "Review preserved in plugins.list");

    // Test 5: Host restart and persistence
    await host.stop();
    host = new Host(hostBin, dataDir);
    await host.start();

    const restartListRes = await host.call("plugins.list", {});
    const restartedPlugin = restartListRes.plugins.find((p) => p.id === "demo.plus-curated");
    assert(restartedPlugin, "plugin preserved after restart");
    assert(restartedPlugin.marketplace?.review?.decision === "approved", "review preserved after restart");
    record("E2E-PLUS-CURATED-RESTART-PERSISTENCE", true, "Review preserved across host restart");

    // Test 6: Mismatched pin rejection
    let mismatchRejected = false;
    try {
      await host.call("market.install", {
        id: "demo.plus-curated",
        version: "1.0.0",
        enable: true,
        grantedPermissions: [],
        expectedMarketplace: {
          ...pin,
          shasum: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      });
    } catch (err) {
      mismatchRejected = true;
    }
    assert(mismatchRejected, "mismatched expectedMarketplace hash must be rejected");
    record("E2E-PLUS-CURATED-PIN-MISMATCH-REJECTED", true, "Mismatched checksum rejected");

    // Test 7: Unreviewed version rejection in curated channel
    const unreviewedCatalog = JSON.parse(JSON.stringify(fixtureCatalog));
    delete unreviewedCatalog.plugins[0].versions[0].review;
    writeFileSync(catalogPath, JSON.stringify(unreviewedCatalog, null, 2), "utf8");
    await host.call("market.refresh", { force: true });

    let unreviewedRejected = false;
    try {
      await host.call("market.install", {
        id: "demo.plus-curated",
        version: "1.0.0",
        enable: true,
        grantedPermissions: [],
        expectedMarketplace: pin,
      });
    } catch (err) {
      unreviewedRejected = String(err).includes("no maintainer review");
    }
    assert(unreviewedRejected, "unreviewed version on plus curated channel must be rejected");
    record("E2E-PLUS-CURATED-UNREVIEWED-REJECTED", true, "Unreviewed version rejected on curated channel");

  } finally {
    await host.stop();
    if (process.env.E2E_KEEP_ARTIFACTS !== "1") {
      try {
        rmSync(runRoot, { recursive: true, force: true });
      } catch {}
    }
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`${failed.length} test(s) failed.`);
    process.exit(1);
  }
  console.log("All Plus Curated E2E tests passed!");
}

run().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(1);
});
