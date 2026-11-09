import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { helperEnvironment, spawnDetachedHelper } = await import(
  "../electron/main/assisted-update/helper-process.ts"
);

test("the helper environment is rebuilt from an allow-list with a fixed PATH", () => {
  const env = helperEnvironment({
    PATH: "/tmp/evil:/usr/bin",
    HOME: "/Users/someone",
    USER: "someone",
    TMPDIR: "/var/folders/x/",
    LANG: "en_US.UTF-8",
    ELECTRON_RUN_AS_NODE: "1",
    DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
    NODE_OPTIONS: "--require /tmp/evil.js",
    GITHUB_TOKEN: "secret",
  });
  assert.deepEqual(env, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: "/Users/someone",
    USER: "someone",
    TMPDIR: "/var/folders/x/",
    LANG: "en_US.UTF-8",
  });
  assert.deepEqual(helperEnvironment({}), { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
});

test("the helper starts with the job directory, a clean environment and its own log", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "assisted-helper-"));
  const jobDir = join(root, "job");
  await writeFile(join(root, "keep"), "");
  const helper = join(root, "helper.sh");
  await writeFile(
    helper,
    ["#!/bin/sh", 'echo "args:$1|$2"', 'echo "cwd:$(pwd)"', "env | sort", "exit 0", ""].join("\n"),
  );
  await chmod(helper, 0o700);
  await (await import("node:fs/promises")).mkdir(jobDir);
  process.env.ASSISTED_HELPER_TEST_SECRET = "must-not-leak";
  try {
    await spawnDetachedHelper(helper, jobDir);
  } finally {
    delete process.env.ASSISTED_HELPER_TEST_SECRET;
  }
  // The helper runs detached: wait for its output instead of for the process.
  const logPath = join(jobDir, "helper.log");
  let log = "";
  for (let attempt = 0; attempt < 100 && !log.includes("PATH="); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    log = await readFile(logPath, "utf8").catch(() => "");
  }
  const lines = log.split("\n");
  assert.ok(lines.includes(`args:--job-dir|${jobDir}`), "the helper is told which job to run");
  assert.ok(lines.includes("cwd:/"), "the helper does not inherit the app's working directory");
  assert.ok(lines.includes("PATH=/usr/bin:/bin:/usr/sbin:/sbin"), "PATH is fixed to the system directories");
  assert.equal(log.includes("ASSISTED_HELPER_TEST_SECRET") || log.includes("must-not-leak"), false);
  assert.equal(((await stat(logPath)).mode & 0o777).toString(8), "600");
  await rm(root, { recursive: true });
});

test("a helper that cannot start is reported with a stable code", async () => {
  const root = await mkdtemp(join(tmpdir(), "assisted-helper-"));
  await (await import("node:fs/promises")).mkdir(join(root, "job"));
  await assert.rejects(() => spawnDetachedHelper(join(root, "missing"), join(root, "job")), {
    code: "helper-spawn",
  });
  await rm(root, { recursive: true });
});
