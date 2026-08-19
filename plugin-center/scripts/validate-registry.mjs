#!/usr/bin/env node
/**
 * Validate registry entries before they can produce a catalog.
 *
 * Deliberately dependency-free: this runs on a PR from an untrusted fork, so
 * it must not execute anything the change brings with it — no npm install, no
 * plugin code, no scripts from the submitted repository. It reads JSON and
 * applies rules.
 *
 * Usage: node scripts/validate-registry.mjs [--registry registry] [--plugin <id>]
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/** Mirrors PACKAGE_HOST_ALLOWLIST in PI-Desktop crates/host-core/src/plugins.rs. */
const SOURCE_HOST_ALLOWLIST = ["github.com", "cnb.cool"];

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

function parseArgs(argv) {
  const options = { registry: "registry", plugin: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--registry") options.registry = argv[++i] ?? "";
    else if (arg === "--plugin") options.plugin = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function hostAllowed(host) {
  return SOURCE_HOST_ALLOWLIST.some((a) => host === a || host.endsWith(`.${a}`));
}

/**
 * A repository URL has to be something the center can re-resolve and a reader
 * can open. Credentials, query strings, and fragments are all signs the value
 * was pasted from somewhere it should not have been.
 */
function repositoryErrors(label, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [`${label}: repository is required`];
  let url;
  try {
    url = new URL(raw);
  } catch {
    return [`${label}: repository is not a valid URL`];
  }
  const errors = [];
  if (url.protocol !== "https:") errors.push(`${label}: repository must use https`);
  if (url.username || url.password) errors.push(`${label}: repository must not embed credentials`);
  if (url.search || url.hash) errors.push(`${label}: repository must not carry a query or fragment`);
  if (!hostAllowed(url.hostname)) {
    errors.push(`${label}: ${url.hostname} is not a supported source host`);
  }
  return errors;
}

export function validateEntry(entry, fileName) {
  const errors = [];
  const id = entry?.pluginId ?? "<missing>";
  const push = (message) => errors.push(`${id}: ${message}`);

  if (entry?.schemaVersion !== 1) push("schemaVersion must be 1");
  if (!ID_PATTERN.test(String(entry?.pluginId ?? ""))) {
    push("pluginId must be <publisher>.<name> in lowercase");
  }
  if (fileName && basename(fileName, ".json") !== entry?.pluginId) {
    push(`file name ${fileName} must match pluginId`);
  }
  if (!entry?.publisherId) push("publisherId is required");
  if (entry?.pluginId && entry?.publisherId && !String(entry.pluginId).startsWith(`${entry.publisherId}.`)) {
    // The id namespace is the ownership claim; letting them disagree would let
    // one publisher occupy another's prefix.
    push(`pluginId must start with the publisher namespace "${entry.publisherId}."`);
  }
  for (const field of ["name", "description", "author"]) {
    if (!String(entry?.[field] ?? "").trim()) push(`${field} is required`);
  }
  errors.push(...repositoryErrors(id, entry?.repository));
  if (entry?.trust !== undefined && !["verified", "community"].includes(entry.trust)) {
    push(`trust must be verified or community, got ${entry.trust}`);
  }

  const releases = entry?.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    push("releases must be a non-empty array");
    return errors;
  }

  const seen = new Set();
  let live = 0;
  for (const release of releases) {
    const label = `${id}@${release?.version ?? "<missing>"}`;
    if (!SEMVER.test(String(release?.version ?? ""))) errors.push(`${label}: invalid semantic version`);
    if (seen.has(release?.version)) errors.push(`${label}: duplicate version`);
    seen.add(release?.version);
    if (!release?.publishedAt || Number.isNaN(Date.parse(release.publishedAt))) {
      errors.push(`${label}: publishedAt must be an ISO timestamp`);
    }
    if (!Array.isArray(release?.permissions)) errors.push(`${label}: permissions must be an array`);
    if (release?.minPiDesktop !== undefined && !/^\d+\.\d+\.\d+$/.test(String(release.minPiDesktop))) {
      // The client ignores a bound it cannot parse, so a range here silently
      // does nothing rather than failing loudly at install time.
      errors.push(`${label}: minPiDesktop must be a plain version, not a range`);
    }

    const provenance = release?.provenance;
    if (!provenance || typeof provenance !== "object") {
      errors.push(`${label}: provenance is required`);
    } else {
      errors.push(...repositoryErrors(`${label} provenance`, provenance.sourceRepository));
      if (!COMMIT.test(String(provenance.sourceCommit ?? ""))) {
        errors.push(`${label}: provenance.sourceCommit must be a 40-character commit SHA`);
      }
      if (
        entry?.repository &&
        provenance.sourceRepository &&
        String(provenance.sourceRepository).replace(/\/$/, "") !==
          String(entry.repository).replace(/\/$/, "")
      ) {
        // A version built from a different repository than the plugin claims
        // breaks the one link a user can actually audit.
        errors.push(`${label}: provenance.sourceRepository disagrees with the plugin repository`);
      }
    }

    if (release?.yanked === true) {
      if (!String(release?.yankedReason ?? "").trim()) {
        errors.push(`${label}: a withdrawn release must say why`);
      }
      continue;
    }
    live += 1;

    const artifact = release?.artifact;
    if (!artifact || typeof artifact !== "object") {
      errors.push(`${label}: artifact is required for a live release`);
      continue;
    }
    if (!SHA256.test(String(artifact.sha256 ?? ""))) {
      errors.push(`${label}: artifact.sha256 must be a 64-character SHA-256 digest`);
    }
    if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      errors.push(`${label}: artifact.sizeBytes must be a positive integer`);
    } else if (artifact.sizeBytes > MAX_ARTIFACT_BYTES) {
      errors.push(`${label}: artifact.sizeBytes exceeds the 50MB package limit`);
    }
    const expected = `${entry.pluginId}-${release.version}.piplug`;
    if (artifact.fileName !== expected) {
      // The client caches by plugin and version; a surprising file name is the
      // cheapest way to end up serving one version's bytes under another's tag.
      errors.push(`${label}: artifact.fileName must be ${expected}`);
    }
    if (release?.review && release.review.decision !== "approved") {
      errors.push(`${label}: a published release must carry an approved review decision`);
    }
  }

  if (live === 0) errors.push(`${id}: every release is withdrawn`);
  return errors;
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const dir = resolve(options.registry);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    const errors = [];
    let checked = 0;
    for (const name of names) {
      let entry;
      try {
        entry = JSON.parse(await readFile(join(dir, name), "utf8"));
      } catch (error) {
        errors.push(`${name}: invalid JSON: ${error.message}`);
        continue;
      }
      if (options.plugin && entry.pluginId !== options.plugin) continue;
      checked += 1;
      errors.push(...validateEntry(entry, name));
    }
    if (options.plugin && checked === 0) errors.push(`plugin not found: ${options.plugin}`);
    if (errors.length) {
      console.error("Registry validation failed:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`Registry passed validation: ${checked} plugin(s) in ${options.registry}`);
    }
  } catch (error) {
    console.error(`validate-registry failed: ${error.message}`);
    process.exitCode = 1;
  }
}
