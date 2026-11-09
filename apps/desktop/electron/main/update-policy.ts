import type { UpdateDelivery, UpdateMode, UpdatePreference } from "@pi-desktop/shared";

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
 *
 * An ad-hoc install in an eligible location is the exception to the rule above:
 * it updates through PI-Desktop's own assisted installer, which does not use
 * Squirrel.Mac (ADR plus-assisted-macos-adhoc-update). `assistedEligible` is
 * decided by the controller from the running bundle's location.
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
  assistedEligible = false,
): boolean {
  if (!isPackaged) return false;
  if (platform === "win32") return true;
  if (platform === "darwin") {
    return macSigning === "developer-id" || (macSigning === "adhoc" && assistedEligible);
  }
  return platform === "linux" && Boolean(env.APPIMAGE);
}

export function resolveDefaultUpdatePreference(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
  distribution?: WindowsDistribution,
  macSigning: MacSigning = "unknown",
  assistedEligible = false,
): UpdatePreference {
  if (!supportsAutomaticUpdates(platform, isPackaged, env, macSigning, assistedEligible)) {
    return "manual";
  }
  // The assisted lane is an explicit opt-in: it trades Developer ID trust for
  // the fixed GitHub repository (ADR plus-assisted-macos-adhoc-update, OD4).
  if (platform === "darwin" && macSigning === "adhoc") return "manual";
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
  assistedEligible = false,
): UpdateMode {
  if (!isPackaged) return "disabled";
  if (!supportsAutomaticUpdates(platform, isPackaged, env, macSigning, assistedEligible)) {
    return "manual";
  }
  const selected =
    preference ??
    resolveDefaultUpdatePreference(
      platform,
      isPackaged,
      env,
      distribution,
      macSigning,
      assistedEligible,
    );
  return selected === "automatic" ? "in-app" : "manual";
}

/** `assisted` when this install updates through the assisted macOS lane. */
export function resolveUpdateDelivery(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  macSigning: MacSigning = "unknown",
  assistedEligible = false,
): UpdateDelivery | undefined {
  return isPackaged && platform === "darwin" && macSigning === "adhoc" && assistedEligible
    ? "assisted"
    : undefined;
}
