#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubTransport, publishRelease } from "./publish-release.mjs";
import { parseReleaseVersion } from "./release-preflight.mjs";

const requiredJobs = [
  "Validate source, version and signing requirements",
  "Verify candidate / JS build / typecheck / lint / architecture / test",
  "Verify candidate / Rust host-core format / lint / test",
  "Verify candidate / Isolated launch / message / approval / restart smoke / fixture",
  "Build macOS arm64",
  "Verify macOS arm64 installer bundle",
];
const publicationJob = "Publish verified GitHub Release";

function positiveId(value, label) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(value);
}

async function list(api, endpoint, key) {
  const values = [];
  for (let page = 1; page <= 10; page++) {
    const response = await api("GET", `${endpoint}&per_page=100&page=${page}`);
    if (!Array.isArray(response?.[key])) throw new Error(`GitHub did not return ${key}`);
    values.push(...response[key]);
    if (response[key].length < 100) return values;
  }
  throw new Error(`Incomplete ${key} search`);
}

export async function inspectReleaseRecovery({ runId, env }, { api }) {
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Release recovery must be dispatched from main on a GitHub-hosted Actions runner");
  }
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository ?? "")) {
    throw new Error("Invalid recovery repository");
  }
  const allowUnsigned = env.ALLOW_UNSIGNED_MACOS_RELEASE ?? "false";
  if (!["true", "false"].includes(allowUnsigned)) throw new Error("ALLOW_UNSIGNED_MACOS_RELEASE must be true or false");
  const id = positiveId(runId, "release run ID");
  const root = `/repos/${repository}/actions`;
  const workflow = await api("GET", `${root}/workflows/release.yml`);
  const run = await api("GET", `${root}/runs/${id}`);
  if (run.id !== id || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.workflow_id !== workflow.id || !Number.isSafeInteger(workflow.id) || workflow.id <= 0 ||
      run.path !== ".github/workflows/release.yml" || run.event !== "push" || run.status !== "completed" ||
      !["failure", "cancelled"].includes(run.conclusion) || !/^[a-f0-9]{40}$/.test(run.head_sha ?? "") ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0 ||
      run.html_url !== `https://github.com/${repository}/actions/runs/${id}`) {
    throw new Error("Recovery requires a completed failed tag run from this repository's Release workflow");
  }
  if (!run.head_branch?.startsWith("v")) throw new Error("Recovery requires a version tag");
  const version = parseReleaseVersion(run.head_branch.slice(1)).version;
  const jobs = await list(api, `${root}/runs/${id}/jobs?filter=latest`, "jobs");
  const expectedNames = [...requiredJobs, publicationJob];
  if (jobs.length !== expectedNames.length || new Set(jobs.map(job => job.name)).size !== jobs.length ||
      jobs.some(job => !expectedNames.includes(job.name) || job.status !== "completed" ||
        job.run_id !== id || job.head_sha !== run.head_sha) ||
      requiredJobs.some(name => jobs.find(job => job.name === name)?.conclusion !== "success") ||
      !["failure", "cancelled"].includes(jobs.find(job => job.name === publicationJob)?.conclusion)) {
    throw new Error("All six release gates must pass; only publication may have failed");
  }
  const artifactName = `release-bundle-${version}-${run.head_sha}`;
  const artifacts = await list(api, `${root}/runs/${id}/artifacts?name=${encodeURIComponent(artifactName)}`, "artifacts");
  if (artifacts.length !== 1) throw new Error("Recovery requires exactly one verified release bundle");
  const artifact = artifacts[0];
  if (artifact.name !== artifactName || artifact.expired !== false ||
      !Number.isSafeInteger(artifact.id) || artifact.id <= 0 ||
      !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") ||
      artifact.workflow_run?.id !== id || artifact.workflow_run?.head_sha !== run.head_sha ||
      artifact.workflow_run?.head_branch !== run.head_branch) {
    throw new Error("Release bundle provenance is missing, expired or mismatched");
  }
  return { repository, runId, runAttempt: String(run.run_attempt), sourceSha: run.head_sha,
    tag: run.head_branch, version, artifactId: String(artifact.id), artifactName,
    allowUnsignedMacos: allowUnsigned === "true" };
}

export async function recoverReleasePublication({ directory, artifactId, ...input }, { api }) {
  positiveId(artifactId, "pinned artifact ID");
  const receipt = await inspectReleaseRecovery(input, { api });
  if (receipt.artifactId !== artifactId) throw new Error("Verified release artifact changed after recovery preparation");
  const manifest = JSON.parse(await readFile(join(directory, "release-manifest.json"), "utf8"));
  if (manifest.kind !== "release" || manifest.version !== receipt.version ||
      manifest.source?.repository !== receipt.repository || manifest.source?.sha !== receipt.sourceSha ||
      manifest.build?.runId !== receipt.runId || manifest.build?.runAttempt !== receipt.runAttempt ||
      manifest.build?.url !== `https://github.com/${receipt.repository}/actions/runs/${receipt.runId}`) {
    throw new Error("Downloaded release manifest does not match the original verified run and attempt");
  }
  return publishRelease({ directory, repository: receipt.repository, sourceSha: receipt.sourceSha,
    ref: `refs/tags/${receipt.tag}`, allowUnsignedMacos: receipt.allowUnsignedMacos }, { api });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] !== "--run-id" || ![2, 6].includes(args.length) ||
        (args.length === 6 && (args[2] !== "--artifact-id" || args[4] !== "--directory"))) {
      throw new Error("Usage: recover-release-publication.mjs --run-id <id> [--artifact-id <id> --directory <verified-bundle>]");
    }
    const input = { runId: args[1], env: process.env };
    const remote = { api: githubTransport(process.env.GITHUB_TOKEN) };
    if (args.length === 6) {
      const url = await recoverReleasePublication({ ...input, artifactId: args[3], directory: resolve(args[5]) }, remote);
      console.log(`Recovered verified release: ${url}`);
    } else {
      const receipt = await inspectReleaseRecovery(input, remote);
      if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required for recovery preparation");
      await appendFile(process.env.GITHUB_OUTPUT, `artifact_id=${receipt.artifactId}\nartifact_name=${receipt.artifactName}\n` +
        `run_id=${receipt.runId}\ntag=${receipt.tag}\nallow_unsigned_macos=${receipt.allowUnsignedMacos}\n`);
      console.log(`Verified recovery source: ${receipt.repository} ${receipt.tag} ${receipt.sourceSha} run ${receipt.runId}`);
    }
  } catch (error) {
    console.error(`Release recovery failed: ${error.message}`);
    process.exitCode = 1;
  }
}
