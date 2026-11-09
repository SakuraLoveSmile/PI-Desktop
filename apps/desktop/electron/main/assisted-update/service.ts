import { chmod, copyFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandRunner } from "./commands";
import { downloadAsset, type HttpTransport } from "./download";
import { AssistedUpdateError } from "./errors";
import {
  BACKUP_PREFIX,
  COMMIT_FILE,
  HELPER_NAME,
  JOB_FILE,
  SCHEMA_VERSION,
  STAGE_FILE,
  STAGING_PREFIX,
  ensurePrivateDir,
  removeRecordedInstallDir,
  writeJsonAtomic,
  type AssistedPaths,
  type JobFile,
  type StageRecord,
} from "./job-store";
import { recoverPreviousInstalls, type RecoveryLog, type RecoveryOutcome } from "./recovery";
import { selectAssistedAsset, type FeedInfo } from "./release-asset";
import { readInfoPlist, stageUpdate } from "./staging";

export type AssistedServiceOptions = {
  paths: AssistedPaths;
  bundlePath: string;
  runningVersion: string;
  arch: string;
  /** The helper binary inside the running app (`Contents/Resources/bin`). */
  helperSource: string;
  transport: () => Promise<HttpTransport>;
  run: CommandRunner;
  /** Starts the copied helper detached; resolves once it is running. */
  spawnHelper: (helperPath: string, jobDir: string) => Promise<void>;
  log: RecoveryLog;
  now?: () => number;
  newJobId?: () => string;
  /** Test hook for the parent pid written into the job. */
  pid?: number;
};

type Prepared = { jobId: string; jobDir: string; stagingDir: string; stagedApp: string; version: string };

/** What the controller needs from the lane; tests substitute a fake. */
export type AssistedUpdateLane = Pick<
  AssistedUpdateService,
  | "recover"
  | "prepare"
  | "discardPrepared"
  | "install"
  | "commitPendingInstall"
  | "hasPendingInstall"
  | "skipsAutoInstall"
>;

/**
 * The assisted lane for one install: downloads and stages an update next to
 * the installed app, hands the exchange to the helper when the user restarts,
 * and cleans up after earlier attempts. It never touches the installed app.
 */
export class AssistedUpdateService {
  private readonly options: AssistedServiceOptions;
  private readonly installDir: string;
  private prepared: Prepared | null = null;
  private pendingCommit: { jobId: string; jobDir: string } | null = null;
  private failedVersion: string | undefined;
  private bundleId: string | null = null;

  constructor(options: AssistedServiceOptions) {
    this.options = options;
    this.installDir = dirname(options.bundlePath);
  }

  /** Once per launch, before any download: settle what earlier helpers left. */
  async recover(): Promise<RecoveryOutcome> {
    const { paths } = this.options;
    await ensurePrivateDir(paths.root);
    await ensurePrivateDir(paths.jobs);
    const outcome = await recoverPreviousInstalls({
      paths,
      runningVersion: this.options.runningVersion,
      now: (this.options.now ?? Date.now)(),
      skipJobId: this.prepared?.jobId,
      log: this.options.log,
    });
    this.failedVersion = outcome.failedVersion;
    return outcome;
  }

  /** An earlier in-place install of this version failed: do not retry it on its own. */
  skipsAutoInstall(version: string): boolean {
    return this.failedVersion === version;
  }

  hasPendingInstall(): boolean {
    return this.pendingCommit !== null;
  }

  /** Downloads, verifies and stages the update the feed offers. */
  async prepare(
    info: FeedInfo,
    hooks: { signal: AbortSignal; onProgress?: (percent: number) => void },
  ): Promise<{ version: string }> {
    if (this.pendingCommit) {
      throw new AssistedUpdateError("not-prepared", "an install is already pending");
    }
    const asset = selectAssistedAsset(info, this.options.arch);
    await this.discardPrepared();
    const { paths } = this.options;
    const jobId = (this.options.newJobId ?? defaultJobId)();
    const jobDir = join(paths.jobs, jobId);
    const stagingDir = join(this.installDir, `${STAGING_PREFIX}${jobId}`);
    const zipPath = join(paths.downloads, `${jobId}.zip`);
    await ensurePrivateDir(paths.downloads);
    await ensurePrivateDir(paths.jobs);
    await ensurePrivateDir(jobDir);
    const record: StageRecord = {
      schemaVersion: SCHEMA_VERSION,
      jobId,
      version: asset.version,
      targetApp: this.options.bundlePath,
      stagingDir,
      createdAtMs: (this.options.now ?? Date.now)(),
    };
    await writeJsonAtomic(join(jobDir, STAGE_FILE), record);
    try {
      await downloadAsset({
        asset,
        destination: zipPath,
        transport: await this.options.transport(),
        signal: hooks.signal,
        onProgress: hooks.onProgress,
      });
      throwIfAborted(hooks.signal);
      const { stagedApp } = await stageUpdate(
        {
          zipPath,
          stagingDir,
          running: {
            bundleId: await this.runningBundleId(),
            version: this.options.runningVersion,
          },
          offeredVersion: asset.version,
          arch: this.options.arch,
        },
        this.options.run,
      );
      this.prepared = { jobId, jobDir, stagingDir, stagedApp, version: asset.version };
      if (hooks.signal.aborted) {
        await this.discardPrepared();
        throwIfAborted(hooks.signal);
      }
      return { version: asset.version };
    } catch (error) {
      await removeRecordedInstallDir(stagingDir).catch(() => undefined);
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(zipPath, { force: true }).catch(() => undefined);
      await rm(`${zipPath}.part`, { force: true }).catch(() => undefined);
    }
  }

  /** Drops a staged update that will not be installed. */
  async discardPrepared(): Promise<void> {
    const prepared = this.prepared;
    if (!prepared || this.pendingCommit?.jobId === prepared.jobId) return;
    this.prepared = null;
    await removeRecordedInstallDir(prepared.stagingDir).catch(() => undefined);
    await rm(prepared.jobDir, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * The user chose to restart: write the helper's job, start the helper, and
   * remember that the commit file is owed. The caller quits only after this
   * resolves, so a failed start leaves the app running.
   */
  async install(): Promise<void> {
    const prepared = this.prepared;
    if (!prepared) throw new AssistedUpdateError("not-prepared", "no update has been staged");
    if (this.pendingCommit) return;
    const helperPath = join(prepared.jobDir, HELPER_NAME);
    try {
      await copyFile(this.options.helperSource, helperPath);
      await chmod(helperPath, 0o700);
    } catch (error) {
      throw new AssistedUpdateError("helper-missing", `the update helper is unavailable: ${String(error)}`);
    }
    const target = await stat(this.options.bundlePath, { bigint: true });
    const job: JobFile = {
      schemaVersion: SCHEMA_VERSION,
      jobId: prepared.jobId,
      parentPid: this.options.pid ?? process.pid,
      targetApp: this.options.bundlePath,
      targetDev: target.dev.toString(),
      targetIno: target.ino.toString(),
      stagedApp: prepared.stagedApp,
      backupDir: join(this.installDir, `${BACKUP_PREFIX}${prepared.jobId}`),
      fromVersion: this.options.runningVersion,
      toVersion: prepared.version,
    };
    await writeJsonAtomic(join(prepared.jobDir, JOB_FILE), job);
    await this.options.spawnHelper(helperPath, prepared.jobDir);
    this.pendingCommit = { jobId: prepared.jobId, jobDir: prepared.jobDir };
  }

  /**
   * Writes the commit file the helper waits for. Called by the shutdown path
   * after the sidecar and host-core have stopped, immediately before Main
   * exits; a quit that never reaches this point leaves no commit and the
   * helper does nothing.
   */
  async commitPendingInstall(): Promise<void> {
    const pending = this.pendingCommit;
    if (!pending) return;
    await writeJsonAtomic(join(pending.jobDir, COMMIT_FILE), {
      schemaVersion: SCHEMA_VERSION,
      jobId: pending.jobId,
    });
    this.pendingCommit = null;
  }

  private async runningBundleId(): Promise<string> {
    if (!this.bundleId) {
      this.bundleId = (await readInfoPlist(this.options.bundlePath, this.options.run)).bundleId;
    }
    return this.bundleId;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AssistedUpdateError("aborted", "download cancelled");
}

function defaultJobId(): string {
  return crypto.randomUUID();
}
