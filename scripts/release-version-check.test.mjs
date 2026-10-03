import assert from "node:assert/strict";
import test from "node:test";
import {
  isUpstreamTrackedPackage,
  resolveReleaseDocumentCheck,
  workspaceVersionFailures,
} from "./release-version-check.mjs";

test("checks a stable release against one aligned version", () => {
  assert.deepEqual(resolveReleaseDocumentCheck("0.15.2", "0.15.2"), {
    documentVersion: "0.15.2",
    surfaceVersion: "0.15.2",
    isPrereleasePreview: false,
  });
});

test("checks a prerelease preview against its stable documentation version", () => {
  assert.deepEqual(resolveReleaseDocumentCheck("0.15.2-beta.2", "0.15.2"), {
    documentVersion: "0.15.2",
    surfaceVersion: "0.15.2-beta.2",
    isPrereleasePreview: true,
  });
});

test("does not hide a mismatched requested version", () => {
  assert.deepEqual(resolveReleaseDocumentCheck("0.15.2-beta.2", "0.15.1"), {
    documentVersion: "0.15.1",
    surfaceVersion: "0.15.1",
    isPrereleasePreview: false,
  });
});

const manifest = (relPath, version) => ({ relPath, version });

test("only packages/* are upstream-tracked, on either path separator", () => {
  assert.equal(isUpstreamTrackedPackage("packages/shared/package.json"), true);
  assert.equal(isUpstreamTrackedPackage("packages\\shared\\package.json"), true);
  for (const relPath of ["package.json", "docs/package.json", "apps/desktop/package.json"]) {
    assert.equal(isUpstreamTrackedPackage(relPath), false, relPath);
  }
});

test("app surfaces carry the release version while packages/* keep the upstream one", () => {
  const manifests = [
    manifest("package.json", "0.15.8"),
    manifest("docs/package.json", "0.15.8"),
    manifest("apps/desktop/package.json", "0.15.8"),
    manifest("packages/shared/package.json", "0.15.10"),
    manifest("packages/i18n/package.json", "0.15.10"),
  ];
  assert.deepEqual(workspaceVersionFailures(manifests, "0.15.8"), []);
});

test("a release version in every manifest is accepted too", () => {
  const manifests = [
    manifest("package.json", "0.16.0"),
    manifest("apps/desktop/package.json", "0.16.0"),
    manifest("packages/shared/package.json", "0.16.0"),
  ];
  assert.deepEqual(workspaceVersionFailures(manifests, "0.16.0"), []);
});

test("an app manifest off the release version is reported", () => {
  const failures = workspaceVersionFailures(
    [
      manifest("package.json", "0.15.8"),
      manifest("docs/package.json", "0.15.7"),
      manifest("apps/pi-host/package.json", "0.15.10"),
      manifest("packages/shared/package.json", "0.15.10"),
    ],
    "0.15.8",
  );
  assert.deepEqual(
    failures.map((failure) => failure.relPath),
    ["docs/package.json", "apps/pi-host/package.json"],
  );
  assert.match(failures[0].message, /0\.15\.7.*0\.15\.8/);
});

test("the odd packages/* manifest out is the one reported", () => {
  const failures = workspaceVersionFailures(
    [
      manifest("package.json", "0.15.8"),
      manifest("packages/shared/package.json", "0.15.10"),
      manifest("packages/i18n/package.json", "0.15.7"),
      manifest("packages/racp/package.json", "0.15.10"),
    ],
    "0.15.8",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].relPath, "packages/i18n/package.json");
  assert.match(failures[0].message, /0\.15\.7.*0\.15\.10/);
});

test("a packages/* split without a majority reports a deterministic side", () => {
  const manifests = [
    manifest("packages/a/package.json", "0.15.7"),
    manifest("packages/b/package.json", "0.15.10"),
  ];
  const failures = workspaceVersionFailures(manifests, "0.15.8");
  assert.deepEqual(failures, workspaceVersionFailures([...manifests].reverse(), "0.15.8"));
  assert.equal(failures.length, 1);
});

test("backslash packages/* paths are checked as libraries, not app surfaces", () => {
  const failures = workspaceVersionFailures(
    [
      manifest("packages\\shared\\package.json", "0.15.10"),
      manifest("packages\\i18n\\package.json", "0.15.10"),
    ],
    "0.15.8",
  );
  assert.deepEqual(failures, []);
});

test("a manifest without a version is reported instead of ignored", () => {
  const failures = workspaceVersionFailures(
    [
      manifest("apps/desktop/package.json", undefined),
      manifest("packages/shared/package.json", "0.15.10"),
      manifest("packages/i18n/package.json", undefined),
      manifest("packages/racp/package.json", "0.15.10"),
    ],
    "0.15.8",
  );
  assert.deepEqual(
    failures.map((failure) => failure.relPath),
    ["apps/desktop/package.json", "packages/i18n/package.json"],
  );
});
