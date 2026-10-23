import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const MAC_ARCHES = ["arm64", "x64"];
const LINUX_ARCHES = ["x64", "arm64"];

function validateOptions(options) {
  for (const key of ["input", "output", "version", "source", "repository", "runId", "runAttempt", "channel"]) {
    if (typeof options[key] !== "string" || !options[key]) throw new Error(`Invalid ${key}`);
  }
  const version = VERSION.exec(options.version);
  if (!version) throw new Error("Invalid version");
  const expectedChannel = version[4]?.split(".")[0] ?? "latest";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(options.channel) || options.channel !== expectedChannel ||
      (version[4] && options.channel === "latest")) throw new Error("Invalid release channel for version");
  if (!/^[a-f0-9]{40}$/.test(options.source)) throw new Error("Invalid source SHA");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.repository)) {
    throw new Error("Invalid source repository");
  }
  if (!/^[1-9]\d*$/.test(options.runId) || !/^[1-9]\d*$/.test(options.runAttempt)) {
    throw new Error("Invalid build run identity");
  }
  if (!["candidate", "release"].includes(options.kind) || typeof options.signedMacos !== "boolean") {
    throw new Error("Invalid build kind or signed-macos value");
  }
  if (options.kind === "release" && !options.signedMacos) throw new Error("A release requires signed macOS artifacts");
}

function requiredLayout(version, channel) {
  const layout = new Map();
  for (const arch of MAC_ARCHES) {
    const dmg = `Pi-Desktop-Plus-${version}-${arch}.dmg`;
    const zip = `Pi-Desktop-Plus-${version}-${arch}-mac.zip`;
    layout.set(`dist-mac-${arch}`, [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, `${channel}-mac-${arch}.yml`]);
  }
  const installer = `Pi-Desktop-Plus-Setup-${version}.exe`;
  layout.set("dist-windows-x64", [installer, `${installer}.blockmap`,
    `Pi-Desktop-Plus-Portable-${version}.zip`, `PI-Desktop-Portable-${version}.exe`, `${channel}.yml`]);
  for (const arch of LINUX_ARCHES) {
    const imageArch = arch === "x64" ? "x86_64" : "arm64";
    const debArch = arch === "x64" ? "amd64" : "arm64";
    const rpmArch = arch === "x64" ? "x86_64" : "aarch64";
    layout.set(`dist-linux-${arch}`, [`Pi-Desktop-Plus-${version}-linux-${imageArch}.AppImage`,
      `pi-desktop-plus_${version}_${debArch}.deb`, `pi-desktop-plus-${version}-${rpmArch}.rpm`,
      `Pi-Desktop-Plus-${version}-linux-${arch}.asar`, `${channel}-linux${arch === "x64" ? "" : "-arm64"}.yml`]);
  }
  for (const arch of LINUX_ARCHES) {
    const archive = `pi-host-${version}-linux-${arch}.tar.gz`;
    layout.set(`pi-host-linux-${arch}`, [archive, `${archive}.sha256`]);
  }
  return layout;
}

async function existing(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function canonicalFuturePath(path) {
  const missing = [];
  let ancestor = path;
  while (!(await existing(ancestor))) {
    missing.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return join(await realpath(ancestor), ...missing);
}

function containsPath(parent, child) {
  const path = relative(parent, child);
  return !path || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

async function inspectInput(input, output, layout) {
  const root = await existing(input);
  if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error("Input must be a real directory");
  const canonicalInput = await realpath(input);
  const canonicalOutput = await canonicalFuturePath(output);
  if (containsPath(canonicalInput, canonicalOutput) || containsPath(canonicalOutput, canonicalInput)) {
    throw new Error("Input and output directories must not overlap");
  }
  if (await existing(output)) throw new Error("Output directory already exists");
  const directories = await readdir(input);
  for (const name of directories) if (!layout.has(name)) throw new Error(`Unexpected artifact directory: ${name}`);
  const files = new Map();
  for (const [group] of layout) {
    if (!directories.includes(group)) throw new Error(`Missing artifact directory: ${group}`);
    const path = join(input, group);
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Artifact group must be a real directory: ${group}`);
    for (const name of await readdir(path)) {
      if (!SAFE_NAME.test(name)) throw new Error(`Unsafe artifact filename: ${name}`);
      const source = join(path, name);
      const stats = await lstat(source);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Artifact must be a regular file: ${group}/${name}`);
      if (files.has(name)) throw new Error(`Duplicate artifact: ${name}`);
      files.set(name, { group, source });
    }
  }
  for (const [name, file] of files) {
    if (!layout.get(file.group).includes(name)) throw new Error(`Unexpected artifact in ${file.group}: ${name}`);
  }
  for (const [group, names] of layout) {
    for (const name of names) if (!files.has(name)) throw new Error(`Missing required artifact in ${group}: ${name}`);
  }
  return files;
}

async function hashAsset(path) {
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    sha256.update(chunk);
    sha512.update(chunk);
  }
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`Artifact is empty or too large: ${basename(path)}`);
  return { size, sha256: sha256.digest("hex"), sha512: sha512.digest("base64") };
}

async function readMetadata(path) {
  const stats = await lstat(path);
  if (stats.size > 1024 * 1024) throw new Error(`Release metadata exceeds 1 MiB: ${basename(path)}`);
  return readFile(path, "utf8");
}

async function parseFeed(path) {
  await readMetadata(path);
  try {
    // Publishing already requires Ruby/Psych. Keep YAML parsing on that existing
    // safe loader rather than importing an undeclared transitive npm dependency.
    const json = execFileSync("ruby", ["-ryaml", "-rjson", "-e",
      "STDOUT.write(JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), permitted_classes: [], aliases: false)))", path],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(json);
  } catch {
    throw new Error(`Cannot parse updater feed: ${basename(path)}`);
  }
}

function safeReference(name) {
  if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error("Unsafe artifact reference in updater feed");
  return name;
}

function verifyFeed(feed, label, version, allowed, inventory) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed) || feed.version !== version) {
    throw new Error(`Updater feed version mismatch: ${label}`);
  }
  if (!Array.isArray(feed.files) || feed.files.length !== allowed.length) throw new Error(`Incomplete updater files: ${label}`);
  const seen = new Set();
  for (const file of feed.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error(`Invalid updater file: ${label}`);
    const name = safeReference(file.url);
    if (!allowed.includes(name) || seen.has(name)) throw new Error(`Updater feed has an unexpected update target: ${label}: ${name}`);
    seen.add(name);
    const actual = inventory.get(name);
    if (file.sha512 !== actual.sha512) throw new Error(`Updater SHA512 mismatch: ${label}: ${name}`);
    if (!Number.isSafeInteger(file.size) || file.size !== actual.size) throw new Error(`Updater size mismatch: ${label}: ${name}`);
    if (file.blockMapSize !== undefined && (!Number.isSafeInteger(file.blockMapSize) || file.blockMapSize <= 0 || file.blockMapSize > actual.size)) {
      throw new Error(`Invalid updater blockmap size: ${label}: ${name}`);
    }
  }
  const legacyName = safeReference(feed.path);
  if (!seen.has(legacyName)) throw new Error(`Updater legacy path is not in files: ${label}`);
  if (feed.sha512 !== inventory.get(legacyName).sha512) throw new Error(`Updater legacy SHA512 mismatch: ${label}`);
  if (feed.size !== undefined && feed.size !== inventory.get(legacyName).size) throw new Error(`Updater legacy size mismatch: ${label}`);
  return feed;
}

async function verifyAndMergeFeeds(staging, options, inventory) {
  const { version, channel } = options;
  const macFeeds = [];
  for (const arch of MAC_ARCHES) {
    const name = `${channel}-mac-${arch}.yml`;
    const feed = await parseFeed(join(staging, name));
    macFeeds.push(verifyFeed(feed, name, version,
      [`Pi-Desktop-Plus-${version}-${arch}-mac.zip`, `Pi-Desktop-Plus-${version}-${arch}.dmg`], inventory));
  }
  const windowsFeed = `${channel}.yml`;
  verifyFeed(await parseFeed(join(staging, windowsFeed)), windowsFeed, version,
    [`Pi-Desktop-Plus-Setup-${version}.exe`], inventory);
  for (const arch of LINUX_ARCHES) {
    const name = `${channel}-linux${arch === "x64" ? "" : "-arm64"}.yml`;
    const installers = requiredLayout(version, channel).get(`dist-linux-${arch}`)
      .filter(file => [".AppImage", ".deb", ".rpm"].some(extension => file.endsWith(extension)));
    verifyFeed(await parseFeed(join(staging, name)), name, version,
      installers, inventory);
  }
  const files = macFeeds.flatMap(feed => feed.files);
  const zip = files.find(file => file.url.endsWith(".zip"));
  const merged = { ...macFeeds[0], files, path: zip.url, sha512: zip.sha512 };
  // JSON is a YAML 1.2 subset accepted by electron-updater's YAML reader.
  const name = `${channel}-mac.yml`;
  await writeFile(join(staging, name), JSON.stringify(merged, null, 2) + "\n", { flag: "wx" });
  inventory.set(name, await hashAsset(join(staging, name)));
  for (const arch of MAC_ARCHES) {
    const name = `${channel}-mac-${arch}.yml`;
    await rm(join(staging, name));
    inventory.delete(name);
  }
}

async function verifyHostChecksums(staging, version, inventory) {
  for (const arch of LINUX_ARCHES) {
    const name = `pi-host-${version}-linux-${arch}.tar.gz`;
    const text = await readMetadata(join(staging, `${name}.sha256`));
    const checksum = /^([a-fA-F0-9]{64}) [ *]([^\r\n]+)\r?\n?$/.exec(text);
    if (!checksum || checksum[2] !== name) throw new Error(`Invalid headless checksum filename: ${name}.sha256`);
    if (checksum[1].toLowerCase() !== inventory.get(name).sha256) throw new Error(`Headless SHA256 mismatch: ${name}`);
  }
}

/** Validate a complete downloaded build before atomically exposing its assets. */
export async function aggregateReleaseAssets(options) {
  validateOptions(options);
  const input = resolve(options.input);
  const output = resolve(options.output);
  const files = await inspectInput(input, output, requiredLayout(options.version, options.channel));
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), ".release-assets-"));
  try {
    const inventory = new Map();
    for (const [name, file] of files) {
      await copyFile(file.source, join(staging, name), constants.COPYFILE_EXCL);
      inventory.set(name, await hashAsset(join(staging, name)));
    }
    await verifyHostChecksums(staging, options.version, inventory);
    await verifyAndMergeFeeds(staging, options, inventory);
    const assets = [...inventory].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, { size, sha256 }]) => ({ name, size, sha256 }));
    const manifest = { schemaVersion: 1, kind: options.kind, version: options.version, channel: options.channel,
      signedMacos: options.signedMacos, source: { repository: options.repository, sha: options.source },
      build: { runId: options.runId, runAttempt: options.runAttempt,
        url: `https://github.com/${options.repository}/actions/runs/${options.runId}` }, assets };
    const manifestName = "release-manifest.json";
    await writeFile(join(staging, manifestName), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    const checksums = [...assets, { name: manifestName, ...await hashAsset(join(staging, manifestName)) }]
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      .map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
    await writeFile(join(staging, "SHA256SUMS"), checksums, { flag: "wx" });
    if (await existing(output)) throw new Error("Output directory already exists");
    await rename(staging, output);
    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function parseArguments(argumentsList) {
  const keys = new Map(["input", "output", "version", "source", "repository", "run-id", "run-attempt", "channel", "kind", "signed-macos"]
    .map(key => [`--${key}`, key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]));
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = keys.get(argumentsList[index]);
    if (!key) throw new Error(`Unknown argument: ${argumentsList[index]}`);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate argument: ${argumentsList[index]}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${argumentsList[index]}`);
    if (key === "signedMacos") {
      if (!["true", "false"].includes(value)) throw new Error("Invalid signed-macos value");
      options[key] = value === "true";
    } else options[key] = value;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await aggregateReleaseAssets(parseArguments(process.argv.slice(2)));
    console.log(`Verified ${manifest.assets.length} assets for ${manifest.version} (${manifest.kind}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
