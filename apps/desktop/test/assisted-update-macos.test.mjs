// Real-tool checks for the assisted macOS update lane. They drive ditto, plutil,
// codesign and, for the install, the real Rust helper, so they run on arm64
// macOS only. Build the helper first and point at it:
//   cargo build -p update-helper && PI_UPDATE_HELPER_BIN=target/debug/pi-desktop-update-helper node --test ...
// Without the helper binary the install tests are skipped (reported, not passed).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { runCommand } = await import("../electron/main/assisted-update/commands.ts");
const { spawnDetachedHelper } = await import("../electron/main/assisted-update/helper-process.ts");
const { readInfoPlist, stageUpdate } = await import("../electron/main/assisted-update/staging.ts");
const { AssistedUpdateService } = await import("../electron/main/assisted-update/service.ts");
const { assistedPaths, COMMIT_FILE, HELPER_NAME, RESULT_FILE } = await import(
  "../electron/main/assisted-update/job-store.ts"
);
const { recoverPreviousInstalls } = await import("../electron/main/assisted-update/recovery.ts");

const CODESIGN = "/usr/bin/codesign";
const DITTO = "/usr/bin/ditto";
const XATTR = "/usr/bin/xattr";
const BUNDLE_ID = "com.example.assisted-update-test";
const APP = "Pi-Desktop-Plus.app";
const EXECUTABLE = "Pi-Desktop-Plus";

const onArm64Mac = process.platform === "darwin" && process.arch === "arm64";
const skipUnlessMac = onArm64Mac ? false : "needs arm64 macOS";
const helperBin = [
  process.env.PI_UPDATE_HELPER_BIN,
  resolve(here, "../../../target/debug/pi-desktop-update-helper"),
  resolve(here, "../../../target/release/pi-desktop-update-helper"),
]
  .filter(Boolean)
  .find((candidate) => existsSyncSafe(candidate));
const skipUnlessHelper = skipUnlessMac || (helperBin ? false : "build the helper: cargo build -p update-helper");

function existsSyncSafe(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function run(command, args) {
  const result = await runCommand(command, args, { timeoutMs: 120_000 });
  assert.equal(result.code, 0, `${command} ${args.join(" ")}: ${result.stderr}`);
  return result;
}

/** A real, ad-hoc signed bundle whose executable is a copy of `executable`. */
async function makeApp(dir, version, { executable, bundleId = BUNDLE_ID } = {}) {
  const app = join(dir, APP);
  await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
  await copyFile(executable, join(app, "Contents", "MacOS", EXECUTABLE));
  await chmod(join(app, "Contents", "MacOS", EXECUTABLE), 0o755);
  await writeFile(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleExecutable</key><string>${EXECUTABLE}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>
`,
  );
  await run(CODESIGN, ["--force", "--sign", "-", app]);
  return app;
}

async function zipApp(app, zipPath) {
  await run(DITTO, ["-c", "-k", "--keepParent", app, zipPath]);
  const bytes = await readFile(zipPath);
  return { bytes, sha512: createHash("sha512").update(bytes).digest("base64") };
}

async function scratch() {
  return realpath(await mkdtemp(join(tmpdir(), "assisted-macos-")));
}

const exists = (path) => stat(path).then(() => true, () => false);
const staging = (root, zipPath, overrides = {}) => ({
  zipPath,
  stagingDir: join(root, "staging"),
  running: { bundleId: BUNDLE_ID, version: "0.16.0" },
  offeredVersion: "0.16.1",
  arch: "arm64",
  ...overrides,
});

test("a genuine ad-hoc signed update passes staging with the real tools", { skip: skipUnlessMac }, async () => {
  const root = await scratch();
  const app = await makeApp(join(root, "src"), "0.16.1", { executable: "/usr/bin/true" });
  await zipApp(app, join(root, "u.zip"));
  const { stagedApp } = await stageUpdate(staging(root, join(root, "u.zip")), runCommand);
  assert.equal(stagedApp, join(root, "staging", APP));
  assert.deepEqual(await readInfoPlist(stagedApp, runCommand), {
    bundleId: BUNDLE_ID,
    version: "0.16.1",
    executable: EXECUTABLE,
  });
  await rm(root, { recursive: true });
});

test("a bundle changed after signing is refused and nothing is left behind", { skip: skipUnlessMac }, async () => {
  const root = await scratch();
  const app = await makeApp(join(root, "src"), "0.16.1", { executable: "/usr/bin/true" });
  await writeFile(join(app, "Contents", "MacOS", EXECUTABLE), "tampered", { flag: "a" });
  await zipApp(app, join(root, "u.zip"));
  await assert.rejects(() => stageUpdate(staging(root, join(root, "u.zip")), runCommand), {
    code: "signature",
  });
  assert.equal(await exists(join(root, "staging")), false);
  await rm(root, { recursive: true });
});

test("another application, an older version and a wrong offer are refused", { skip: skipUnlessMac }, async () => {
  const root = await scratch();
  const other = await makeApp(join(root, "other"), "0.16.1", {
    executable: "/usr/bin/true",
    bundleId: "com.example.somebody-else",
  });
  await zipApp(other, join(root, "other.zip"));
  await assert.rejects(() => stageUpdate(staging(root, join(root, "other.zip")), runCommand), { code: "identity" });

  const same = await makeApp(join(root, "same"), "0.16.1", { executable: "/usr/bin/true" });
  await zipApp(same, join(root, "same.zip"));
  await assert.rejects(
    () => stageUpdate(staging(root, join(root, "same.zip"), { running: { bundleId: BUNDLE_ID, version: "0.16.1" } }), runCommand),
    { code: "version" },
  );
  await assert.rejects(
    () => stageUpdate(staging(root, join(root, "same.zip"), { offeredVersion: "0.16.2" }), runCommand),
    { code: "version" },
  );
  assert.equal(await exists(join(root, "staging")), false);
  await rm(root, { recursive: true });
});

/** Plays the running app: a process whose exit the helper waits for. */
function standInApp() {
  const child = spawn("/bin/sleep", ["600"], { stdio: "ignore" });
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  return {
    pid: child.pid,
    async quit() {
      child.kill("SIGKILL");
      await exited;
    },
  };
}

async function arrangeInstall({ withCommit, quarantineHelperSource = false }) {
  const root = await scratch();
  const installDir = join(root, "Applications");
  const bundlePath = await makeApp(installDir, "0.16.0", { executable: helperBin });
  const release = await makeApp(join(root, "release"), "0.16.1", { executable: helperBin });
  const zip = await zipApp(release, join(root, "release.zip"));
  const app = standInApp();
  const logs = [];
  const paths = assistedPaths(join(root, "cache"));
  let helperSource = helperBin;
  if (quarantineHelperSource) {
    // An app unpacked from a browser download carries the attribute on every file.
    helperSource = join(root, "quarantined-helper");
    await copyFile(helperBin, helperSource);
    await chmod(helperSource, 0o755);
    await run(XATTR, ["-w", "com.apple.quarantine", "0081;5f9a0000;Safari;", helperSource]);
  }
  const service = new AssistedUpdateService({
    paths,
    bundlePath,
    runningVersion: "0.16.0",
    arch: "arm64",
    helperSource,
    transport: async () => ({
      async get() {
        return {
          statusCode: 200,
          headers: {},
          body: (async function* () {
            yield zip.bytes;
          })(),
        };
      },
    }),
    run: runCommand,
    spawnHelper: spawnDetachedHelper,
    log: (level, message) => logs.push(`${level}:${message}`),
    pid: app.pid,
  });
  await service.recover();
  const feed = {
    version: "0.16.1",
    files: [
      {
        url: "Pi-Desktop-Plus-0.16.1-arm64-mac.zip",
        sha512: zip.sha512,
        size: zip.bytes.length,
      },
    ],
  };
  await service.prepare(feed, { signal: new AbortController().signal });
  await service.install();
  if (withCommit) await service.commitPendingInstall();
  const [jobId] = await readdir(paths.jobs).then((names) => names.filter((n) => !n.startsWith(".")));
  return { root, installDir, bundlePath, paths, service, app, jobId, logs };
}

async function waitForResult(paths, jobId) {
  const path = join(paths.jobs, jobId, RESULT_FILE);
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text) return JSON.parse(text);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("the helper wrote no result");
}

test(
  "a committed update installs through the real helper and the next launch settles it",
  { skip: skipUnlessHelper, timeout: 120_000 },
  async () => {
    const t = await arrangeInstall({ withCommit: true });
    try {
      assert.equal(await exists(join(t.paths.jobs, t.jobId, COMMIT_FILE)), true);
      await t.app.quit();
      const result = await waitForResult(t.paths, t.jobId);
      assert.equal(result.status, "launch_requested", result.message);
      assert.equal(result.fromVersion, "0.16.0");
      assert.equal(result.toVersion, "0.16.1");

      assert.equal((await readInfoPlist(t.bundlePath, runCommand)).version, "0.16.1");
      await run(CODESIGN, ["--verify", "--deep", "--strict", t.bundlePath]);
      const backups = (await readdir(t.installDir)).filter((n) => n.startsWith(".pi-desktop-plus-backup-"));
      assert.equal(backups.length, 1);
      assert.equal(
        (await readInfoPlist(join(t.installDir, backups[0], APP), runCommand)).version,
        "0.16.0",
        "the previous app is the backup",
      );
      assert.deepEqual(
        (await readdir(t.installDir)).sort(),
        [...backups, APP].sort(),
        "no staging directory is left next to the app",
      );

      // The new app starts, finds the helper's result and settles it.
      const outcome = await recoverPreviousInstalls({
        paths: t.paths,
        runningVersion: "0.16.1",
        now: Date.now(),
        log: () => undefined,
      });
      assert.equal(outcome.confirmed, true);
      assert.equal(outcome.failedVersion, undefined);
      assert.equal(await exists(join(t.paths.jobs, t.jobId)), false);
      assert.equal(await exists(join(t.installDir, backups[0])), true, "one backup is kept");
    } finally {
      await t.app.quit().catch(() => undefined);
      await rm(t.root, { recursive: true, force: true });
    }
  },
);

test(
  "a quarantined bundled helper still installs because its copy drops the attribute",
  { skip: skipUnlessHelper, timeout: 120_000 },
  async () => {
    // The first lane-bearing release is installed by hand from a download, so
    // every file of the running app may carry com.apple.quarantine, helper
    // included. The helper runs from a copy; a copy that kept the attribute
    // could be blocked at launch.
    const t = await arrangeInstall({ withCommit: true, quarantineHelperSource: true });
    try {
      const copy = join(t.paths.jobs, t.jobId, HELPER_NAME);
      const quarantine = (file) => runCommand(XATTR, ["-p", "com.apple.quarantine", file], { timeoutMs: 20_000 });
      assert.equal((await quarantine(join(t.root, "quarantined-helper"))).code, 0, "the source is quarantined");
      assert.notEqual((await quarantine(copy)).code, 0, "the copy carries no quarantine attribute");

      await t.app.quit();
      const result = await waitForResult(t.paths, t.jobId);
      assert.equal(result.status, "launch_requested", result.message);
      assert.equal((await readInfoPlist(t.bundlePath, runCommand)).version, "0.16.1");
    } finally {
      await t.app.quit().catch(() => undefined);
      await rm(t.root, { recursive: true, force: true });
    }
  },
);

test(
  "an update the app never committed changes nothing",
  { skip: skipUnlessHelper, timeout: 120_000 },
  async () => {
    const t = await arrangeInstall({ withCommit: false });
    try {
      await t.app.quit();
      const result = await waitForResult(t.paths, t.jobId);
      assert.equal(result.status, "not_committed", result.message);
      assert.equal((await readInfoPlist(t.bundlePath, runCommand)).version, "0.16.0");
      assert.equal(
        (await readdir(t.installDir)).filter((n) => n.startsWith(".pi-desktop-plus-backup-")).length,
        0,
      );

      const outcome = await recoverPreviousInstalls({
        paths: t.paths,
        runningVersion: "0.16.0",
        now: Date.now(),
        log: () => undefined,
      });
      assert.equal(outcome.failedVersion, undefined, "a quit that never committed is not an install failure");
      assert.deepEqual(await readdir(t.installDir), [APP], "the unused staged copy is removed");
    } finally {
      await t.app.quit().catch(() => undefined);
      await rm(t.root, { recursive: true, force: true });
    }
  },
);
