/**
 * Pure policy for selecting the macOS codesign timestamp mode.
 *
 * Notarized builds require a secure timestamp. Ordinary local artifacts keep
 * the explicit `none` mode because timestamp authority failures are costly
 * and local artifacts are not notarization candidates.
 */

/** Whether the caller explicitly asks electron-builder to notarize the app. */
export function notarizationRequested(args = []) {
  return args.some((arg, index) => {
    if (/^(?:-c|--config)\.mac\.notarize=true$/.test(arg)) return true;
    return /^(?:-c|--config)\.mac\.notarize$/.test(arg) && args[index + 1] === "true";
  });
}

/** Whether the packaging command must retain a secure signing timestamp. */
export function shouldUseSecureTimestamp(args = [], env = {}) {
  return env.PI_MAC_SECURE_TIMESTAMP === "1" || notarizationRequested(args);
}

/**
 * Signing lane stamped into the packaged app for update delivery.
 *
 * Developer ID packages keep the in-app `electron-updater` lane. Ad-hoc
 * packages cannot satisfy Squirrel.Mac's designated-requirement check on a
 * later build, so they must stay on notify-and-link delivery. A lane that
 * names neither ad-hoc signing nor signing credentials is `unknown`; the app
 * treats that conservatively as not automatic-capable.
 */
export function resolveMacSigningLane(args = [], env = {}) {
  const adHoc = args.some((arg, index) => {
    if (/^(?:-c|--config)\.mac\.identity=-$/.test(arg)) return true;
    return /^(?:-c|--config)\.mac\.identity$/.test(arg) && args[index + 1] === "-";
  });
  if (adHoc) return "adhoc";
  if (
    notarizationRequested(args) ||
    Boolean(env.CSC_LINK || env.CSC_NAME)
  ) {
    return "developer-id";
  }
  return "unknown";
}
