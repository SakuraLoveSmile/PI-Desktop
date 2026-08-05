import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { IPty } from "node-pty";

/**
 * Work panel PTY sessions (D099).
 *
 * One login shell per workspace path, owned by the Electron main process.
 * Sessions survive panel close / tab switches; a bounded replay buffer
 * restores scrollback when the renderer reattaches. Everything dies with
 * the app via disposeAll().
 *
 * This interactive terminal has an independent PTY shell policy from the
 * agent's non-interactive Bash protocol tool. It prefers Git Bash on Windows,
 * bash on macOS/Linux, and honors `PI_DESKTOP_BASH` on any platform.
 */

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform === "win32") return /\.exe$/i.test(path);
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function searchPath(
  name: string,
  accept: (path: string) => boolean = () => true,
): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate) && accept(candidate)) return candidate;
  }
  return null;
}

/** Git for Windows bash: next to git.exe, then standard install dirs, then
 * a PATH scan that skips the WSL launcher in System32. */
function findWindowsGitBash(): string | null {
  const git = searchPath("git.exe");
  if (git) {
    const root = join(git, "..", "..");
    for (const rel of [join("bin", "bash.exe"), join("usr", "bin", "bash.exe")]) {
      const candidate = join(root, rel);
      if (isExecutable(candidate)) return candidate;
    }
  }
  for (const base of ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]) {
    const dir = process.env[base];
    if (!dir) continue;
    const root = base === "LocalAppData" ? join(dir, "Programs") : dir;
    const candidate = join(root, "Git", "bin", "bash.exe");
    if (isExecutable(candidate)) return candidate;
  }
  return searchPath("bash.exe", (p) => !/\bsystem32\b/i.test(p));
}

export function resolveShell(): { shell: string; args: string[] } {
  const override = process.env.PI_DESKTOP_BASH;
  if (override && isExecutable(override)) {
    return { shell: override, args: ["-l"] };
  }
  if (process.platform === "win32") {
    const gitBash = findWindowsGitBash();
    // Interactive login shell: users expect their aliases; slow Git Bash
    // profiles are acceptable for a terminal (unlike per-command tool runs).
    if (gitBash) return { shell: gitBash, args: ["-l", "-i"] };
    // Degraded fallback so the panel still opens without Git for Windows.
    return { shell: process.env.COMSPEC || "cmd.exe", args: [] };
  }
  const candidates = [
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
    "/opt/homebrew/bin/bash",
  ];
  const bash = candidates.find(isExecutable) ?? searchPath("bash");
  return { shell: bash ?? process.env.SHELL ?? "/bin/sh", args: ["-l"] };
}

const REPLAY_LIMIT_BYTES = 128 * 1024;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type PtySession = {
  termId: string;
  cwd: string;
  pty: IPty;
  replay: string;
  exited: boolean;
};

export type PtyEvents = {
  onData: (termId: string, data: string) => void;
  onExit: (termId: string, exitCode: number | null) => void;
};

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private byCwd = new Map<string, string>();
  private events: PtyEvents;

  constructor(events: PtyEvents) {
    this.events = events;
  }

  /** Create a session for `cwd`, or reattach to the live one. */
  async create(input: {
    cwd: string;
    cols?: number;
    rows?: number;
  }): Promise<{ termId: string; replay: string }> {
    const existingId = this.byCwd.get(input.cwd);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && !existing.exited) {
        return { termId: existing.termId, replay: existing.replay };
      }
    }

    // Deferred import: node-pty is a native module; loading it lazily keeps
    // app boot resilient if the binary is missing or incompatible.
    const { spawn } = await import("node-pty");
    const { shell, args } = resolveShell();
    const termId = randomUUID();
    const pty = spawn(shell, args, {
      name: "xterm-256color",
      cwd: input.cwd,
      cols: input.cols ?? DEFAULT_COLS,
      rows: input.rows ?? DEFAULT_ROWS,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });

    const session: PtySession = { termId, cwd: input.cwd, pty, replay: "", exited: false };
    this.sessions.set(termId, session);
    this.byCwd.set(input.cwd, termId);

    pty.onData((data) => {
      session.replay = (session.replay + data).slice(-REPLAY_LIMIT_BYTES);
      this.events.onData(termId, data);
    });
    pty.onExit(({ exitCode }) => {
      session.exited = true;
      // A dead session must not shadow the cwd for the next create().
      if (this.byCwd.get(session.cwd) === termId) this.byCwd.delete(session.cwd);
      this.sessions.delete(termId);
      this.events.onExit(termId, exitCode ?? null);
    });

    return { termId, replay: "" };
  }

  write(termId: string, data: string): void {
    this.sessions.get(termId)?.pty.write(data);
  }

  resize(termId: string, cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const safeCols = Math.max(2, Math.min(500, Math.floor(cols)));
    const safeRows = Math.max(2, Math.min(300, Math.floor(rows)));
    try {
      this.sessions.get(termId)?.pty.resize(safeCols, safeRows);
    } catch {
      // Resizing a just-exited pty throws; harmless.
    }
  }

  dispose(termId: string): void {
    const session = this.sessions.get(termId);
    if (!session) return;
    this.sessions.delete(termId);
    if (this.byCwd.get(session.cwd) === termId) this.byCwd.delete(session.cwd);
    session.exited = true;
    try {
      session.pty.kill();
    } catch {
      // already dead
    }
  }

  disposeAll(): void {
    for (const termId of [...this.sessions.keys()]) this.dispose(termId);
  }
}
