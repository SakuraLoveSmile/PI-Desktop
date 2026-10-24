import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { aggregateReleaseAssets } from "./release-assets.mjs";

const execute = promisify(execFile);
const digest = (algorithm, bytes, encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);

async function fixture(t, version = "0.15.8", channel = "latest") {
  const root = await mkdtemp(join(tmpdir(), "pi-release-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, "downloaded");
  const output = join(root, "dist");
  await mkdir(input);
  const groups = new Map();
  const add = async (group, name, bytes = `fixture:${group}:${name}\n`) => {
    const directory = join(input, group);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), bytes);
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group).add(name);
    return name;
  };
  const feed = async (group, name, assets) => {
    const files = [];
    for (const url of assets) {
      const bytes = await readFile(join(input, group, url));
      files.push({ url, sha512: digest("sha512", bytes, "base64"), size: bytes.length });
    }
    const document = { version, files, path: files[0].url, sha512: files[0].sha512,
      releaseDate: "2026-10-23T00:00:00.000Z" };
    await add(group, name, JSON.stringify(document));
  };
  for (const arch of ["arm64"]) {
    const group = `dist-mac-${arch}`;
    const dmg = await add(group, `Pi-Desktop-Plus-${version}-${arch}.dmg`);
    await add(group, `${dmg}.blockmap`);
    const zip = await add(group, `Pi-Desktop-Plus-${version}-${arch}-mac.zip`);
    await add(group, `${zip}.blockmap`);
    await feed(group, `${channel}-mac-${arch}.yml`, [zip, dmg]);
  }
  const options = { input, output, version, channel, source: "a".repeat(40), repository: "SakuraLoveSmile/PI-Desktop",
    runId: "123456789", runAttempt: "2", kind: "candidate", signedMacos: false };
  const changeFeed = async (group, name, update) => {
    const path = join(input, group, name);
    const document = JSON.parse(await readFile(path, "utf8"));
    update(document);
    await writeFile(path, JSON.stringify(document));
  };
  return { root, input, output, groups, options, changeFeed };
}

test("the CLI aggregates only macOS arm64 and records exact provenance and checksums", async t => {
  const f = await fixture(t);
  const argumentsList = Object.entries(f.options).flatMap(([key, value]) => [
    `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, String(value),
  ]);
  await execute(process.execPath, [fileURLToPath(new URL("./release-assets.mjs", import.meta.url)), ...argumentsList]);
  const names = (await readdir(f.output)).sort();
  assert.deepEqual(names, [
    "Pi-Desktop-Plus-0.15.8-arm64-mac.zip",
    "Pi-Desktop-Plus-0.15.8-arm64-mac.zip.blockmap",
    "Pi-Desktop-Plus-0.15.8-arm64.dmg",
    "Pi-Desktop-Plus-0.15.8-arm64.dmg.blockmap",
    "SHA256SUMS", "latest-mac.yml", "release-manifest.json",
  ]);
  const manifest = JSON.parse(await readFile(join(f.output, "release-manifest.json"), "utf8"));
  assert.deepEqual(manifest, {
    schemaVersion: 1, kind: "candidate", version: "0.15.8", channel: "latest", signedMacos: false,
    source: { repository: "SakuraLoveSmile/PI-Desktop", sha: "a".repeat(40) },
    build: { runId: "123456789", runAttempt: "2", url: "https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/123456789" },
    assets: await Promise.all(names.filter(name => !["SHA256SUMS", "release-manifest.json"].includes(name)).map(async name => {
      const bytes = await readFile(join(f.output, name));
      return { name, size: bytes.length, sha256: digest("sha256", bytes) };
    })),
  });
  const sums = (await readFile(join(f.output, "SHA256SUMS"), "utf8")).trim().split("\n");
  assert.equal(sums.length, 6);
  for (const line of sums) {
    const [sha256, name] = line.split("  ");
    assert.notEqual(name, "SHA256SUMS");
    assert.equal(sha256, digest("sha256", await readFile(join(f.output, name))));
  }
  assert(sums.some(line => line.endsWith("  release-manifest.json")));
  const mac = JSON.parse(await readFile(join(f.output, "latest-mac.yml"), "utf8"));
  assert.deepEqual(mac.files.map(file => file.url), [
    "Pi-Desktop-Plus-0.15.8-arm64-mac.zip", "Pi-Desktop-Plus-0.15.8-arm64.dmg",
  ]);
  assert.equal(mac.path, "Pi-Desktop-Plus-0.15.8-arm64-mac.zip");
  assert.equal(mac.sha512, mac.files.find(file => file.url === mac.path).sha512);
});

test("prerelease aggregation uses only its own update channel", async t => {
  const f = await fixture(t, "0.15.8-beta.2", "beta");
  const manifest = await aggregateReleaseAssets({ ...f.options, kind: "release", signedMacos: true });
  assert.equal(manifest.channel, "beta");
  assert.equal(manifest.kind, "release");
  assert.equal(manifest.signedMacos, true);
  const names = await readdir(f.output);
  assert(names.includes("beta-mac.yml"));
  assert.equal(names.length, 7);
  assert(!names.some(name => name.startsWith("latest")));
});

test("ordinary YAML feeds are safely read without depending on npm packages", async t => {
  const f = await fixture(t);
  const path = join(f.input, "dist-mac-arm64", "latest-mac-arm64.yml");
  const feed = JSON.parse(await readFile(path, "utf8"));
  const entries = feed.files.map(file => `  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}\n`).join("");
  await writeFile(path, `version: ${feed.version}\nfiles:\n${entries}path: ${feed.path}\nsha512: ${feed.sha512}\nreleaseDate: '${feed.releaseDate}'\n`);
  await aggregateReleaseAssets(f.options);
  assert((await readdir(f.output)).includes("latest-mac.yml"));
});

for (const [label, mutate, expected] of [
  ["missing native lane", f => rm(join(f.input, "dist-mac-arm64"), { recursive: true }), /Missing artifact directory/],
  ["missing required format", f => rm(join(f.input, "dist-mac-arm64", "Pi-Desktop-Plus-0.15.8-arm64-mac.zip")), /Missing required artifact/],
  ["missing required blockmap", f => rm(join(f.input, "dist-mac-arm64", "Pi-Desktop-Plus-0.15.8-arm64.dmg.blockmap")), /Missing required artifact/],
  ["wrong architecture", f => rename(join(f.input, "dist-mac-arm64", "Pi-Desktop-Plus-0.15.8-arm64.dmg"), join(f.input, "dist-mac-arm64", "Pi-Desktop-Plus-0.15.8-x64.dmg")), /Unexpected artifact/],
  ["unexpected Intel lane", f => mkdir(join(f.input, "dist-mac-x64")), /Unexpected artifact directory/],
  ["unexpected Windows lane", f => mkdir(join(f.input, "dist-windows-x64")), /Unexpected artifact directory/],
  ["unexpected Linux lane", f => mkdir(join(f.input, "dist-linux-arm64")), /Unexpected artifact directory/],
  ["unexpected headless lane", f => mkdir(join(f.input, "pi-host-linux-x64")), /Unexpected artifact directory/],
  ["stale feed version", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.version = "0.15.7"; }), /version/],
  ["bad feed hash", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.files[0].sha512 = "incorrect"; }), /SHA512/],
  ["bad feed size", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.files[0].size++; }), /size/],
  ["missing installer update entry", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.files.pop(); }), /Incomplete updater files/],
  ["bad legacy feed hash", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.sha512 = "incorrect"; }), /SHA512/],
  ["feed traversal", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.files[0].url = "../private.zip"; }), /Unsafe artifact reference/],
  ["external feed URL", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.files[0].url = "https://example.invalid/app.zip"; }), /Unsafe artifact reference/],
  ["foreign architecture feed target", f => f.changeFeed("dist-mac-arm64", "latest-mac-arm64.yml", feed => { feed.files[0].url = "Pi-Desktop-Plus-0.15.8-x64-mac.zip"; }), /unexpected update target/],
  ["YAML aliases", f => writeFile(join(f.input, "dist-mac-arm64", "latest-mac-arm64.yml"), "version: &version 0.15.8\nfiles: *version\n"), /Cannot parse updater feed/],
]) {
  test(`rejects ${label} before exposing a release directory`, async t => {
    const f = await fixture(t);
    await mutate(f);
    await assert.rejects(aggregateReleaseAssets(f.options), expected);
    await assert.rejects(readdir(f.output), { code: "ENOENT" });
    assert(!(await readdir(f.root)).some(name => name.startsWith(".release-assets-")));
  });
}

test("rejects symbolic links in downloaded files and directories", async t => {
  const f = await fixture(t);
  const target = join(f.root, "outside");
  await writeFile(target, "outside");
  const artifact = join(f.input, "dist-mac-arm64", "Pi-Desktop-Plus-0.15.8-arm64.dmg");
  await rm(artifact);
  await symlink(target, artifact);
  await assert.rejects(aggregateReleaseAssets(f.options), /regular file/);
  await rm(artifact);
  await writeFile(artifact, "restored fixture");
  const directory = join(f.input, "dist-mac-arm64");
  const moved = join(f.root, "moved-mac");
  await rename(directory, moved);
  await symlink(moved, directory);
  await assert.rejects(aggregateReleaseAssets(f.options), /real directory/);
});

test("an existing output directory is preserved", async t => {
  const f = await fixture(t);
  await mkdir(f.output);
  await writeFile(join(f.output, "keep"), "existing output");
  await assert.rejects(aggregateReleaseAssets(f.options), /already exists/);
  assert.equal(await readFile(join(f.output, "keep"), "utf8"), "existing output");
});

test("invalid provenance, channels and release signing cannot produce a manifest", async t => {
  const f = await fixture(t);
  for (const update of [
    { source: "main" }, { repository: "../PI-Desktop" }, { runId: "../1" }, { runAttempt: "0" },
    { version: "../0.15.8" }, { channel: "../latest" }, { channel: "beta" }, { signedMacos: "false" },
    { kind: "unknown" }, { kind: "release", signedMacos: false },
  ]) await assert.rejects(aggregateReleaseAssets({ ...f.options, ...update }), /Invalid|requires/);
  await assert.rejects(aggregateReleaseAssets({ ...f.options, output: join(f.input, "nested") }), /overlap/);
  await assert.rejects(readdir(f.output), { code: "ENOENT" });
});

test("CLI rejects unknown or duplicate arguments", async t => {
  const f = await fixture(t);
  for (const args of [["--unknown", "value"], ["--input", f.input, "--input", f.input]]) {
    await assert.rejects(execute(process.execPath, [fileURLToPath(new URL("./release-assets.mjs", import.meta.url)), ...args]), error => {
      assert.match(error.stderr, /Unknown|Duplicate/);
      return true;
    });
  }
});
