import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releasePreflight, parseReleaseVersion } from "./release-preflight.mjs";

function fixture(t, version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "pi-release-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  writeFileSync(join(root, "baseline"), "baseline\n"); git("add", "."); git("commit", "-m", "baseline");
  for (const file of ["package.json", "docs/package.json", "apps/desktop/package.json", "apps/pi-host/package.json"]) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), JSON.stringify({ version }));
  }
  mkdirSync(join(root, "packages/shared/src"), { recursive: true });
  writeFileSync(join(root, "packages/shared/src/protocol.ts"), `export const APP_VERSION = "${version}";\n`);
  writeFileSync(join(root, "Cargo.toml"), `[workspace.package]\nversion = "${version}"\n`);
  writeFileSync(join(root, "Cargo.lock"), `name = "host-core"\nversion = "${version}"\n`);
  git("add", "."); git("commit", "-m", "release metadata");
  const sourceSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", sourceSha);
  git("tag", "-a", `v${version}`, "-m", "fixture release");
  const env = Object.fromEntries(["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID", "MAC_SIGNING_IDENTITY"].map(name => [name, "fixture"]));
  const options = { root, eventName: "push", ref: `refs/tags/v${version}`, sourceSha, env };
  return { root, git, options };
}

test("manual candidates pin their checkout and do not require signing secrets", t => {
  const { options, git } = fixture(t);
  const result = releasePreflight({ ...options, eventName: "workflow_dispatch", ref: "refs/heads/main", env: {} });
  assert.equal(result.kind, "candidate");
  assert.equal(result.source_sha, options.sourceSha);
  assert.equal(result.base_sha, git("rev-parse", "HEAD^"));
  assert.equal(result.signed_macos, "false");
  assert.equal(result.channel, "latest");
});

test("formal releases require main membership and signing even if input is false", t => {
  const { options, git } = fixture(t);
  assert.equal(releasePreflight(options).signed_macos, "true");
  assert.throws(() => releasePreflight({ ...options, env: {} }), /Missing GitHub Actions macOS signing secrets: CSC_LINK/);
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD^"));
  assert.throws(() => releasePreflight(options), /already be merged/);
});

test("wrong tag, wrong checkout and inconsistent version surfaces are refused", t => {
  const { options, root, git } = fixture(t);
  assert.throws(() => releasePreflight({ ...options, ref: "refs/tags/v9.9.9" }), /exactly match/);
  assert.throws(() => releasePreflight({ ...options, sourceSha: git("rev-parse", "HEAD^") }), /Checkout does not match/);
  writeFileSync(join(root, "apps/pi-host/package.json"), JSON.stringify({ version: "1.2.2" }));
  assert.throws(() => releasePreflight(options), /apps\/pi-host\/package.json/);
});

test("prereleases use a separate safe channel and stable release-document version", t => {
  const { options } = fixture(t, "1.2.3-beta.2");
  const result = releasePreflight(options);
  assert.equal(result.prerelease, "true");
  assert.equal(result.channel, "beta");
  assert.equal(result.document_version, "1.2.3");
  for (const version of ["1.2.3-latest.1", "1.2.3-stable.1", "1.2.3-123", "1.2.3-RC.1", "01.2.3", "1.2.3-beta.01"]) {
    assert.throws(() => parseReleaseVersion(version));
  }
});

test("signed candidates and malformed manual metadata fail before builds", t => {
  const { options } = fixture(t);
  assert.throws(() => releasePreflight({ ...options, eventName: "workflow_dispatch", signMacos: "true", env: {} }), /Missing/);
  assert.throws(() => releasePreflight({ ...options, sourceSha: "HEAD" }), /full commit SHA/);
  assert.throws(() => releasePreflight({ ...options, eventName: "pull_request" }), /only accepts/);
  assert.throws(() => releasePreflight({ ...options, signMacos: "yes" }), /true or false/);
});
