import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fakeToolRunner } from "./helpers/assisted-fakes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { AssistedUpdateService } = await import("../electron/main/assisted-update/service.ts");
const { assistedPaths } = await import("../electron/main/assisted-update/job-store.ts");

const PAYLOAD = Buffer.alloc(40_000, 9);
const SHA = createHash("sha512").update(PAYLOAD).digest("base64");
const NAME = "Pi-Desktop-Plus-0.16.1-arm64-mac.zip";
const OFFER = { version: "0.16.1", files: [{ url: NAME, sha512: SHA, size: PAYLOAD.length }] };

async function* body(buffer) {
  yield buffer;
}

async function setup(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "assisted-service-"));
  const installDir = join(root, "Applications");
  const bundlePath = join(installDir, "Pi-Desktop-Plus.app");
  await mkdir(join(bundlePath, "Contents"), { recursive: true });
  const helperSource = join(root, "helper-src");
  await writeFile(helperSource, "#!/bin/sh\nexit 0\n");
  await chmod(helperSource, 0o755);
  const tools = fakeToolRunner(overrides.tools);
  const spawned = [];
  const logs = [];
  let counter = 0;
  const service = new AssistedUpdateService({
    paths: assistedPaths(join(root, "cache")),
    bundlePath,
    runningVersion: "0.16.0",
    arch: "arm64",
    helperSource: overrides.helperSource ?? helperSource,
    transport: async () => ({
      async get() {
        return { statusCode: 200, headers: {}, body: body(overrides.payload ?? PAYLOAD) };
      },
    }),
    run: tools.run,
    spawnHelper:
      overrides.spawnHelper ??
      (async (helper, jobDir) => {
        spawned.push({ helper, jobDir });
      }),
    log: (level, message) => logs.push(`${level}:${message}`),
    newJobId: () => `job-0000-${String((counter += 1)).padStart(4, "0")}`,
    pid: 4242,
  });
  return { root, installDir, bundlePath, service, tools, spawned, logs, paths: assistedPaths(join(root, "cache")) };
}

const noop = { signal: new AbortController().signal };
const exists = (path) => stat(path).then(() => true, () => false);

test("prepare downloads, stages next to the app and leaves only the staged copy and its record", async () => {
  const t = await setup();
  const result = await t.service.prepare(OFFER, noop);
  assert.deepEqual(result, { version: "0.16.1" });
  const stagingDir = join(t.installDir, ".pi-desktop-plus-update-job-0000-0001");
  assert.equal(await exists(join(stagingDir, "Pi-Desktop-Plus.app")), true);
  const record = JSON.parse(await readFile(join(t.paths.jobs, "job-0000-0001", "stage.json"), "utf8"));
  assert.equal(record.stagingDir, stagingDir);
  assert.equal(record.targetApp, t.bundlePath);
  assert.deepEqual(await readdir(t.paths.downloads), [], "the ZIP is deleted once staged");
  await rm(t.root, { recursive: true });
});

test("a failed download leaves nothing behind", async () => {
  const t = await setup({ payload: Buffer.alloc(PAYLOAD.length, 1) });
  await assert.rejects(() => t.service.prepare(OFFER, noop), { code: "hash-mismatch" });
  assert.deepEqual(await readdir(t.paths.downloads), []);
  assert.deepEqual(await readdir(t.paths.jobs), []);
  assert.deepEqual(await readdir(t.installDir), ["Pi-Desktop-Plus.app"]);
  await rm(t.root, { recursive: true });
});

test("a refused staging leaves nothing behind", async () => {
  const t = await setup({ tools: { bundleId: "com.example.other" } });
  await assert.rejects(() => t.service.prepare(OFFER, noop), { code: "identity" });
  assert.deepEqual(await readdir(t.paths.downloads), []);
  assert.deepEqual(await readdir(t.paths.jobs), []);
  assert.deepEqual(await readdir(t.installDir), ["Pi-Desktop-Plus.app"]);
  await rm(t.root, { recursive: true });
});

test("a cancel that lands after staging discards the staged copy", async () => {
  const t = await setup();
  const controller = new AbortController();
  const tools = t.tools;
  const original = tools.run;
  t.service.options.run = async (command, args) => {
    const result = await original(command, args);
    if (command.endsWith("xattr")) controller.abort();
    return result;
  };
  await assert.rejects(() => t.service.prepare(OFFER, { signal: controller.signal }), {
    code: "aborted",
  });
  assert.deepEqual(await readdir(t.installDir), ["Pi-Desktop-Plus.app"]);
  assert.deepEqual(await readdir(t.paths.jobs), []);
  await rm(t.root, { recursive: true });
});

test("install writes the helper's job, starts the helper, and the commit follows only on demand", async () => {
  const t = await setup();
  await t.service.prepare(OFFER, noop);
  await t.service.install();

  const jobDir = join(t.paths.jobs, "job-0000-0001");
  assert.deepEqual(t.spawned, [{ helper: join(jobDir, "pi-desktop-update-helper"), jobDir }]);
  assert.equal(((await stat(t.spawned[0].helper)).mode & 0o777).toString(8), "700");
  const bundle = await stat(t.bundlePath, { bigint: true });
  const job = JSON.parse(await readFile(join(jobDir, "job.json"), "utf8"));
  assert.deepEqual(job, {
    schemaVersion: 1,
    jobId: "job-0000-0001",
    parentPid: 4242,
    targetApp: t.bundlePath,
    targetDev: bundle.dev.toString(),
    targetIno: bundle.ino.toString(),
    stagedApp: join(t.installDir, ".pi-desktop-plus-update-job-0000-0001", "Pi-Desktop-Plus.app"),
    backupDir: join(t.installDir, ".pi-desktop-plus-backup-job-0000-0001"),
    fromVersion: "0.16.0",
    toVersion: "0.16.1",
  });
  assert.equal(await exists(join(jobDir, "commit.json")), false, "no commit before the quit");
  assert.equal(t.service.hasPendingInstall(), true);

  await t.service.install();
  assert.equal(t.spawned.length, 1, "a second restart click does not start a second helper");

  await t.service.commitPendingInstall();
  assert.deepEqual(JSON.parse(await readFile(join(jobDir, "commit.json"), "utf8")), {
    schemaVersion: 1,
    jobId: "job-0000-0001",
  });
  assert.equal(t.service.hasPendingInstall(), false);
  await rm(t.root, { recursive: true });
});

test("a commit with nothing pending writes nothing", async () => {
  const t = await setup();
  await t.service.commitPendingInstall();
  await t.service.prepare(OFFER, noop);
  await t.service.commitPendingInstall();
  assert.equal(await exists(join(t.paths.jobs, "job-0000-0001", "commit.json")), false);
  await rm(t.root, { recursive: true });
});

test("install needs a staged update and a helper that can start", async () => {
  const t = await setup();
  await assert.rejects(() => t.service.install(), { code: "not-prepared" });

  await t.service.prepare(OFFER, noop);
  const missing = await setup({ helperSource: "/nonexistent/helper" });
  await missing.service.prepare(OFFER, noop);
  await assert.rejects(() => missing.service.install(), { code: "helper-missing" });
  assert.equal(missing.service.hasPendingInstall(), false);

  const failing = await setup({
    spawnHelper: async () => {
      throw Object.assign(new Error("cannot start"), { code: "helper-spawn" });
    },
  });
  await failing.service.prepare(OFFER, noop);
  await assert.rejects(() => failing.service.install(), /cannot start/);
  assert.equal(failing.service.hasPendingInstall(), false);
  await failing.service.commitPendingInstall();
  assert.equal(await exists(join(failing.paths.jobs, "job-0000-0001", "commit.json")), false);
  for (const x of [t, missing, failing]) await rm(x.root, { recursive: true });
});

test("a new download replaces the staged copy of the old one", async () => {
  const t = await setup();
  await t.service.prepare(OFFER, noop);
  await t.service.prepare(OFFER, noop);
  assert.deepEqual((await readdir(t.installDir)).sort(), [
    ".pi-desktop-plus-update-job-0000-0002",
    "Pi-Desktop-Plus.app",
  ]);
  assert.deepEqual(await readdir(t.paths.jobs), ["job-0000-0002"]);
  await rm(t.root, { recursive: true });
});

test("nothing new is staged while an install is pending, and the pending copy is never discarded", async () => {
  const t = await setup();
  await t.service.prepare(OFFER, noop);
  await t.service.install();
  await assert.rejects(() => t.service.prepare(OFFER, noop), { code: "not-prepared" });
  await t.service.discardPrepared();
  assert.equal(await exists(join(t.installDir, ".pi-desktop-plus-update-job-0000-0001")), true);
  await rm(t.root, { recursive: true });
});

test("discarding drops the staged copy and its record", async () => {
  const t = await setup();
  await t.service.prepare(OFFER, noop);
  await t.service.discardPrepared();
  assert.deepEqual(await readdir(t.installDir), ["Pi-Desktop-Plus.app"]);
  assert.deepEqual(await readdir(t.paths.jobs), []);
  await rm(t.root, { recursive: true });
});
