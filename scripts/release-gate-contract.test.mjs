import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nightlyCatalogFamilies, nightlyGateJobs, readPinnedReleaseSource,
  recoveryGateContract, releaseGateVersion } from "./release-gate-contract.mjs";

const releaseWorkflow = `env:
  PI_RELEASE_GATE_CONTRACT: nightly-v1
jobs:
  nightly:
    name: Nightly candidate
    needs: metadata
    uses: ./.github/workflows/e2e-nightly.yml
    with:
      source_sha: \${{ needs.metadata.outputs.source_sha }}
      job_prefix: Nightly candidate
  build:
    needs: [metadata, verify, nightly]
`;
const nightlyWorkflow = `jobs:
  catalog:
    name: Catalog nightly families
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ inputs.source_sha || github.sha }}
  family:
    name: Nightly family (\${{ matrix.family }})
    uses: ./.github/workflows/e2e-run.yml
    with:
      source_sha: \${{ needs.catalog.outputs.source_sha }}
      tier: nightly
      family: \${{ matrix.family }}
  summary:
    name: Summarize nightly families
`;
const contractInput = { releaseWorkflow, ciWorkflow: "name: CI\n", nightlyWorkflow,
  runnerWorkflow: "jobs:\n  fixture:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          ref: ${{ inputs.source_sha || github.sha }}\n",
  catalog: { version: 1, families: ["goals-team"], suites: [{ id: "goal", family: "goals-team", tier: "nightly" }] } };

test("nightly contracts use complete unique automated catalog families and stable qualified job names", () => {
  assert.deepEqual(nightlyCatalogFamilies(contractInput.catalog), ["goals-team"]);
  assert.deepEqual(nightlyGateJobs(["goals-team"]), ["Nightly candidate / Catalog nightly families",
    "Nightly candidate / Nightly family (goals-team) / fixture", "Nightly candidate / Summarize nightly families"]);
  assert.equal(nightlyGateJobs(["goals-team"], "")[1], "Nightly family (goals-team) / fixture");
  assert.equal(recoveryGateContract(contractInput).requiredJobs.length, 9);
  for (const catalog of [null, {}, { ...contractInput.catalog, version: 2 },
    { ...contractInput.catalog, families: [] }, { ...contractInput.catalog, families: ["goals-team", "goals-team"] },
    { ...contractInput.catalog, families: ["../other"] }, { ...contractInput.catalog, suites: [] },
    { ...contractInput.catalog, suites: [{ id: "goal", family: "other", tier: "nightly" }] },
    { ...contractInput.catalog, suites: [{ id: "goal", family: "goals-team", tier: "manual" }] },
    { ...contractInput.catalog, suites: [...contractInput.catalog.suites, ...contractInput.catalog.suites] },
  ]) assert.throws(() => nightlyCatalogFamilies(catalog), /Invalid|no automated suite/);
  assert.throws(() => nightlyGateJobs(["shell"], "unexpected"), /Unknown nightly caller/);
});

test("new, missing or duplicate contract declarations cannot be treated as legacy", () => {
  for (const source of ["name: Release\n", releaseWorkflow.replace("nightly-v1", "nightly-v2"),
    releaseWorkflow + "env:\n  OTHER: value\n", releaseWorkflow.replace("jobs:", "  PI_RELEASE_GATE_CONTRACT: nightly-v1\njobs:"),
    releaseWorkflow.replace("env:", "# env:"),
  ]) assert.throws(() => releaseGateVersion(source, contractInput.ciWorkflow), /Unknown release gate contract/);
  for (const value of ["'nightly-v1'", '"nightly-v1"']) {
    assert.equal(releaseGateVersion(releaseWorkflow.replace("nightly-v1", value), "name: CI\n"), "nightly-v1");
  }
});

test("workflow job declarations must match the audited nightly contract", () => {
  for (const [field, before, after] of [
    ["releaseWorkflow", "name: Nightly candidate", "name: Candidate nightly"],
    ["releaseWorkflow", "uses: ./.github/workflows/e2e-nightly.yml", "uses: other/repo/.github/workflows/nightly.yml@main"],
    ["releaseWorkflow", "source_sha: ${{ needs.metadata.outputs.source_sha }}", "source_sha: main"],
    ["releaseWorkflow", "job_prefix: Nightly candidate", "job_prefix: other"],
    ["releaseWorkflow", "needs: [metadata, verify, nightly]", "needs: [metadata, verify]"],
    ["releaseWorkflow", "needs: metadata", "needs: other"],
    ["nightlyWorkflow", "ref: ${{ inputs.source_sha || github.sha }}", "ref: main"],
    ["nightlyWorkflow", "name: Nightly family (${{ matrix.family }})", "name: family"],
    ["nightlyWorkflow", "uses: ./.github/workflows/e2e-run.yml", "uses: ./.github/workflows/other.yml"],
    ["nightlyWorkflow", "source_sha: ${{ needs.catalog.outputs.source_sha }}", "source_sha: main"],
    ["nightlyWorkflow", "tier: nightly", "tier: smoke"],
    ["nightlyWorkflow", "family: ${{ matrix.family }}", "family: shell"],
    ["nightlyWorkflow", "name: Summarize nightly families", "name: Other summary"],
    ["runnerWorkflow", "    runs-on:", "    name: Renamed fixture\n    runs-on:"],
    ["runnerWorkflow", "ref: ${{ inputs.source_sha || github.sha }}", "ref: main"],
  ]) assert.throws(() => recoveryGateContract({ ...contractInput,
    [field]: contractInput[field].replace(before, after) }), /Unknown nightly-v1/);
});

test("legacy fixture bytes retain the exact ADR audited workflow digest pair", async () => {
  const release = await readFile(new URL("./fixtures/release-gates-legacy/release.yml", import.meta.url), "utf8");
  const ci = await readFile(new URL("./fixtures/release-gates-legacy/ci.yml", import.meta.url), "utf8");
  const hash = value => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(release), "5384f558617933d98de0bcd1945bda68efeba83449d25e96ea58721bf64221e9");
  assert.equal(hash(ci), "d4336a9a2561e2cdd84159cd4ad0b3be69d1bacd42987e320977b2fbfa7c5b2b");
  assert.equal(recoveryGateContract({ releaseWorkflow: release, ciWorkflow: ci }).requiredJobs.length, 6);
});

const path = ".github/workflows/release.yml";
const input = { repository: "fixture/pi-desktop", sourceSha: "a".repeat(40), path };
function response(bytes = Buffer.from(releaseWorkflow)) {
  return { type: "file", path, name: "release.yml", encoding: "base64", size: bytes.length,
    content: bytes.toString("base64"), sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") };
}

test("pinned sources validate immutable source, complete bytes, git blob identity and strict UTF8", async () => {
  const expected = `/repos/${input.repository}/contents/${path}?ref=${input.sourceSha}`;
  const api = async (method, endpoint) => {
    assert.equal(method, "GET");
    assert.equal(endpoint, expected);
    return response();
  };
  assert.equal(await readPinnedReleaseSource(input, { api }), releaseWorkflow);
  const multiline = response();
  multiline.content = multiline.content.match(/.{1,60}/g).join("\n") + "\n";
  assert.equal(await readPinnedReleaseSource(input, { api: async () => multiline }), releaseWorkflow);
  for (const change of [{ type: "dir" }, { path: "other" }, { name: "other" }, { encoding: "utf8" },
    { truncated: true }, { size: 0 }, { size: 1_048_577 }, { size: 2.5 }, { size: 1 },
    { sha: "b".repeat(40) }, { content: "%%%=" }, { content: "Zg==extra" },
  ]) await assert.rejects(readPinnedReleaseSource(input, { api: async () => ({ ...response(), ...change }) }), /Invalid|incomplete or mismatched/);
  const noncanonical = response(Buffer.from("f"));
  noncanonical.content = "Zh==";
  await assert.rejects(readPinnedReleaseSource(input, { api: async () => noncanonical }), /incomplete or mismatched/);
  await assert.rejects(readPinnedReleaseSource(input, { api: async () => response(Buffer.from([0xff])) }), /not UTF-8/);
  for (const change of [{ sourceSha: "main" }, { path: "private-data" }]) {
    await assert.rejects(readPinnedReleaseSource({ ...input, ...change }, { api: async () => assert.fail("no remote read") }), /Invalid pinned/);
  }
  await assert.rejects(readPinnedReleaseSource(input, { api: async () => { throw new Error("source not found"); } }), /source not found/);
});
