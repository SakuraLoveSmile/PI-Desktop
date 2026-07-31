import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { HostProcess, ProcessExitHandler, StderrHandler } from "./host-process";

export type SidecarNotificationHandler = (method: string, params: unknown) => void;

/** Result shape the sidecar's tool executor expects from tools.execute. */
export type LocalToolResult = {
  ok: boolean;
  content: unknown;
  isError?: boolean;
  errorCode?: string;
};

export type LocalToolHandler = (input: {
  sessionId: string;
  toolCallId: string;
  args: unknown;
}) => Promise<LocalToolResult>;

export type ProjectInstructionResolver = (input: {
  sessionId: string;
  path: string;
}) => Promise<unknown>;

// The sidecar runs model-directed code paths; it must not be able to pull
// secrets or mutate configuration through the parent proxy. Tight allowlist
// of host methods the agent loop legitimately needs.
const HOST_PROXY_ALLOWED = new Set([
  "tools.execute",
  "tools.list",
  "session.get",
  "session.appendMessage",
  "session.appendCompaction",
  "session.replaceMessages",
  "workspace.get",
  "plans.enter",
  "plans.submit",
  "plans.pending",
  "plans.abort",
  "project.instructions.resolve",
  "app.health",
]);

function resolveSidecarEntry(): string {
  const candidates = [
    join(process.resourcesPath || "", "agent-runtime/sidecar.js"),
    join(__dirname, "../../../agent-runtime/dist/sidecar.js"),
    join(__dirname, "../../../../packages/agent-runtime/dist/sidecar.js"),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return join(__dirname, "../../../../packages/agent-runtime/dist/sidecar.js");
}

export class AgentSidecar {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private handlers = new Set<SidecarNotificationHandler>();
  private exitHandlers = new Set<ProcessExitHandler>();
  private disposed = false;
  private host: HostProcess | null = null;
  private unsubscribeHost: (() => void) | null = null;
  // Tools served by Electron main itself (e.g. BrowserPreview drives the
  // work panel's WebContentsView) — host-core never sees these.
  private localTools = new Map<string, LocalToolHandler>();
  private projectInstructionResolver: ProjectInstructionResolver | null = null;

  constructor(onStderr?: StderrHandler) {
    const entry = resolveSidecarEntry();
    this.child = spawn(process.execPath, [entry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    this.child.stderr.on("data", (buf) => {
      const text = String(buf).trim();
      if (!text) return;
      if (onStderr) onStderr(text);
      else console.error(`[agent-sidecar] ${text}`);
    });

    this.child.on("exit", (code, signal) => {
      this.rejectAllPending(new Error("agent sidecar exited"));
      for (const h of this.exitHandlers) {
        h({ code, signal, intentional: this.disposed });
      }
    });
    this.child.on("error", () => {
      this.rejectAllPending(new Error("agent sidecar spawn failed"));
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => void this.onLine(line));
  }

  private rejectAllPending(error: Error) {
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();
  }

  onExit(handler: ProcessExitHandler): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  /** Register a tool the sidecar can call that main handles locally. */
  setLocalTool(name: string, handler: LocalToolHandler): void {
    this.localTools.set(name, handler);
  }

  setProjectInstructionResolver(resolver: ProjectInstructionResolver): void {
    this.projectInstructionResolver = resolver;
  }

  setHost(host: HostProcess) {
    this.host = host;
    this.unsubscribeHost?.();
    this.unsubscribeHost = host.onNotification((method, params) => {
      // Forward host notifications to sidecar. permissions.request stays out:
      // the renderer already gets it straight from wireHost, and bouncing it
      // through the sidecar delivered the dialog twice with the full args
      // payload re-serialized across two extra stdio hops.
      if (method === "permissions.request") return;
      const payload =
        JSON.stringify({
          jsonrpc: "2.0",
          method: "host.notification",
          params: { method, params },
        }) + "\n";
      this.child.stdin.write(payload);
    });
  }

  private async onLine(line: string) {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Reverse RPC from sidecar → host proxy
    if (msg.method === "host.proxy" && msg.id !== undefined) {
      try {
        const method = String(msg.params?.method || "");
        if (!HOST_PROXY_ALLOWED.has(method)) {
          throw Object.assign(
            new Error(`host method not allowed from sidecar: ${method}`),
            { code: -32601 },
          );
        }
        const params = (msg.params?.params ?? {}) as Record<string, unknown>;
        if (method === "project.instructions.resolve") {
          if (!this.projectInstructionResolver) {
            throw new Error("project instruction resolver unavailable");
          }
          const result = await this.projectInstructionResolver({
            sessionId: String(params.sessionId ?? ""),
            path: String(params.path ?? ""),
          });
          this.child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
          );
          return;
        }
        // Main-local tools short-circuit before host-core (which doesn't
        // know them); everything else proxies through unchanged.
        const localTool =
          method === "tools.execute"
            ? this.localTools.get(String(params.toolName ?? ""))
            : undefined;
        if (localTool) {
          const result = await localTool({
            sessionId: String(params.sessionId ?? ""),
            toolCallId: String(params.toolCallId ?? ""),
            args: params.args,
          });
          this.child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
          );
          return;
        }
        if (!this.host) throw new Error("host unavailable");
        const result = await this.host.call(method, params);
        this.child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
        );
      } catch (e: any) {
        this.child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: e?.code ?? -32000,
              message: e instanceof Error ? e.message : String(e),
              data: e?.data,
            },
          }) + "\n",
        );
      }
      return;
    }

    if (msg.id !== undefined && msg.id !== null && msg.method === undefined) {
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

  onNotification(handler: SidecarNotificationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = randomUUID();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: any) => void,
        reject,
      });
      this.child.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`sidecar RPC timeout: ${method}`));
        }
      }, 130_000);
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribeHost?.();
    this.rejectAllPending(new Error("agent sidecar disposed"));
    this.child.kill();
  }
}
