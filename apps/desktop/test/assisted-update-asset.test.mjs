import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { selectAssistedAsset, isAllowedAssetUrl, assistedAssetName } = await import(
  "../electron/main/assisted-update/release-asset.ts"
);
const { evaluateAssistedEligibility, bundlePathFromExecutable } = await import(
  "../electron/main/assisted-update/eligibility.ts"
);

const SHA = `${"A".repeat(86)}==`;
const NAME = "Pi-Desktop-Plus-0.16.1-arm64-mac.zip";
const feed = (files, version = "0.16.1") => ({ version, files });
const file = (url, extra = {}) => ({ url, sha512: SHA, size: 150_000_000, ...extra });

test("the asset is the exact arm64 ZIP, with its URL rebuilt from the fixed repository", () => {
  assert.equal(assistedAssetName("0.16.1", "arm64"), NAME);
  const asset = selectAssistedAsset(
    feed([file("Pi-Desktop-Plus-0.16.1-arm64.dmg"), file(NAME), file(`${NAME}.blockmap`)]),
    "arm64",
  );
  assert.deepEqual(asset, {
    version: "0.16.1",
    name: NAME,
    url: `https://github.com/SakuraLoveSmile/PI-Desktop/releases/download/v0.16.1/${NAME}`,
    sha512: SHA,
    size: 150_000_000,
  });
});

test("a feed URL for the ZIP never becomes the download URL", () => {
  const asset = selectAssistedAsset(
    feed([file(`https://evil.example/download/${NAME}`)]),
    "arm64",
  );
  assert.equal(new URL(asset.url).hostname, "github.com");
  assert.ok(asset.url.endsWith(`/v0.16.1/${NAME}`));
});

test("the lane refuses what it cannot verify", () => {
  const cases = [
    ["no ZIP listed", feed([file("Pi-Desktop-Plus-0.16.1-arm64.dmg")]), "asset-missing"],
    ["wrong architecture", feed([file("Pi-Desktop-Plus-0.16.1-x64-mac.zip")]), "asset-missing"],
    ["ZIP of another version", feed([file("Pi-Desktop-Plus-0.16.0-arm64-mac.zip")]), "asset-missing"],
    ["listed twice", feed([file(NAME), file(NAME)]), "asset-missing"],
    ["prerelease", feed([file(NAME)], "0.16.1-rc.1"), "asset-missing"],
    ["no version", { files: [file(NAME)] }, "asset-missing"],
    ["no files", { version: "0.16.1" }, "asset-missing"],
    ["no hash", feed([{ url: NAME, size: 5 }]), "asset-integrity"],
    ["hex hash", feed([file(NAME, { sha512: "ab".repeat(64) })]), "asset-integrity"],
    ["no size", feed([{ url: NAME, sha512: SHA }]), "asset-integrity"],
    ["zero size", feed([file(NAME, { size: 0 })]), "asset-integrity"],
    ["fractional size", feed([file(NAME, { size: 1.5 })]), "asset-integrity"],
    ["negative size", feed([file(NAME, { size: -3 })]), "asset-integrity"],
    ["over the 1 GiB cap", feed([file(NAME, { size: 1024 ** 3 + 1 })]), "asset-integrity"],
  ];
  for (const [label, info, code] of cases) {
    assert.throws(() => selectAssistedAsset(info, "arm64"), { code }, label);
  }
});

test("only GitHub's HTTPS asset hosts are allowed, without credentials or odd ports", () => {
  const allowed = [
    "https://github.com/SakuraLoveSmile/PI-Desktop/releases/download/v1/a.zip",
    "https://release-assets.githubusercontent.com/github-production-release-asset/1",
    "https://objects.githubusercontent.com/x",
    "https://github-releases.githubusercontent.com/x",
    "https://github.com:443/x",
  ];
  const refused = [
    "http://github.com/x",
    "https://evil.example/x",
    "https://github.com.evil.example/x",
    "https://githubusercontent.com/x",
    "https://user:pw@github.com/x",
    "https://github.com:8443/x",
    "ftp://github.com/x",
    "file:///etc/passwd",
    "not a url",
    "",
  ];
  for (const url of allowed) assert.equal(isAllowedAssetUrl(url), true, url);
  for (const url of refused) assert.equal(isAllowedAssetUrl(url), false, url);
});

const baseInput = {
  platform: "darwin",
  arch: "arm64",
  isPackaged: true,
  macSigning: "adhoc",
  execPath: "/Applications/Pi-Desktop-Plus.app/Contents/MacOS/Pi-Desktop-Plus",
};
const okFs = { realpath: (p) => p, access: () => {} };
const errno = (code) => Object.assign(new Error(code), { code });

test("an ad-hoc arm64 app in a writable folder is eligible", () => {
  assert.deepEqual(evaluateAssistedEligibility(baseInput, okFs), {
    eligible: true,
    bundlePath: "/Applications/Pi-Desktop-Plus.app",
    installDir: "/Applications",
  });
});

test("builds outside the lane are not applicable and carry no reason", () => {
  const others = [
    { platform: "win32" },
    { platform: "linux" },
    { isPackaged: false },
    { macSigning: "developer-id" },
    { macSigning: "unknown" },
    { macSigning: undefined },
    { arch: "x64" },
    { execPath: "/opt/homebrew/bin/node" },
    { execPath: "/Applications/Pi.app/Contents/Resources/Pi" },
    { execPath: "/Applications/.app/Contents/MacOS/Pi" },
  ];
  for (const override of others) {
    assert.deepEqual(
      evaluateAssistedEligibility({ ...baseInput, ...override }, okFs),
      { eligible: false },
      JSON.stringify(override),
    );
  }
});

test("a fixable location says why the lane cannot be used", () => {
  const translocated = evaluateAssistedEligibility(
    {
      ...baseInput,
      execPath:
        "/private/var/folders/ab/T/AppTranslocation/0F/d/Pi-Desktop-Plus.app/Contents/MacOS/Pi-Desktop-Plus",
    },
    okFs,
  );
  assert.deepEqual(translocated, { eligible: false, reason: "translocated" });

  const symlinked = evaluateAssistedEligibility(baseInput, {
    ...okFs,
    realpath: () => "/Volumes/Data/Apps/Pi-Desktop-Plus.app",
  });
  assert.deepEqual(symlinked, { eligible: false, reason: "symlink" });

  const readOnly = evaluateAssistedEligibility(baseInput, {
    ...okFs,
    access: () => {
      throw errno("EROFS");
    },
  });
  assert.deepEqual(readOnly, { eligible: false, reason: "read-only" });

  const bundleWritableOnly = evaluateAssistedEligibility(baseInput, {
    ...okFs,
    access: (path) => {
      if (path === "/Applications") throw errno("EACCES");
    },
  });
  assert.deepEqual(bundleWritableOnly, { eligible: false, reason: "not-writable" });

  const vanished = evaluateAssistedEligibility(baseInput, {
    ...okFs,
    realpath: () => {
      throw errno("ENOENT");
    },
  });
  assert.deepEqual(vanished, { eligible: false, reason: "not-writable" });
});

test("the bundle is derived only from a Contents/MacOS executable", () => {
  assert.equal(
    bundlePathFromExecutable("/Users/me/Applications/Pi-Desktop-Plus.app/Contents/MacOS/Pi-Desktop-Plus"),
    "/Users/me/Applications/Pi-Desktop-Plus.app",
  );
  assert.equal(bundlePathFromExecutable("/usr/local/bin/node"), null);
  assert.equal(bundlePathFromExecutable("/Applications/Pi.app/Contents/Frameworks/Helper"), null);
});
