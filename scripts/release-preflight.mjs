#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const signingSecrets = [
  "CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID", "MAC_SIGNING_IDENTITY",
];

export function parseReleaseVersion(version) {
  const found = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!found) throw new Error(`Invalid release version: ${version}`);
  const identifiers = found[4]?.split(".") ?? [];
  if (identifiers.some(value => /^\d+$/.test(value) && value.length > 1 && value.startsWith("0"))) {
    throw new Error("Numeric prerelease identifiers must not have leading zeroes");
  }
  const channel = identifiers[0] ?? "latest";
  if (!/^[a-z][a-z0-9-]*$/.test(channel) || (identifiers.length > 0 && ["latest", "stable"].includes(channel))) {
    throw new Error("A prerelease must use a safe lowercase channel such as alpha, beta or rc");
  }
  return { version, stableVersion: found.slice(1, 4).join("."), channel, prerelease: identifiers.length > 0 };
}

function versionSurfaces(root, expected) {
  const manifests = ["package.json", "docs/package.json"];
  for (const item of readdirSync(join(root, "apps"), { withFileTypes: true })) {
    const relative = `apps/${item.name}/package.json`;
    if (item.isDirectory() && existsSync(join(root, relative))) manifests.push(relative);
  }
  const mismatches = manifests.filter(file => JSON.parse(readFileSync(join(root, file), "utf8")).version !== expected);
  for (const [file, pattern] of [
    ["Cargo.toml", /\[workspace\.package\][\s\S]*?\bversion = "([^"]+)"/],
    ["Cargo.lock", /name = "host-core"\nversion = "([^"]+)"/],
    ["packages/shared/src/protocol.ts", /export const APP_VERSION = "([^"]+)"/],
  ]) {
    if (readFileSync(join(root, file), "utf8").match(pattern)?.[1] !== expected) mismatches.push(file);
  }
  if (mismatches.length) throw new Error(`Release version surfaces disagree with ${expected}: ${mismatches.join(", ")}`);
}

export function releasePreflight({ root, eventName, ref, sourceSha, signMacos = "false", env = process.env }) {
  if (!["push", "workflow_dispatch"].includes(eventName)) throw new Error("Release only accepts a tag push or manual candidate build");
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) throw new Error("The candidate must identify a full commit SHA");
  if (!["true", "false"].includes(String(signMacos))) throw new Error("sign_macos must be true or false");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const resolved = git("rev-parse", "--verify", `${sourceSha}^{commit}`);
  if (resolved !== sourceSha || git("rev-parse", "HEAD") !== resolved) throw new Error("Checkout does not match the pinned source SHA");
  const parsed = parseReleaseVersion(JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8")).version);
  versionSurfaces(root, parsed.version);
  const isRelease = eventName === "push";
  if (isRelease) {
    if (ref !== `refs/tags/v${parsed.version}`) throw new Error("Release tag must exactly match the app version");
    if (git("rev-parse", "--verify", `${ref}^{commit}`) !== resolved) throw new Error("Release tag does not identify the pinned source commit");
    try { git("merge-base", "--is-ancestor", resolved, "origin/main"); }
    catch { throw new Error("A formal release must already be merged into origin/main"); }
  } else if (!/^refs\/(?:heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref ?? "")) {
    throw new Error("Manual candidate builds require a valid branch or tag reference");
  }
  const signedMacos = isRelease || String(signMacos) === "true";
  if (signedMacos) {
    const missing = signingSecrets.filter(name => !env[name]);
    if (missing.length) throw new Error(`Missing GitHub Actions macOS signing secrets: ${missing.join(", ")}`);
  }
  const common = git("merge-base", resolved, "origin/main");
  const baseSha = common === resolved ? git("rev-parse", `${resolved}^`) : common;
  return {
    source_sha: resolved, base_sha: baseSha, version: parsed.version,
    document_version: parsed.stableVersion, channel: parsed.channel,
    prerelease: String(parsed.prerelease), signed_macos: String(signedMacos),
    kind: isRelease ? "release" : "candidate", tag: `v${parsed.version}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const metadata = releasePreflight({ root: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF, sourceSha: process.env.GITHUB_SHA, signMacos: process.env.SIGN_MACOS ?? "false" });
    if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(""));
    console.log(JSON.stringify(metadata));
  } catch (error) {
    console.error(`Release preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
