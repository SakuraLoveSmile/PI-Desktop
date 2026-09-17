#!/usr/bin/env node
/**
 * Runs after electron-builder finishes signing the macOS bundle.
 *
 * Doing this in `afterSign` (not `afterPack`) guarantees that every nested
 * helper (`PI-Desktop Helper.app`, `... Helper (Renderer).app`, ...) has
 * already been adhoc- or Developer-ID-signed. Otherwise `codesign` refuses
 * to re-sign the outer `.app` with:
 *   "code object is not signed at all"
 * because some helper's signature was stripped by @electron/rebuild.
 */
import path from "node:path";
import { ensureMacCodesignIdentifier } from "./macos-codesign-identity.mjs";

export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const bundleId = context.packager.appInfo.id;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const result = ensureMacCodesignIdentifier(appPath, bundleId);
  if (result.status === "adhoc-signed") {
    console.log(
      `macOS codesign identifier ${result.previous ?? "(unsigned)"} → ${result.identifier}`,
    );
  }
}
