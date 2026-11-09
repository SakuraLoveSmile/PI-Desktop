import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { recoverPreviousInstalls, STALE_JOB_MS } = await import(
  "../electron/main/assisted-update/recovery.ts"
);
const { assistedPaths, removeRecordedInstallDir, saveState, loadState } = await import(
  "../electron/main/assisted-update/job-store.ts"
);

const exists = (path) => stat(path).then(() => true, () => false);

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "assisted-recovery-"));
  const installDir = join(root, "Applications");
  await mkdir(installDir, { recursive: true });
  const paths = assistedPaths(join(root, "cache"));
  await mkdir(paths.jobs, { recursive: true });
  const logs = [];
  const run = (runningVersion = "0.16.1", now = Date.now()) =>
    recoverPreviousInstalls({
      paths,
      runningVersion,
      now,
      log: (level, message) => logs.push(`${level}:${message}`),
    });
  /** A finished job as the helper leaves it. */
  const job = async (id, { status, toVersion = "0.16.1", withBackup = true, withStaging = false, noResult = false } = {}) => {
    const dir = join(paths.jobs, id);
    await mkdir(dir, { recursive: true });
    const stagingDir = join(installDir, `.pi-desktop-plus-update-${id}`);
    const backupDir = join(installDir, `.pi-desktop-plus-backup-${id}`);
    if (withBackup) await mkdir(join(backupDir, "Pi-Desktop-Plus.app"), { recursive: true });
    if (withStaging) await mkdir(join(stagingDir, "Pi-Desktop-Plus.app"), { recursive: true });
    await writeFile(
      join(dir, "job.json"),
      JSON.stringify({
        schemaVersion: 1,
        jobId: id,
        targetApp: join(installDir, "Pi-Desktop-Plus.app"),
        stagedApp: join(stagingDir, "Pi-Desktop-Plus.app"),
        backupDir,
        toVersion,
      }),
    );
    if (!noResult) {
      await writeFile(
        join(dir, "result.json"),
        JSON.stringify({
          schemaVersion: 1,
          jobId: id,
          status,
          message: "m",
          fromVersion: "0.16.0",
          toVersion,
          backupApp: withBackup ? join(backupDir, "Pi-Desktop-Plus.app") : null,
          finishedAtMs: 1,
        }),
      );
    }
    return { dir, stagingDir, backupDir };
  };
  return { root, installDir, paths, run, job, logs };
}

test("a confirmed install keeps its backup, forgets the older backup and clears the job", async () => {
  const t = await setup();
  const old = await t.job("job-old-00000001", { status: "launch_requested", toVersion: "0.16.0" });
  await saveState(t.paths, { schemaVersion: 1, backupDir: old.backupDir, failedVersion: "0.15.0" });
  await rm(old.dir, { recursive: true });
  const fresh = await t.job("job-new-00000002", { status: "launch_requested" });

  const outcome = await t.run("0.16.1");
  assert.deepEqual(outcome, { failedVersion: undefined, confirmed: true });
  assert.equal(await exists(old.backupDir), false, "only one backup is kept");
  assert.equal(await exists(fresh.backupDir), true);
  assert.equal(await exists(fresh.dir), false);
  assert.deepEqual(await loadState(t.paths), { schemaVersion: 1, backupDir: fresh.backupDir });
  await rm(t.root, { recursive: true });
});

test("a launched update that is not the running version is not confirmed", async () => {
  const t = await setup();
  const j = await t.job("job-aaaa-00000001", { status: "launch_requested", toVersion: "0.16.2" });
  const outcome = await t.run("0.16.1");
  assert.equal(outcome.confirmed, false);
  assert.equal(await exists(j.backupDir), true, "the backup is left alone");
  assert.equal(await exists(j.dir), false);
  await rm(t.root, { recursive: true });
});

for (const status of ["swap_failed", "staged_invalid", "bundle_in_use", "rolled_back", "invalid_job"]) {
  test(`${status} records the failed version and removes the failed copies`, async () => {
    const t = await setup();
    const j = await t.job("job-fail-00000001", { status, toVersion: "0.16.2", withStaging: true });
    const outcome = await t.run("0.16.1");
    assert.equal(outcome.failedVersion, "0.16.2");
    assert.equal(await exists(j.stagingDir), false);
    assert.equal(await exists(j.backupDir), false);
    assert.equal(await exists(j.dir), false);
    assert.equal((await loadState(t.paths)).failedVersion, "0.16.2");
    await rm(t.root, { recursive: true });
  });
}

test("a restore that failed keeps the backup, because it holds the user's previous app", async () => {
  const t = await setup();
  const j = await t.job("job-lost-00000001", { status: "rollback_failed", toVersion: "0.16.2" });
  const outcome = await t.run("0.16.1");
  assert.equal(outcome.failedVersion, "0.16.2");
  assert.equal(await exists(j.backupDir), true);
  assert.ok(t.logs.some((line) => line.startsWith("warn:")));
  await rm(t.root, { recursive: true });
});

for (const status of ["not_committed", "parent_still_running", "locked", "target_changed"]) {
  test(`${status} is not blamed on the update`, async () => {
    const t = await setup();
    const j = await t.job("job-calm-00000001", { status, toVersion: "0.16.2", withBackup: false, withStaging: true });
    const outcome = await t.run("0.16.1");
    assert.equal(outcome.failedVersion, undefined);
    assert.equal(await exists(j.stagingDir), false, "the unused staged copy is removed");
    assert.equal(await exists(j.dir), false);
    await rm(t.root, { recursive: true });
  });
}

test("a job without a result is left alone while fresh and removed once abandoned", async () => {
  const t = await setup();
  const j = await t.job("job-wait-00000001", { noResult: true, withStaging: true, withBackup: false });
  await t.run("0.16.1");
  assert.equal(await exists(j.dir), true, "a helper may still be working");
  assert.equal(await exists(j.stagingDir), true);

  const old = new Date(Date.now() - STALE_JOB_MS - 60_000);
  await utimes(j.dir, old, old);
  await t.run("0.16.1");
  assert.equal(await exists(j.dir), false);
  assert.equal(await exists(j.stagingDir), false);
  await rm(t.root, { recursive: true });
});

test("the job being prepared right now is skipped", async () => {
  const t = await setup();
  const j = await t.job("job-live-00000001", { status: "swap_failed" });
  await recoverPreviousInstalls({
    paths: t.paths,
    runningVersion: "0.16.1",
    now: Date.now(),
    skipJobId: "job-live-00000001",
    log: () => {},
  });
  assert.equal(await exists(j.dir), true);
  await rm(t.root, { recursive: true });
});

test("recorded paths are data, not authority", async () => {
  const t = await setup();
  const precious = join(t.root, "precious");
  await mkdir(precious);
  await writeFile(join(precious, "file"), "keep");
  const dir = join(t.paths.jobs, "job-evil-00000001");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "job.json"),
    JSON.stringify({ stagedApp: join(precious, "X.app"), backupDir: precious, stagingDir: precious }),
  );
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify({ schemaVersion: 1, status: "swap_failed", toVersion: "9.9.9", message: "" }),
  );
  await t.run("0.16.1");
  assert.equal(await readFile(join(precious, "file"), "utf8"), "keep");

  // The name pattern alone is not enough: a symlink, a file or a foreign path is refused too.
  const target = join(t.root, "elsewhere");
  await mkdir(target);
  const link = join(t.installDir, ".pi-desktop-plus-backup-link-00000001");
  await symlink(target, link);
  assert.equal(await removeRecordedInstallDir(link), false);
  assert.equal(await exists(target), true);
  const file = join(t.installDir, ".pi-desktop-plus-update-file-00000001");
  await writeFile(file, "x");
  assert.equal(await removeRecordedInstallDir(file), false);
  assert.equal(await removeRecordedInstallDir("relative/.pi-desktop-plus-update-aaaaaaaa"), false);
  assert.equal(await removeRecordedInstallDir(join(t.installDir, "Pi-Desktop-Plus.app")), false);
  assert.equal(await removeRecordedInstallDir(undefined), false);
  await rm(t.root, { recursive: true });
});

test("unrelated entries in the jobs directory are ignored", async () => {
  const t = await setup();
  await writeFile(join(t.paths.jobs, ".update.lock"), "");
  await mkdir(join(t.paths.jobs, "not a job id"));
  await t.run("0.16.1");
  assert.deepEqual((await readdir(t.paths.jobs)).sort(), [".update.lock", "not a job id"]);
  await rm(t.root, { recursive: true });
});
