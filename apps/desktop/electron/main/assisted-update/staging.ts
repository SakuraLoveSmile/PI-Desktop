import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRunner } from "./commands";
import { AssistedUpdateError } from "./errors";

const DITTO = "/usr/bin/ditto";
const PLUTIL = "/usr/bin/plutil";
const CODESIGN = "/usr/bin/codesign";
const XATTR = "/usr/bin/xattr";
const IGNORED_ENTRIES = new Set(["__MACOSX", ".DS_Store"]);

export type StageInput = {
  zipPath: string;
  /** `<install dir>/.pi-desktop-plus-update-<job id>`; must not exist yet. */
  stagingDir: string;
  running: { bundleId: string; version: string };
  offeredVersion: string;
  /** Architecture the staged executable must contain. */
  arch: string;
};

/**
 * Extracts the verified ZIP next to the installed app and refuses anything
 * that is not exactly the app being updated: one bundle, same identifier, the
 * offered version and strictly newer than the running one, this architecture,
 * an intact seal, and no quarantine attribute. The seal check is integrity
 * only; ad-hoc builds have no identity to compare (ADR decision 5).
 */
export async function stageUpdate(
  input: StageInput,
  run: CommandRunner,
): Promise<{ stagedApp: string }> {
  await mkdir(input.stagingDir, { mode: 0o700 });
  try {
    const extracted = await run(DITTO, ["-x", "-k", input.zipPath, input.stagingDir], {
      timeoutMs: 600_000,
    });
    if (extracted.code !== 0) {
      throw new AssistedUpdateError("extract-failed", `ditto exited with ${extracted.code}`);
    }
    const stagedApp = await findSingleApp(input.stagingDir);
    const info = await readInfoPlist(stagedApp, run);
    if (info.bundleId !== input.running.bundleId) {
      throw new AssistedUpdateError("identity", "the update is a different application");
    }
    if (info.version !== input.offeredVersion) {
      throw new AssistedUpdateError("version", "the update's version differs from the release");
    }
    if (compareStableVersions(info.version, input.running.version) <= 0) {
      throw new AssistedUpdateError("version", "the update is not newer than the running version");
    }
    await verifyArchitecture(stagedApp, info.executable, input.arch);
    const sealed = await run(CODESIGN, ["--verify", "--deep", "--strict", stagedApp], {
      timeoutMs: 300_000,
    });
    if (sealed.code !== 0) {
      throw new AssistedUpdateError("signature", `the update's seal is broken: ${sealed.stderr.trim()}`);
    }
    await verifyNotQuarantined(stagedApp, run);
    return { stagedApp };
  } catch (error) {
    await rm(input.stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function findSingleApp(stagingDir: string): Promise<string> {
  const entries = (await readdir(stagingDir, { withFileTypes: true })).filter(
    (entry) => !IGNORED_ENTRIES.has(entry.name),
  );
  const [only] = entries;
  if (entries.length !== 1 || !only.isDirectory() || !only.name.endsWith(".app")) {
    throw new AssistedUpdateError("layout", "the update archive must contain exactly one application");
  }
  return join(stagingDir, only.name);
}

export type PlistInfo = { bundleId: string; version: string; executable: string };

export async function readInfoPlist(app: string, run: CommandRunner): Promise<PlistInfo> {
  const result = await run(PLUTIL, ["-convert", "json", "-o", "-", join(app, "Contents", "Info.plist")]);
  if (result.code !== 0) {
    throw new AssistedUpdateError("layout", "the update's Info.plist is unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new AssistedUpdateError("layout", "the update's Info.plist is unreadable");
  }
  const plist = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof plist[key] === "string" ? (plist[key] as string) : "");
  const executable = text("CFBundleExecutable");
  if (!executable || executable.includes("/") || executable === "." || executable === "..") {
    throw new AssistedUpdateError("layout", "the update has no usable executable name");
  }
  return {
    bundleId: text("CFBundleIdentifier"),
    version: text("CFBundleShortVersionString"),
    executable,
  };
}

async function verifyArchitecture(app: string, executable: string, arch: string): Promise<void> {
  const path = join(app, "Contents", "MacOS", executable);
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile()) {
    throw new AssistedUpdateError("layout", "the update's executable is missing");
  }
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(512);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!parseMachOArchitectures(header.subarray(0, bytesRead)).includes(arch)) {
      throw new AssistedUpdateError("arch", `the update does not contain ${arch} code`);
    }
  } finally {
    await handle.close();
  }
}

async function verifyNotQuarantined(app: string, run: CommandRunner): Promise<void> {
  const result = await run(XATTR, ["-p", "com.apple.quarantine", app]);
  if (result.code === 0) {
    throw new AssistedUpdateError("quarantine", "the update carries com.apple.quarantine and is refused");
  }
  if (!/No such xattr/i.test(result.stderr)) {
    throw new AssistedUpdateError("quarantine", "the update's attributes could not be read");
  }
}

const CPU_TYPES: Record<number, string> = { 0x0100000c: "arm64", 0x01000007: "x64" };

/** CPU architectures named by a Mach-O (thin or universal) file header. */
export function parseMachOArchitectures(header: Buffer): string[] {
  if (header.length < 8) return [];
  if (header.readUInt32LE(0) === 0xfeedfacf) {
    const name = CPU_TYPES[header.readUInt32LE(4)];
    return name ? [name] : [];
  }
  const magic = header.readUInt32BE(0);
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return [];
  const entrySize = magic === 0xcafebabe ? 20 : 32;
  const count = Math.min(header.readUInt32BE(4), 16);
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * entrySize;
    if (offset + 4 > header.length) break;
    const name = CPU_TYPES[header.readUInt32BE(offset)];
    if (name) names.push(name);
  }
  return names;
}

/** Compares `x.y.z` stable versions; any other shape sorts as not newer (-1). */
export function compareStableVersions(left: string, right: string): number {
  const parse = (value: string) =>
    /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value) ? value.split(".").map(Number) : null;
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return -1;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}
