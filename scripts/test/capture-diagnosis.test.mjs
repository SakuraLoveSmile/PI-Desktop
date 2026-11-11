import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCaptureDiagnosis } from "../e2e/capture-diagnosis.mjs";

async function fixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), "capture-diagnosis-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, "child.mjs");
  await writeFile(script, source);
  return { root, script, directory: join(root, ".artifacts/e2e/goal-capture-diagnosis") };
}

const childSetup = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: {
  "capture-diagnostic-trial": { type: "boolean" },
  "capture-diagnostic-dir": { type: "string" },
  "capture-frame-barrier": { type: "boolean" },
} });
if (!values["capture-diagnostic-trial"]) throw new Error("Expected diagnostic trial flag");
const directory = values["capture-diagnostic-dir"];
const id = basename(directory);
`;

test("retains every cold trial and both output streams when an earlier trial fails", async t => {
  const { root, script, directory } = await fixture(t, childSetup + `
const summary = JSON.parse(readFileSync(join(dirname(directory), "summary.json"), "utf8"));
writeFileSync(join(directory, "observed-summary.json"), JSON.stringify(summary));
writeFileSync(join(directory, "environment.json"), JSON.stringify({
  home: process.env.HOME, cache: process.env.XDG_CACHE_HOME, tmp: process.env.TMPDIR,
  secretPresent: "CAPTURE_DIAGNOSIS_TEST_SECRET" in process.env,
  markerExisted: existsSync(join(process.env.HOME, "marker")),
}));
writeFileSync(join(process.env.HOME, "marker"), id);
console.log("stdout " + id); console.error("stderr " + id);
if (id === "trial-02") process.exitCode = 7;
`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "old-success.json"), '{"passed":true}');
  const previousSecret = process.env.CAPTURE_DIAGNOSIS_TEST_SECRET;
  process.env.CAPTURE_DIAGNOSIS_TEST_SECRET = "must-not-reach-child";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.CAPTURE_DIAGNOSIS_TEST_SECRET;
    else process.env.CAPTURE_DIAGNOSIS_TEST_SECRET = previousSecret;
  });
  const summary = await runCaptureDiagnosis({ root, script });
  assert.equal(summary.purpose, "diagnosis");
  assert.equal(summary.acceptanceEvidence, false);
  assert.equal(summary.passed, false);
  assert.equal(summary.status, "completed");
  assert.equal(summary.trials.length, 6);
  assert.deepEqual(summary.trials.map(trial => trial.code), [0, 7, 0, 0, 0, 0]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "summary.json"), "utf8")), summary);
  await assert.rejects(access(join(directory, "old-success.json")), { code: "ENOENT" });
  const homes = [], caches = [], temporaryDirectories = [];
  for (const [index, trial] of summary.trials.entries()) {
    assert.equal(trial.status, "completed");
    const log = await readFile(trial.logPath, "utf8");
    assert.match(log, new RegExp(`stdout ${trial.id}`));
    assert.match(log, new RegExp(`stderr ${trial.id}`));
    const observed = JSON.parse(await readFile(join(trial.diagnosticDir, "observed-summary.json"), "utf8"));
    assert.equal(observed.trials.length, index + 1);
    assert.equal(observed.trials[index].status, "running");
    assert.equal(observed.passed, false);
    const environment = JSON.parse(await readFile(join(trial.diagnosticDir, "environment.json"), "utf8"));
    assert.equal(environment.secretPresent, false);
    assert.equal(environment.markerExisted, false);
    homes.push(environment.home); caches.push(environment.cache); temporaryDirectories.push(environment.tmp);
    await assert.rejects(access(trial.temporaryRoot), { code: "ENOENT" });
  }
  assert.equal(new Set(homes).size, 6);
  assert.equal(new Set(caches).size, 6);
  assert.equal(new Set(temporaryDirectories).size, 6);
});

test("marks a successful diagnosis complete while keeping it separate from acceptance", async t => {
  const { root, script } = await fixture(t, childSetup + 'console.log("finished fixture");');
  const summary = await runCaptureDiagnosis({ root, script, attempts: 1 });
  assert.equal(summary.passed, true);
  assert.equal(summary.acceptanceEvidence, false);
  assert.equal(summary.trials[0].passed, true);
  assert.equal(summary.trials[0].code, 0);
  assert.equal(summary.trials[0].signal, null);
  assert.equal(summary.frameBarrier, false);
});

test("forwards an explicitly requested frame barrier only as diagnostic evidence", async t => {
  const { root, script } = await fixture(t, childSetup + 'if (!values["capture-frame-barrier"]) throw new Error("Missing frame barrier");');
  const summary = await runCaptureDiagnosis({ root, script, attempts: 1, frameBarrier: true });
  assert.equal(summary.passed, true);
  assert.equal(summary.frameBarrier, true);
  assert.equal(summary.acceptanceEvidence, false);
});

test("preserves a signalled child as a failed trial", async t => {
  const { root, script } = await fixture(t, childSetup + 'process.kill(process.pid, "SIGTERM");');
  const summary = await runCaptureDiagnosis({ root, script, attempts: 1 });
  assert.equal(summary.passed, false);
  assert.equal(summary.trials[0].code, null);
  assert.equal(summary.trials[0].signal, "SIGTERM");
  assert.equal(summary.trials[0].passed, false);
});

test("rejects an unbounded diagnosis before replacing existing evidence", async t => {
  const { root, script, directory } = await fixture(t, 'throw new Error("must not run");');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "summary.json"), "existing evidence");
  for (const attempts of [0, 7, 1.5, Number.NaN]) {
    await assert.rejects(runCaptureDiagnosis({ root, script, attempts }), /between one and six/);
  }
  assert.equal(await readFile(join(directory, "summary.json"), "utf8"), "existing evidence");
});
