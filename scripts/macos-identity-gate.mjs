#!/usr/bin/env node
/**
 * electron-builder `afterPack` gate: refuse to continue with a candidate whose
 * macOS identity is not independent, or that is missing its host sidecar.
 *
 * Why before signing
 * ------------------
 * `afterPack` runs after the app bundle is assembled but before electron-builder
 * signs it, which is exactly where an identity must still be changeable and where
 * a bad candidate should stop the build. `afterSign` deliberately does not appear
 * here: it must never alter binary bytes.
 *
 * What it enforces
 * ----------------
 *   1. the main executable's `LC_UUID` is present and shared with neither the
 *      pinned official Electron distribution nor any supplied reference — the
 *      collision that cost this fork its Local Network identity;
 *   2. the declared application id and the Local Network usage description are
 *      the Plus ones;
 *   3. the host sidecar really is inside the bundle. electron-builder only prints
 *      `file source doesn't exist` when an `extraResources` source is missing and
 *      then finishes successfully, which shipped a `host unavailable` build once
 *      already; a package without it is not a working product.
 *
 * The signature check is intentionally not part of this gate: signing happens
 * *after* this hook, so a pre-sign candidate is legitimately unsigned. The
 * release verifier (`scripts/verify-macos-release.sh`) owns signature and
 * notarization acceptance.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECK_STATUS,
  collectBundleFacts,
  compareIdentities,
  createDefaultProbes,
  evaluateSlice,
  EXPECTED_APP_ID,
} from "./macos-executable-identity.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarRelativePath = join("Contents", "Resources", "bin", "pi-desktop-host-core");

/** Checks that a pre-sign candidate cannot satisfy yet, with the reason why. */
const DEFERRED_TO_SIGNING = new Set(["code-signature"]);

function describeFailures(checks) {
  return checks
    .filter((entry) => entry.status === CHECK_STATUS.FAIL)
    .map((entry) => `${entry.id}: ${entry.detail ?? "failed"}`)
    .join("; ");
}

/** A missing source UUID makes independence unverifiable, so fail closed. */
export function describeComparisonFailures(comparison) {
  const sources = comparison?.unverifiableSources ?? [];
  if (sources.length === 0) return null;
  const list = sources
    .map((entry) => `${entry.role} ${entry.path ?? "unknown path"}`)
    .join(", ");
  return `source-identities-readable: main executable UUID unavailable for ${list}`;
}

export default async function macosIdentityGate(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appInfo = context.packager?.appInfo;
  const productFilename = appInfo?.productFilename;
  if (!productFilename) throw new Error("macOS identity gate: the packager did not report a product filename");
  const bundlePath = join(context.appOutDir, `${productFilename}.app`);

  const sidecarPath = join(bundlePath, sidecarRelativePath);
  if (!existsSync(sidecarPath) || statSync(sidecarPath).size === 0) {
    throw new Error(
      `macOS identity gate: the host sidecar is missing from the bundle (${sidecarRelativePath}). ` +
        "electron-builder only warns when an extraResources source does not exist, so this build would " +
        "ship a 'host unavailable' application. Build the Rust sidecar (pnpm run build:host-release) first.",
    );
  }

  const probes = createDefaultProbes();
  const officialApp = join(repoRoot, "apps", "desktop", "node_modules", "electron", "dist", "Electron.app");
  const sources = [];
  if (existsSync(officialApp)) {
    sources.push({ role: "input", facts: collectBundleFacts(officialApp, probes) });
  }
  const reference = process.env.PI_IDENTITY_REFERENCE;
  if (reference && existsSync(reference)) {
    sources.push({ role: "reference", facts: collectBundleFacts(reference, probes) });
  }
  if (sources.length === 0) {
    throw new Error(
      "macOS identity gate: no identity source to compare against. Expected the pinned official Electron " +
        `distribution at ${officialApp}, or PI_IDENTITY_REFERENCE pointing at an installed reference app.`,
    );
  }

  const candidateFacts = collectBundleFacts(bundlePath, probes);
  const comparison = compareIdentities({
    candidate: { role: "candidate", facts: candidateFacts },
    sources: sources.map((source) => ({ role: source.role, facts: source.facts })),
  });
  const evaluated = evaluateSlice({
    role: "candidate",
    facts: candidateFacts,
    expectedAppId: process.env.PI_IDENTITY_APP_ID ?? EXPECTED_APP_ID,
    duplicates: comparison.duplicateMainExecutable,
  });
  const enforced = evaluated.checks.filter((entry) => !DEFERRED_TO_SIGNING.has(entry.id));
  const failures = [describeComparisonFailures(comparison), describeFailures(enforced)]
    .filter(Boolean)
    .join("; ");

  if (failures) {
    throw new Error(
      `macOS identity gate: the candidate is not an independent identity (${evaluated.verdict}): ${failures}`,
    );
  }

  const candidateUuid = candidateFacts.mainExecutable?.uuid ?? "unknown";
  const sourceUuids = sources
    .map((source) => `${source.role}=${source.facts.mainExecutable?.uuid ?? "unknown"}`)
    .join(" ");
  console.log(
    `[identity-gate] candidate ${productFilename}.app main executable UUID ${candidateUuid} ` +
      `is independent of ${sourceUuids}; host sidecar present.`,
  );
}
