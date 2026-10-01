#!/usr/bin/env node
/**
 * Assemble an independently identified Electron distribution for macOS packaging.
 *
 * Why this exists
 * ---------------
 * electron-builder renames Electron's prebuilt main executable instead of
 * relinking it (`app-builder-lib/out/electron/electronMac.js` ->
 * `doRename(contents/MacOS, productName, CFBundleExecutable)`), so every fork of
 * the same Electron release keeps the same `LC_UUID`. macOS attributes Local
 * Network privacy to the code signature together with the main executable's UUID
 * (Apple TN3179), and a measured comparison on this fork showed what that costs:
 * with the shared UUID the app never received a Local Network prompt, never
 * appeared in the privacy pane, and its LAN requests failed as
 * `net::ERR_ADDRESS_UNREACHABLE`; after linking its own main executable it was
 * prompted, listed, and reached the gateway.
 *
 * What it does — offline, no Electron source build
 * ------------------------------------------------
 *   1. compiles `apps/desktop/build/electron-main-stub.c` against the *pinned
 *      official* Electron distribution already installed under `node_modules`;
 *   2. verifies the freshly linked executable's `LC_UUID` differs from the
 *      official one (the entire point — a silent failure here would ship the
 *      collision again);
 *   3. copies the official distribution and swaps in the new main executable,
 *      leaving `Electron Framework`, the helper applications, resources and the
 *      `version` file untouched, so the runtime stays exactly the pinned version.
 *
 * Usage: `node scripts/assemble-electron-dist.mjs [--out <dir>]`
 * Prints the distribution directory as its last line of output.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The framework's root entries must stay bundle-relative symlinks. An absolute
 * link (or one copied as a regular file) points outside the bundle, which makes
 * codesign reject it as unsealed — exactly the failure that motivated this check.
 */
function assertFrameworkLinksAreRelative(distDir) {
  const frameworkRoot = join(
    distDir,
    "Electron.app",
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );
  for (const name of ["Electron Framework", "Helpers", "Libraries", "Resources"]) {
    const entry = join(frameworkRoot, name);
    let target;
    try {
      target = readlinkSync(entry);
    } catch {
      fail(`the assembled framework's '${name}' is not a symlink: ${entry}`);
    }
    if (target.startsWith("/")) {
      fail(
        `the assembled framework's '${name}' points outside the bundle (${target}); copying must ` +
          "preserve relative symlinks or codesign will reject the bundle as unsealed.",
      );
    }
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const stubSource = join(desktopRoot, "build", "electron-main-stub.c");

function fail(message) {
  console.error(`[electron-dist] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

/** The `LC_UUID` of a Mach-O binary, or null when the tool cannot read one. */
function mainExecutableUuid(binaryPath) {
  try {
    const output = run("dwarfdump", ["--uuid", binaryPath]);
    const match = /UUID:\s*([0-9A-Fa-f-]{36})/.exec(output);
    return match ? match[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  let out = join(desktopRoot, "release", "electron-dist-identity");
  let arch = process.arch === "x64" ? "x86_64" : "arm64";
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--out") out = resolve(argv[++index] ?? fail("--out needs a directory"));
    else if (flag === "--arch") {
      const value = argv[++index];
      if (value === "x64" || value === "x86_64") arch = "x86_64";
      else if (value === "arm64") arch = "arm64";
      else fail(`unsupported --arch ${value}`);
    }
  }
  return { out, arch };
}

function main() {
  if (process.platform !== "darwin") {
    fail("the independent main executable is a macOS requirement; nothing to do on " + process.platform);
  }
  const { out, arch } = parseArgs(process.argv.slice(2));

  const officialDist = join(desktopRoot, "node_modules", "electron", "dist");
  const officialApp = join(officialDist, "Electron.app");
  const officialMain = join(officialApp, "Contents", "MacOS", "Electron");
  if (!existsSync(officialMain)) {
    fail(
      `the pinned official Electron distribution is missing: ${officialMain}. ` +
        "Run the desktop package's postinstall (or `pnpm install`) so node_modules/electron/dist exists.",
    );
  }
  if (!existsSync(stubSource)) fail(`the main executable source is missing: ${stubSource}`);

  const officialUuid = mainExecutableUuid(officialMain);
  if (!officialUuid) fail(`cannot read the official main executable's LC_UUID from ${officialMain}`);

  const frameworkDir = join(officialApp, "Contents", "Frameworks");
  const linkedBinary = join(out, "electron-main-linked");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // The stub imports ElectronMain/ElectronInitializeICUandStartNode from the
  // framework and needs the framework's own rpath; Apple's ld gives the output a
  // fresh LC_UUID, which is the identity this fork is after.
  run("clang", [
    "-O2",
    "-arch",
    arch,
    "-mmacosx-version-min=12.0",
    `-F${frameworkDir}`,
    "-framework",
    "Electron Framework",
    "-Wl,-rpath,@executable_path/../Frameworks",
    "-Wl,-random_uuid",
    "-o",
    linkedBinary,
    stubSource,
  ]);

  const linkedUuid = mainExecutableUuid(linkedBinary);
  if (!linkedUuid) fail(`cannot read the freshly linked main executable's LC_UUID from ${linkedBinary}`);
  if (linkedUuid === officialUuid) {
    fail(
      `the freshly linked main executable kept the official UUID ${officialUuid}; ` +
        "refusing to build a candidate that would collide with the official application.",
    );
  }

  /*
    Copy with `ditto`, not `fs.cpSync`: Node's copy rewrites the framework's
    relative symlinks (`Electron Framework -> Versions/Current/Electron Framework`)
    into absolute links pointing back at the pnpm store, which leaves the
    framework's root contents unsealed and makes codesign reject the bundle
    ("unsealed contents present in the bundle root"). `ditto` is the macOS tool
    that preserves links and metadata verbatim.
  */
  run("ditto", [officialDist, out]);
  assertFrameworkLinksAreRelative(out);
  const targetMain = join(out, "Electron.app", "Contents", "MacOS", "Electron");
  copyFileSync(linkedBinary, targetMain);
  rmSync(linkedBinary, { force: true });

  const versionPath = join(out, "version");
  const version = existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : "unknown";
  const size = statSync(targetMain).size;

  console.error(
    `[electron-dist] assembled ${out}\n` +
      `[electron-dist] electron version ${version} (unchanged)\n` +
      `[electron-dist] main executable UUID ${linkedUuid} (official was ${officialUuid})\n` +
      `[electron-dist] main executable size ${size} bytes`,
  );
  console.log(out);
}

main();
