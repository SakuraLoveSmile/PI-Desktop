import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  JOB_FILE,
  RESULT_FILE,
  STAGE_FILE,
  SCHEMA_VERSION,
  isJobId,
  loadState,
  readJsonFile,
  removeRecordedInstallDir,
  saveState,
  type AssistedPaths,
  type HelperResult,
  type HelperResultStatus,
} from "./job-store";


/** A job without a result older than this is abandoned (the helper gives up after two minutes). */
export const STALE_JOB_MS = 10 * 60 * 1000;

const NO_FAULT: ReadonlySet<HelperResultStatus> = new Set([
  "not_committed",
  "parent_still_running",
  "locked",
  "target_changed",
]);

export type RecoveryLog = (
  level: "info" | "warn",
  message: string,
  data?: Record<string, unknown>,
) => void;

export type RecoveryOutcome = {
  /** A version whose in-place install failed; the lane stops auto-installing it. */
  failedVersion?: string;
  /** True when the previous install was confirmed by the running version. */
  confirmed: boolean;
};

/**
 * Reads what earlier helpers left behind, once per launch: records failures,
 * keeps one backup after a confirmed install, and removes every staging and
 * job directory that belongs to a finished or abandoned job.
 */
export async function recoverPreviousInstalls(args: {
  paths: AssistedPaths;
  runningVersion: string;
  now: number;
  skipJobId?: string;
  log: RecoveryLog;
}): Promise<RecoveryOutcome> {
  const { paths, runningVersion, now, log } = args;
  const state = await loadState(paths);
  let confirmed = false;
  const names = await readdir(paths.jobs).catch(() => [] as string[]);
  for (const name of names) {
    if (!isJobId(name) || name === args.skipJobId) continue;
    const dir = join(paths.jobs, name);
    const stat = await lstat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const result = parseResult(await readJsonFile(join(dir, RESULT_FILE)));
    const record = ((await readJsonFile(join(dir, JOB_FILE))) ??
      (await readJsonFile(join(dir, STAGE_FILE)))) as Record<string, unknown> | null;
    const stagingDir = stagingDirOf(record);
    const backupDir = typeof record?.backupDir === "string" ? record.backupDir : undefined;

    if (!result) {
      if (now - stat.mtimeMs < STALE_JOB_MS) continue; // a helper may still be working
      await removeRecordedInstallDir(stagingDir);
      await rm(dir, { recursive: true, force: true });
      log("info", "removed an abandoned update job", { jobId: name });
      continue;
    }

    log("info", "previous assisted install finished", {
      jobId: name,
      status: result.status,
      message: result.message,
    });
    if (result.status === "launch_requested") {
      if (result.toVersion === runningVersion && backupDir) {
        confirmed = true;
        if (state.backupDir && state.backupDir !== backupDir) {
          await removeRecordedInstallDir(state.backupDir);
        }
        state.backupDir = backupDir;
        if (state.failedVersion) delete state.failedVersion;
      }
    } else if (result.status === "rollback_failed") {
      state.failedVersion = result.toVersion;
      log("warn", "the previous app could not be restored; its backup is kept", {
        backupApp: result.backupApp,
      });
    } else {
      if (!NO_FAULT.has(result.status)) state.failedVersion = result.toVersion;
      await removeRecordedInstallDir(backupDir);
    }
    if (result.status !== "launch_requested") await removeRecordedInstallDir(stagingDir);
    await rm(dir, { recursive: true, force: true });
  }
  await saveState(paths, state);
  return { failedVersion: state.failedVersion, confirmed };
}

function stagingDirOf(record: Record<string, unknown> | null): string | undefined {
  if (typeof record?.stagingDir === "string") return record.stagingDir;
  // A job file names the staged app; its directory is the staging directory.
  if (typeof record?.stagedApp === "string") return record.stagedApp.replace(/\/[^/]+$/, "");
  return undefined;
}

function parseResult(value: unknown): HelperResult | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof raw.status !== "string" || typeof raw.toVersion !== "string") return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    jobId: typeof raw.jobId === "string" ? raw.jobId : "",
    status: raw.status as HelperResultStatus,
    message: typeof raw.message === "string" ? raw.message : "",
    fromVersion: typeof raw.fromVersion === "string" ? raw.fromVersion : "",
    toVersion: raw.toVersion,
    backupApp: typeof raw.backupApp === "string" ? raw.backupApp : null,
    finishedAtMs: typeof raw.finishedAtMs === "number" ? raw.finishedAtMs : 0,
  };
}
