import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { captureEnvironment, createCaptureOutput, parseArguments, sourceIdentity } from "./capture.mjs";
import { candidateIdentity } from "../e2e-suite-runtime.mjs";
import network from "./network.cjs";

test("capture child receives fixture directories and display, without caller credentials or launch flags", () => {
  const scratch = join(tmpdir(), "capture-env-fixture");
  const env = captureEnvironment({
    PATH: "/fixture/tools", DISPLAY: ":99", HOME: "/user/profile", PI_DESKTOP_DATA_DIR: "/user/database",
    OPENAI_API_KEY: "fixture-secret", GITHUB_TOKEN: "fixture-token", PI_DESKTOP_HOST_BIN: "/user/host",
    ELECTRON_RUN_AS_NODE: "1", ELECTRON_RENDERER_URL: "https://fixture.invalid", NODE_OPTIONS: "--inspect",
    PI_DESKTOP_CAPTURE: "1", HTTP_PROXY: "https://fixture.invalid",
  }, scratch, "/fixture/output", "/fixture/bundle");
  assert.equal(env.DISPLAY, ":99");
  assert.equal(env.HOME, join(scratch, "home"));
  assert.equal(env.PI_DESKTOP_DATA_DIR, join(scratch, "data"));
  assert.equal(env.TZ, "UTC");
  for (const key of ["OPENAI_API_KEY", "GITHUB_TOKEN", "PI_DESKTOP_HOST_BIN", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "PI_DESKTOP_CAPTURE", "HTTP_PROXY"]) {
    assert.equal(env[key], undefined, `${key} must not reach the screenshot child`);
  }
  assert.equal(env.ELECTRON_RENDERER_URL, "");
  for (const key of ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR"]) assert(env[key].startsWith(scratch));
});

test("fixture request policy admits bundled resources and rejects public, local services and escaped files", () => {
  const bundle = join(tmpdir(), "capture-network-fixture");
  assert.equal(network.isFixtureRequest(pathToFileURL(join(bundle, "renderer.js")).href, bundle), true);
  assert.equal(network.isFixtureRequest("data:image/png;base64,fixture", bundle), true);
  assert.equal(network.isFixtureRequest("blob:file:///fixture", bundle), true);
  for (const url of ["https://fixture.invalid/v1/models", "http://127.0.0.1:54321/", "ws://127.0.0.1/", "wss://fixture.invalid/",
    pathToFileURL(join(bundle, "../outside.txt")).href, "file://remote.invalid/share/private", "file:///%XX", "about:blank"]) {
    assert.equal(network.isFixtureRequest(url, bundle), false, url);
  }
});

test("build-only stays explicit and unknown arguments cannot become Electron flags", () => {
  assert.deepEqual(parseArguments(["--", "--build-only", "--output", ".artifacts/prepared"]), { buildOnly: true, output: ".artifacts/prepared" });
  assert.deepEqual(parseArguments(["--output", ".artifacts/run"]), { buildOnly: false, output: ".artifacts/run" });
  for (const args of [[], ["--output"], ["--output", "one", "--output", "two"], ["--output", "one", "--no-sandbox"]]) {
    assert.throws(() => parseArguments(args), /Usage/);
  }
});

test("output rejects symlinked ancestors before creating any external directory", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ui-output-test-"));
  const repository = join(scratch, "repository");
  const outside = join(scratch, "outside");
  try {
    await mkdir(repository); await mkdir(outside);
    await symlink(outside, join(repository, ".artifacts"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(createCaptureOutput(".artifacts/missing/parent/run", repository), /ancestors/);
    assert.deepEqual(await readdir(outside), []);
    await assert.rejects(createCaptureOutput("../outside/run", repository), /under this worktree/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("output creates a new nested artifact directory and preserves existing evidence", async () => {
  const repository = await mkdtemp(join(tmpdir(), "ui-output-local-test-"));
  try {
    const output = await createCaptureOutput(".artifacts/ui/before", repository);
    await writeFile(join(output, "evidence"), "preserved");
    await assert.rejects(createCaptureOutput(".artifacts/ui/before", repository), { code: "EEXIST" });
    assert.deepEqual(await readdir(output), ["evidence"]);
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("renderer source identity ignores an inherited missing Host while default E2E identity still binds it", async () => {
  const repository = await mkdtemp(join(tmpdir(), "ui-source-test-"));
  const previousHost = process.env.PI_DESKTOP_HOST_BIN;
  try {
    const git = args => execFileSync("git", args, { cwd: repository });
    git(["init", "--quiet", "--initial-branch=main"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
      "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    process.env.PI_DESKTOP_HOST_BIN = join(repository, "missing-host");
    const source = await sourceIdentity(repository);
    assert.match(source.head, /^[a-f0-9]{40}$/);
    assert.equal(source.dirty, false);
    await assert.rejects(candidateIdentity(repository), { code: "ENOENT" });
    await writeFile(process.env.PI_DESKTOP_HOST_BIN, "fixture-binary");
    assert.match((await candidateIdentity(repository)).hostBinarySha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previousHost === undefined) delete process.env.PI_DESKTOP_HOST_BIN;
    else process.env.PI_DESKTOP_HOST_BIN = previousHost;
    await rm(repository, { recursive: true, force: true });
  }
});
