#!/usr/bin/env node
/**
 * Bump the workspace version everywhere and (optionally) create the release tag.
 *
 * Usage:
 *   node scripts/release.mjs <version>          # bump files only
 *   node scripts/release.mjs <version> --tag    # bump + commit (only bumped files) + tag v<version>
 *
 * BEFORE running this for a stable release: update the dual-locale in-app
 * product changelog in packages/shared/src/changelog.ts (EN + zh-CN entries
 * for <version>, matching highlight counts). Required by D164 and
 * docs/spec/06-delivery/06-release-runbook.md section 4.1. GitHub auto-generated
 * release bodies are web-only and are not a substitute.
 *
 * Pushing the tag triggers .github/workflows/release.yml, which builds the
 * macOS / Windows / Linux installers and publishes them to a GitHub Release:
 *
 *   git push origin <branch> v<version>
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
const doTag = process.argv.includes("--tag");

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error("Usage: node scripts/release.mjs <version> [--tag]   e.g. 0.2.0 or 0.2.0-beta.1");
  process.exit(1);
}

const changed = [];

function bumpPackageJson(relPath) {
  const file = path.join(root, relPath);
  if (!existsSync(file)) return;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (pkg.version === version) return;
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  changed.push(relPath);
}

bumpPackageJson("package.json");
for (const group of ["apps", "packages"]) {
  for (const dir of readdirSync(path.join(root, group), { withFileTypes: true })) {
    if (dir.isDirectory()) bumpPackageJson(path.join(group, dir.name, "package.json"));
  }
}

// Cargo workspace version ([workspace.package] in root Cargo.toml), lockfile
// entry, and the APP_VERSION constant surfaced in the About panel.
for (const [relPath, pattern] of [
  ["Cargo.toml", /(\[workspace\.package\][\s\S]*?\bversion = ")[^"]+(")/],
  ["Cargo.lock", /(name = "host-core"\nversion = ")[^"]+(")/],
  ["packages/shared/src/protocol.ts", /(export const APP_VERSION = ")[^"]+(")/],
]) {
  const file = path.join(root, relPath);
  const source = readFileSync(file, "utf8");
  const updated = source.replace(pattern, `$1${version}$2`);
  if (updated === source) continue;
  writeFileSync(file, updated);
  changed.push(relPath);
}

if (changed.length === 0) {
  console.log(`Everything is already at ${version}; nothing to do.`);
  process.exit(0);
}
console.log(`Bumped to ${version}:\n  ${changed.join("\n  ")}`);

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const tag = `v${version}`;
const branch = git("rev-parse", "--abbrev-ref", "HEAD");

if (doTag) {
  if (git("tag", "--list", tag)) {
    console.error(`Tag ${tag} already exists.`);
    process.exit(1);
  }
  // Pathspec commit: only the bumped files, so unrelated staged work stays untouched.
  git("commit", "-m", `chore(release): ${tag}`, "--", ...changed);
  git("tag", tag);
  console.log(`\nCommitted and tagged ${tag}. Publish with:\n  git push origin ${branch} ${tag}`);
} else {
  console.log(`\nNext steps:\n  git commit -m "chore(release): ${tag}" -- ${changed.join(" ")}\n  git tag ${tag}\n  git push origin ${branch} ${tag}`);
}
