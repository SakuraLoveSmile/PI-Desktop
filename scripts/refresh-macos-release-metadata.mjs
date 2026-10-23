#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseVersion } from "./release-preflight.mjs";

const safeName = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

async function digest(path) {
  const hash = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; }
  return { size, sha512: hash.digest("base64") };
}

function installedBlockmapBuilder() {
  const desktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
  const builder = createRequire(desktop.resolve("electron-builder/package.json"));
  // Use the same implementation as electron-builder's DMG target, with an
  // explicit external output: omitted output would append to the signed DMG.
  return builder("app-builder-lib/out/targets/blockmap/blockmap.js").buildBlockMap;
}

export async function refreshMacosReleaseMetadata({ directory, channel }) {
  if (!/^[a-z][a-z0-9-]*$/.test(channel ?? "")) throw new Error("Invalid updater channel");
  directory = resolve(directory);
  const dmgs = (await readdir(directory)).filter(name => name.endsWith(".dmg"));
  if (dmgs.length !== 1 || !safeName.test(dmgs[0])) throw new Error("Expected one exact DMG");
  const name = dmgs[0];
  const dmgPath = join(directory, name);
  const feedPath = join(directory, `${channel}-mac.yml`);
  for (const path of [dmgPath, feedPath]) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error("Expected regular nonempty release files");
    if (path === feedPath && stat.size > 1024 * 1024) throw new Error("Updater feed exceeds 1 MiB");
  }
  const feed = JSON.parse(execFileSync("ruby", ["-ryaml", "-rjson", "-e",
    "STDOUT.write(JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), permitted_classes: [], aliases: false)))", feedPath],
  { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  if (!feed || parseReleaseVersion(feed.version).channel !== channel || !Array.isArray(feed.files) ||
      feed.files.filter(file => file?.url === name).length !== 1 ||
      feed.files.some(file => typeof file?.url !== "string" || !safeName.test(file.url) || (file.url.endsWith(".dmg") && file.url !== name)) ||
      !feed.files.some(file => file.url === feed.path)) throw new Error("Updater feed must identify the exact DMG and channel");
  const before = await digest(dmgPath);
  const staging = await mkdtemp(join(directory, ".post-staple-"));
  try {
    const stagedMap = join(staging, `${name}.blockmap`);
    const info = await installedBlockmapBuilder()(dmgPath, "gzip", stagedMap);
    const after = await digest(dmgPath);
    if (after.size !== before.size || after.sha512 !== before.sha512 || info.size !== before.size || info.sha512 !== before.sha512) {
      throw new Error("Blockmap generation changed or misidentified the signed DMG");
    }
    if ((await lstat(stagedMap)).size <= 0) throw new Error("Generated blockmap is empty");
    feed.files = feed.files.map(file => file.url === name ? { ...file, ...info } : file);
    if (feed.path === name) {
      feed.sha512 = info.sha512;
      if (feed.size !== undefined) feed.size = info.size;
    }
    const stagedFeed = join(staging, "feed.yml");
    await writeFile(stagedFeed, JSON.stringify(feed, null, 2) + "\n");
    await rename(stagedMap, `${dmgPath}.blockmap`);
    await rename(stagedFeed, feedPath);
    return info;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: refresh-macos-release-metadata.mjs <release-dir> <channel>");
    const info = await refreshMacosReleaseMetadata({ directory: process.argv[2], channel: process.argv[3] });
    console.log(`Refreshed updater metadata and external blockmap for ${info.size} unchanged DMG bytes.`);
  } catch (error) {
    console.error(`macOS metadata refresh failed: ${error.message}`);
    process.exitCode = 1;
  }
}
