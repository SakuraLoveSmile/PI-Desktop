import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureEnvironment } from "../e2e-suite-runtime.mjs";

/** Run independent cold profiles for diagnosis, never as retry-to-pass evidence. */
export async function runCaptureDiagnosis({ root, script, attempts = 6, frameBarrier = false }) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6) {
    throw new Error("Capture diagnosis requires between one and six attempts");
  }
  if (typeof frameBarrier !== "boolean") throw new Error("Capture frame barrier must be explicitly boolean");
  const directory = resolve(root, ".artifacts/e2e/goal-capture-diagnosis");
  const scriptPath = resolve(root, script);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const summaryPath = join(directory, "summary.json");
  const summary = {
    schemaVersion: 1, purpose: "diagnosis", acceptanceEvidence: false,
    attempts, frameBarrier, status: "running", startedAt: new Date().toISOString(), passed: false, trials: [],
  };
  const persist = async () => {
    await writeFile(summaryPath + ".tmp", JSON.stringify(summary, null, 2) + "\n");
    await rename(summaryPath + ".tmp", summaryPath);
  };
  await persist();
  for (let index = 1; index <= attempts; index++) {
    const id = `trial-${String(index).padStart(2, "0")}`;
    const diagnosticDir = join(directory, id);
    await mkdir(diagnosticDir);
    const scratch = await mkdtemp(join(tmpdir(), "pi-goal-capture-diagnosis-"));
    const logPath = join(diagnosticDir, "child.log");
    await writeFile(logPath, "");
    const start = Date.now();
    const trial = {
      id, status: "running", diagnosticDir, logPath, temporaryRoot: scratch,
      startedAt: new Date(start).toISOString(), passed: false,
    };
    summary.trials.push(trial);
    await persist();
    try {
      const env = fixtureEnvironment(process.env, scratch);
      for (const path of new Set([env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.TMPDIR])) {
        await mkdir(path, { recursive: true });
      }
      let logError;
      const capture = chunk => {
        try { appendFileSync(logPath, chunk); }
        catch (error) { logError ??= { name: error.name, message: error.message }; }
      };
      const result = await new Promise(resolveResult => {
        let child;
        let spawnError;
        try {
          child = spawn(process.execPath, [scriptPath, "--capture-diagnostic-trial", "--capture-diagnostic-dir", diagnosticDir,
            ...(frameBarrier ? ["--capture-frame-barrier"] : [])], {
            cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: false,
          });
        } catch (error) {
          resolveResult({ code: null, signal: null, spawnError: { name: error.name, message: error.message } });
          return;
        }
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.once("error", error => { spawnError = { name: error.name, message: error.message }; });
        child.once("close", (code, signal) => resolveResult({ code, signal, ...(spawnError ? { spawnError } : {}) }));
      });
      Object.assign(trial, result, logError ? { logError } : {});
      trial.passed = result.code === 0 && !result.signal && !result.spawnError && !logError;
    } finally {
      await rm(scratch, { recursive: true, force: true });
      trial.status = "completed";
      trial.completedAt = new Date().toISOString();
      trial.durationMs = Date.now() - start;
      await persist();
    }
  }
  summary.status = "completed";
  summary.completedAt = new Date().toISOString();
  summary.passed = summary.trials.every(trial => trial.passed);
  await persist();
  return summary;
}
