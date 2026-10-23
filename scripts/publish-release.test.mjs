import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishRelease } from "./publish-release.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const repository = "fixture/pi-desktop";
const sourceSha = "a".repeat(40);

async function fixture(t, version = "1.2.3") {
  const directory = await mkdtemp(join(tmpdir(), "pi-release-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("a fixture installer, not a real build\n");
  const name = `installer-${version}.zip`;
  const channel = version.includes("-") ? version.split("-")[1].split(".")[0] : "latest";
  const manifest = { schemaVersion: 1, kind: "release", version, channel, signedMacos: true,
    source: { repository, sha: sourceSha }, build: { runId: "1", runAttempt: "1", url: "https://example.invalid/run/1" },
    assets: [{ name, size: bytes.length, sha256: sha256(bytes) }] };
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(join(directory, name), bytes);
  await writeFile(join(directory, "release-manifest.json"), manifestBytes);
  await writeFile(join(directory, "SHA256SUMS"), `${sha256(bytes)}  ${name}\n${sha256(manifestBytes)}  release-manifest.json\n`);
  return { directory, repository, sourceSha, ref: `refs/tags/v${version}`, version, name };
}

function github(options = {}) {
  const calls = [];
  let release = options.release;
  let assets = [];
  let failed = false;
  let uploadCount = 0;
  let releaseReads = 0;
  const api = async (method, endpoint, request = {}) => {
    calls.push({ method, endpoint, ...request });
    if (method === "GET" && endpoint.includes("/git/ref/tags/")) return { object: { type: "tag", sha: "b".repeat(40) } };
    if (method === "GET" && endpoint.includes("/git/tags/")) return { object: { type: "commit", sha: options.tagSha ?? sourceSha } };
    if (method === "GET" && endpoint.includes("/compare/")) return { status: options.mainStatus ?? "ahead" };
    if (method === "GET" && endpoint.includes("/releases/tags/")) {
      releaseReads++;
      if (options.releaseReadError) throw Object.assign(new Error("fixture authentication failure"), { status: options.releaseReadError });
      if (options.changeDraft && releaseReads > 1 && release) return { ...release, ...options.changeDraft };
      if (release) return release;
      throw Object.assign(new Error("not found"), { status: 404 });
    }
    if (method === "POST" && endpoint.endsWith("/releases")) {
      release = { id: 42, html_url: "https://example.invalid/release", ...request.json };
      return release;
    }
    if (method === "GET" && endpoint.includes("/assets?")) {
      if (options.corruptRemote && assets.length === 3) return assets.map((asset, index) => index ? asset : { ...asset, digest: "sha256:" + "0".repeat(64) });
      return assets;
    }
    if (method === "POST" && endpoint.includes("/assets?")) {
      uploadCount++;
      if (options.failUploadOnce && !failed && uploadCount === 2) {
        failed = true;
        throw new Error("fixture upload interrupted");
      }
      const name = new URL("https://example.invalid" + endpoint).searchParams.get("name");
      assert(!assets.some(asset => asset.name === name), "an existing asset must never be replaced");
      const bytes = await readFile(request.file);
      assert.equal(bytes.length, request.size);
      const asset = { name, size: bytes.length, state: "uploaded", digest: `sha256:${sha256(bytes)}` };
      assets.push(asset);
      return asset;
    }
    if (method === "PATCH" && endpoint.endsWith("/releases/42")) {
      release = { ...release, ...request.json };
      return release;
    }
    throw new Error(`Unexpected fixture request: ${method} ${endpoint}`);
  };
  return { api, calls, get release() { return release; }, get assets() { return assets; } };
}

test("stable release is a draft until every uploaded digest is verified", async t => {
  const input = await fixture(t);
  const remote = github();
  assert.equal(await publishRelease(input, remote), "https://example.invalid/release");
  const create = remote.calls.find(call => call.method === "POST" && call.endpoint.endsWith("/releases"));
  assert.equal(create.json.draft, true);
  assert.equal(create.json.target_commitish, sourceSha);
  assert.equal(create.json.generate_release_notes, true);
  const publish = remote.calls.at(-1);
  assert.equal(publish.method, "PATCH");
  assert.deepEqual(publish.json, { draft: false, prerelease: false, make_latest: "true" });
  assert.equal(remote.assets.length, 3);
});

test("prerelease publication does not become the stable latest release", async t => {
  const input = await fixture(t, "1.2.3-beta.2");
  const remote = github();
  await publishRelease(input, remote);
  assert.deepEqual(remote.calls.at(-1).json, { draft: false, prerelease: true, make_latest: "false" });
});

test("published releases and unrelated drafts are immutable", async t => {
  const input = await fixture(t);
  for (const release of [{ id: 42, draft: false }, { id: 42, draft: true, body: "unrelated draft" }]) {
    const remote = github({ release });
    await assert.rejects(publishRelease(input, remote), /already published|does not match/);
    assert(remote.calls.every(call => call.method === "GET"));
  }
});

test("interrupted upload retains its draft and an exact retry uploads only missing files", async t => {
  const input = await fixture(t);
  const remote = github({ failUploadOnce: true });
  await assert.rejects(publishRelease(input, remote), /upload interrupted/);
  assert.equal(remote.release.draft, true);
  assert.equal(remote.assets.length, 1);
  await publishRelease(input, remote);
  assert.equal(remote.release.draft, false);
  assert.equal(remote.assets.length, 3);
  assert.equal(remote.calls.filter(call => call.method === "POST" && call.endpoint.endsWith("/releases")).length, 1);
});

test("remote digest mismatch leaves the release private", async t => {
  const input = await fixture(t);
  const remote = github({ corruptRemote: true });
  await assert.rejects(publishRelease(input, remote), /Remote asset digest or size mismatch/);
  assert.equal(remote.release.draft, true);
  assert(!remote.calls.some(call => call.method === "PATCH"));
});

test("draft changes during upload prevent the final publication", async t => {
  const input = await fixture(t);
  for (const changeDraft of [{ draft: false }, { id: 43 }, { target_commitish: "c".repeat(40) }, { body: "edited" }]) {
    const remote = github({ changeDraft });
    await assert.rejects(publishRelease(input, remote), /already published|does not match/);
    assert(!remote.calls.some(call => call.method === "PATCH"));
  }
});

test("authentication errors do not create a replacement release", async t => {
  const input = await fixture(t);
  const remote = github({ releaseReadError: 403 });
  await assert.rejects(publishRelease(input, remote), /authentication failure/);
  assert(remote.calls.every(call => call.method === "GET"));
});

test("changed tags, removed main ancestry and workflow identity mismatch cannot publish", async t => {
  const input = await fixture(t);
  for (const options of [{ tagSha: "c".repeat(40) }, { mainStatus: "diverged" }]) {
    const remote = github(options);
    await assert.rejects(publishRelease(input, remote), /no longer/);
    assert(remote.calls.every(call => call.method === "GET"));
  }
  const remote = github();
  await assert.rejects(publishRelease({ ...input, ref: "refs/heads/main" }, remote), /Workflow identity/);
  assert.equal(remote.calls.length, 0);
});

test("tampered local assets are rejected before contacting GitHub", async t => {
  const input = await fixture(t);
  await writeFile(join(input.directory, input.name), "modified");
  const remote = github();
  await assert.rejects(publishRelease(input, remote), /checksum mismatch/);
  assert.equal(remote.calls.length, 0);
});
