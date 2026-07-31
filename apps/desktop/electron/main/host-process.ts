import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@pi-desktop/shared";

export type HostNotificationHandler = (method: string, params: unknown) => void;
export type ProcessExitHandler = (info: {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
}) => void;
export type StderrHandler = (text: string) => void;

function resolveHostBinary(): string {
  if (process.env.PI_DESKTOP_HOST_BIN && existsSync(process.env.PI_DESKTOP_HOST_BIN)) {
    return process.env.PI_DESKTOP_HOST_BIN;
  }
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    // packaged resources
    join(process.resourcesPath || "", `bin/pi-desktop-host-core${exe}`),
    // monorepo dev/build
    join(__dirname, `../../../../target/debug/pi-desktop-host-core${exe}`),
    join(__dirname, `../../../../target/release/pi-desktop-host-core${exe}`),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  throw new Error(
    "host-core binary not found. Run `cargo build -p host-core` first.",
  );
}

export class HostProcess {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private handlers = new Set<HostNotificationHandler>();
  private exitHandlers = new Set<ProcessExitHandler>();
  private disposed = false;
  private available = true;
  readonly binaryPath: string;
  readonly generation = randomUUID();

  constructor(dataDir: string, onStderr?: StderrHandler) {
    this.binaryPath = resolveHostBinary();
    this.child = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_DESKTOP_DATA_DIR: dataDir,
      },
    });

    this.child.stderr.on("data", (buf) => {
      const text = String(buf).trim();
      if (!text) return;
      if (onStderr) onStderr(text);
      else console.error(`[host-core] ${text}`);
    });

    this.child.on("exit", (code, signal) => {
      this.available = false;
      this.rejectAllPending(this.unavailableError("host-core exited"));
      for (const h of this.exitHandlers) {
        h({ code, signal, intentional: this.disposed });
      }
    });
    this.child.on("error", (error) => {
      this.available = false;
      this.rejectAllPending(this.unavailableError(`host-core process error: ${error.message}`));
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.onLine(line));
  }

  private rejectAllPending(error: Error) {
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();
  }

  private unavailableError(message: string): Error & { errorCode: string } {
    return Object.assign(new Error(message), { errorCode: "HOST_UNAVAILABLE" });
  }

  isAvailable(): boolean {
    return this.available && this.child.exitCode === null && !this.child.killed;
  }

  onExit(handler: ProcessExitHandler): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(String(msg.id));
      if (pending) {
        this.pending.delete(String(msg.id));
        if (msg.error) {
          const err = new Error(msg.error.message) as Error & {
            code?: number;
            data?: unknown;
          };
          err.code = msg.error.code;
          err.data = msg.error.data;
          pending.reject(err);
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }
    if (msg.method) {
      for (const h of this.handlers) h(msg.method, msg.params);
    }
  }

  onNotification(handler: HostNotificationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.isAvailable()) {
      throw this.unavailableError(`host RPC unavailable: ${method}`);
    }
    const id = randomUUID();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      if (!this.isAvailable()) {
        reject(this.unavailableError(`host RPC unavailable: ${method}`));
        return;
      }
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`host RPC timeout: ${method}`));
        }
      }, 130_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.child.stdin.write(payload, (err) => {
          if (err) {
            this.pending.delete(id);
            clearTimeout(timeout);
            reject(this.unavailableError(`host RPC write failed: ${err.message}`));
          }
        });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(
          this.unavailableError(
            `host RPC write failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  async handshake(): Promise<void> {
    await this.call("app.handshake", { protocolVersion: PROTOCOL_VERSION });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.available = false;
    this.rejectAllPending(this.unavailableError("host-core disposed"));
    if (!this.child.killed && this.child.exitCode === null) {
      this.child.kill();
    }
  }
}
