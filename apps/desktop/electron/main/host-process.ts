import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, rpcTimeoutMs } from "@pi-desktop/shared";

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
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private handlers = new Set<HostNotificationHandler>();
  private exitHandlers = new Set<ProcessExitHandler>();
  private disposed = false;
  private closed = false;
  private exitNotified = false;
  private readline?: ReturnType<typeof createInterface>;
  readonly binaryPath: string;

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
      this.closeTransport(new Error("host-core exited"));
      this.notifyExit({ code, signal, intentional: this.disposed });
    });
    this.child.on("error", (error) => {
      this.closeTransport(error instanceof Error ? error : new Error(String(error)));
      this.notifyExit({ code: null, signal: null, intentional: this.disposed });
    });

    const rl = createInterface({ input: this.child.stdout });
    this.readline = rl;
    rl.on("line", (line) => this.onLine(line));
  }

  private closeTransport(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.handlers.clear();
    this.readline?.close();
    this.readline = undefined;
    this.child.removeAllListeners("exit");
    this.child.removeAllListeners("error");
    this.child.stderr.removeAllListeners("data");
  }

  private notifyExit(info: {
    code: number | null;
    signal: NodeJS.Signals | null;
    intentional: boolean;
  }) {
    if (this.exitNotified) return;
    this.exitNotified = true;
    for (const h of this.exitHandlers) h(info);
    this.exitHandlers.clear();
  }

  onExit(handler: ProcessExitHandler): () => void {
    if (this.closed) return () => undefined;
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
        if (pending.timer) clearTimeout(pending.timer);
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
    if (this.closed) return () => undefined;
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) throw new Error("host-core is unavailable");
    const id = randomUUID();
    const timeoutMs = rpcTimeoutMs(method, params);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: any) => void,
        reject,
      });
      const settle = (settleWith: (pending: {
        resolve: (v: any) => void;
        reject: (e: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
      }) => void) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        settleWith(pending);
      };
      this.child.stdin.write(payload, (err) => {
        if (err) {
          this.closeTransport(err);
          this.notifyExit({ code: null, signal: null, intentional: this.disposed });
        }
      });
      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          settle((pending) => pending.reject(new Error(`host RPC timeout: ${method}`)));
        }, timeoutMs);
        const pending = this.pending.get(id);
        if (pending) pending.timer = timer;
      }
    });
  }

  async handshake(): Promise<void> {
    await this.call("app.handshake", { protocolVersion: PROTOCOL_VERSION });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.closeTransport(new Error("host-core disposed"));
    this.exitHandlers.clear();
    this.child.kill();
  }
}
