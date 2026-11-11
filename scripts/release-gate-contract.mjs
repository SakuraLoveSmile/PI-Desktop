import { createHash } from "node:crypto";

export const BASE_RELEASE_GATES = Object.freeze([
  "Validate source, version and signing requirements",
  "Verify candidate / JS build / typecheck / lint / architecture / test",
  "Verify candidate / Rust host-core format / lint / test",
  "Verify candidate / Isolated launch / message / approval / restart smoke / fixture",
  "Build macOS arm64",
  "Verify macOS arm64 installer bundle",
]);
export const PUBLICATION_JOB = "Publish verified GitHub Release";
export const NIGHTLY_CALL_NAME = "Nightly candidate";
export const NIGHTLY_CATALOG_NAME = "Catalog nightly families";
export const NIGHTLY_SUMMARY_NAME = "Summarize nightly families";

const legacyDigests = Object.freeze({
  release: "5384f558617933d98de0bcd1945bda68efeba83449d25e96ea58721bf64221e9",
  ci: "d4336a9a2561e2cdd84159cd4ad0b3be69d1bacd42987e320977b2fbfa7c5b2b",
});
const sourcePaths = new Set([
  ".github/workflows/release.yml", ".github/workflows/ci.yml",
  ".github/workflows/e2e-nightly.yml", ".github/workflows/e2e-run.yml",
  "scripts/e2e-suite-catalog.json",
]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function validFamilies(families) {
  if (!Array.isArray(families) || !families.length ||
      families.some(family => typeof family !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(family)) ||
      new Set(families).size !== families.length) throw new Error("Invalid nightly family inventory");
  return families;
}

function qualified(name, callerName) {
  if (typeof callerName !== "string" || !["", NIGHTLY_CALL_NAME].includes(callerName)) {
    throw new Error("Unknown nightly caller name");
  }
  return callerName ? `${callerName} / ${name}` : name;
}

export function nightlyFamilyJobName(family, callerName = NIGHTLY_CALL_NAME) {
  validFamilies([family]);
  return qualified(`Nightly family (${family}) / fixture`, callerName);
}

export function nightlyGateJobs(families, callerName = NIGHTLY_CALL_NAME) {
  return [qualified(NIGHTLY_CATALOG_NAME, callerName),
    ...validFamilies(families).map(family => nightlyFamilyJobName(family, callerName)),
    qualified(NIGHTLY_SUMMARY_NAME, callerName)];
}

export function nightlyCatalogFamilies(catalog) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.suites) || !catalog.suites.length) {
    throw new Error("Invalid source nightly catalog");
  }
  const families = validFamilies(catalog.families);
  const ids = new Set();
  for (const entry of catalog.suites) {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) ||
        !families.includes(entry.family) || !["smoke", "nightly", "manual"].includes(entry.tier)) {
      throw new Error("Invalid source nightly suite classification");
    }
    ids.add(entry.id);
  }
  if (families.some(family => !catalog.suites.some(entry => entry.family === family && entry.tier !== "manual"))) {
    throw new Error("Source nightly family contains no automated suite");
  }
  return [...families];
}

export function releaseGateVersion(releaseWorkflow, ciWorkflow) {
  if (sha256(releaseWorkflow) === legacyDigests.release && sha256(ciWorkflow) === legacyDigests.ci) {
    return "legacy-six-v1";
  }
  // This is a deliberately narrow version declaration, not a YAML evaluator.
  // Unknown spellings or duplicated declarations require an audited contract update.
  const blocks = [...releaseWorkflow.matchAll(/^env:\r?\n((?:[ \t].*\r?\n|[ \t]*\r?\n)*)/gm)];
  const markers = [...releaseWorkflow.matchAll(/^\s*PI_RELEASE_GATE_CONTRACT\s*:/gm)];
  if (blocks.length !== 1 || markers.length !== 1 ||
      !/^  PI_RELEASE_GATE_CONTRACT: (?:nightly-v1|'nightly-v1'|"nightly-v1")\r?$/m.test(blocks[0][1])) {
    throw new Error("Unknown release gate contract; rerun a fully gated candidate or audit the historical workflows");
  }
  return "nightly-v1";
}

function workflowBlock(source, id) {
  const start = new RegExp(`^  ${id}:\\r?$`, "m").exec(source);
  if (!start) throw new Error(`Unknown nightly-v1 workflow: missing ${id} job`);
  const rest = source.slice(start.index + start[0].length);
  const next = /^  [A-Za-z0-9_-]+:\r?$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function requireLine(block, line) {
  if (!block.split(/\r?\n/).some(value => value.trim() === line)) {
    throw new Error(`Unknown nightly-v1 workflow declaration: ${line}`);
  }
}

export function recoveryGateContract({ releaseWorkflow, ciWorkflow, nightlyWorkflow, runnerWorkflow, catalog }) {
  const version = releaseGateVersion(releaseWorkflow, ciWorkflow);
  if (version === "legacy-six-v1") return { version, requiredJobs: [...BASE_RELEASE_GATES] };
  const call = workflowBlock(releaseWorkflow, "nightly");
  requireLine(call, `name: ${NIGHTLY_CALL_NAME}`);
  requireLine(call, "needs: metadata");
  requireLine(call, "uses: ./.github/workflows/e2e-nightly.yml");
  requireLine(call, "source_sha: ${{ needs.metadata.outputs.source_sha }}");
  requireLine(call, `job_prefix: ${NIGHTLY_CALL_NAME}`);
  requireLine(workflowBlock(releaseWorkflow, "build"), "needs: [metadata, verify, nightly]");
  const catalogJob = workflowBlock(nightlyWorkflow, "catalog");
  requireLine(catalogJob, `name: ${NIGHTLY_CATALOG_NAME}`);
  requireLine(catalogJob, "ref: ${{ inputs.source_sha || github.sha }}");
  const family = workflowBlock(nightlyWorkflow, "family");
  requireLine(family, "name: Nightly family (${{ matrix.family }})");
  requireLine(family, "uses: ./.github/workflows/e2e-run.yml");
  requireLine(family, "source_sha: ${{ needs.catalog.outputs.source_sha }}");
  requireLine(family, "tier: nightly");
  requireLine(family, "family: ${{ matrix.family }}");
  requireLine(workflowBlock(nightlyWorkflow, "summary"), `name: ${NIGHTLY_SUMMARY_NAME}`);
  const fixture = workflowBlock(runnerWorkflow, "fixture");
  requireLine(fixture, "ref: ${{ inputs.source_sha || github.sha }}");
  if (/^    name:/m.test(fixture)) throw new Error("Unknown nightly-v1 fixture job name");
  return { version, requiredJobs: [...BASE_RELEASE_GATES, ...nightlyGateJobs(nightlyCatalogFamilies(catalog))] };
}

export async function readPinnedReleaseSource({ repository, sourceSha, path }, { api }) {
  if (!sourcePaths.has(path) || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Invalid pinned release source request");
  const response = await api("GET", `/repos/${repository}/contents/${path}?ref=${sourceSha}`);
  if (response?.type !== "file" || response.path !== path || response.name !== path.split("/").at(-1) ||
      response.encoding !== "base64" || response.truncated === true || typeof response.content !== "string" ||
      !Number.isSafeInteger(response.size) || response.size <= 0 || response.size > 1_048_576 ||
      !/^[a-f0-9]{40}$/.test(response.sha ?? "")) throw new Error(`Invalid pinned source metadata: ${path}`);
  const encoded = response.content.replace(/\r?\n/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4) throw new Error(`Invalid pinned source encoding: ${path}`);
  const bytes = Buffer.from(encoded, "base64");
  const blobSha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (bytes.length !== response.size || bytes.toString("base64") !== encoded || blobSha !== response.sha) {
    throw new Error(`Pinned source content is incomplete or mismatched: ${path}`);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(`Pinned source is not UTF-8 text: ${path}`); }
}

export async function loadRecoveryGateContract(input, remote) {
  const read = path => readPinnedReleaseSource({ ...input, path }, remote);
  const [releaseWorkflow, ciWorkflow] = await Promise.all([
    read(".github/workflows/release.yml"), read(".github/workflows/ci.yml"),
  ]);
  if (releaseGateVersion(releaseWorkflow, ciWorkflow) === "legacy-six-v1") {
    return recoveryGateContract({ releaseWorkflow, ciWorkflow });
  }
  const [nightlyWorkflow, runnerWorkflow, catalogText] = await Promise.all([
    read(".github/workflows/e2e-nightly.yml"), read(".github/workflows/e2e-run.yml"), read("scripts/e2e-suite-catalog.json"),
  ]);
  let catalog;
  try { catalog = JSON.parse(catalogText); }
  catch { throw new Error("Invalid source nightly catalog JSON"); }
  return recoveryGateContract({ releaseWorkflow, ciWorkflow, nightlyWorkflow, runnerWorkflow, catalog });
}
