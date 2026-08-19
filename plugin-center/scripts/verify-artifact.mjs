#!/usr/bin/env node
/**
 * Verify a published artifact still matches what the registry recorded.
 *
 * GitHub release assets are not WORM storage: a repository admin can delete
 * and re-upload one. This is the check that turns that from undetectable into
 * loud. It is meant to run on a schedule against the whole registry, and on
 * demand during an incident.
 *
 * Usage:
 *   node scripts/verify-artifact.mjs [--registry registry] [--plugin <id>]
 *                                    [--base <artifactBaseUrl>] [--version <v>]
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { artifactPath } from "./build-catalog.mjs";

const DEFAULT_BASE = "https://github.com/vastsa/pi-plugin-center/releases/download";
const MAX_BYTES = 50 * 1024 * 1024;

function parseArgs(argv) {
  const options = { registry: "registry", plugin: "", base: DEFAULT_BASE, version: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in options)) throw new Error(`unknown argument: ${argv[i]}`);
    options[key] = argv[++i] ?? "";
  }
  return options;
}

async function download(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "pi-plugin-center-artifact-verifier" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) throw new Error("artifact exceeds the 50MB package limit");
  return buffer;
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  const options = parseArgs(process.argv.slice(2));
  const dir = resolve(options.registry);
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const base = options.base.endsWith("/") ? options.base : `${options.base}/`;
  const failures = [];
  let verified = 0;

  for (const name of names) {
    const entry = JSON.parse(await readFile(join(dir, name), "utf8"));
    if (options.plugin && entry.pluginId !== options.plugin) continue;
    for (const release of entry.releases ?? []) {
      // A withdrawn release intentionally loses its asset after the incident
      // window, so a missing file there is the expected state, not a failure.
      if (release.yanked === true) continue;
      if (options.version && release.version !== options.version) continue;
      const url = `${base}${artifactPath(entry.pluginId, release.version, release.artifact.fileName)}`;
      const label = `${entry.pluginId}@${release.version}`;
      try {
        const bytes = await download(url);
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== release.artifact.sha256) {
          failures.push(
            `${label}: digest mismatch — registry ${release.artifact.sha256}, asset ${digest}`,
          );
        } else if (bytes.byteLength !== release.artifact.sizeBytes) {
          failures.push(
            `${label}: size mismatch — registry ${release.artifact.sizeBytes}, asset ${bytes.byteLength}`,
          );
        } else {
          verified += 1;
        }
      } catch (error) {
        failures.push(`${label}: ${error.message} (${url})`);
      }
    }
  }

  if (failures.length) {
    console.error("Artifact verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(
      "\nA digest mismatch means a published asset no longer matches the registry and Git history. Treat it as an incident: yank the version rather than updating the recorded digest.",
    );
    process.exitCode = 1;
  } else {
    console.log(`Verified ${verified} artifact(s) against ${base}`);
  }
}
