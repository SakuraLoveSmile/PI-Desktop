import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { refreshMacosReleaseMetadata } from "./refresh-macos-release-metadata.mjs";

const sha512 = bytes => createHash("sha512").update(bytes).digest("base64");

async function fixture(t, channel = "latest") {
  const directory = await mkdtemp(join(tmpdir(), "pi-stapled-metadata-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dmg = "Pi-Desktop-Plus-1.2.3-arm64.dmg";
  const zip = "Pi-Desktop-Plus-1.2.3-arm64-mac.zip";
  const original = Buffer.from("fixture disk image before notarization\n");
  const zipInfo = { url: zip, size: 1234, sha512: "unchanged ZIP hash" };
  const feed = { version: channel === "latest" ? "1.2.3" : `1.2.3-${channel}.1`,
    files: [zipInfo, { url: dmg, size: original.length, sha512: sha512(original) }],
    path: dmg, size: original.length, sha512: sha512(original), releaseDate: "2026-10-23T00:00:00Z" };
  await writeFile(join(directory, dmg), original);
  await writeFile(join(directory, `${dmg}.blockmap`), "obsolete blockmap");
  await writeFile(join(directory, `${channel}-mac.yml`), JSON.stringify(feed));
  // A stapler mutates the distributed DMG after builder generated its metadata.
  await appendFile(join(directory, dmg), "fixture notarization ticket\n");
  const stapled = await readFile(join(directory, dmg));
  assert.notEqual(sha512(stapled), feed.files[1].sha512, "baseline: builder metadata is stale after stapling");
  return { directory, channel, dmg, stapled, zipInfo, feed };
}

test("refreshes the stapled DMG feed and official external blockmap without changing signed bytes", async t => {
  const input = await fixture(t);
  await refreshMacosReleaseMetadata(input);
  assert.deepEqual(await readFile(join(input.directory, input.dmg)), input.stapled);
  const updated = JSON.parse(await readFile(join(input.directory, "latest-mac.yml"), "utf8"));
  assert.deepEqual(updated.files[0], input.zipInfo);
  assert.deepEqual(updated.files[1], { url: input.dmg, size: input.stapled.length, sha512: sha512(input.stapled) });
  assert.equal(updated.size, input.stapled.length);
  assert.equal(updated.sha512, sha512(input.stapled));
  assert.equal(updated.releaseDate, input.feed.releaseDate);
  const map = JSON.parse(gunzipSync(await readFile(join(input.directory, `${input.dmg}.blockmap`))));
  assert.equal(map.version, "2");
  assert.equal(map.files[0].sizes.reduce((sum, size) => sum + size, 0), input.stapled.length);
  assert.equal(map.files[0].checksums.length, map.files[0].sizes.length);
});

test("refreshes only the prerelease channel and preserves ZIP legacy metadata", async t => {
  const input = await fixture(t, "beta");
  const feed = { ...input.feed, path: input.zipInfo.url, sha512: input.zipInfo.sha512, size: input.zipInfo.size };
  await writeFile(join(input.directory, "beta-mac.yml"), JSON.stringify(feed));
  await refreshMacosReleaseMetadata(input);
  const updated = JSON.parse(await readFile(join(input.directory, "beta-mac.yml"), "utf8"));
  assert.equal(updated.path, input.zipInfo.url);
  assert.equal(updated.sha512, input.zipInfo.sha512);
  assert.equal(updated.size, input.zipInfo.size);
  await assert.rejects(readFile(join(input.directory, "latest-mac.yml")), { code: "ENOENT" });
});

test("refuses a feed that does not identify the exact DMG before rewriting metadata", async t => {
  const input = await fixture(t);
  const feedPath = join(input.directory, "latest-mac.yml");
  const bytes = JSON.stringify({ ...input.feed, files: [input.zipInfo] });
  await writeFile(feedPath, bytes);
  await assert.rejects(refreshMacosReleaseMetadata(input), /exact DMG/);
  assert.equal(await readFile(feedPath, "utf8"), bytes);
  assert.equal(await readFile(join(input.directory, `${input.dmg}.blockmap`), "utf8"), "obsolete blockmap");
});
