#!/usr/bin/env node
/**
 * Generate catalog.json from approved/<pluginId>/<version>.json.
 *
 * The approval records are the allowlist: nothing else may enter this catalog,
 * and the catalog must never be a copy of an upstream directory. Records are
 * maintainer-authored, so this script validates their shape and derives the
 * document; it never decides whether a review was adequate.
 *
 * Output is deterministic (records sorted, no timestamps of its own) so a
 * catalog diff shows real changes only.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const approvedDir = join(root, "approved");
const catalogPath = join(root, "catalog.json");

const PROVIDER_ID = "pi-desktop-plus-curated";
const POLICY_VERSION = "plus-curated-v1";
const SHASUM = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const isoDate = (value) => nonEmpty(value) && !Number.isNaN(Date.parse(value));

function compareVersions(a, b) {
  const parse = (v) => v.split(/[-+]/)[0].split(".").map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return a.localeCompare(b);
}

async function readRecords() {
  let dirs = [];
  try {
    dirs = await readdir(approvedDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const dir of dirs.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const files = await readdir(join(approvedDir, dir.name));
    for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
      const where = `${dir.name}/${file}`;
      try {
        records.push({ where, dirName: dir.name, fileName: file, record: JSON.parse(await readFile(join(approvedDir, dir.name, file), "utf8")) });
      } catch (error) {
        fail(where, `not valid JSON: ${error.message}`);
      }
    }
  }
  return records;
}

/** Shape checks only; a maintainer decides whether the review was adequate. */
function check(where, record, dirName, fileName) {
  const catalog = record.catalog ?? {};
  if (record.schemaVersion !== 1) fail(where, "schemaVersion must be 1");
  if (record.pluginId !== dirName) fail(where, "pluginId must match its directory");
  if (record.version !== fileName.replace(/\.json$/, "")) fail(where, "version must match its filename");
  if (!SEMVER.test(String(record.version ?? ""))) fail(where, "version must be semver");
  if (!SHASUM.test(String(record.shasum ?? ""))) fail(where, "shasum must be 64 lowercase hex");
  if (!Number.isInteger(record.sizeBytes) || record.sizeBytes <= 0) fail(where, "sizeBytes must be a positive integer");
  if (record.decision !== "approved" && record.decision !== "yanked") fail(where, "decision must be approved or yanked");
  if (!isoDate(record.reviewedAt)) fail(where, "reviewedAt must be an ISO-8601 timestamp");
  if (!nonEmpty(record.policyVersion)) fail(where, "policyVersion is required");
  if (!String(record.sourceRepository ?? "").startsWith("https://")) fail(where, "sourceRepository must be an https URL");
  if (!COMMIT.test(String(record.sourceCommit ?? ""))) fail(where, "sourceCommit must be 40 lowercase hex");
  if (!nonEmpty(record.license)) fail(where, "license is required");
  if (record.decision === "yanked" && !nonEmpty(record.reason)) fail(where, "a yanked record needs a reason");
  if (!nonEmpty(catalog.name)) fail(where, "catalog.name is required");
  if (!nonEmpty(catalog.description)) fail(where, "catalog.description is required");
  if (!nonEmpty(catalog.author)) fail(where, "catalog.author is required");
  if (!isoDate(catalog.publishedAt)) fail(where, "catalog.publishedAt must be an ISO-8601 timestamp");
  if (!Array.isArray(catalog.permissions) || catalog.permissions.some((p) => !nonEmpty(p))) {
    fail(where, "catalog.permissions must be a list of permission ids");
  }
  if (catalog.minPiDesktop !== undefined && !nonEmpty(catalog.minPiDesktop)) fail(where, "catalog.minPiDesktop must be a version string when present");
}

function toEntry(record) {
  return {
    id: record.pluginId,
    name: record.catalog.name,
    description: record.catalog.description,
    author: record.catalog.author,
    trust: "unknown",
    versions: [
      {
        version: record.version,
        publishedAt: record.catalog.publishedAt,
        shasum: record.shasum,
        url: `packages/${record.pluginId}-${record.version}.piplug`,
        sizeBytes: record.sizeBytes,
        permissions: record.catalog.permissions,
        provenance: { sourceRepository: record.sourceRepository, sourceCommit: record.sourceCommit },
        review: { decision: "approved", reviewedAt: record.reviewedAt, policyVersion: record.policyVersion },
        ...(record.catalog.minPiDesktop ? { minPiDesktop: record.catalog.minPiDesktop } : {}),
        ...(record.decision === "yanked" ? { yanked: true, yankedReason: record.reason } : {}),
      },
    ],
  };
}

async function main() {
  const records = await readRecords();
  const plugins = new Map();
  for (const { where, dirName, fileName, record } of records) {
    check(where, record, dirName, fileName);
    if (problems.some((problem) => problem.startsWith(`${where}:`))) continue;
    const existing = plugins.get(record.pluginId);
    if (existing) {
      for (const field of ["name", "description", "author"]) {
        if (existing[field] !== record.catalog[field]) fail(where, `catalog.${field} must match the other records of ${record.pluginId}`);
      }
    }
    const entry = existing ?? toEntry(record);
    if (existing) entry.versions.push(...toEntry(record).versions);
    plugins.set(record.pluginId, entry);
  }

  if (problems.length > 0) {
    console.error(`generate-catalog: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const catalog = {
    schemaVersion: 2,
    providerId: PROVIDER_ID,
    catalogId: PROVIDER_ID,
    policyVersion: POLICY_VERSION,
    plugins: [...plugins.values()]
      .map((entry) => ({ ...entry, versions: entry.versions.sort((a, b) => compareVersions(b.version, a.version)) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`generate-catalog: wrote ${catalog.plugins.length} plugin(s) to catalog.json`);
}

await main();
