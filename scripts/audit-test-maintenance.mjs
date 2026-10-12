#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Missing failure evidence is unknown, never proof that a test found nothing. */
export function auditRows(churn, evidence, since, until) {
  if (evidence && (!evidence.coverage || !Array.isArray(evidence.regressions))) throw new Error("Evidence requires coverage and regressions");
  if (evidence) {
    const { from, to, complete } = evidence.coverage;
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || typeof complete !== "boolean" || Date.parse(to) < Date.parse(from)) throw new Error("Invalid evidence coverage interval");
    for (const entry of evidence.regressions) {
      if (typeof entry.path !== "string" || !Number.isFinite(Date.parse(entry.caughtAt)) || typeof entry.evidence !== "string" || !entry.evidence.trim()) throw new Error("Each regression requires path, caughtAt, and a verifiable evidence reference");
    }
  }
  const complete = evidence?.coverage.complete === true && Date.parse(evidence.coverage.from) <= Date.parse(since) && Date.parse(evidence.coverage.to) >= Date.parse(until);
  return Object.entries(churn).map(([path, changedCommits]) => {
    const catches = evidence?.regressions.filter((entry) => entry.path === path && Date.parse(entry.caughtAt) >= Date.parse(since) && Date.parse(entry.caughtAt) <= Date.parse(until)) ?? [];
    return {
      path, changedCommits,
      regressionSignal: catches.length ? "observed" : complete ? "none-recorded" : "unknown",
      recordedCatches: catches.length,
      evidence: catches.map((entry) => entry.evidence),
      action: changedCommits >= 5 ? "review-for-behavior-coverage-or-retirement" : "monitor",
    };
  }).sort((left, right) => right.changedCommits - left.changedCommits || left.path.localeCompare(right.path));
}

export function run(args = process.argv.slice(2), root = process.cwd()) {
  const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const until = option("--until") ?? new Date().toISOString();
  const since = option("--since") ?? new Date(Date.parse(until) - 90 * 86_400_000).toISOString();
  if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.parse(since)) throw new Error("Invalid audit interval");
  const log = execFileSync("git", ["log", `--since=${since}`, `--until=${until}`, "--format=COMMIT:%H", "--name-only", "--", "apps/desktop/test", "packages", "scripts/test"], { cwd: root, encoding: "utf8" });
  const churn = {};
  let changed = new Set();
  const flush = () => { for (const path of changed) churn[path] = (churn[path] ?? 0) + 1; changed = new Set(); };
  for (const line of log.split("\n")) {
    if (line.startsWith("COMMIT:")) flush();
    else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(line)) changed.add(line);
  }
  flush();
  const evidencePath = option("--evidence");
  const evidence = evidencePath ? JSON.parse(readFileSync(resolve(root, evidencePath), "utf8")) : undefined;
  const report = { since, until, evidenceCoverage: evidence?.coverage ?? null, rows: auditRows(churn, evidence, since, until) };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const output = option("--output");
  if (output) writeFileSync(resolve(root, output), json);
  else process.stdout.write(json);
  return report;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
