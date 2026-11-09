import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

export const STAGING_PREFIX = ".pi-desktop-plus-update-";
export const BACKUP_PREFIX = ".pi-desktop-plus-backup-";
export const HELPER_NAME = "pi-desktop-update-helper";
export const STAGE_FILE = "stage.json";
export const JOB_FILE = "job.json";
export const COMMIT_FILE = "commit.json";
export const RESULT_FILE = "result.json";
export const SCHEMA_VERSION = 1;

const JOB_ID = /^[A-Za-z0-9-]{8,64}$/;
const INSTALL_DIR_NAME = /^\.pi-desktop-plus-(update|backup)-[A-Za-z0-9-]{8,64}$/;
const ASSISTED_DIR_NAME = "pi-desktop-plus-assisted-update";

export type AssistedPaths = { root: string; downloads: string; jobs: string; state: string };

export function assistedPaths(cacheBasePath: string): AssistedPaths {
  const root = join(cacheBasePath, ASSISTED_DIR_NAME);
  return {
    root,
    downloads: join(root, "downloads"),
    jobs: join(root, "jobs"),
    state: join(root, "state.json"),
  };
}

export function isJobId(value: string): boolean {
  return JOB_ID.test(value);
}

/** Main's record of a staged update, written before the staging directory exists. */
export type StageRecord = {
  schemaVersion: 1;
  jobId: string;
  version: string;
  targetApp: string;
  stagingDir: string;
  createdAtMs: number;
};

/** The helper's input; field names are the helper's contract (crates/update-helper). */
export type JobFile = {
  schemaVersion: 1;
  jobId: string;
  parentPid: number;
  targetApp: string;
  targetDev: string;
  targetIno: string;
  stagedApp: string;
  backupDir: string;
  fromVersion: string;
  toVersion: string;
};

export type HelperResultStatus =
  | "launch_requested"
  | "not_committed"
  | "parent_still_running"
  | "locked"
  | "target_changed"
  | "bundle_in_use"
  | "staged_invalid"
  | "swap_failed"
  | "rolled_back"
  | "rollback_failed"
  | "invalid_job";

export type HelperResult = {
  schemaVersion: 1;
  jobId: string;
  status: HelperResultStatus;
  message: string;
  fromVersion: string;
  toVersion: string;
  backupApp: string | null;
  finishedAtMs: number;
};

/** Survives restarts: the one retained backup and a version whose install failed. */
export type AssistedState = { schemaVersion: 1; backupDir?: string; failedVersion?: string };

export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

/** Parsed JSON, or null when the file is missing or unreadable. */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function loadState(paths: AssistedPaths): Promise<AssistedState> {
  const raw = (await readJsonFile(paths.state)) as Record<string, unknown> | null;
  const state: AssistedState = { schemaVersion: SCHEMA_VERSION };
  if (typeof raw?.backupDir === "string") state.backupDir = raw.backupDir;
  if (typeof raw?.failedVersion === "string") state.failedVersion = raw.failedVersion;
  return state;
}

export async function saveState(paths: AssistedPaths, state: AssistedState): Promise<void> {
  await ensurePrivateDir(paths.root);
  await writeJsonAtomic(paths.state, state);
}

/**
 * Removes a staging or backup directory that an earlier job recorded. Anything
 * that is not exactly such a directory (name pattern, real directory, owned by
 * this user) is left alone: recorded paths are data, not authority.
 */
export async function removeRecordedInstallDir(path: unknown): Promise<boolean> {
  if (typeof path !== "string" || !isAbsolute(path) || !INSTALL_DIR_NAME.test(basename(path))) {
    return false;
  }
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isDirectory()) return false;
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return false;
  await rm(path, { recursive: true, force: true });
  return true;
}
