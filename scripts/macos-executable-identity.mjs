#!/usr/bin/env node
// Read-only macOS executable-identity verifier.
//
// Why this exists: on macOS the "app" that the OS attributes local network
// access, TCC prompts, and privacy bookkeeping to is identified by the code
// identity of the *main executable* of the bundle. A re-branded fork that is
// produced by copying the stock Electron distribution keeps the Electron main
// executable byte-for-byte, so its Mach-O debug-symbol UUID stays identical to
// the stock Electron binary and to every other app built from the same
// Electron release. `dwarfdump --uuid` shows the collision directly, and it is
// the cheapest local signal that a bundle is *not* an independently linked
// identity.
//
// This script only ever reads: it never writes, never signs, never patches a
// UUID, never touches a bundle, and never modifies any packaging input. It
// answers one question per architecture slice: is this bundle a *qualified
// independent* identity?
//
// Qualification rules (all must hold for the candidate slice):
//   1. the bundle exists and its Info.plist is readable;
//   2. the main executable exists and `dwarfdump --uuid` reports a UUID for it;
//   3. the declared application identifier is the expected one
//      (`cn.sakura.pi-desktop` unless overridden);
//   4. that main-executable UUID does not collide with the main-executable
//      UUID of any supplied reference identity (the independently linked
//      Electron input, and/or an installed official app);
//   5. the bundle carries a signature and `codesign --verify --deep --strict`
//      accepts it;
//   6. `NSLocalNetworkUsageDescription` is declared.
//
// Sharing UUIDs of *libraries* (Electron Framework, dylibs, helper apps) with
// the Electron input is expected for any Electron app and is reported as
// informational only. It is never a collision and never a failure.
//
// Output policy: the verifier reports a signature *category*
// ("unsigned", "adhoc", "apple-development", "developer-id", ...), never the
// authority string. `codesign -d --verbose=2` text is parsed to pick the
// category and is deliberately not propagated into the result or the report,
// because it carries certificate labels, e-mail addresses and team IDs.
//
// Design: every OS interaction goes through an injectable probe object, so the
// pure verdict logic can be exercised with synthetic or captured tool output on
// any host. Process execution lives only in `createDefaultProbes()`.
//
// Usage:
//   node scripts/macos-executable-identity.mjs --candidate <path> \
//     [--input <path>] [--reference <path>]... [--expected-app-id <id>] [--json]
//
//   <path> is a `*.app` bundle. `--candidate` is required; `--input` and
//   `--reference` may be repeated and are the identities the candidate must
//   NOT collide with. Exit code 0 only for a qualified independent identity,
//   1 for any other verdict (a per-slice verdict table is printed), 2 for bad
//   usage, 3 when the host platform cannot run the probes.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- constants

export const EXPECTED_APP_ID = "cn.sakura.pi-desktop";

/** Candidate verdicts. `QUALIFIED` is the only passing one. */
export const VERDICT = {
  QUALIFIED: "qualified-independent",
  MISSING_BUNDLE: "missing-bundle",
  MISSING_EXECUTABLE_UUID: "missing-executable-uuid",
  WRONG_APPLICATION_ID: "wrong-application-id",
  DUPLICATE_MAIN_EXECUTABLE_UUID: "duplicate-main-executable-uuid",
  MISSING_SIGNATURE: "missing-signature",
  SIGNATURE_VERIFICATION_FAILED: "signature-verification-failed",
  MISSING_LOCAL_NETWORK_USAGE_DESCRIPTION:
    "missing-local-network-usage-description",
  UNVERIFIABLE_SOURCE_IDENTITY: "unverifiable-source-identity",
};

/** Fixed failure precedence: the first matching verdict wins. */
export const VERDICT_PRECEDENCE = [
  VERDICT.MISSING_BUNDLE,
  VERDICT.MISSING_EXECUTABLE_UUID,
  VERDICT.WRONG_APPLICATION_ID,
  VERDICT.DUPLICATE_MAIN_EXECUTABLE_UUID,
  VERDICT.MISSING_SIGNATURE,
  VERDICT.SIGNATURE_VERIFICATION_FAILED,
  VERDICT.MISSING_LOCAL_NETWORK_USAGE_DESCRIPTION,
  VERDICT.UNVERIFIABLE_SOURCE_IDENTITY,
];

export const CHECK_STATUS = { PASS: "pass", FAIL: "fail", INFO: "info" };

/** Signature categories. Never a certificate label or authority string. */
export const SIGNATURE_CATEGORY = {
  UNSIGNED: "unsigned",
  ADHOC: "adhoc",
  APPLE_DEVELOPMENT: "apple-development",
  APPLE_DISTRIBUTION: "apple-distribution",
  DEVELOPER_ID: "developer-id",
  OTHER_CERTIFICATE: "other-certificate",
  UNKNOWN: "unknown",
};

export const EXIT_CODE = {
  QUALIFIED: 0,
  NOT_QUALIFIED: 1,
  USAGE: 2,
  UNSUPPORTED_PLATFORM: 3,
};

export const LOCAL_NETWORK_USAGE_KEY = "NSLocalNetworkUsageDescription";
export const APP_ID_PLIST_KEY = "CFBundleIdentifier";
export const MAIN_EXECUTABLE_PLIST_KEY = "CFBundleExecutable";

const USAGE = [
  "usage: node scripts/macos-executable-identity.mjs --candidate <path>",
  "         [--input <path>] [--reference <path>]...",
  "         [--expected-app-id <id>] [--json]",
].join("\n");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DWARFDUMP_LINE =
  /^UUID:\s*([0-9a-fA-F-]{36})\s*(?:\(([^)]*)\))?\s*(.*\S)?\s*$/;

// Failure tokens derived from `codesign --verify` output. The translation is
// intentional: raw `codesign` text is never surfaced.
const CODESIGN_FAILURE_TOKENS = [
  ["code object is not signed at all", "not-signed"],
  ["code has no resources but signature indicates they must be present", "missing-resource-envelope"],
  ["a sealed resource is missing or invalid", "sealed-resource-mismatch"],
  ["invalid signature", "invalid-signature"],
  ["code signature invalid", "invalid-signature"],
  ["not signed by a valid certificate", "untrusted-certificate"],
  ["unable to build chain to self-signed root", "untrusted-certificate"],
  ["resources missing", "missing-resource-envelope"],
];

// ------------------------------------------------------------------ helpers

/** Normalize a Mach-O UUID for comparison. Returns null for junk. */
export function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null;
}

export function uuidsEqual(left, right) {
  const a = normalizeUuid(left);
  const b = normalizeUuid(right);
  return a !== null && b !== null && a === b;
}

/**
 * Parse `dwarfdump --uuid <binary>` output.
 *
 * Real shape (one line per architecture slice):
 *   UUID: 4C4C44B6-5555-3144-A187-35A40BAD7A39 (arm64) path/to/binary
 *
 * Returns `{ entries: [{ uuid, arch, path }], unparsed: string[] }`. Lines that
 * do not match the UUID shape (tool errors such as "could not find specified
 * file") are collected in `unparsed` so callers can fail closed.
 */
export function parseDwarfdumpUuidOutput(text) {
  const entries = [];
  const unparsed = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = DWARFDUMP_LINE.exec(trimmed);
    const uuid = match ? normalizeUuid(match[1]) : null;
    if (!uuid) {
      unparsed.push(trimmed);
      continue;
    }
    entries.push({
      uuid,
      arch: match[2] ? match[2].trim() : null,
      path: match[3] ? match[3].trim() : null,
    });
  }
  return { entries, unparsed };
}

/**
 * Reduce `codesign --verify --deep --strict` output to a verdict plus a
 * category token. No authority, label, e-mail or team identifier survives.
 */
export function parseCodesignVerification(raw) {
  const status = typeof raw?.status === "number" ? raw.status : null;
  const text = `${raw?.stdout ?? ""}\n${raw?.stderr ?? ""}`;
  let failure = null;
  for (const [needle, token] of CODESIGN_FAILURE_TOKENS) {
    if (text.includes(needle)) {
      failure = token;
      break;
    }
  }
  if (status === 0) {
    return { verified: true, failure: null };
  }
  if (status === null) {
    return { verified: false, failure: failure ?? "probe-unavailable" };
  }
  return { verified: false, failure: failure ?? "verification-failed" };
}

/**
 * Classify a `codesign -d --verbose=2` dump into a signature category token.
 *
 * The authority line is matched by its *prefix* only and is never returned, so
 * certificate labels, e-mail addresses and team identifiers cannot leak
 * through this function's result.
 */
export function classifySignatureCategory(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let sawAuthority = false;
  let category = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Signature=adhoc")) {
      category = SIGNATURE_CATEGORY.ADHOC;
      continue;
    }
    if (!trimmed.startsWith("Authority=")) continue;
    const authority = trimmed.slice("Authority=".length).trim();
    if (authority === "" || authority.startsWith("(unavailable)")) continue;
    sawAuthority = true;
    const prefix = authority.split(":")[0].trim().toLowerCase();
    if (prefix.startsWith("developer id application")) {
      category = SIGNATURE_CATEGORY.DEVELOPER_ID;
    } else if (prefix.startsWith("apple development")) {
      category = SIGNATURE_CATEGORY.APPLE_DEVELOPMENT;
    } else if (
      prefix.startsWith("apple distribution") ||
      prefix.startsWith("3rd party mac developer")
    ) {
      category = SIGNATURE_CATEGORY.APPLE_DISTRIBUTION;
    } else if (category === null) {
      category = SIGNATURE_CATEGORY.OTHER_CERTIFICATE;
    }
  }
  if (category !== null) return category;
  const insecure =
    /Signature=adhoc/.test(text) ||
    /flags=0x[0-9a-f]*\(adhoc\)/i.test(text) ||
    /linker-signed/.test(text);
  if (insecure) return SIGNATURE_CATEGORY.ADHOC;
  if (!sawAuthority && /^Identifier=/m.test(text)) {
    return SIGNATURE_CATEGORY.UNSIGNED;
  }
  return SIGNATURE_CATEGORY.UNKNOWN;
}

/**
 * Read the two plist values this verifier cares about.
 *
 * `plutil` JSON output is preferred; a plain-text XML plist is used as a
 * fallback so the parser still works where `plutil` is unavailable.
 */
export function parseBundleInfoPlist({ plutil, xml } = {}) {
  if (plutil && typeof plutil.status === "number" && plutil.status === 0) {
    try {
      const value = JSON.parse(String(plutil.stdout ?? ""));
      return {
        ok: true,
        source: "plutil-json",
        appId: typeof value[APP_ID_PLIST_KEY] === "string" ? value[APP_ID_PLIST_KEY] : null,
        mainExecutable:
          typeof value[MAIN_EXECUTABLE_PLIST_KEY] === "string"
            ? value[MAIN_EXECUTABLE_PLIST_KEY]
            : null,
        usageDescription:
          typeof value[LOCAL_NETWORK_USAGE_KEY] === "string"
            ? value[LOCAL_NETWORK_USAGE_KEY]
            : null,
      };
    } catch {
      // fall through to the XML fallback
    }
  }
  if (xml && xml.ok && typeof xml.text === "string") {
    return {
      ok: true,
      source: "xml-text",
      appId: parseXmlPlistStringValue(xml.text, APP_ID_PLIST_KEY),
      mainExecutable: parseXmlPlistStringValue(xml.text, MAIN_EXECUTABLE_PLIST_KEY),
      usageDescription: parseXmlPlistStringValue(xml.text, LOCAL_NETWORK_USAGE_KEY),
    };
  }
  return {
    ok: false,
    source: null,
    appId: null,
    mainExecutable: null,
    usageDescription: null,
  };
}

/**
 * Minimal `<key>K</key><string>V</string>` reader for XML plists. Values that
 * are not plain strings (arrays, booleans) resolve to null.
 */
export function parseXmlPlistStringValue(xmlText, key) {
  if (typeof xmlText !== "string" || typeof key !== "string") return null;
  const index = xmlText.indexOf(`<key>${key}</key>`);
  if (index === -1) return null;
  const rest = xmlText.slice(index + `<key>${key}</key>`.length);
  const match = /^\s*<string>([\s\S]*?)<\/string>/.exec(rest);
  if (!match) return null;
  return match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function check(id, status, detail) {
  return { id, status, detail };
}

function hasUsableUuid(entry) {
  return entry !== null && normalizeUuid(entry?.uuid) !== null;
}

// ------------------------------------------------------- pure verdict logic

/**
 * Turn one probed bundle into checks plus a verdict.
 *
 * `duplicates` is the list of `{ role, path, uuid }` whose main-executable UUID
 * equals this slice's main-executable UUID.
 */
export function evaluateSlice({
  role,
  facts,
  expectedAppId,
  duplicates = [],
}) {
  const checks = [];
  const failing = [];

  if (!facts.exists || !facts.infoPlist?.ok) {
    checks.push(
      check(
        "bundle-readable",
        CHECK_STATUS.FAIL,
        `${facts.bundlePath}: bundle or Info.plist is not readable`,
      ),
    );
    failing.push(VERDICT.MISSING_BUNDLE);
    return { role, verdict: verdictFor(role, failing), checks, facts };
  }
  checks.push(check("bundle-readable", CHECK_STATUS.PASS, facts.bundlePath));

  checks.push(
    check(
      "application-id",
      facts.appId === expectedAppId ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      facts.appId === null
        ? `${APP_ID_PLIST_KEY} is absent`
        : `declared application id ${facts.appId}`,
    ),
  );
  if (facts.appId !== expectedAppId) failing.push(VERDICT.WRONG_APPLICATION_ID);

  if (!hasUsableUuid(facts.mainExecutable)) {
    checks.push(
      check(
        "main-executable-uuid",
        CHECK_STATUS.FAIL,
        facts.mainExecutable?.path
          ? `no Mach-O UUID reported for ${facts.mainExecutable.path}`
          : "main executable could not be resolved",
      ),
    );
    failing.push(VERDICT.MISSING_EXECUTABLE_UUID);
  } else {
    checks.push(
      check(
        "main-executable-uuid",
        CHECK_STATUS.PASS,
        `${facts.mainExecutable.uuid} (${facts.mainExecutable.arch ?? "unknown arch"})`,
      ),
    );
  }

  if (facts.usageDescription.present) {
    checks.push(
      check(
        "local-network-usage-description",
        CHECK_STATUS.PASS,
        `${LOCAL_NETWORK_USAGE_KEY} declared (${facts.usageDescription.characters} characters)`,
      ),
    );
  } else {
    checks.push(
      check(
        "local-network-usage-description",
        CHECK_STATUS.FAIL,
        `${LOCAL_NETWORK_USAGE_KEY} is not declared`,
      ),
    );
    failing.push(VERDICT.MISSING_LOCAL_NETWORK_USAGE_DESCRIPTION);
  }

  const signature = facts.signature ?? {};
  if (signature.present === false || signature.category === SIGNATURE_CATEGORY.UNSIGNED) {
    checks.push(
      check(
        "code-signature",
        CHECK_STATUS.FAIL,
        `no signature present (category ${signature.category ?? SIGNATURE_CATEGORY.UNKNOWN})`,
      ),
    );
    failing.push(VERDICT.MISSING_SIGNATURE);
  } else if (!signature.verified) {
    checks.push(
      check(
        "code-signature",
        CHECK_STATUS.FAIL,
        `signature present (category ${signature.category}) but verification failed: ${
          signature.failure ?? "unknown"
        }`,
      ),
    );
    failing.push(VERDICT.SIGNATURE_VERIFICATION_FAILED);
  } else {
    checks.push(
      check(
        "code-signature",
        CHECK_STATUS.PASS,
        `verified, category ${signature.category}`,
      ),
    );
  }

  for (const duplicate of duplicates) {
    checks.push(
      check(
        "main-executable-uuid-unique",
        CHECK_STATUS.FAIL,
        `main executable UUID ${facts.mainExecutable.uuid} is shared with ${duplicate.role} ${duplicate.path}`,
      ),
    );
  }
  if (duplicates.length > 0) failing.push(VERDICT.DUPLICATE_MAIN_EXECUTABLE_UUID);
  if (role === "candidate" && duplicates.length === 0 && hasUsableUuid(facts.mainExecutable)) {
    checks.push(
      check(
        "main-executable-uuid-unique",
        CHECK_STATUS.PASS,
        "no supplied identity shares this main executable UUID",
      ),
    );
  }

  if (role !== "candidate") {
    return { role, verdict: sourceVerdict(failing), checks, facts };
  }
  return { role, verdict: verdictFor(role, failing), checks, facts };
}

function verdictFor(role, failing) {
  if (role !== "candidate") return sourceVerdict(failing);
  for (const candidate of VERDICT_PRECEDENCE) {
    if (failing.includes(candidate)) return candidate;
  }
  return VERDICT.QUALIFIED;
}

function sourceVerdict(failing) {
  if (failing.includes(VERDICT.MISSING_BUNDLE)) return VERDICT.MISSING_BUNDLE;
  if (failing.includes(VERDICT.MISSING_EXECUTABLE_UUID)) {
    return VERDICT.MISSING_EXECUTABLE_UUID;
  }
  return "identity-source";
}

/**
 * Cross-slice comparison. Returns the shared-library (informational) UUIDs and
 * the duplicate main-executable UUIDs for the candidate.
 */
export function compareIdentities({ candidate, sources }) {
  const duplicateMainExecutable = [];
  const unverifiableSources = [];
  for (const source of sources) {
    if (!hasUsableUuid(source.facts?.mainExecutable)) {
      unverifiableSources.push({ role: source.role, path: source.facts?.bundlePath });
      continue;
    }
    if (
      hasUsableUuid(candidate.facts?.mainExecutable) &&
      uuidsEqual(
        candidate.facts.mainExecutable.uuid,
        source.facts.mainExecutable.uuid,
      )
    ) {
      duplicateMainExecutable.push({
        role: source.role,
        path: source.facts.bundlePath,
        uuid: normalizeUuid(source.facts.mainExecutable.uuid),
      });
    }
  }

  const candidateLibraries = candidate.facts?.libraryUuids ?? [];
  const sharedLibraries = [];
  for (const library of candidateLibraries) {
    const sharedWith = [];
    for (const source of sources) {
      const match = (source.facts?.libraryUuids ?? []).find((entry) =>
        uuidsEqual(entry.uuid, library.uuid),
      );
      if (match) sharedWith.push({ role: source.role, path: match.path });
    }
    if (sharedWith.length > 0) {
      sharedLibraries.push({
        path: library.path,
        uuid: normalizeUuid(library.uuid),
        sharedWith,
      });
    }
  }

  return { duplicateMainExecutable, unverifiableSources, sharedLibraries };
}

/**
 * Full qualification decision from already-probed facts. Pure: no I/O.
 */
export function decideQualification({
  candidate,
  sources = [],
  expectedAppId = EXPECTED_APP_ID,
}) {
  const comparison = compareIdentities({ candidate, sources });

  const evaluatedCandidate = evaluateSlice({
    role: "candidate",
    facts: candidate.facts,
    expectedAppId,
    duplicates: comparison.duplicateMainExecutable,
  });
  const evaluatedSources = sources.map((source) =>
    evaluateSlice({ role: source.role, facts: source.facts, expectedAppId }),
  );

  const checks = [...evaluatedCandidate.checks];
  const reasons = evaluatedCandidate.checks
    .filter((entry) => entry.status === CHECK_STATUS.FAIL)
    .map((entry) => entry.detail);

  if (comparison.unverifiableSources.length > 0) {
    const list = comparison.unverifiableSources
      .map((entry) => `${entry.role} ${entry.path}`)
      .join(", ");
    checks.push(
      check(
        "source-identities-readable",
        CHECK_STATUS.FAIL,
        `main executable UUID unavailable for: ${list}`,
      ),
    );
    reasons.push(
      `cannot prove independence: main executable UUID unavailable for ${list}`,
    );
  } else if (sources.length > 0) {
    checks.push(
      check(
        "source-identities-readable",
        CHECK_STATUS.PASS,
        `main executable UUID read for ${sources.length} supplied identity(ies)`,
      ),
    );
  }

  if (comparison.sharedLibraries.length > 0) {
    checks.push(
      check(
        "shared-library-uuids",
        CHECK_STATUS.INFO,
        `${comparison.sharedLibraries.length} library UUID(s) shared with a supplied identity — informational, never a collision`,
      ),
    );
  }

  let verdict = evaluatedCandidate.verdict;
  if (
    verdict === VERDICT.QUALIFIED &&
    comparison.unverifiableSources.length > 0
  ) {
    verdict = VERDICT.UNVERIFIABLE_SOURCE_IDENTITY;
  }
  reasons.push(`verdict: ${verdict}`);

  return {
    expectedAppId,
    qualified: verdict === VERDICT.QUALIFIED,
    verdict,
    candidate: {
      role: "candidate",
      path: candidate.facts.bundlePath,
      verdict,
      facts: candidate.facts,
      checks,
    },
    sources: evaluatedSources.map((entry, index) => ({
      role: entry.role,
      path: sources[index].facts.bundlePath,
      verdict: entry.verdict,
      facts: sources[index].facts,
      checks: entry.checks,
    })),
    duplicateMainExecutable: comparison.duplicateMainExecutable,
    sharedLibraries: comparison.sharedLibraries,
    unverifiableSources: comparison.unverifiableSources,
    reasons,
  };
}

// ------------------------------------------------------------ OS probes

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    return {
      status: null,
      stdout: "",
      stderr: "",
      unavailable: true,
      code: result.error.code ?? "probe-unavailable",
    };
  }
  return {
    status: typeof result.status === "number" ? result.status : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    unavailable: false,
    code: null,
  };
}

function readTextFile(filePath) {
  try {
    return { ok: true, text: fs.readFileSync(filePath, "utf8"), error: null };
  } catch (error) {
    return { ok: false, text: null, error: error?.code ?? "read-failed" };
  }
}

/**
 * The nested Mach-O files whose UUIDs are worth comparing. Bounded on purpose:
 * `dwarfdump` is spawned once per entry.
 */
export function listNestedBinaryPaths(bundlePath, mainExecutablePath) {
  const found = new Set();
  const frameworksDir = path.join(bundlePath, "Contents", "Frameworks");
  const entries = (() => {
    try {
      return fs.readdirSync(frameworksDir, { withFileTypes: true });
    } catch {
      return [];
    }
  })();
  for (const entry of entries) {
    const entryPath = path.join(frameworksDir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".framework")) {
      const versionedDir = path.join(entryPath, "Versions", "A");
      const binaryName = entry.name.slice(0, -".framework".length);
      found.add(path.join(versionedDir, binaryName));
      const helpersDir = path.join(versionedDir, "Helpers");
      for (const helper of (() => {
        try {
          return fs.readdirSync(helpersDir);
        } catch {
          return [];
        }
      })()) {
        found.add(path.join(helpersDir, helper));
      }
    } else if (entry.isDirectory() && entry.name.endsWith(".app")) {
      const helperMacOsDir = path.join(entryPath, "Contents", "MacOS");
      for (const binary of (() => {
        try {
          return fs.readdirSync(helperMacOsDir);
        } catch {
          return [];
        }
      })()) {
        found.add(path.join(helperMacOsDir, binary));
      }
    } else if (entry.name.endsWith(".dylib")) {
      found.add(entryPath);
    }
  }
  const resourcesBinDir = path.join(bundlePath, "Contents", "Resources", "bin");
  for (const binary of (() => {
    try {
      return fs.readdirSync(resourcesBinDir);
    } catch {
      return [];
    }
  })()) {
    found.add(path.join(resourcesBinDir, binary));
  }
  if (mainExecutablePath) found.delete(mainExecutablePath);
  return [...found].filter((candidate) => fs.existsSync(candidate)).sort();
}

/** Default probes: the only place in this module that touches the host OS. */
export function createDefaultProbes({
  platform = process.platform,
  run = runCommand,
  readFile = readTextFile,
  exists = (target) => fs.existsSync(target),
  listNested = listNestedBinaryPaths,
} = {}) {
  return {
    platform: () => platform,
    pathExists: (target) => exists(target),
    readInfoPlist: (bundlePath) => {
      const plistPath = path.join(bundlePath, "Contents", "Info.plist");
      return {
        plistPath,
        plutil: run("plutil", ["-convert", "json", "-o", "-", plistPath]),
        xml: readFile(plistPath),
      };
    },
    readDwarfdumpUuid: (binaryPath) =>
      run("dwarfdump", ["--uuid", binaryPath]),
    verifySignature: (bundlePath) =>
      run("codesign", ["--verify", "--deep", "--strict", bundlePath]),
    describeSignature: (bundlePath) =>
      run("codesign", ["-d", "--verbose=2", bundlePath]),
    listNestedBinaries: (bundlePath, mainExecutablePath) =>
      listNested(bundlePath, mainExecutablePath),
  };
}

/** Read one bundle into plain facts through the given probes. */
export function collectBundleFacts(bundlePath, probes) {
  const infoPlist = probes.readInfoPlist(bundlePath);
  const parsed = parseBundleInfoPlist(infoPlist);

  let mainExecutable = null;
  if (parsed.ok) {
    const declaredName = parsed.mainExecutable;
    const macOsDir = path.join(bundlePath, "Contents", "MacOS");
    const executablePath = declaredName
      ? path.join(macOsDir, declaredName)
      : null;
    if (executablePath && probes.pathExists(executablePath)) {
      const dwarf = probes.readDwarfdumpUuid(executablePath);
      const { entries, unparsed } = parseDwarfdumpUuidOutput(dwarf.stdout);
      const primary = entries[0] ?? null;
      mainExecutable = {
        path: executablePath,
        uuid: primary ? normalizeUuid(primary.uuid) : null,
        arch: primary ? primary.arch : null,
        slices: entries.map((entry) => ({ uuid: entry.uuid, arch: entry.arch })),
        probe: {
          status: dwarf.status ?? null,
          unavailable: dwarf.unavailable === true,
          unparsed: unparsed.length,
        },
      };
    } else {
      mainExecutable = {
        path: executablePath,
        uuid: null,
        arch: null,
        slices: [],
        probe: { status: null, unavailable: false, unparsed: 0 },
      };
    }
  }

  const describe = probes.describeSignature(bundlePath);
  const verification = probes.verifySignature(bundlePath);
  const category = parsed.ok
    ? classifySignatureCategory(`${describe.stdout}\n${describe.stderr}`)
    : SIGNATURE_CATEGORY.UNKNOWN;
  const signatureVerdict = parseCodesignVerification(verification);

  const libraryUuids = [];
  if (parsed.ok && mainExecutable?.path) {
    for (const binaryPath of probes.listNestedBinaries(
      bundlePath,
      mainExecutable.path,
    )) {
      const dwarf = probes.readDwarfdumpUuid(binaryPath);
      const { entries } = parseDwarfdumpUuidOutput(dwarf.stdout);
      const primary = entries[0] ?? null;
      if (primary) {
        libraryUuids.push({
          path: path.relative(bundlePath, binaryPath) || binaryPath,
          uuid: normalizeUuid(primary.uuid),
        });
      }
    }
  }

  return {
    bundlePath,
    exists: probes.pathExists(bundlePath),
    infoPlist: {
      ok: parsed.ok,
      source: parsed.source,
      path: infoPlist.plistPath,
    },
    appId: parsed.appId,
    usageDescription: {
      present:
        typeof parsed.usageDescription === "string" &&
        parsed.usageDescription.trim().length > 0,
      characters:
        typeof parsed.usageDescription === "string"
          ? parsed.usageDescription.length
          : null,
    },
    mainExecutable,
    signature: {
      verified: signatureVerdict.verified,
      failure: signatureVerdict.failure,
      category,
      present:
        category !== SIGNATURE_CATEGORY.UNSIGNED &&
        category !== SIGNATURE_CATEGORY.UNKNOWN,
    },
    libraryUuids,
  };
}

/** Probe every slice and decide. This is the entry point tests and CLI share. */
export function verifyExecutableIdentity({
  candidate,
  input = null,
  references = [],
  expectedAppId = EXPECTED_APP_ID,
  probes = createDefaultProbes(),
}) {
  const platform = probes.platform ? probes.platform() : null;
  const sources = [];
  if (input) sources.push({ role: "input", path: input });
  for (const reference of references) {
    sources.push({ role: "reference", path: reference });
  }

  const result = decideQualification({
    candidate: { facts: collectBundleFacts(candidate, probes) },
    sources: sources.map((source) => ({
      role: source.role,
      facts: collectBundleFacts(source.path, probes),
    })),
    expectedAppId,
  });
  return { ...result, platform };
}

// ------------------------------------------------------------------ report

function signatureLabel(facts) {
  const signature = facts.signature ?? {};
  const category = signature.category ?? SIGNATURE_CATEGORY.UNKNOWN;
  if (!signature.verified) return `${category} (unverified)`;
  return `${category} (verified)`;
}

function pad(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function shortPath(value, width = 44) {
  const text = String(value ?? "");
  if (text.length <= width) return text;
  return `…${text.slice(text.length - width + 1)}`;
}

/** Human-readable report. Contains no certificate strings by construction. */
export function formatReport(result) {
  const lines = [];
  lines.push("macOS executable identity report (read-only)");
  lines.push(`platform: ${result.platform ?? "unknown"}`);
  lines.push(`expected application id: ${result.expectedAppId}`);
  lines.push("");
  lines.push(
    `${pad("slice", 10)} ${pad("verdict", 34)} ${pad("app id", 24)} ${pad(
      "main executable uuid",
      38,
    )} ${pad("signature", 26)} path`,
  );
  const rows = [result.candidate, ...result.sources];
  for (const row of rows) {
    lines.push(
      `${pad(row.role, 10)} ${pad(row.verdict, 34)} ${pad(
        row.facts.appId ?? "(none)",
        24,
      )} ${pad(row.facts.mainExecutable?.uuid ?? "(unreadable)", 38)} ${pad(
        signatureLabel(row.facts),
        26,
      )} ${shortPath(row.path)}`,
    );
  }
  lines.push("");
  lines.push("checks");
  for (const row of rows) {
    for (const entry of row.checks) {
      lines.push(`  [${row.role}] ${entry.status}: ${entry.id} — ${entry.detail}`);
    }
  }
  if (result.sharedLibraries.length > 0) {
    lines.push("");
    lines.push(
      `shared library UUIDs (informational, never a collision): ${result.sharedLibraries.length}`,
    );
    for (const shared of result.sharedLibraries) {
      lines.push(
        `  ${shared.uuid} ${shared.path} shared with ${shared.sharedWith
          .map((entry) => entry.role)
          .join(", ")}`,
      );
    }
  }
  lines.push("");
  lines.push(`qualified independent identity: ${result.qualified ? "yes" : "no"}`);
  return lines.join("\n");
}

/** Machine-readable form. Also authority-free. */
export function toJsonReport(result) {
  return JSON.stringify(
    {
      platform: result.platform ?? null,
      expectedAppId: result.expectedAppId,
      qualified: result.qualified,
      verdict: result.verdict,
      candidate: {
        path: result.candidate.path,
        verdict: result.candidate.verdict,
        appId: result.candidate.facts.appId,
        mainExecutableUuid: result.candidate.facts.mainExecutable?.uuid ?? null,
        signatureCategory: result.candidate.facts.signature.category,
        signatureVerified: result.candidate.facts.signature.verified,
        localNetworkUsageDescription: result.candidate.facts.usageDescription,
        checks: result.candidate.checks,
      },
      sources: result.sources.map((row) => ({
        role: row.role,
        path: row.path,
        verdict: row.verdict,
        appId: row.facts.appId,
        mainExecutableUuid: row.facts.mainExecutable?.uuid ?? null,
        checks: row.checks,
      })),
      duplicateMainExecutable: result.duplicateMainExecutable,
      sharedLibraries: result.sharedLibraries,
      unverifiableSources: result.unverifiableSources,
      reasons: result.reasons,
    },
    null,
    2,
  );
}

// --------------------------------------------------------------------- CLI

export function parseArgs(argv) {
  const options = {
    candidate: null,
    input: null,
    references: [],
    expectedAppId: EXPECTED_APP_ID,
    json: false,
    help: false,
    unknown: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--candidate" && value) {
      options.candidate = value;
      index += 1;
    } else if (flag === "--input" && value) {
      options.input = value;
      index += 1;
    } else if (flag === "--reference" && value) {
      options.references.push(value);
      index += 1;
    } else if (flag === "--expected-app-id" && value) {
      options.expectedAppId = value;
      index += 1;
    } else if (flag === "--json") {
      options.json = true;
    } else if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else {
      options.unknown.push(flag);
    }
  }
  return options;
}

export function main(argv, { probes = createDefaultProbes(), log = console.log, error = console.error } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(USAGE);
    return EXIT_CODE.QUALIFIED;
  }
  if (options.unknown.length > 0) {
    error(`error: unknown argument(s): ${options.unknown.join(", ")}`);
    error(USAGE);
    return EXIT_CODE.USAGE;
  }
  if (!options.candidate) {
    error("error: --candidate <path> is required.");
    error(USAGE);
    return EXIT_CODE.USAGE;
  }
  const platform = probes.platform ? probes.platform() : null;
  if (platform !== "darwin") {
    error(
      `error: executable identity probing needs macOS (host platform: ${platform ?? "unknown"}).`,
    );
    return EXIT_CODE.UNSUPPORTED_PLATFORM;
  }
  const result = verifyExecutableIdentity({
    candidate: options.candidate,
    input: options.input,
    references: options.references,
    expectedAppId: options.expectedAppId,
    probes,
  });
  if (options.json) log(toJsonReport(result));
  else log(formatReport(result));
  return result.qualified ? EXIT_CODE.QUALIFIED : EXIT_CODE.NOT_QUALIFIED;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
