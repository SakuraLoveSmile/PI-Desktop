import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReleaseTag } from "./release-git.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-release-tag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, "checkout");
  const remote = join(root, "origin.git");
  mkdirSync(work);
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c",
    "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--bare", "--initial-branch=main", remote);
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  mkdirSync(join(work, "apps", "desktop"), { recursive: true });
  writeFileSync(join(work, "apps", "desktop", "package.json"), '{"version":"1.2.3"}\n');
  git("add", ".");
  git("commit", "-qm", "Version preparation");
  git("remote", "add", "origin", remote);
  git("push", "-qu", "origin", "main");
  return { root, work, remote, git };
}

test("a release tag identifies an exact main commit and is annotated", (t) => {
  const { work, git } = fixture(t);
  git("checkout", "--detach", "-q");
  const head = git("rev-parse", "HEAD");
  assert.deepEqual(createReleaseTag(work, "1.2.3"), { tag: "v1.2.3", source: head });
  assert.equal(git("cat-file", "-t", "v1.2.3"), "tag");
  assert.equal(git("rev-parse", "v1.2.3^{}"), head);
  assert.equal(git("ls-remote", "--tags", "origin"), "");
});

test("unmerged code cannot receive a release tag", (t) => {
  const { work, git } = fixture(t);
  git("checkout", "-qb", "codex/unmerged");
  writeFileSync(join(work, "unmerged.txt"), "candidate");
  git("add", ".");
  git("commit", "-qm", "Unmerged change");
  assert.throws(() => createReleaseTag(work, "1.2.3"), /not been merged/);
  assert.equal(git("tag", "--list"), "");
});

test("a dirty tracked file and mismatched version are refused without a commit", (t) => {
  const { work, git } = fixture(t);
  const head = git("rev-parse", "HEAD");
  assert.throws(() => createReleaseTag(work, "2.0.0"), /Merge version preparation/);
  writeFileSync(join(work, "apps", "desktop", "package.json"), '{"version":"1.2.4"}\n');
  assert.throws(() => createReleaseTag(work, "1.2.4"), /tracked changes/);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("tag", "--list"), "");
});

test("a remote-only tag cannot be replaced", (t) => {
  const { work, git } = fixture(t);
  git("tag", "v1.2.3");
  git("push", "-q", "origin", "v1.2.3");
  git("tag", "-d", "v1.2.3");
  assert.throws(() => createReleaseTag(work, "1.2.3"), /already exists on origin/);
  assert.equal(git("tag", "--list"), "");
});

test("unavailable remote fails closed", (t) => {
  const { root, work, git } = fixture(t);
  git("remote", "set-url", "origin", join(root, "missing-origin.git"));
  assert.throws(() => createReleaseTag(work, "1.2.3"), /Cannot fetch origin\/main/);
  assert.equal(git("tag", "--list"), "");
});
