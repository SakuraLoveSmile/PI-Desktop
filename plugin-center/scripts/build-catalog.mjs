#!/usr/bin/env node
/**
 * Generate catalog.json from the Git-tracked registry.
 *
 * The catalog is a projection, never a source of truth: every field here comes
 * from a registry entry that the publish transaction wrote. Regenerating from
 * an unchanged registry must produce a byte-identical catalog apart from
 * `generatedAt`, which is why keys are emitted in a fixed order and the
 * timestamp is an explicit input rather than `Date.now()`.
 *
 * Usage:
 *   node scripts/build-catalog.mjs [--registry registry] [--out catalog.json]
 *                                  [--base <artifactBaseUrl>] [--generated-at <iso>]
 *                                  [--shards catalog/plugins]
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const DEFAULTS = {
  registry: "registry",
  out: "catalog.json",
  base: "https://github.com/vastsa/pi-plugin-center/releases/download",
  shards: "catalog/plugins",
  providerId: "official",
  catalogId: "pi-plugin-center",
  name: "PI Plugin Center",
  homepage: "https://github.com/vastsa/pi-plugin-center",
};

function parseArgs(argv) {
  const options = { ...DEFAULTS, generatedAt: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in options)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    options[key] = value;
  }
  return options;
}

/**
 * Release tag and asset path for a version.
 *
 * One tag per published version, never moved and never reused. The path is
 * relative so a mirror can serve the same catalog under its own base.
 */
export function artifactPath(pluginId, version, fileName) {
  return `${pluginId}@${version}/${fileName}`;
}

function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    if (!m) return null;
    return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  // A release outranks its own prereleases.
  if (!pa.pre.length && pb.pre.length) return 1;
  if (pa.pre.length && !pb.pre.length) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i += 1) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    return numeric ? Number(x) - Number(y) : x.localeCompare(y);
  }
  return 0;
}

/** Drop undefined values so an absent field never becomes `null` in the catalog. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

export function catalogVersion(entry, release) {
  const withdrawn = release.yanked === true;
  return compact({
    version: release.version,
    publishedAt: release.publishedAt,
    changelog: release.changelog,
    minPiDesktop: release.minPiDesktop,
    // A withdrawn release keeps its history row and loses its download.
    shasum: withdrawn ? undefined : release.artifact?.sha256,
    url: withdrawn
      ? undefined
      : artifactPath(entry.pluginId, release.version, release.artifact.fileName),
    sizeBytes: withdrawn ? undefined : release.artifact?.sizeBytes,
    permissions: release.permissions ?? [],
    fs: release.fs,
    yanked: withdrawn ? true : undefined,
    yankedReason: withdrawn ? release.yankedReason : undefined,
    provenance: release.provenance,
    review: release.review,
    signature: release.signature,
    signatureAlg: release.signatureAlg,
    keyId: release.keyId,
  });
}

export function catalogPlugin(entry) {
  const trust = entry.trust ?? "community";
  const versions = [...entry.releases].sort((a, b) => compareVersions(b.version, a.version));
  return compact({
    id: entry.pluginId,
    name: entry.name,
    description: entry.description,
    author: entry.author,
    publisherId: entry.publisherId,
    trust,
    // v1 clients read this boolean; v2 clients read `trust` and ignore it.
    verified: trust === "verified",
    categories: entry.categories?.length ? entry.categories : undefined,
    homepage: entry.homepage,
    repository: entry.repository,
    readmeMarkdown: entry.readmeMarkdown,
    safetyNotes: entry.safetyNotes,
    versions: versions.map((release) => catalogVersion(entry, release)),
  });
}

export function buildCatalog(entries, options) {
  const plugins = [...entries]
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
    .map(catalogPlugin);
  return compact({
    schemaVersion: 2,
    catalogId: options.catalogId,
    providerId: options.providerId,
    name: options.name,
    homepage: options.homepage,
    generatedAt: options.generatedAt || undefined,
    policyVersion: options.policyVersion,
    artifactBaseUrl: options.base,
    plugins,
  });
}

async function readRegistry(dir) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const entries = [];
  for (const name of names) {
    const raw = await readFile(join(dir, name), "utf8");
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${name}: invalid JSON: ${error.message}`);
    }
    if (entry.pluginId !== basename(name, ".json")) {
      throw new Error(`${name}: file name must match pluginId "${entry.pluginId}"`);
    }
    entries.push(entry);
  }
  return entries;
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const entries = await readRegistry(resolve(options.registry));
    if (entries.length === 0) throw new Error(`no registry entries in ${options.registry}`);
    const catalog = buildCatalog(entries, options);

    await writeFile(resolve(options.out), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

    // Per-plugin shards let a detail page and a client fetch one plugin
    // without pulling the whole catalog.
    const shardDir = resolve(options.shards);
    await mkdir(shardDir, { recursive: true });
    for (const plugin of catalog.plugins) {
      await writeFile(
        join(shardDir, `${plugin.id}.json`),
        `${JSON.stringify({ schemaVersion: 2, artifactBaseUrl: options.base, plugin }, null, 2)}\n`,
        "utf8",
      );
    }

    const versionCount = catalog.plugins.reduce((n, p) => n + p.versions.length, 0);
    console.log(
      `Wrote ${options.out}: ${catalog.plugins.length} plugins, ${versionCount} versions, base ${options.base}`,
    );
  } catch (error) {
    console.error(`build-catalog failed: ${error.message}`);
    process.exitCode = 1;
  }
}
