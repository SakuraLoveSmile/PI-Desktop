#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseVersion } from "./release-preflight.mjs";

class GitHubError extends Error {
  constructor(status, message) { super(`GitHub HTTP ${status}: ${message}`); this.status = status; }
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifiedBundle(directory) {
  const manifestPath = join(directory, "release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const parsed = parseReleaseVersion(manifest.version);
  if (manifest.schemaVersion !== 1 || manifest.kind !== "release" || manifest.signedMacos !== true) {
    throw new Error("Only a signed, verified formal release bundle can be published");
  }
  if (manifest.channel !== parsed.channel || !/^[a-f0-9]{40}$/.test(manifest.source?.sha ?? "") ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(manifest.source?.repository ?? "")) {
    throw new Error("Release bundle has invalid source or channel metadata");
  }
  const checksums = new Map();
  const checksumText = await readFile(join(directory, "SHA256SUMS"), "utf8");
  for (const line of checksumText.trimEnd().split("\n")) {
    const item = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)$/.exec(line);
    if (!item || item[2] === "SHA256SUMS" || checksums.has(item[2])) throw new Error("Invalid or duplicate SHA256SUMS entry");
    checksums.set(item[2], item[1]);
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) throw new Error("Release manifest contains no assets");
  const expected = new Map();
  for (const asset of manifest.assets) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(asset.name ?? "") ||
        ["release-manifest.json", "SHA256SUMS"].includes(asset.name) || expected.has(asset.name) ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) {
      throw new Error("Release manifest contains invalid or duplicate assets");
    }
    expected.set(asset.name, asset);
  }
  const names = [...expected.keys(), "release-manifest.json"].sort();
  if (JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify(names)) throw new Error("Checksums do not cover the complete manifest");
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...names, "SHA256SUMS"].sort())) {
    throw new Error("Release directory does not match the verified asset set");
  }
  for (const name of [...names, "SHA256SUMS"]) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error(`Release asset must be a nonempty regular file: ${name}`);
    const sha256 = await hashFile(path);
    if (name !== "SHA256SUMS" && checksums.get(name) !== sha256) throw new Error(`Release checksum mismatch: ${name}`);
    const listed = expected.get(name);
    if (listed && (listed.size !== stat.size || listed.sha256 !== sha256)) throw new Error(`Release manifest mismatch: ${name}`);
    expected.set(name, { name, size: stat.size, sha256, path });
  }
  return { manifest, parsed, files: [...expected.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function githubTransport(token) {
  if (!token) throw new Error("GITHUB_TOKEN is required");
  return async (method, endpoint, options = {}) => {
    const upload = options.file !== undefined;
    const origin = upload ? "https://uploads.github.com" : "https://api.github.com";
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pi-desktop-release" };
    let body;
    if (upload) {
      headers["Content-Type"] = "application/octet-stream";
      headers["Content-Length"] = String(options.size);
      body = createReadStream(options.file);
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    const response = await fetch(origin + endpoint, { method, headers, body,
      redirect: "error", ...(upload ? { duplex: "half" } : {}) });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new GitHubError(response.status, result?.message ?? "request failed");
    return result;
  };
}

async function requireRemoteSource(api, repository, tag, source) {
  let target = (await api("GET", `/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  const visited = new Set();
  while (target?.type === "tag") {
    if (visited.has(target.sha) || visited.size >= 5 || !/^[a-f0-9]{40}$/.test(target.sha)) throw new Error("Invalid annotated release tag");
    visited.add(target.sha);
    target = (await api("GET", `/repos/${repository}/git/tags/${target.sha}`)).object;
  }
  if (target?.type !== "commit" || target.sha !== source) throw new Error("Remote tag no longer matches the verified source");
  const comparison = await api("GET", `/repos/${repository}/compare/${source}...main`);
  if (!["ahead", "identical"].includes(comparison.status)) throw new Error("Release source is no longer part of main");
}

function verifyRemoteAsset(asset, expected) {
  if (asset.state !== "uploaded" || asset.size !== expected.size || asset.digest !== `sha256:${expected.sha256}`) {
    throw new Error(`Remote asset digest or size mismatch: ${expected.name}`);
  }
}

function requireMatchingDraft(release, { tag, source, prerelease, marker, id }) {
  if (release && !release.draft) throw new Error(`Release ${tag} is already published; assets are immutable`);
  if (!release || (id !== undefined && release.id !== id) || release.tag_name !== tag ||
      release.target_commitish !== source || release.prerelease !== prerelease || !release.body?.includes(marker)) {
    throw new Error("Existing draft does not match this exact verified bundle; retained for inspection");
  }
}

async function remoteAssets(api, repository, releaseId) {
  const results = [];
  for (let page = 1; page <= 10; page++) {
    const assets = await api("GET", `/repos/${repository}/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(assets)) throw new Error("GitHub did not return a release asset list");
    results.push(...assets);
    if (assets.length < 100) return results;
  }
  throw new Error("Unexpectedly large release asset list");
}

export async function publishRelease({ directory, repository, sourceSha, ref }, { api }) {
  const { manifest, parsed, files } = await verifiedBundle(directory);
  const source = manifest.source.sha;
  const tag = `v${manifest.version}`;
  if (repository !== manifest.source.repository || sourceSha !== source || ref !== `refs/tags/${tag}`) {
    throw new Error("Workflow identity does not match the verified release bundle");
  }
  await requireRemoteSource(api, repository, tag, source);
  const manifestHash = files.find(file => file.name === "release-manifest.json").sha256;
  const marker = `<!-- pi-release source=${source} manifest=${manifestHash} -->`;
  let release;
  try { release = await api("GET", `/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`); }
  catch (error) { if (error.status !== 404) throw error; }
  const draftIdentity = { tag, source, prerelease: parsed.prerelease, marker };
  if (release) requireMatchingDraft(release, draftIdentity);
  if (!release) {
    release = await api("POST", `/repos/${repository}/releases`, { json: { tag_name: tag,
      target_commitish: source, name: tag, draft: true, prerelease: parsed.prerelease,
      generate_release_notes: true, body: marker, make_latest: "false" } });
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error("GitHub returned an invalid release ID");
  let remote = await remoteAssets(api, repository, release.id);
  const expected = new Map(files.map(file => [file.name, file]));
  const seen = new Set();
  for (const asset of remote) {
    if (!expected.has(asset.name) || seen.has(asset.name)) throw new Error("Draft contains unexpected or duplicate assets; retained for inspection");
    seen.add(asset.name);
    verifyRemoteAsset(asset, expected.get(asset.name));
  }
  for (const file of files) {
    if (!seen.has(file.name)) {
      await api("POST", `/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,
        { file: file.path, size: file.size });
    }
  }
  remote = await remoteAssets(api, repository, release.id);
  if (remote.length !== files.length || new Set(remote.map(asset => asset.name)).size !== files.length) {
    throw new Error("Remote release does not contain the complete verified asset set");
  }
  for (const asset of remote) {
    if (!expected.has(asset.name)) throw new Error("Remote release contains an unexpected asset");
    verifyRemoteAsset(asset, expected.get(asset.name));
  }
  // Recheck mutable refs immediately before opening the draft to users.
  await requireRemoteSource(api, repository, tag, source);
  const currentDraft = await api("GET", `/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`);
  requireMatchingDraft(currentDraft, { ...draftIdentity, id: release.id });
  const published = await api("PATCH", `/repos/${repository}/releases/${release.id}`, {
    json: { draft: false, prerelease: parsed.prerelease, make_latest: parsed.prerelease ? "false" : "true" },
  });
  if (published.draft !== false || published.tag_name !== tag || published.prerelease !== parsed.prerelease) {
    throw new Error("GitHub did not confirm the expected publication state");
  }
  return published.html_url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
      throw new Error("Release publication must run on a GitHub-hosted Actions runner");
    }
    if (process.argv.length !== 4 || process.argv[2] !== "--directory") throw new Error("Usage: publish-release.mjs --directory <verified-bundle>");
    const url = await publishRelease({ directory: resolve(process.argv[3]), repository: process.env.GITHUB_REPOSITORY,
      sourceSha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF }, { api: githubTransport(process.env.GITHUB_TOKEN) });
    console.log(`Published verified release: ${url}`);
  } catch (error) {
    console.error(`Release publication failed: ${error.message}`);
    process.exitCode = 1;
  }
}
