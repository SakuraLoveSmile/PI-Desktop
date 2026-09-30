// Behaviour tests for the read-only macOS executable-identity verifier.
//
// Every OS interaction the verifier performs is injectable, so these tests
// drive it with synthetic bundles and with tool output captured from this
// host. Nothing here spawns `dwarfdump`, `codesign`, or `plutil`, touches a
// real bundle, or depends on the host platform.
//
// The signature fixtures use the repository's existing synthetic signing
// identity style ("Release Signer (TEAMPLUS1234)"); no real certificate label,
// e-mail address, or team identifier appears in this file. One test asserts the
// opposite direction: an authority string fed into the verifier must not reach
// its report.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_STATUS,
  EXIT_CODE,
  EXPECTED_APP_ID,
  SIGNATURE_CATEGORY,
  VERDICT,
  classifySignatureCategory,
  decideQualification,
  formatReport,
  main,
  normalizeUuid,
  parseArgs,
  parseBundleInfoPlist,
  parseCodesignVerification,
  parseDwarfdumpUuidOutput,
  toJsonReport,
  uuidsEqual,
  verifyExecutableIdentity,
} from "../../../scripts/macos-executable-identity.mjs";

// ------------------------------------------------------------------ fixtures

// Captured `dwarfdump --uuid` shape. The UUIDs are the ones this host actually
// reports for the stock Electron distribution and for the apps built from it.
const CAPTURED_MAIN_UUID = "4C4C44B6-5555-3144-A187-35A40BAD7A39";
const CAPTURED_FRAMEWORK_UUID = "4C4C44DB-5555-3144-A182-AAA89B546B03";
const INDEPENDENT_MAIN_UUID = "1111AAAA-2222-3333-4444-555566667777";

const CAPTURED_DWARFDUMP_OUTPUT = [
  `UUID: ${CAPTURED_MAIN_UUID} (arm64) /Applications/Pi-Desktop-Plus.app/Contents/MacOS/Pi-Desktop-Plus`,
  "",
].join("\n");

// Captured `codesign --verify --deep --strict` output for the stock Electron
// distribution app that the primary checkout has on disk. No certificate text.
const CAPTURED_CODESIGN_FAILURE =
  "Electron.app: code has no resources but signature indicates they must be present";

const SYNTHETIC_AUTHORITY = "Developer ID Application: Release Signer (TEAMPLUS1234)";

/**
 * Declarative bundle description. `null` means "not present / unreadable" so a
 * fixture can express every failure slice without touching the filesystem.
 */
function makeProbes(bundles) {
  const byBundle = new Map(bundles.map((bundle) => [bundle.path, bundle]));
  const binaries = new Map();
  for (const bundle of bundles) {
    if (bundle.executableName) {
      binaries.set(`${bundle.path}/Contents/MacOS/${bundle.executableName}`, {
        uuid: bundle.mainUuid,
        stdout: bundle.mainUuidText ?? null,
        status: bundle.dwarfdumpStatus ?? 0,
        stderr: bundle.dwarfdumpStderr ?? "",
      });
    }
    for (const library of bundle.libraries ?? []) {
      binaries.set(`${bundle.path}/${library.path}`, {
        uuid: library.uuid,
        status: 0,
      });
    }
  }

  const describeText = (bundle) => {
    const lines = [`Identifier=${bundle.appId ?? "unknown"}`];
    const category = bundle.signatureCategory ?? SIGNATURE_CATEGORY.DEVELOPER_ID;
    if (category === SIGNATURE_CATEGORY.DEVELOPER_ID) {
      lines.push(`Authority=${SYNTHETIC_AUTHORITY}`, "TeamIdentifier=TEAMPLUS1234");
    } else if (category === SIGNATURE_CATEGORY.APPLE_DEVELOPMENT) {
      lines.push("Authority=Apple Development: Release Signer (TEAMPLUS1234)");
    } else if (category === SIGNATURE_CATEGORY.ADHOC) {
      lines.push("Signature=adhoc");
    }
    return `${lines.join("\n")}\n`;
  };

  return {
    platform: () => "darwin",
    pathExists: (target) => byBundle.has(target) || binaries.has(target),
    readInfoPlist: (bundlePath) => {
      const bundle = byBundle.get(bundlePath);
      const plistPath = `${bundlePath}/Contents/Info.plist`;
      if (!bundle || bundle.infoPlistUnreadable) {
        return {
          plistPath,
          plutil: { status: 1, stdout: "", stderr: "unreadable" },
          xml: { ok: false, text: null, error: "ENOENT" },
        };
      }
      const plist = { CFBundleIdentifier: bundle.appId };
      if (bundle.executableName) plist.CFBundleExecutable = bundle.executableName;
      if (bundle.usageDescription !== null) {
        plist.NSLocalNetworkUsageDescription = bundle.usageDescription;
      }
      if (bundle.omitAppId) delete plist.CFBundleIdentifier;
      return {
        plistPath,
        plutil: { status: 0, stdout: JSON.stringify(plist), stderr: "" },
        xml: { ok: true, text: "", error: null },
      };
    },
    readDwarfdumpUuid: (binaryPath) => {
      const entry = binaries.get(binaryPath);
      if (!entry) {
        return { status: 1, stdout: "", stderr: "could not find specified file" };
      }
      const stdout =
        entry.stdout ??
        (entry.uuid
          ? `UUID: ${entry.uuid} (arm64) ${binaryPath}\n`
          : "could not find specified file\n");
      return {
        status: entry.uuid ? entry.status : 1,
        stdout,
        stderr: entry.stderr,
      };
    },
    verifySignature: (bundlePath) => {
      const bundle = byBundle.get(bundlePath) ?? {};
      return {
        status: bundle.signatureVerifyStatus ?? 0,
        stdout: "",
        stderr: bundle.signatureVerifyStderr ?? "",
      };
    },
    describeSignature: (bundlePath) => ({
      status: 0,
      stdout: describeText(byBundle.get(bundlePath) ?? {}),
      stderr: "",
    }),
    listNestedBinaries: (bundlePath) =>
      (byBundle.get(bundlePath)?.libraries ?? []).map(
        (library) => `${bundlePath}/${library.path}`,
      ),
  };
}

function qualifiedCandidate(overrides = {}) {
  return {
    path: "/fixtures/Pi-Desktop-Plus.app",
    appId: EXPECTED_APP_ID,
    executableName: "Pi-Desktop-Plus",
    mainUuid: INDEPENDENT_MAIN_UUID,
    usageDescription: "Reaches LAN providers.",
    signatureCategory: SIGNATURE_CATEGORY.DEVELOPER_ID,
    signatureVerifyStatus: 0,
    libraries: [],
    ...overrides,
  };
}

function electronInput(overrides = {}) {
  return {
    path: "/fixtures/Electron.app",
    appId: "com.github.Electron",
    executableName: "Electron",
    mainUuid: CAPTURED_MAIN_UUID,
    usageDescription: null,
    signatureCategory: SIGNATURE_CATEGORY.ADHOC,
    signatureVerifyStatus: 1,
    signatureVerifyStderr: CAPTURED_CODESIGN_FAILURE,
    libraries: [],
    ...overrides,
  };
}

function run(bundles, options = {}) {
  const candidate = bundles.find((bundle) => bundle.role === "candidate");
  const input = bundles.find((bundle) => bundle.role === "input");
  const references = bundles.filter((bundle) => bundle.role === "reference");
  const probes = makeProbes(bundles);
  return verifyExecutableIdentity({
    candidate: candidate.path,
    input: input ? input.path : null,
    references: references.map((bundle) => bundle.path),
    expectedAppId: options.expectedAppId ?? EXPECTED_APP_ID,
    probes,
  });
}

// ------------------------------------------------------------ pure parsers

test("parseDwarfdumpUuidOutput reads captured per-architecture UUID lines", () => {
  const parsed = parseDwarfdumpUuidOutput(CAPTURED_DWARFDUMP_OUTPUT);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].uuid, CAPTURED_MAIN_UUID);
  assert.equal(parsed.entries[0].arch, "arm64");
  assert.match(parsed.entries[0].path, /MacOS\/Pi-Desktop-Plus$/);
  assert.deepEqual(parsed.unparsed, []);
});

test("parseDwarfdumpUuidOutput splits a universal binary and records noise", () => {
  const parsed = parseDwarfdumpUuidOutput(
    [
      "UUID: 1111AAAA-2222-3333-4444-555566667777 (arm64) /tmp/App/Contents/MacOS/App",
      "UUID: 8888BBBB-9999-aaaa-bbbb-ccccddddeeee (x86_64) /tmp/App/Contents/MacOS/App",
      "could not find specified file",
    ].join("\n"),
  );
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(
    parsed.entries.map((entry) => entry.arch),
    ["arm64", "x86_64"],
  );
  assert.deepEqual(parsed.unparsed, ["could not find specified file"]);
});

test("normalizeUuid and uuidsEqual compare case-insensitively and reject junk", () => {
  assert.equal(normalizeUuid(" 4c4c44b6-5555-3144-a187-35a40bad7a39 "), CAPTURED_MAIN_UUID);
  assert.equal(normalizeUuid("not-a-uuid"), null);
  assert.equal(normalizeUuid(null), null);
  assert.equal(uuidsEqual(CAPTURED_MAIN_UUID, CAPTURED_MAIN_UUID.toLowerCase()), true);
  assert.equal(uuidsEqual(CAPTURED_MAIN_UUID, INDEPENDENT_MAIN_UUID), false);
  assert.equal(uuidsEqual(null, null), false);
});

test("parseCodesignVerification maps captured failure text to a token", () => {
  assert.deepEqual(
    parseCodesignVerification({ status: 1, stdout: "", stderr: CAPTURED_CODESIGN_FAILURE }),
    { verified: false, failure: "missing-resource-envelope" },
  );
  assert.deepEqual(
    parseCodesignVerification({
      status: 1,
      stdout: "",
      stderr: "code object is not signed at all",
    }),
    { verified: false, failure: "not-signed" },
  );
  assert.deepEqual(parseCodesignVerification({ status: 0, stdout: "", stderr: "" }), {
    verified: true,
    failure: null,
  });
  // An unavailable probe must fail closed rather than read as verified.
  assert.deepEqual(parseCodesignVerification({ status: null, stdout: "", stderr: "" }), {
    verified: false,
    failure: "probe-unavailable",
  });
});

test("classifySignatureCategory reports a category, never the authority", () => {
  const developerId = classifySignatureCategory(
    `Identifier=cn.sakura.pi-desktop\nAuthority=${SYNTHETIC_AUTHORITY}\nTeamIdentifier=TEAMPLUS1234\n`,
  );
  assert.equal(developerId, SIGNATURE_CATEGORY.DEVELOPER_ID);
  assert.equal(developerId.includes("Release Signer"), false);
  assert.equal(developerId.includes("TEAMPLUS1234"), false);

  assert.equal(
    classifySignatureCategory("Authority=Apple Development: Someone (TEAMPLUS1234)"),
    SIGNATURE_CATEGORY.APPLE_DEVELOPMENT,
  );
  assert.equal(
    classifySignatureCategory("Identifier=Electron\nSignature=adhoc\n"),
    SIGNATURE_CATEGORY.ADHOC,
  );
  assert.equal(
    classifySignatureCategory("Identifier=Something\n"),
    SIGNATURE_CATEGORY.UNSIGNED,
  );
  assert.equal(
    classifySignatureCategory("Authority=(unavailable)\nSignature=adhoc\n"),
    SIGNATURE_CATEGORY.ADHOC,
  );
});

test("parseBundleInfoPlist falls back to an XML plist when plutil is unusable", () => {
  const xml = [
    "<plist><dict>",
    "<key>CFBundleIdentifier</key><string>cn.sakura.pi-desktop</string>",
    "<key>CFBundleExecutable</key><string>Pi-Desktop-Plus</string>",
    "<key>NSLocalNetworkUsageDescription</key><string>LAN &amp; more</string>",
    "<key>NSBonjourServices</key><array><string>_http._tcp</string></array>",
    "</dict></plist>",
  ].join("");
  const parsed = parseBundleInfoPlist({
    plutil: { status: 1, stdout: "", stderr: "unavailable" },
    xml: { ok: true, text: xml, error: null },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.source, "xml-text");
  assert.equal(parsed.appId, "cn.sakura.pi-desktop");
  assert.equal(parsed.mainExecutable, "Pi-Desktop-Plus");
  assert.equal(parsed.usageDescription, "LAN & more");
});

// ------------------------------------------------------- qualification paths

test("a fully qualified independent candidate passes", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate" },
    { ...electronInput(), role: "input" },
  ]);
  assert.equal(result.verdict, VERDICT.QUALIFIED);
  assert.equal(result.qualified, true);
  assert.deepEqual(result.duplicateMainExecutable, []);
  assert.deepEqual(result.unverifiableSources, []);
  assert.equal(result.candidate.facts.mainExecutable.uuid, INDEPENDENT_MAIN_UUID);
  assert.equal(
    result.candidate.facts.signature.category,
    SIGNATURE_CATEGORY.DEVELOPER_ID,
  );
});

test("a candidate also passes with no input or reference identity supplied", () => {
  const result = run([{ ...qualifiedCandidate(), role: "candidate" }]);
  assert.equal(result.verdict, VERDICT.QUALIFIED);
  assert.equal(result.qualified, true);
  assert.equal(result.sources.length, 0);
});

test("shared library UUIDs are informational and never fail qualification", () => {
  const libraries = [
    { path: "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework", uuid: CAPTURED_FRAMEWORK_UUID },
    { path: "Contents/Frameworks/Pi-Desktop-Plus Helper.app/Contents/MacOS/Pi-Desktop-Plus Helper", uuid: "4C4C4442-5555-3144-A1D6-863380D90104" },
  ];
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", libraries },
    {
      ...electronInput(),
      role: "input",
      libraries: [
        { path: "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework", uuid: CAPTURED_FRAMEWORK_UUID },
      ],
    },
  ]);
  assert.equal(result.verdict, VERDICT.QUALIFIED);
  assert.equal(result.qualified, true);
  assert.equal(result.sharedLibraries.length, 1);
  assert.equal(result.sharedLibraries[0].uuid, CAPTURED_FRAMEWORK_UUID);
  assert.deepEqual(
    result.sharedLibraries[0].sharedWith.map((entry) => entry.role),
    ["input"],
  );
  const infoCheck = result.candidate.checks.find(
    (entry) => entry.id === "shared-library-uuids",
  );
  assert.equal(infoCheck.status, CHECK_STATUS.INFO);
  assert.deepEqual(result.duplicateMainExecutable, []);
});

test("a missing main executable UUID fails with missing-executable-uuid", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", mainUuid: null },
    { ...electronInput(), role: "input" },
  ]);
  assert.equal(result.verdict, VERDICT.MISSING_EXECUTABLE_UUID);
  assert.equal(result.qualified, false);
  const failed = result.candidate.checks.find(
    (entry) => entry.id === "main-executable-uuid",
  );
  assert.equal(failed.status, CHECK_STATUS.FAIL);
});

test("an unreadable Info.plist fails with missing-bundle", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", infoPlistUnreadable: true },
  ]);
  assert.equal(result.verdict, VERDICT.MISSING_BUNDLE);
  assert.equal(result.qualified, false);
});

test("a wrong application identifier fails with wrong-application-id", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", appId: "net.aiuo.pi-desktop" },
    { ...electronInput(), role: "input" },
  ]);
  assert.equal(result.verdict, VERDICT.WRONG_APPLICATION_ID);
  assert.equal(result.qualified, false);
  const failed = result.candidate.checks.find(
    (entry) => entry.id === "application-id",
  );
  assert.equal(failed.status, CHECK_STATUS.FAIL);
});

test("a missing application identifier fails with wrong-application-id", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", appId: null, omitAppId: true },
  ]);
  assert.equal(result.verdict, VERDICT.WRONG_APPLICATION_ID);
});

test("a candidate colliding with the Electron input fails with duplicate-main-executable-uuid", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", mainUuid: CAPTURED_MAIN_UUID },
    { ...electronInput(), role: "input" },
  ]);
  assert.equal(result.verdict, VERDICT.DUPLICATE_MAIN_EXECUTABLE_UUID);
  assert.equal(result.qualified, false);
  assert.equal(result.duplicateMainExecutable.length, 1);
  assert.equal(result.duplicateMainExecutable[0].role, "input");
  assert.equal(result.duplicateMainExecutable[0].uuid, CAPTURED_MAIN_UUID);
});

test("a candidate colliding with a supplied reference fails with duplicate-main-executable-uuid", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", mainUuid: CAPTURED_MAIN_UUID },
    { ...electronInput(), role: "input", mainUuid: INDEPENDENT_MAIN_UUID },
    {
      ...electronInput({
        path: "/Applications/PI-Desktop.app",
        appId: "net.aiuo.pi-desktop",
        mainUuid: CAPTURED_MAIN_UUID,
        signatureVerifyStatus: 0,
        signatureVerifyStderr: "",
      }),
      role: "reference",
    },
  ]);
  assert.equal(result.verdict, VERDICT.DUPLICATE_MAIN_EXECUTABLE_UUID);
  assert.equal(result.qualified, false);
  assert.deepEqual(
    result.duplicateMainExecutable.map((entry) => entry.role),
    ["reference"],
  );
});

test("a candidate whose main executable UUID collides case-insensitively still fails", () => {
  const result = run([
    {
      ...qualifiedCandidate(),
      role: "candidate",
      mainUuid: CAPTURED_MAIN_UUID.toLowerCase(),
    },
    { ...electronInput(), role: "input" },
  ]);
  assert.equal(result.verdict, VERDICT.DUPLICATE_MAIN_EXECUTABLE_UUID);
});

test("a bundle without a signature fails with missing-signature", () => {
  const result = run([
    {
      ...qualifiedCandidate(),
      role: "candidate",
      signatureCategory: SIGNATURE_CATEGORY.UNSIGNED,
    },
  ]);
  assert.equal(result.verdict, VERDICT.MISSING_SIGNATURE);
  assert.equal(result.qualified, false);
  assert.equal(result.candidate.facts.signature.present, false);
});

test("a present but failing signature fails with signature-verification-failed", () => {
  const result = run([
    {
      ...qualifiedCandidate(),
      role: "candidate",
      signatureVerifyStatus: 1,
      signatureVerifyStderr: CAPTURED_CODESIGN_FAILURE,
    },
  ]);
  assert.equal(result.verdict, VERDICT.SIGNATURE_VERIFICATION_FAILED);
  assert.equal(result.qualified, false);
  assert.equal(
    result.candidate.facts.signature.failure,
    "missing-resource-envelope",
  );
});

test("a missing NSLocalNetworkUsageDescription fails", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", usageDescription: null },
  ]);
  assert.equal(result.verdict, VERDICT.MISSING_LOCAL_NETWORK_USAGE_DESCRIPTION);
  assert.equal(result.qualified, false);
  assert.equal(result.candidate.facts.usageDescription.present, false);
});

test("an unreadable supplied identity makes independence unprovable", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate" },
    { ...electronInput(), role: "input", mainUuid: null },
  ]);
  assert.equal(result.verdict, VERDICT.UNVERIFIABLE_SOURCE_IDENTITY);
  assert.equal(result.qualified, false);
  assert.equal(result.unverifiableSources.length, 1);
  assert.equal(result.unverifiableSources[0].role, "input");
});

test("failure precedence is stable when several checks fail at once", () => {
  const result = run([
    {
      ...qualifiedCandidate(),
      role: "candidate",
      appId: "wrong.app.id",
      mainUuid: null,
      usageDescription: null,
      signatureCategory: SIGNATURE_CATEGORY.UNSIGNED,
    },
  ]);
  assert.equal(result.verdict, VERDICT.MISSING_EXECUTABLE_UUID);
});

test("decideQualification works from plain facts without any probes", () => {
  const facts = {
    bundlePath: "/facts/App.app",
    exists: true,
    infoPlist: { ok: true, source: "plutil-json", path: "/facts/App.app/Contents/Info.plist" },
    appId: EXPECTED_APP_ID,
    usageDescription: { present: true, characters: 12 },
    mainExecutable: {
      path: "/facts/App.app/Contents/MacOS/App",
      uuid: INDEPENDENT_MAIN_UUID,
      arch: "arm64",
      slices: [],
      probe: { status: 0, unavailable: false, unparsed: 0 },
    },
    signature: {
      verified: true,
      failure: null,
      category: SIGNATURE_CATEGORY.APPLE_DEVELOPMENT,
      present: true,
    },
    libraryUuids: [],
  };
  const result = decideQualification({
    candidate: { facts },
    sources: [],
    expectedAppId: EXPECTED_APP_ID,
  });
  assert.equal(result.verdict, VERDICT.QUALIFIED);
  assert.equal(result.qualified, true);
});

// ------------------------------------------------------------------ reporting

test("the report contains no certificate label, e-mail, or team identifier", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate" },
    { ...electronInput(), role: "input" },
    {
      ...electronInput({
        path: "/Applications/PI-Desktop.app",
        appId: "net.aiuo.pi-desktop",
        signatureVerifyStatus: 0,
        signatureVerifyStderr: "",
      }),
      role: "reference",
    },
  ]);
  const text = `${formatReport(result)}\n${toJsonReport(result)}`;
  assert.equal(text.includes("Release Signer"), false);
  assert.equal(text.includes("TEAMPLUS1234"), false);
  assert.equal(text.includes("Authority="), false);
  assert.equal(text.includes("@"), false);
  assert.match(text, /qualified independent identity: yes/);
  assert.match(text, /developer-id/);
});

test("the report prints a per-slice verdict table with the failing verdict", () => {
  const result = run([
    { ...qualifiedCandidate(), role: "candidate", mainUuid: CAPTURED_MAIN_UUID },
    { ...electronInput(), role: "input" },
  ]);
  const report = formatReport(result);
  assert.match(report, /slice/);
  assert.match(report, /duplicate-main-executable-uuid/);
  assert.match(report, /identity-source/);
  assert.match(report, /qualified independent identity: no/);
  const json = JSON.parse(toJsonReport(result));
  assert.equal(json.qualified, false);
  assert.equal(json.verdict, VERDICT.DUPLICATE_MAIN_EXECUTABLE_UUID);
  assert.equal(json.candidate.signatureCategory, SIGNATURE_CATEGORY.DEVELOPER_ID);
  assert.equal(json.sources[0].role, "input");
});

// ----------------------------------------------------------------------- CLI

test("parseArgs collects candidate, input, references and overrides", () => {
  const options = parseArgs([
    "--candidate",
    "/a/Candidate.app",
    "--input",
    "/a/Electron.app",
    "--reference",
    "/a/Official.app",
    "--reference",
    "/b/Other.app",
    "--expected-app-id",
    "cn.sakura.pi-desktop.dev",
    "--json",
  ]);
  assert.equal(options.candidate, "/a/Candidate.app");
  assert.equal(options.input, "/a/Electron.app");
  assert.deepEqual(options.references, ["/a/Official.app", "/b/Other.app"]);
  assert.equal(options.expectedAppId, "cn.sakura.pi-desktop.dev");
  assert.equal(options.json, true);
  assert.deepEqual(options.unknown, []);
});

test("the CLI exits 0 only for a qualified independent identity", () => {
  const lines = [];
  const errors = [];
  const io = { log: (line) => lines.push(line), error: (line) => errors.push(line) };

  const qualified = main(
    ["--candidate", "/fixtures/Pi-Desktop-Plus.app", "--input", "/fixtures/Electron.app"],
    {
      probes: makeProbes([
        { ...qualifiedCandidate(), role: "candidate" },
        { ...electronInput(), role: "input" },
      ]),
      ...io,
    },
  );
  assert.equal(qualified, EXIT_CODE.QUALIFIED);
  assert.deepEqual(errors, []);

  const duplicate = main(
    ["--candidate", "/fixtures/Pi-Desktop-Plus.app", "--input", "/fixtures/Electron.app"],
    {
      probes: makeProbes([
        { ...qualifiedCandidate(), role: "candidate", mainUuid: CAPTURED_MAIN_UUID },
        { ...electronInput(), role: "input" },
      ]),
      ...io,
    },
  );
  assert.equal(duplicate, EXIT_CODE.NOT_QUALIFIED);
  assert.match(lines.join("\n"), /duplicate-main-executable-uuid/);
});

test("the CLI rejects bad usage and non-macOS hosts", () => {
  const lines = [];
  const errors = [];
  const io = { log: (line) => lines.push(line), error: (line) => errors.push(line) };

  assert.equal(main([], io), EXIT_CODE.USAGE);
  assert.equal(main(["--nope"], io), EXIT_CODE.USAGE);
  assert.equal(
    main(["--candidate", "/x/App.app"], {
      probes: { ...makeProbes([]), platform: () => "linux" },
      ...io,
    }),
    EXIT_CODE.UNSUPPORTED_PLATFORM,
  );
  assert.match(errors.join("\n"), /--candidate <path> is required/);
  assert.match(errors.join("\n"), /needs macOS/);

  const help = [];
  assert.equal(main(["--help"], { log: (line) => help.push(line), error: () => {} }), EXIT_CODE.QUALIFIED);
  assert.match(help.join("\n"), /--candidate <path>/);
});
