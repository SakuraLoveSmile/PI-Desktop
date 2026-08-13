#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_URL =
  process.env.PI_DESKTOP_PLUGIN_MARKET_URL ||
  "https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json";

function usage() {
  console.error(
    "Usage: node scripts/check-marketplace-catalog.mjs [--url <url-or-file>] [--plugin <id>]",
  );
}

function parseArgs(argv) {
  const options = { url: DEFAULT_URL, plugin: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--url") options.url = argv[++index] || "";
    else if (arg === "--plugin") options.plugin = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function readCatalog(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { "user-agent": "pi-desktop-marketplace-preflight" },
    });
    if (!response.ok) throw new Error(`catalog fetch failed: HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }
  return JSON.parse(await readFile(source, "utf8"));
}

function parseSemver(value) {
  const match = String(value ?? "")
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function validateCatalog(catalog, pluginFilter) {
  const errors = [];
  if (!catalog || !Array.isArray(catalog.plugins) || catalog.plugins.length === 0) {
    return ["catalog.plugins must be a non-empty array"];
  }

  for (const plugin of catalog.plugins) {
    if (pluginFilter && plugin.id !== pluginFilter) continue;
    if (!plugin.id) errors.push("plugin is missing id");
    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      errors.push(`${plugin.id || "<unknown>"}: versions must be non-empty`);
      continue;
    }
    const seen = new Set();
    for (const version of plugin.versions) {
      const label = `${plugin.id || "<unknown>"}@${version.version || "<missing>"}`;
      if (!parseSemver(version.version)) errors.push(`${label}: invalid semantic version`);
      if (seen.has(version.version)) errors.push(`${label}: duplicate version`);
      seen.add(version.version);
      if (!/^[a-f0-9]{64}$/i.test(String(version.shasum || ""))) {
        errors.push(`${label}: shasum must be a 64-character SHA-256 hex digest`);
      }
      if (!String(version.url || "").trim()) errors.push(`${label}: url is required`);
      if (!Number.isInteger(version.sizeBytes) || version.sizeBytes <= 0) {
        errors.push(`${label}: sizeBytes must be a positive integer`);
      }
      if (!Array.isArray(version.permissions)) {
        errors.push(`${label}: permissions must be an array`);
      }
    }
  }

  if (pluginFilter && !catalog.plugins.some((plugin) => plugin.id === pluginFilter)) {
    errors.push(`plugin not found: ${pluginFilter}`);
  }
  return errors;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) throw new Error("--url requires a value");
  const catalog = await readCatalog(options.url);
  const errors = validateCatalog(catalog, options.plugin);
  if (errors.length) {
    console.error(`Marketplace catalog failed preflight: ${options.url}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    const scope = options.plugin ? ` for ${options.plugin}` : "";
    console.log(`Marketplace catalog passed preflight${scope}: ${options.url}`);
  }
} catch (error) {
  usage();
  console.error(`Marketplace catalog preflight failed: ${error.message}`);
  process.exitCode = 1;
}
