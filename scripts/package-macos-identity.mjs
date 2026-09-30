#!/usr/bin/env node
/**
 * macOS packaging entry point with an independently identified Electron.
 *
 * Every macOS package lane in this repository replaces the plain
 * `electron-builder` invocation with this wrapper, so one place assembles the
 * independent distribution (see `scripts/assemble-electron-dist.mjs`) and one
 * place installs the pre-sign identity gate (see `scripts/macos-identity-gate.mjs`).
 * Because both flags are added here, the *only* macOS package path that can reach
 * electron-builder is one that carries them; there is no fallback to the stock
 * Electron distribution, whose main executable UUID collides with the official
 * application and costs this app its Local Network identity (ADR 0308).
 *
 * Two failure modes are guarded explicitly, both observed while wiring this up:
 * a bare `--` forwarded by `pnpm run <script> -- <args>` makes electron-builder's
 * option parser ignore every flag after it, and electron-builder still exits
 * successfully when an `afterPack` hook or an `electronDist` override is silently
 * ineffective. So the separator is dropped here, the flags are placed before the
 * caller's arguments, and the packaged bundles are verified afterwards.
 *
 * A caller that already assembled a distribution may pass `PI_ELECTRON_DIST` to
 * skip the assembly step.
 *
 * Non-macOS hosts are passed straight through to electron-builder with the
 * arguments the caller gave, so the Windows and Linux lanes behave exactly as
 * before.
 *
 * Usage (from any macOS lane): `node ../../scripts/package-macos-identity.mjs --mac --publish never`
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const assembler = join(repoRoot, "scripts", "assemble-electron-dist.mjs");
const gate = join(repoRoot, "scripts", "macos-identity-gate.mjs");

// A lane receives arguments through `pnpm run <script> -- <args>`, which forwards
// the bare `--` separator as well. Dropping it keeps electron-builder's parser
// reading the identity flags that follow.
const forwarded = process.argv.slice(2).filter((arg) => arg !== "--");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktopRoot, stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`[package-macos] failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

/** The lane's architecture, so the linked main executable matches the package. */
function requestedArch(args) {
  if (args.includes("--x64")) return "x64";
  if (args.includes("--arm64")) return "arm64";
  return process.arch === "x64" ? "x64" : "arm64";
}

/** `LC_UUID` of a Mach-O binary, or null when it cannot be read. */
function mainExecutableUuid(binaryPath) {
  const result = spawnSync("dwarfdump", ["--uuid", binaryPath], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = /UUID:\s*([0-9A-Fa-f-]{36})/.exec(result.stdout ?? "");
  return match ? match[1].toUpperCase() : null;
}

/** The pinned official distribution's main executable, the collision source. */
function officialMainExecutable() {
  return join(
    desktopRoot,
    "node_modules",
    "electron",
    "dist",
    "Electron.app",
    "Contents",
    "MacOS",
    "Electron",
  );
}

/** The main executable of a macOS bundle (its name matches the bundle name). */
function mainExecutableOf(bundlePath) {
  const macOsDir = join(bundlePath, "Contents", "MacOS");
  const expected = join(macOsDir, basename(bundlePath).replace(/\.app$/, ""));
  if (existsSync(expected)) return expected;
  if (!existsSync(macOsDir)) return expected;
  const entries = readdirSync(macOsDir);
  return entries.length > 0 ? join(macOsDir, entries[0]) : expected;
}

/** Every packaged `.app` bundle below the desktop release directory. */
function packagedAppBundles() {
  const releaseDir = join(desktopRoot, "release");
  if (!existsSync(releaseDir)) return [];
  const found = [];
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    const candidate = join(releaseDir, entry.name);
    if (entry.name.endsWith(".app") && entry.isDirectory()) {
      found.push(candidate);
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const inner of readdirSync(candidate)) {
      if (inner.endsWith(".app")) found.push(join(candidate, inner));
    }
  }
  return found;
}

/**
 * The independent distribution to package with. `PI_ELECTRON_DIST` lets a caller
 * that already assembled one (CI, or a lane in a scaffolded repository) skip the
 * assembly step; otherwise the assembler runs and reports the path.
 */
function resolveElectronDist() {
  const provided = process.env.PI_ELECTRON_DIST;
  if (provided && provided.trim()) {
    process.stderr.write(`[package-macos] using PI_ELECTRON_DIST=${provided}\n`);
    return provided.trim();
  }
  const result = spawnSync(
    process.execPath,
    [
      assembler,
      "--arch",
      requestedArch(forwarded),
      "--out",
      join(desktopRoot, "release", "electron-dist-identity"),
    ],
    { cwd: desktopRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    console.error("[package-macos] the independent Electron distribution could not be assembled");
    process.exit(1);
  }
  process.stderr.write(result.stderr ?? "");
  const distPath = (result.stdout ?? "").trim().split("\n").pop();
  if (!distPath) {
    console.error("[package-macos] the assembler did not report a distribution path");
    process.exit(1);
  }
  return distPath;
}

if (process.platform !== "darwin") {
  // Windows and Linux keep the previous behavior: no independent distribution is
  // involved and the caller's arguments reach electron-builder untouched.
  process.exit(run("pnpm", ["exec", "electron-builder", ...forwarded]));
}

const electronDist = resolveElectronDist();
const electronDistFlag = `-c.electronDist=${electronDist}`;
const afterPackFlag = `-c.afterPack=${gate}`;
console.error(`[package-macos] packaging with ${electronDistFlag} and the pre-sign identity gate`);
const status = run("pnpm", [
  "exec",
  "electron-builder",
  electronDistFlag,
  afterPackFlag,
  ...forwarded,
]);
if (status !== 0) process.exit(status);

/*
  Belt and braces: the pre-sign gate runs inside electron-builder, so a build whose
  hook or override was silently ignored would still finish and ship the stock
  identity. Verify the packaged bundles afterwards and fail if any of them kept the
  official main executable UUID.
*/
const officialUuid = mainExecutableUuid(officialMainExecutable());
const packaged = packagedAppBundles();
if (officialUuid && packaged.length > 0) {
  const offenders = packaged.filter(
    (bundle) => mainExecutableUuid(mainExecutableOf(bundle)) === officialUuid,
  );
  if (offenders.length > 0) {
    console.error(
      "[package-macos] refusing to accept a package whose main executable UUID collides with the " +
        `official Electron distribution (${officialUuid}):\n  ${offenders.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.error(
    `[package-macos] verified ${packaged.length} packaged bundle(s) carry an independent main executable UUID`,
  );
}
