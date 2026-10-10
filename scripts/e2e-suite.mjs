#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { candidateIdentity, loadCatalog, runSuite, selectSuites } from "./e2e-suite-runtime.mjs";

const { values } = parseArgs({ options: {
  tier: { type: "string", default: "nightly" }, family: { type: "string" }, suite: { type: "string" },
  list: { type: "boolean" }, matrix: { type: "boolean" }, report: { type: "string" },
} });
const catalog = await loadCatalog();
if (values.matrix) console.log(JSON.stringify(catalog.families));
else {
  const selected = selectSuites(catalog, values);
  if (values.list) console.log(JSON.stringify(selected, null, 2));
  else {
    const candidate = await candidateIdentity();
    const results = [];
    for (const entry of selected) {
      console.log(`RUN ${entry.id} (${entry.family}/${entry.tier})`);
      results.push(await runSuite(entry));
    }
    const after = await candidateIdentity();
    const candidateUnchanged = candidate.head === after.head && candidate.baseMain === after.baseMain && candidate.workspaceDiffSha256 === after.workspaceDiffSha256 && candidate.hostBinarySha256 === after.hostBinarySha256;
    const report = { candidate, candidateUnchanged, tier: values.tier, family: values.family ?? "all", results,
      passed: candidateUnchanged && results.every(result => result.passed),
      manual: catalog.suites.filter(entry => entry.tier === "manual").map(({ id, safety }) => ({ id, reason: safety })),
    };
    if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + "\n");
    console.log(`E2E suites: ${results.filter(result => result.passed).length}/${results.length} passed; manual/excluded cases are not acceptance evidence.`);
    if (!candidateUnchanged) console.error("E2E candidate sources changed during execution; rerun against a stable candidate.");
    if (!report.passed) process.exitCode = 1;
  }
}
