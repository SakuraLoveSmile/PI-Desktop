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
