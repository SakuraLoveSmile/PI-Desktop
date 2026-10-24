import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectReleaseRecovery, recoverReleasePublication } from "./recover-release-publication.mjs";
import { publishRelease } from "./publish-release.mjs";

const repository = "fixture/pi-desktop";
const sourceSha = "a".repeat(40);
const runId = "123";
const artifactId = "456";
const version = "1.2.3";
const tag = `v${version}`;
const artifactName = `release-bundle-${version}-${sourceSha}`;
const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
const gateNames = [
  "Validate source, version and signing requirements",
  "Verify candidate / JS build / typecheck / lint / architecture / test",
  "Verify candidate / Rust host-core format / lint / test",
  "Verify candidate / Isolated launch / message / approval / restart smoke / fixture",
  "Build macOS arm64",
  "Verify macOS arm64 installer bundle",
];
const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: repository, ALLOW_UNSIGNED_MACOS_RELEASE: "true" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function github() {
  const calls = [];
  const run = { id: Number(runId), repository: { full_name: repository }, head_repository: { full_name: repository },
    workflow_id: 789, path: ".github/workflows/release.yml", event: "push", status: "completed", conclusion: "failure",
    head_sha: sourceSha, head_branch: tag, run_attempt: 1, html_url: runUrl };
  const jobs = [...gateNames, "Publish verified GitHub Release"].map((name, index) => ({
    name, status: "completed", conclusion: index === 6 ? "failure" : "success", run_id: Number(runId), head_sha: sourceSha,
  }));
  const artifact = { id: Number(artifactId), name: artifactName, expired: false, size_in_bytes: 100,
    digest: `sha256:${"b".repeat(64)}`, workflow_run: { id: Number(runId), head_sha: sourceSha, head_branch: tag } };
  const remote = { run, jobs, artifacts: [artifact], calls, draft: undefined, assets: [], failFinalRead: false };
  remote.api = async (method, endpoint, request = {}) => {
    calls.push({ method, endpoint });
    if (method === "GET" && endpoint.endsWith("/actions/workflows/release.yml")) return { id: 789 };
    if (method === "GET" && endpoint.endsWith(`/actions/runs/${runId}`)) return run;
    if (method === "GET" && endpoint.includes(`/runs/${runId}/jobs?`)) return { jobs };
    if (method === "GET" && endpoint.includes(`/runs/${runId}/artifacts?`)) return { artifacts: remote.artifacts };
    if (method === "GET" && endpoint.includes("/git/ref/tags/")) return { object: { type: "commit", sha: sourceSha } };
    if (method === "GET" && endpoint.includes("/compare/")) return { status: "ahead" };
    if (method === "GET" && endpoint.startsWith(`/repos/${repository}/releases?`)) return remote.draft ? [remote.draft] : [];
    if (method === "POST" && endpoint.endsWith("/releases")) {
      assert.equal(remote.draft, undefined, "recovery must retain the existing draft");
      remote.draft = { id: 42, html_url: "https://example.invalid/release", ...request.json };
      return remote.draft;
    }
    if (method === "GET" && endpoint.includes("/assets?")) return remote.assets;
    if (method === "POST" && endpoint.includes("/assets?")) {
      const name = new URL("https://example.invalid" + endpoint).searchParams.get("name");
      const bytes = await readFile(request.file);
      assert(!remote.assets.some(asset => asset.name === name));
      remote.assets.push({ name, state: "uploaded", size: bytes.length, digest: `sha256:${hash(bytes)}` });
      return remote.assets.at(-1);
    }
    if (method === "GET" && endpoint.endsWith("/releases/42")) {
      if (remote.failFinalRead) throw new Error("fixture final draft lookup failed");
      return remote.draft;
    }
    if (method === "PATCH" && endpoint.endsWith("/releases/42")) {
      remote.draft = { ...remote.draft, ...request.json };
      return remote.draft;
    }
    throw new Error(`Unexpected request ${method} ${endpoint}`);
  };
  return remote;
}

async function bundle(t, signedMacos = false) {
  const directory = await mkdtemp(join(tmpdir(), "pi-release-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const name = "fixture-installer.zip";
  const bytes = Buffer.from("isolated fixture, not a product installer");
  const manifest = { schemaVersion: 1, kind: "release", version, channel: "latest", signedMacos,
    source: { repository, sha: sourceSha }, build: { runId, runAttempt: "1", url: runUrl },
    assets: [{ name, size: bytes.length, sha256: hash(bytes) }] };
  const save = async () => {
    const body = JSON.stringify(manifest);
    await writeFile(join(directory, name), bytes);
    await writeFile(join(directory, "release-manifest.json"), body);
    await writeFile(join(directory, "SHA256SUMS"), `${hash(bytes)}  ${name}\n${hash(body)}  release-manifest.json\n`);
  };
  await save();
  return { directory, manifest, save, name };
}

test("main recovery resumes an uploaded unsigned draft from its original run without replacing assets", async t => {
  const { directory } = await bundle(t);
  const remote = github();
  remote.failFinalRead = true;
  await assert.rejects(publishRelease({ directory, repository, sourceSha, ref: `refs/tags/${tag}`,
    allowUnsignedMacos: true }, remote), /final draft lookup/);
  assert.equal(remote.draft.draft, true);
  assert.equal(remote.assets.length, 3);
  const writesBefore = remote.calls.filter(call => call.method === "POST").length;
  remote.failFinalRead = false;
  const receipt = await inspectReleaseRecovery({ runId, env }, remote);
  assert.equal(receipt.artifactId, artifactId);
  assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(await recoverReleasePublication({ directory, runId, artifactId: receipt.artifactId, env }, remote),
    "https://example.invalid/release");
  assert.equal(remote.draft.id, 42);
  assert.equal(remote.draft.draft, false);
  assert(remote.draft.body.includes("unsigned and not notarized"));
  assert.equal(remote.calls.filter(call => call.method === "POST").length, writesBefore);
  assert.equal(remote.calls.at(-1).method, "PATCH");
});

test("recovery requires main, manual dispatch, hosted runner and valid inputs before remote reads", async () => {
  for (const change of [{ GITHUB_REF: "refs/heads/feature" }, { GITHUB_EVENT_NAME: "push" },
    { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "../other" },
    { ALLOW_UNSIGNED_MACOS_RELEASE: "yes" }]) {
    const remote = github();
    await assert.rejects(inspectReleaseRecovery({ runId, env: { ...env, ...change } }, remote));
    assert.equal(remote.calls.length, 0);
  }
  for (const invalid of ["0", "-1", "123;exit", "9007199254740992", 123, undefined]) {
    const remote = github();
    await assert.rejects(inspectReleaseRecovery({ runId: invalid, env }, remote), /Invalid release run ID/);
    assert.equal(remote.calls.length, 0);
  }
});

test("candidates, other repositories, incomplete runs and other workflows cannot be recovered", async () => {
  for (const change of [{ event: "workflow_dispatch" }, { head_branch: "main" }, { head_branch: "v01.2.3" },
    { repository: { full_name: "other/repo" } }, { head_repository: { full_name: "other/repo" } },
    { status: "in_progress" }, { conclusion: "success" }, { workflow_id: 999 }, { id: 999 },
    { path: ".github/workflows/other.yml" }, { head_sha: "invalid" }, { run_attempt: 0 }, { html_url: "https://example.invalid" }]) {
    const remote = github();
    Object.assign(remote.run, change);
    await assert.rejects(inspectReleaseRecovery({ runId, env }, remote));
    assert(remote.calls.every(call => call.method === "GET"));
  }
});

test("every original gate must have passed and publication alone must have failed", async () => {
  for (let index = 0; index < gateNames.length; index++) {
    const remote = github();
    remote.jobs[index].conclusion = "failure";
    await assert.rejects(inspectReleaseRecovery({ runId, env }, remote), /All six release gates/);
  }
  for (const change of [jobs => jobs.pop(), jobs => jobs.push({ ...jobs[0] }),
    jobs => { jobs[0].run_id = 999; }, jobs => { jobs[0].head_sha = "b".repeat(40); },
    jobs => { jobs[0].status = "queued"; }, jobs => { jobs[6].conclusion = "success"; }]) {
    const remote = github();
    change(remote.jobs);
    await assert.rejects(inspectReleaseRecovery({ runId, env }, remote), /All six release gates/);
  }
});

test("missing, ambiguous, expired or mismatched artifacts cannot reach publication", async () => {
  for (const change of [remote => { remote.artifacts = []; }, remote => remote.artifacts.push({ ...remote.artifacts[0] }),
    remote => { remote.artifacts[0].expired = true; }, remote => { remote.artifacts[0].id = 0; },
    remote => { remote.artifacts[0].digest = null; }, remote => { remote.artifacts[0].name = "candidate"; },
    remote => { remote.artifacts[0].workflow_run.head_sha = "b".repeat(40); },
    remote => { remote.artifacts[0].workflow_run.id = 999; },
    remote => { remote.artifacts[0].workflow_run.head_branch = "main"; }]) {
    const remote = github();
    change(remote);
    await assert.rejects(inspectReleaseRecovery({ runId, env }, remote), /release bundle|provenance/);
    assert(remote.calls.every(call => call.method === "GET"));
  }
});

test("recovery rejects artifact changes between preparation and publication", async t => {
  const { directory } = await bundle(t);
  const remote = github();
  remote.artifacts[0].id = 999;
  await assert.rejects(recoverReleasePublication({ directory, runId, artifactId, env }, remote), /artifact changed/);
  assert(remote.calls.every(call => call.method === "GET"));
});

test("downloaded manifests must retain source, kind, version and original build run and attempt", async t => {
  for (const change of [manifest => { manifest.source.sha = "b".repeat(40); },
    manifest => { manifest.source.repository = "other/repo"; }, manifest => { manifest.kind = "candidate"; },
    manifest => { manifest.version = "9.9.9"; }, manifest => { manifest.build.runId = "999"; },
    manifest => { manifest.build.runAttempt = "2"; }, manifest => { manifest.build.url = "https://example.invalid"; }]) {
    const { directory, manifest, save } = await bundle(t);
    change(manifest);
    await save();
    const remote = github();
    await assert.rejects(recoverReleasePublication({ directory, runId, artifactId, env }, remote), /manifest does not match/);
    assert(remote.calls.every(call => call.method === "GET"));
  }
});

test("recovery retains unsigned opt-in and payload integrity checks", async t => {
  const { directory, name } = await bundle(t);
  const remote = github();
  await assert.rejects(recoverReleasePublication({ directory, runId, artifactId,
    env: { ...env, ALLOW_UNSIGNED_MACOS_RELEASE: "false" } }, remote), /unsigned/);
  assert.equal(remote.draft, undefined);
  await writeFile(join(directory, name), "changed payload");
  await assert.rejects(recoverReleasePublication({ directory, runId, artifactId, env }, remote), /checksum mismatch/);
  assert.equal(remote.draft, undefined);
  assert(remote.calls.every(call => call.method === "GET"));
});

test("already published releases remain immutable through recovery", async t => {
  const { directory } = await bundle(t);
  const remote = github();
  remote.draft = { id: 42, tag_name: tag, draft: false };
  await assert.rejects(recoverReleasePublication({ directory, runId, artifactId, env }, remote), /already published/);
  assert(remote.calls.every(call => call.method === "GET"));
});
