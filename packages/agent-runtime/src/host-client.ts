import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rpcTimeoutMs } from "@pi-desktop/shared";

export type JsonRpcResult = {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type HostCloseHandler = (error: Error) => void;

export class HostClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    {
      resolve: (v: JsonRpcResult) => void;
      reject: (e: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private notificationHandlers = new Set<(method: string, params: unknown) => void>();
  private closeHandlers = new Set<HostCloseHandler>();
  private closed = false;
  private readline?: ReturnType<typeof createInterface>;
  private ready: Promise<void>;

  constructor(binaryPath: string, env: Record<string, string | undefined> = {}) {
    this.child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    this.child.stderr.on("data", (buf) => {
      const text = buf.toString("utf8").trim();
      if (text) console.error(`[host-core] ${text}`);
    });

    this.child.on("exit", () => {
      this.close(new Error("host client child exited"));
    });
    this.child.on("error", (error) => {
      this.close(error instanceof Error ? error : new Error(String(error)));
    });

    const rl = createInterface({ input: this.child.stdout });
    this.readline = rl;
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && msg.id !== null) {
        const id = String(msg.id);
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve({ result: msg.result, error: msg.error });
        }
        return;
      }
      if (msg.method) {
        for (const h of this.notificationHandlers) {
          h(msg.method, msg.params);
        }
      }
    });

    this.ready = Promise.resolve();
  }

  private close(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.notificationHandlers.clear();
    this.readline?.close();
    this.readline = undefined;
    this.child.removeAllListeners("exit");
    this.child.removeAllListeners("error");
    this.child.stderr.removeAllListeners("data");
    for (const handler of this.closeHandlers) handler(error);
    this.closeHandlers.clear();
  }

  onClose(handler: HostCloseHandler): () => void {
    if (this.closed) return () => undefined;
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onNotification(handler: (method: string, params: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    await this.ready;
    if (this.closed) throw new Error("host client is unavailable");
    const id = randomUUID();
    const timeoutMs = rpcTimeoutMs(method, params);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const result = await new Promise<JsonRpcResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const settle = (settleWith: (pending: {
        resolve: (v: JsonRpcResult) => void;
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
        if (err) this.close(err);
      });
      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          settle((pending) => pending.reject(new Error(`host RPC timeout: ${method}`)));
        }, timeoutMs);
        const pending = this.pending.get(id);
        if (pending) pending.timer = timer;
      }
    });
    if (result.error) {
      const err = new Error(result.error.message) as Error & {
        code?: number;
        data?: unknown;
      };
      err.code = result.error.code;
      err.data = result.error.data;
      throw err;
    }
    return result.result as T;
  }

  async dispose(): Promise<void> {
    this.close(new Error("host client disposed"));
    this.child.kill();
  }
}
