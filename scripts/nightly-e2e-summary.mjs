#!/usr/bin/env node
/** Verify the complete fixture inventory before a nightly caller can succeed. */
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubTransport } from "./publish-release.mjs";
import {
  NIGHTLY_CALL_NAME, NIGHTLY_SUMMARY_NAME, nightlyCatalogFamilies, nightlyGateJobs,
} from "./release-gate-contract.mjs";

function positiveId(value, label) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(value);
}

async function attemptJobs(api, endpoint) {
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const response = await api("GET", `${endpoint}?per_page=100&page=${page}`);
    if (!Array.isArray(response?.jobs)) throw new Error("GitHub did not return this attempt's jobs");
    jobs.push(...response.jobs);
    if (response.jobs.length < 100) return jobs;
  }
  throw new Error("Incomplete current-attempt job inventory");
}

export async function inspectNightlySummary({ env, catalog }, { api }) {
  const report = { sourceSha: env.SOURCE_SHA ?? "", repository: env.GITHUB_REPOSITORY ?? "",
    runId: env.GITHUB_RUN_ID ?? "", runAttempt: env.GITHUB_RUN_ATTEMPT ?? "", rows: [], errors: [], passed: false };
  try {
    if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted") {
      throw new Error("Nightly summary requires its GitHub-hosted Actions context");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(report.repository) ||
      !/^[a-f0-9]{40}$/.test(report.sourceSha)) throw new Error("Invalid nightly repository or full source SHA");
    const runId = positiveId(report.runId, "nightly run ID");
    const attempt = positiveId(report.runAttempt, "nightly run attempt");
    const prefix = env.NIGHTLY_JOB_PREFIX ?? "";
    if (!["", NIGHTLY_CALL_NAME].includes(prefix)) throw new Error("Unknown nightly caller prefix");
    const families = nightlyCatalogFamilies(catalog);
    if (JSON.stringify(JSON.parse(env.NIGHTLY_FAMILIES ?? "null")) !== JSON.stringify(families)) {
      throw new Error("Nightly matrix output differs from the candidate catalog");
    }
    const summaryName = prefix ? `${prefix} / ${NIGHTLY_SUMMARY_NAME}` : NIGHTLY_SUMMARY_NAME;
    const expectedNames = nightlyGateJobs(families, prefix);
    const requiredNames = expectedNames.filter(name => name !== summaryName);
    report.rows = requiredNames.map(name => ({ name, status: "missing", conclusion: "missing" }));
    if (env.CATALOG_RESULT !== "success") report.errors.push(`Catalog dependency: ${env.CATALOG_RESULT ?? "missing"}`);
    if (env.FAMILY_RESULT !== "success") report.errors.push(`Family matrix dependency: ${env.FAMILY_RESULT ?? "missing"}`);
    const endpoint = `/repos/${report.repository}/actions/runs/${runId}/attempts/${attempt}`;
    const run = await api("GET", endpoint);
    if (run.id !== runId || run.head_sha !== report.sourceSha || run.run_attempt !== attempt ||
      run.repository?.full_name !== report.repository) throw new Error("Nightly run attempt does not match the candidate identity");
    const allJobs = await attemptJobs(api, `${endpoint}/jobs`);
    if (allJobs.some(job => typeof job?.name !== "string")) throw new Error("GitHub returned an unnamed job");
    const jobs = prefix ? allJobs.filter(job => job.name.startsWith(`${prefix} / `)) : allJobs;
    const names = jobs.map(job => job.name);
    if (jobs.length !== expectedNames.length || new Set(names).size !== names.length ||
      names.some(name => !expectedNames.includes(name))) report.errors.push("Nightly job inventory is incomplete, duplicated or unexpected");
    if (jobs.some(job => job.run_id !== runId || job.head_sha !== report.sourceSha)) {
      report.errors.push("Nightly jobs do not belong to this candidate run");
    }
    report.rows = requiredNames.map(name => {
      const job = jobs.find(entry => entry.name === name);
      if (job?.status !== "completed" || job?.conclusion !== "success") report.errors.push(`Required nightly gate did not succeed: ${name}`);
      return { name, status: job?.status ?? "missing", conclusion: job?.conclusion ?? "missing" };
    });
    const summary = jobs.find(job => job.name === summaryName);
    // This job cannot have completed while its verification step is executing.
    if (summary?.status !== "in_progress" || summary?.conclusion !== null) report.errors.push("Current nightly summary job is missing or has an unexpected state");
    report.passed = report.errors.length === 0;
  } catch (error) { report.errors.push(error.message); }
  return report;
}

function textCell(value) { return String(value).replace(/[|`\r\n]/g, " "); }

export function renderNightlySummary(report) {
  const lines = [`## Nightly fixture E2E ${report.passed ? "passed" : "failed"}`, "",
    `Candidate: \`${textCell(report.sourceSha)}\``,
    `Run: ${textCell(report.repository)} / ${textCell(report.runId)} / attempt ${textCell(report.runAttempt)}`, "",
    "| Gate | Status | Conclusion |", "| --- | --- | --- |",
    ...report.rows.map(row => `| ${textCell(row.name)} | ${textCell(row.status)} | ${textCell(row.conclusion)} |`)];
  if (report.errors.length) lines.push("", "Failures:", "", ...report.errors.map(error => `- ${textCell(error)}`));
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try {
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error("GITHUB_STEP_SUMMARY is required");
    const catalog = JSON.parse(await readFile(new URL("./e2e-suite-catalog.json", import.meta.url), "utf8"));
    report = await inspectNightlySummary({ env: process.env, catalog }, { api: githubTransport(process.env.GITHUB_TOKEN) });
    await appendFile(process.env.GITHUB_STEP_SUMMARY, renderNightlySummary(report));
    if (!report.passed) throw new Error(report.errors.join("; "));
  } catch (error) {
    const escaped = String(error.message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    console.error(`::error::Nightly fixture gate failed: ${escaped}`);
    process.exitCode = 1;
  }
}
