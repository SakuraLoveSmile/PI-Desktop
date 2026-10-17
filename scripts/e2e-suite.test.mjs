import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { candidateIdentity, fixtureEnvironment, loadCatalog, runSuite, selectSuites } from "./e2e-suite-runtime.mjs";

test("PR smoke covers five fixture paths and automated selection rejects real suites", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(selectSuites(catalog, { tier: "smoke" }).map(entry => entry.id).sort(),
    ["approval", "electron-boot", "restart", "session-completion", "supervision"]);
  assert.ok(selectSuites(catalog, { tier: "nightly" }).every(entry => entry.tier !== "manual"));
  assert.throws(() => selectSuites(catalog, { suite: "agent-live" }), /No matching/);
  assert.throws(() => selectSuites(catalog, { family: "typo" }), /Unknown/);
});

test("fixture environment ignores inherited credentials, user state and model endpoints", () => {
  const env = fixtureEnvironment({ PATH: "/tool/bin", PI_DESKTOP_TEST_API_KEY: "private", OPENAI_API_KEY: "private",
    PI_DESKTOP_DATA_DIR: "/personal/data", PI_DESKTOP_TEST_BASE_URL: "https://live.invalid", NODE_OPTIONS: "--import=private.mjs",
    PI_COMPOSER_PREVIEW: "1", ELECTRON_RENDERER_URL: "http://personal" }, "/fixture");
  assert.equal(env.PATH, "/tool/bin");
  assert.equal(env.HOME, "/fixture/home");
  assert.equal(env.ELECTRON_RENDERER_URL, "");
  for (const key of ["PI_DESKTOP_TEST_API_KEY", "OPENAI_API_KEY", "PI_DESKTOP_DATA_DIR", "PI_DESKTOP_TEST_BASE_URL", "NODE_OPTIONS", "PI_COMPOSER_PREVIEW"]) assert.equal(env[key], undefined);
});

test("dispatcher invokes a real subprocess in its temporary home and surfaces failures/skips", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-suite-test-"));
  try {
    await writeFile(join(directory, "probe.mjs"), `
      import assert from 'node:assert/strict';
      import { writeFile } from 'node:fs/promises';
      import { join } from 'node:path';
      assert.equal(process.env.OPENAI_API_KEY, undefined);
      await writeFile(join(process.env.HOME, 'probe'), 'isolated');
      console.log('PASS subprocess');
    `);
    const entry = { id: "test", script: "probe.mjs", tier: "smoke" };
    const passed = await runSuite(entry, { directory, parentEnv: { OPENAI_API_KEY: "private" }, onOutput: () => {} });
    assert.equal(passed.passed, true);
    await writeFile(join(directory, "probe.mjs"), "console.log('SKIP required-case missing boundary');");
    const skipped = await runSuite(entry, { directory, onOutput: () => {} });
    assert.equal(skipped.passed, false);
    assert.deepEqual(skipped.unexpectedSkips, ["SKIP required-case missing boundary"]);
    const excluded = await runSuite({ ...entry, excludedCoverage: ["required-case"] }, { directory, onOutput: () => {} });
    assert.equal(excluded.passed, true);
    assert.deepEqual(excluded.excludedCoverage, ["required-case"]);
    await writeFile(join(directory, "probe.mjs"), "process.exitCode = 7;");
    const failed = await runSuite(entry, { directory, onOutput: () => {} });
    assert.equal(failed.passed, false); assert.equal(failed.code, 7);
    await assert.rejects(runSuite({ ...entry, tier: "manual", safety: "real provider" }), /direct authorized invocation/);
    assert.equal(await readFile(join(directory, "probe.mjs"), "utf8"), "process.exitCode = 7;");
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("candidate identity fingerprints directory symlinks without following their contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-candidate-test-"));
  const repository = join(directory, "repository");
  const firstTarget = join(directory, "first-target");
  const secondTarget = join(directory, "second-target");
  try {
    for (const path of [repository, firstTarget, secondTarget]) await mkdir(path);
    const config = join(directory, "git-config");
    await writeFile(config, "");
    const git = args => execFileSync("git", args, { cwd: repository,
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" } });
    git(["init", "--quiet", "--initial-branch=main"]);
    // This commit belongs only to the disposable fixture repository.
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
      "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await writeFile(join(repository, ".gitignore"), await readFile(new URL("../.gitignore", import.meta.url), "utf8"));
    git(["add", ".gitignore"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
      "commit", "--quiet", "-m", "Fixture ignore policy"]);
    const beforeEvidence = await candidateIdentity(repository);
    assert.equal(beforeEvidence.dirty, false);
    await mkdir(join(repository, ".artifacts"));
    await mkdir(join(repository, ".review-evidence"));
    await writeFile(join(repository, ".artifacts", "result.json"), "generated report");
    await writeFile(join(repository, ".review-evidence", "screenshot.png"), "generated screenshot");
    const afterEvidence = await candidateIdentity(repository);
    assert.equal(afterEvidence.dirty, false, "generated evidence must leave a clean source checkout");
    assert.equal(afterEvidence.workspaceDiffSha256, beforeEvidence.workspaceDiffSha256,
      "generated reports and screenshots must not appear as candidate source changes");
    // Keep this name outside the copied ignore policy: git hides ignored links from candidate identity.
    const linked = join(repository, "linked-dependency");
    await symlink(firstTarget, linked, process.platform === "win32" ? "junction" : "dir");
    const before = await candidateIdentity(repository);
    assert.equal(before.dirty, true);
    await writeFile(join(firstTarget, "external-file"), "not candidate source");
    const changedTarget = await candidateIdentity(repository);
    assert.equal(changedTarget.workspaceDiffSha256, before.workspaceDiffSha256,
      "linked dependency/cache contents must not enter the candidate fingerprint");
    await unlink(linked);
    await symlink(secondTarget, linked, process.platform === "win32" ? "junction" : "dir");
    const changedLink = await candidateIdentity(repository);
    assert.notEqual(changedLink.workspaceDiffSha256, before.workspaceDiffSha256,
      "changing a symlink target must change the candidate identity");
    await writeFile(join(repository, "source.mjs"), "export const value = 1;");
    const addedSource = await candidateIdentity(repository);
    assert.notEqual(addedSource.workspaceDiffSha256, changedLink.workspaceDiffSha256);
    await writeFile(join(repository, "source.mjs"), "export const value = 2;");
    assert.notEqual((await candidateIdentity(repository)).workspaceDiffSha256, addedSource.workspaceDiffSha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
