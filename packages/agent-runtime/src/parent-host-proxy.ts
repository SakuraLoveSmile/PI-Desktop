import { randomUUID } from "node:crypto";

/**
 * Host client that proxies RPC calls to the Electron main process
 * via the sidecar stdio JSON-RPC channel.
 */
export class ParentHostProxy {
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private notificationHandlers = new Set<(method: string, params: unknown) => void>();

  /** Handle a response/notification line coming from parent on stdin. */
  handleParentMessage(msg: any) {
    if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error)) {
      const pending = this.pending.get(String(msg.id));
      if (pending) {
        this.pending.delete(String(msg.id));
        clearTimeout(pending.timeout);
        if (msg.error) {
          const err = new Error(msg.error.message) as Error & { data?: unknown };
          err.data = msg.error.data;
          pending.reject(err);
        } else {
          pending.resolve(msg.result);
        }
      }
      return true;
    }
    if (msg.method === "host.notification") {
      for (const h of this.notificationHandlers) {
        h(msg.params?.method, msg.params?.params);
      }
      return true;
    }
    return false;
  }

  onNotification(handler: (method: string, params: unknown) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async call<T = unknown>(
    method: string,
    params: unknown = {},
    timeoutMs = 130_000,
  ): Promise<T> {
    const id = randomUUID();
    const payload =
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "host.proxy",
        params: { method, params },
      }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`parent host proxy timeout: ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: any) => void,
        reject,
        timeout,
      });
      process.stdout.write(payload, (err) => {
        if (err) {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            clearTimeout(pending.timeout);
            pending.reject(err);
          }
        }
      });
    });
  }

  async dispose(): Promise<void> {
    // parent owns the real host process
  }
}
