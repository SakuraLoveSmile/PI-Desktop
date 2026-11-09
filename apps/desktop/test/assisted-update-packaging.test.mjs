import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { createRequire, register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const repo = join(here, "../../..");
const read = (path) => readFile(join(repo, path), "utf8");

const { default: macosIdentityGate } = await import("../../../scripts/macos-identity-gate.mjs");
const { HELPER_NAME } = await import("../electron/main/assisted-update/job-store.ts");

const desktopRequire = createRequire(new URL("../package.json", import.meta.url));
const { load } = createRequire(desktopRequire.resolve("electron-builder/package.json"))("js-yaml");
const packageJson = JSON.parse(await read("apps/desktop/package.json"));
const releaseWorkflow = load(await read(".github/workflows/release.yml"));

const BUILD_SCRIPT = join(repo, "scripts/build-update-helper.mjs");
const scriptLines = (script) => script.split("\n").map((line) => line.trim());

test("the helper has one name in the crate, the app config and the Main module", async () => {
  const lines = scriptLines(await read("crates/update-helper/Cargo.toml"));
  const bin = lines.indexOf("[[bin]]");
  assert.notEqual(bin, -1);
  assert.equal(lines[bin + 1], `name = "${HELPER_NAME}"`);
  assert.equal(HELPER_NAME, "pi-desktop-update-helper");
  const mac = packageJson.build.mac.extraResources.find((entry) => entry.to.endsWith(HELPER_NAME));
  assert.deepEqual(mac, {
    from: `../../target/release/${HELPER_NAME}`,
    to: `bin/${HELPER_NAME}`,
  });
});

test("only the macOS app ships the helper, and only macOS packaging scripts build it", () => {
  for (const platform of ["win", "linux"]) {
    const targets = packageJson.build[platform].extraResources.map((entry) => entry.to);
    assert.ok(!targets.some((target) => target.includes("update-helper")), platform);
  }
  const { scripts } = packageJson;
  assert.equal(scripts["build:update-helper-release"], "node ../../scripts/build-update-helper.mjs");
  for (const name of ["pack", "dist", "dist:mac"]) {
    const steps = scripts[name].split(" && ");
    const host = steps.indexOf("pnpm run build:host-release");
    const helper = steps.indexOf("pnpm run build:update-helper-release");
    assert.ok(host !== -1 && helper === host + 1, `${name} builds the helper right after the host`);
    assert.ok(helper < steps.indexOf("pnpm run bundle:runtime"), `${name} builds the helper before packaging`);
  }
  for (const name of ["dist:win", "dist:linux"]) {
    assert.ok(!scripts[name].includes("update-helper"), name);
  }
});

/** Runs the build script as `platform` with a fake `cargo` first (or only) on PATH. */
async function runBuildScript(t, { platform, cargo = "present", cargoExit = 0 }) {
  const root = await mkdtemp(join(tmpdir(), "assisted-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  const argsFile = join(root, "cargo-args.txt");
  if (cargo === "present") {
    const fake = join(bin, "cargo");
    await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_CARGO_ARGS"\nexit "$FAKE_CARGO_EXIT"\n`);
    await chmod(fake, 0o755);
  }
  const preload = join(root, "platform.mjs");
  await writeFile(preload, `Object.defineProperty(process, "platform", { value: process.env.FAKE_PLATFORM });\n`);
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, BUILD_SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: bin,
      FAKE_PLATFORM: platform,
      FAKE_CARGO_ARGS: argsFile,
      FAKE_CARGO_EXIT: String(cargoExit),
    },
  });
  const recorded = await readFile(argsFile, "utf8").catch(() => null);
  return { result, cargoArgs: recorded === null ? null : recorded.split("\n").filter(Boolean) };
}

test("the helper build script builds only the helper crate on macOS", { skip: process.platform === "win32" }, async (t) => {
  const { result, cargoArgs } = await runBuildScript(t, { platform: "darwin" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(cargoArgs, [
    "build",
    "--release",
    "--manifest-path",
    join(repo, "Cargo.toml"),
    "-p",
    "update-helper",
  ]);
});

test("the helper build script passes a cargo failure through", { skip: process.platform === "win32" }, async (t) => {
  const failed = await runBuildScript(t, { platform: "darwin", cargoExit: 3 });
  assert.equal(failed.result.status, 3);
  const missing = await runBuildScript(t, { platform: "darwin", cargo: "absent" });
  assert.equal(missing.result.status, 1);
  assert.ok(missing.result.stderr.includes("cannot run cargo"), missing.result.stderr);
  assert.equal(missing.cargoArgs, null);
});

test("the helper build script does nothing on other platforms", { skip: process.platform === "win32" }, async (t) => {
  for (const platform of ["linux", "win32"]) {
    const { result, cargoArgs } = await runBuildScript(t, { platform });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(cargoArgs, null, `${platform} must not invoke cargo`);
    assert.ok(result.stdout.includes("skipped"), result.stdout);
  }
});

test("the pre-sign gate stops a bundle that lacks the host sidecar or the update helper", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "assisted-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    electronPlatformName: "darwin",
    appOutDir: root,
    packager: { appInfo: { productFilename: "Pi-Desktop-Plus" } },
  };
  const bin = join(root, "Pi-Desktop-Plus.app", "Contents", "Resources", "bin");
  await mkdir(bin, { recursive: true });
  const rejectsWith = (...fragments) => (error) =>
    fragments.every((fragment) => error.message.includes(fragment));

  await assert.rejects(() => macosIdentityGate(context), rejectsWith("host sidecar is missing from the bundle"));

  await writeFile(join(bin, "pi-desktop-host-core"), "host");
  await assert.rejects(
    () => macosIdentityGate(context),
    rejectsWith("update helper is missing from the bundle", "build:update-helper-release"),
  );

  // An empty file is as good as none: electron-builder copies what it finds.
  await writeFile(join(bin, HELPER_NAME), "");
  await assert.rejects(
    () => macosIdentityGate(context),
    rejectsWith("update helper is missing from the bundle"),
  );
});

test("the release job tests the helper on the shipping runner before it packages", () => {
  const steps = releaseWorkflow.jobs.build.steps;
  const testIndex = steps.findIndex((step) => step.name === "Test the macOS update helper");
  assert.notEqual(testIndex, -1);
  const testStep = steps[testIndex];
  assert.equal(testStep.if, "matrix.platform == 'macos'");
  const lines = scriptLines(testStep.run);
  assert.ok(lines.includes("cargo test --locked -p update-helper"));
  assert.ok(lines.includes(`PI_UPDATE_HELPER_BIN="$PWD/target/release/${HELPER_NAME}" \\`));
  assert.ok(lines.includes("node --test apps/desktop/test/assisted-update-macos.test.mjs"));
  const packaging = steps.flatMap((step, index) => (step.run?.includes("dist:mac") ? [index] : []));
  assert.ok(packaging.length >= 2, "the unsigned and the signed lane both package the app");
  for (const index of packaging) {
    assert.ok(testIndex < index, `${steps[index].name} runs after the helper tests`);
  }
});
