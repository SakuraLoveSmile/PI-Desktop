import type { UpdateMode, UpdatePreference } from "@pi-desktop/shared";

export type WindowsDistribution = "installed" | "zip" | "portable";

/**
 * Build-time signing lane stamped into a packaged macOS app.
 *
 * Squirrel.Mac validates an update against the running app's designated
 * requirement. A Developer ID signature gives that requirement a stable
 * identity, so a newer build signed by the same team passes. An ad-hoc
 * signature instead pins the requirement to the running binary's cdhash,
 * which no later build can satisfy. `unknown` covers legacy packages and
 * lanes that bypass the packaging stamp and is therefore treated like ad-hoc.
 */
export type MacSigning = "developer-id" | "adhoc" | "unknown";

export function resolveMacSigning(value: unknown): MacSigning {
  return value === "developer-id" || value === "adhoc" ? value : "unknown";
}

export function supportsAutomaticUpdates(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
  macSigning: MacSigning = "unknown",
): boolean {
  if (!isPackaged) return false;
  if (platform === "win32") return true;
  if (platform === "darwin") return macSigning === "developer-id";
  return platform === "linux" && Boolean(env.APPIMAGE);
}

export function resolveDefaultUpdatePreference(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
  distribution?: WindowsDistribution,
  macSigning: MacSigning = "unknown",
): UpdatePreference {
  if (!supportsAutomaticUpdates(platform, isPackaged, env, macSigning)) {
    return "manual";
  }
  if (
    platform === "win32" &&
    (Boolean(env.PORTABLE_EXECUTABLE_FILE) || distribution === "zip" || distribution === "portable")
  ) {
    return "manual";
  }
  return "automatic";
}

export function resolveStoredUpdatePreference(
  value: unknown,
  fallback: UpdatePreference,
): UpdatePreference {
  return value === "automatic" || value === "manual" ? value : fallback;
}

export function resolveEffectiveUpdatePreference(
  preference: UpdatePreference,
  automaticSupported: boolean,
): UpdatePreference {
  return automaticSupported ? preference : "manual";
}

export function resolveUpdateMode(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
  distribution?: WindowsDistribution,
  preference?: UpdatePreference,
  macSigning: MacSigning = "unknown",
): UpdateMode {
  if (!isPackaged) return "disabled";
  if (!supportsAutomaticUpdates(platform, isPackaged, env, macSigning)) return "manual";
  const selected =
    preference ??
    resolveDefaultUpdatePreference(platform, isPackaged, env, distribution, macSigning);
  return selected === "automatic" ? "in-app" : "manual";
}
