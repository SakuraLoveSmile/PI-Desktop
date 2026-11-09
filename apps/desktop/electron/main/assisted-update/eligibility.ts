import { accessSync, constants, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { AssistedUpdateBlockedReason } from "@pi-desktop/shared";

/**
 * Whether the running install can use the assisted lane, and when it cannot,
 * why. `reason` is set only for an ad-hoc macOS build that the user could fix
 * (moving the app, installing it somewhere writable); every other build is
 * simply not applicable and says nothing.
 */
export type AssistedEligibility =
  | { eligible: true; bundlePath: string; installDir: string }
  | { eligible: false; reason?: AssistedUpdateBlockedReason };

export type EligibilityInput = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  macSigning: string | undefined;
  /** `process.execPath` of the running app. */
  execPath: string;
};

export type EligibilityFs = {
  realpath(path: string): string;
  /** Throws a Node errno error when the mode is not granted. */
  access(path: string, mode: number): void;
};

const systemFs: EligibilityFs = {
  realpath: (path) => realpathSync(path),
  access: (path, mode) => accessSync(path, mode),
};

/** The fork's tag lane publishes arm64 builds only (ADR plus-assisted-macos-adhoc-update). */
export const ASSISTED_ARCH = "arm64";

export function evaluateAssistedEligibility(
  input: EligibilityInput,
  fs: EligibilityFs = systemFs,
): AssistedEligibility {
  if (
    input.platform !== "darwin" ||
    !input.isPackaged ||
    input.macSigning !== "adhoc" ||
    input.arch !== ASSISTED_ARCH
  ) {
    return { eligible: false };
  }
  const bundlePath = bundlePathFromExecutable(input.execPath);
  if (!bundlePath) return { eligible: false };
  // A translocated launch runs a read-only copy; replacing it changes nothing.
  if (input.execPath.includes("/AppTranslocation/")) {
    return { eligible: false, reason: "translocated" };
  }
  try {
    if (fs.realpath(bundlePath) !== bundlePath) {
      return { eligible: false, reason: "symlink" };
    }
  } catch {
    return { eligible: false, reason: "not-writable" };
  }
  const installDir = dirname(bundlePath);
  for (const path of [bundlePath, installDir]) {
    try {
      fs.access(path, constants.W_OK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      return { eligible: false, reason: code === "EROFS" ? "read-only" : "not-writable" };
    }
  }
  return { eligible: true, bundlePath, installDir };
}

/** `<name>.app/Contents/MacOS/<exe>` -> `<name>.app`, or null for anything else. */
export function bundlePathFromExecutable(execPath: string): string | null {
  const macOsDir = dirname(execPath);
  const contentsDir = dirname(macOsDir);
  const bundlePath = dirname(contentsDir);
  if (basename(macOsDir) !== "MacOS" || basename(contentsDir) !== "Contents") return null;
  if (!bundlePath.endsWith(".app") || basename(bundlePath) === ".app") return null;
  return bundlePath;
}
