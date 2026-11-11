import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectNightlySummary, renderNightlySummary } from "./nightly-e2e-summary.mjs";
import { NIGHTLY_CALL_NAME, nightlyCatalogFamilies, nightlyGateJobs } from "./release-gate-contract.mjs";

const catalog = JSON.parse(await readFile(new URL("./e2e-suite-catalog.json", import.meta.url), "utf8"));
const families = nightlyCatalogFamilies(catalog);
const repository = "fixture/pi-desktop";
const sourceSha = "a".repeat(40);
const runId = 42;
const attempt = 2;

function fixture(prefix = NIGHTLY_CALL_NAME) {
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: String(attempt), SOURCE_SHA: sourceSha,
    NIGHTLY_JOB_PREFIX: prefix, NIGHTLY_FAMILIES: JSON.stringify(families), CATALOG_RESULT: "success", FAMILY_RESULT: "success" };
  const names = nightlyGateJobs(families, prefix);
  const remote = {
    run: { id: runId, head_sha: sourceSha, run_attempt: attempt, repository: { full_name: repository } },
    jobs: names.map((name, index) => ({ name, status: index === names.length - 1 ? "in_progress" : "completed",
      conclusion: index === names.length - 1 ? null : "success", run_id: runId, head_sha: sourceSha })), calls: [],
  };
  remote.api = async (method, endpoint) => {
    remote.calls.push({ method, endpoint });
    assert.equal(method, "GET");
    const root = `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}`;
    if (endpoint === root) return remote.run;
    if (endpoint.startsWith(`${root}/jobs?per_page=100&page=`)) {
      const page = Number(new URL(`https://example.invalid${endpoint}`).searchParams.get("page"));
      return { jobs: remote.jobs.slice((page - 1) * 100, page * 100) };
    }
    throw new Error(`Unexpected API call: ${endpoint}`);
  };
  return { env, remote, inspect: () => inspectNightlySummary({ env, catalog }, remote) };
}

test("nightly summary verifies every family on the exact current attempt for release and standalone callers", async () => {
  for (const prefix of [NIGHTLY_CALL_NAME, ""]) {
    const current = fixture(prefix);
    if (prefix) current.remote.jobs.push({ name: "Verify candidate / unrelated CI", status: "in_progress" });
    const report = await current.inspect();
    assert.equal(report.passed, true, JSON.stringify(report.errors));
    assert.equal(report.rows.length, families.length + 1);
    assert(report.rows.every(row => row.status === "completed" && row.conclusion === "success"));
    assert(current.remote.calls.every(call => call.endpoint.includes(`/attempts/${attempt}`)));
    assert(renderNightlySummary(report).includes(sourceSha));
  }
});

test("failed cancelled skipped and missing family gates cannot produce a green summary", async () => {
  for (const conclusion of ["failure", "cancelled", "skipped", null]) {
    const current = fixture();
    current.remote.jobs[1].conclusion = conclusion;
    assert.equal((await current.inspect()).passed, false, `conclusion=${conclusion}`);
  }
  for (const mutate of [jobs => jobs.splice(1, 1), jobs => jobs.push({ ...jobs[1] }),
    jobs => { jobs[1].status = "in_progress"; }, jobs => { jobs[1].name = "Nightly candidate / Nightly family (unknown) / fixture"; },
    jobs => { jobs[1].run_id = runId + 1; }, jobs => { jobs[1].head_sha = "b".repeat(40); }]) {
    const current = fixture();
    mutate(current.remote.jobs);
    const report = await current.inspect();
    assert.equal(report.passed, false);
    assert(renderNightlySummary(report).includes("failed"));
  }
});

test("dependency results and the running summary itself are mandatory", async () => {
  for (const key of ["CATALOG_RESULT", "FAMILY_RESULT"]) {
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      const current = fixture(); current.env[key] = result;
      assert.equal((await current.inspect()).passed, false, `${key}=${result}`);
    }
  }
  for (const mutate of [jobs => jobs.pop(), jobs => { jobs.at(-1).status = "queued"; },
    jobs => { jobs.at(-1).conclusion = "success"; }]) {
    const current = fixture(); mutate(current.remote.jobs);
    assert.equal((await current.inspect()).passed, false);
  }
});

test("summary rejects foreign run attempts and cannot trust a reduced matrix output", async () => {
  for (const mutate of [current => { current.remote.run.head_sha = "b".repeat(40); },
    current => { current.remote.run.id++; }, current => { current.remote.run.run_attempt--; },
    current => { current.remote.run.repository.full_name = "other/repository"; },
    current => { current.env.NIGHTLY_FAMILIES = JSON.stringify(families.slice(1)); },
    current => { current.env.NIGHTLY_JOB_PREFIX = "Other caller"; },
    current => { current.env.GITHUB_RUN_ATTEMPT = "0"; }]) {
    const current = fixture(); mutate(current);
    assert.equal((await current.inspect()).passed, false);
  }
  const current = fixture(); current.remote.api = async () => { throw new Error("Controlled API failure"); };
  const report = await current.inspect();
  assert.equal(report.passed, false);
  assert(renderNightlySummary(report).includes("Controlled API failure"));
});

test("nightly summary reads all current-attempt pages and fails closed on a truncated inventory", async () => {
  const current = fixture();
  for (let index = 0; index < 100; index++) current.remote.jobs.unshift({ name: `Other gate ${index}` });
  assert.equal((await current.inspect()).passed, true);
  assert(current.remote.calls.some(call => call.endpoint.endsWith("page=2")));
  const truncated = fixture();
  truncated.remote.api = async (_method, endpoint) => endpoint.endsWith(`/attempts/${attempt}`)
    ? truncated.remote.run : { jobs: Array.from({ length: 100 }, () => ({ name: "Unrelated gate" })) };
  const report = await truncated.inspect();
  assert.equal(report.passed, false);
  assert(report.errors.includes("Incomplete current-attempt job inventory"));
});

test("workflow contract pins nightly to the candidate and a nightly-only failure blocks the unchanged build lane", async () => {
  const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
  const require = createRequire(desktopRequire.resolve("vite"));
  const { parse } = require("yaml");
  const workflow = async name => parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
  const release = await workflow("release");
  const nightly = await workflow("e2e-nightly");
  assert.equal(release.env.PI_RELEASE_GATE_CONTRACT, "nightly-v1");
  assert.equal(release.jobs.nightly.name, NIGHTLY_CALL_NAME);
  assert.equal(release.jobs.nightly.uses, "./.github/workflows/e2e-nightly.yml");
  assert.equal(release.jobs.nightly.with.source_sha, "${{ needs.metadata.outputs.source_sha }}");
  assert.equal(release.jobs.nightly.with.job_prefix, NIGHTLY_CALL_NAME);
  assert.deepEqual(release.jobs.build.needs, ["metadata", "verify", "nightly"]);
  assert.equal(release.jobs.build.if, undefined);
  const defaultsAllowBuild = conclusions => release.jobs.build.needs.every(name => conclusions[name] === "success");
  assert.equal(defaultsAllowBuild({ metadata: "success", verify: "success", nightly: "failure" }), false);
  assert.equal(defaultsAllowBuild({ metadata: "success", verify: "success", nightly: "success" }), true);
  assert.equal(nightly.on.workflow_call.inputs.source_sha.required, true);
  assert.equal(nightly.jobs.catalog.steps[0].with.ref, "${{ inputs.source_sha || github.sha }}");
  assert.equal(nightly.jobs.family.with.source_sha, "${{ needs.catalog.outputs.source_sha }}");
  assert.equal(nightly.jobs.family.with.tier, "nightly");
  assert.equal(nightly.jobs.family.strategy["fail-fast"], false);
  assert.equal(nightly.jobs.family.strategy["max-parallel"], 3);
  assert.equal(nightly.jobs.summary.if, "always()");
  assert.deepEqual(nightly.jobs.summary.needs, ["catalog", "family"]);
  assert.equal(nightly.jobs.summary.permissions.actions, "read");
  assert.equal(release.jobs.nightly.permissions.actions, "read");
});
