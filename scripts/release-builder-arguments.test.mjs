import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the unsigned cloud lane selects a complete ad-hoc signing pass", { skip: process.platform === "win32" }, async t => {
  const desktopManifest = new URL("../apps/desktop/package.json", import.meta.url);
  const desktop = createRequire(desktopManifest);
  const builder = createRequire(desktop.resolve("electron-builder/package.json"));
  const workflow = builder("js-yaml").load(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
  const step = workflow.jobs.build.steps.find(step => step.name === "Package unsigned macOS installer");
  const scratch = mkdtempSync(join(tmpdir(), "pi-unsigned-builder-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const log = join(scratch, "signing.json");
  const pnpm = join(scratch, "pnpm");
  writeFileSync(pnpm, `#!${process.execPath}
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const desktop = createRequire(${JSON.stringify(fileURLToPath(desktopManifest))});
const builder = createRequire(desktop.resolve('electron-builder/package.json'));
const { getConfig } = builder('app-builder-lib/out/util/config/config.js');
const { MacTargetHelper } = builder('app-builder-lib/out/mac/MacTargetHelper.js');
(async () => {
  const flag = process.argv.find(arg => arg.startsWith('-c.mac.identity='));
  const config = await getConfig(${JSON.stringify(dirname(fileURLToPath(desktopManifest)))}, null,
    flag ? { mac: { identity: flag.slice('-c.mac.identity='.length) } } : {});
  const helper = new MacTargetHelper({ forceCodeSigning: false });
  const identity = await helper.findSigningIdentity(false, false, config.mac.identity, undefined, config.mac);
  writeFileSync(process.env.PI_SIGNING_LOG, JSON.stringify({ identity: identity?.name ?? null, mac: config.mac }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
  chmodSync(pnpm, 0o755);
  execFileSync("bash", ["-c", step.run.replaceAll("${{ matrix.arch }}", "arm64")], {
    env: { ...process.env, ...step.env, PATH: `${scratch}${delimiter}${process.env.PATH}`,
      RELEASE_CHANNEL: "latest", PI_SIGNING_LOG: log },
    timeout: 15_000,
  });
  const result = JSON.parse(readFileSync(log, "utf8"));
  assert.equal(result.identity, "-", "the final app must be sealed instead of retaining its linker signature");
  assert.equal(result.mac.hardenedRuntime, true);
  assert.equal(result.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(result.mac.entitlementsInherit, "build/entitlements.mac.plist");
});

test("Windows packaging forwards explicit update channel and architecture to every format", { skip: process.platform === "win32" }, t => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-builder-args-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const pnpm = join(scratch, "pnpm");
  const log = join(scratch, "calls.jsonl");
  writeFileSync(pnpm, `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.PI_BUILDER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(pnpm, 0o755);
  execFileSync(process.execPath, [fileURLToPath(new URL("./build-desktop-release.mjs", import.meta.url)),
    "win", "--", "--x64", "-c.publish.channel=beta"], {
    env: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
      PATH: `${scratch}${delimiter}${process.env.PATH}`, PI_BUILDER_LOG: log },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls.map(args => args[3]), ["nsis", "zip", "portable"]);
  for (const args of calls) {
    assert(args.includes("--x64"));
    assert(args.includes("-c.publish.channel=beta"));
    assert(!args.includes("--"), "a separator must not hide flags from electron-builder");
    assert(args.every(arg => !arg.startsWith("-c.electronDist=") && !arg.startsWith("-c.afterPack=")),
      "Windows retains its stock Electron distribution");
    assert.deepEqual(args.slice(4, 6), ["--publish", "never"]);
  }
});

test("installed builder merges the channel override into the GitHub publish array", async () => {
  const desktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
  const builder = createRequire(desktop.resolve("electron-builder/package.json"));
  const { getConfig } = builder("app-builder-lib/out/util/config/config.js");
  const root = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
  const config = await getConfig(root, null, { publish: { channel: "beta" } });
  assert.equal(config.publish[0].provider, "github");
  assert.equal(config.publish[0].channel, "beta");
  assert.equal(config.publish[0].owner, "SakuraLoveSmile");
  assert.equal(config.publish[0].repo, "PI-Desktop");
});

test("Linux packaging forwards explicit update channel and architecture past the pnpm separator", { skip: process.platform === "win32" }, t => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-linux-builder-args-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const pnpm = join(scratch, "pnpm");
  const log = join(scratch, "calls.jsonl");
  writeFileSync(pnpm, `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.PI_BUILDER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(pnpm, 0o755);
  execFileSync(process.execPath, [fileURLToPath(new URL("./build-desktop-release.mjs", import.meta.url)),
    "linux", "--", "--arm64", "-c.publish.channel=beta"], {
    env: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
      PATH: `${scratch}${delimiter}${process.env.PATH}`, PI_BUILDER_LOG: log },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [["exec", "electron-builder", "--linux", "--publish", "never", "--arm64", "-c.publish.channel=beta"]]);
  assert(calls[0].every(arg => !arg.startsWith("-c.electronDist=") && !arg.startsWith("-c.afterPack=")),
    "Linux retains its stock Electron distribution");
});
