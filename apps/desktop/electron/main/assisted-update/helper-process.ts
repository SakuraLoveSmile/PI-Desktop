import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { AssistedUpdateError } from "./errors";

/**
 * Starts the installer helper detached, so it survives the quit that follows.
 * Resolves once the process exists; its output goes to `helper.log` in the job
 * directory. The environment is rebuilt from a short allow-list: the helper
 * calls system tools by absolute path and needs nothing Electron added.
 */
export async function spawnDetachedHelper(helperPath: string, jobDir: string): Promise<void> {
  const logFd = openSync(join(jobDir, "helper.log"), "a", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(helperPath, ["--job-dir", jobDir], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        cwd: "/",
        env: helperEnvironment(process.env),
      });
      child.once("error", (error) =>
        reject(new AssistedUpdateError("helper-spawn", `cannot start the update helper: ${error.message}`)),
      );
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    closeSync(logFd);
  }
}

export function helperEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "__CF_USER_TEXT_ENCODING"]) {
    const value = env[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}
