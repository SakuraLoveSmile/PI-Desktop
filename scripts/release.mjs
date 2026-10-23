#!/usr/bin/env node
/**
 * Prepare version files for a release PR, or tag an already merged version.
 *
 * node scripts/release.mjs <version>       # prepare files; commit and merge by PR
 * node scripts/release.mjs <version> --tag # annotate exact HEAD already in main
 *
 * Installers are built only by .github/workflows/release.yml. This command never
 * builds, publishes, or pushes. --tag never bumps or commits files, and remote
 * verification failures block tagging. --skip-docs-check is preparation-only.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseReleaseVersion } from "./release-preflight.mjs";
import { createReleaseTag } from "./release-git.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
const doTag = process.argv.includes("--tag");
const skipDocsCheck = process.argv.includes("--skip-docs-check");
let parsed;
try {
  parsed = parseReleaseVersion(version);
  if (process.argv.slice(3).some((arg) => !["--tag", "--skip-docs-check"].includes(arg))) {
    throw new Error("Unknown release option.");
  }
  if (doTag && skipDocsCheck) throw new Error("--skip-docs-check is preparation-only and cannot be used with --tag.");
} catch (error) {
  console.error(error.message);
  console.error("Usage: node scripts/release.mjs <version> [--tag | --skip-docs-check]");
  process.exit(1);
}

function checkDocumentation() {
  execFileSync(process.execPath, [path.join(root, "scripts/check-release-docs.mjs"), parsed.stableVersion], {
    cwd: root, stdio: "inherit",
  });
}

if (doTag) {
  try {
    checkDocumentation();
    const { tag, source } = createReleaseTag(root, version);
    console.log(`Tagged main commit ${source} as ${tag}. Start the cloud release with:\n  git push origin ${tag}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
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
// `docs` is a third workspace root (pnpm-workspace.yaml), not under apps/packages.
bumpPackageJson("docs/package.json");
// `packages/*` are left alone: they keep the version of the upstream tree they
// were synced from, so a sync merge never conflicts on them (ADR plus-version-line).
for (const dir of readdirSync(path.join(root, "apps"), { withFileTypes: true })) {
  if (dir.isDirectory()) bumpPackageJson(path.join("apps", dir.name, "package.json"));
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
} else {
  console.log(`Bumped to ${version}:\n  ${changed.join("\n  ")}`);
}

// Preparation is reversible. The same stable-document gate also validates
// prerelease version surfaces through check-release-docs' preview support.
if (!skipDocsCheck) {
  try {
    checkDocumentation();
  } catch {
    console.error("\nRelease documentation check failed. Complete the version preparation before opening its PR.");
    process.exit(1);
  }
}

console.log(`
Next steps:
  1. Commit the version files and release notes on a request branch.
  2. Merge that PR into main after its cloud checks pass.
  3. Check out the exact merged commit in a clean worktree.
  4. Run node scripts/release.mjs ${version} --tag
  5. Push only v${version}; GitHub Actions builds, verifies and publishes it.
See docs/spec/06-delivery/06-release-runbook.md.`);
