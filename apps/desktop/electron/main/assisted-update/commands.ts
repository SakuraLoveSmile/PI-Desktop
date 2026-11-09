import { execFile } from "node:child_process";

export type CommandResult = { code: number; stdout: string; stderr: string };

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number },
) => Promise<CommandResult>;

/**
 * Runs a system tool by absolute path. A non-zero exit resolves with its code;
 * a spawn failure, timeout or signal rejects.
 */
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as { code?: unknown }).code;
        if (typeof code === "number") {
          resolve({ code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
