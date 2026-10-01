/**
 * Lifecycle of the optional local MCP control plane.
 *
 * One lifecycle owns the server for the whole process: the saved startup
 * preference and the settings IPC both go through `setEnabled`, so there is
 * exactly one `McpControlServer` slot (the composition root's
 * `state.mcpControl`), one start path, and one stop path. `bootstrap/shutdown.ts`
 * keeps closing that same slot, so quit or restart never leaves a second
 * listener behind.
 *
 * The surface stays additive to ADR 0203: the same loopback bind, the same
 * `0600` bearer token, the same `mcp-control.json` manifest (marked inactive on
 * stop), and the same reviewed operation catalog. What is new is only *who*
 * decides the on/off state, plus the persisted machine-local preference.
 *
 * Ordering guarantees for every mutation:
 *   start -> listener confirmed (`isRunning`, manifest `active: true`)
 *         -> preference written atomically -> reported
 *   stop  -> listener closed and manifest marked inactive
 *         -> preference written atomically -> reported
 * Mutations are serialized, so repeated clicks are idempotent instead of racing
 * a second `listen()`. A failed start never overwrites the saved preference,
 * and a failed save rolls back the server this call opened while the previous
 * preference stands. Nothing here touches Agent turns: disabling the control
 * plane never stops, aborts, or cancels a session.
 */
import type { McpControlStatus } from "@pi-desktop/shared";
import { McpControlServer, type McpControlController } from "./mcp-control";
import {
  MCP_CONTROL_ENV,
  MCP_CONTROL_PORT_ENV,
  environmentMcpControlOverride,
  mcpControlConnectionFile,
  resolveMcpControlEffective,
  writeMcpControlPreference,
} from "./mcp-control-settings";

type Logger = (level: "info" | "warn" | "error", message: string, data?: unknown) => void;

/**
 * The IPC invoker and operation catalog the control server delegates to. It is
 * supplied after `registerIpc()` runs, because internal invokes must go through
 * the same registered handlers the renderer uses.
 */
export type McpControlTarget = {
  invoke: (channel: string, args: readonly unknown[]) => Promise<unknown>;
  channels: Readonly<Record<string, string>>;
  controller?: McpControlController;
  version?: string;
};

export type McpControlLifecycleOptions = {
  dataDir: string;
  /** The single server slot owned by the composition root. */
  getServer: () => McpControlServer | null;
  setServer: (server: McpControlServer | null) => void;
  env?: NodeJS.ProcessEnv;
  log?: Logger;
};

export type McpControlLifecycle = {
  status: () => McpControlStatus;
  startFromPreference: (target: McpControlTarget) => Promise<McpControlStatus>;
  setEnabled: (enabled: boolean) => Promise<McpControlStatus>;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestedPort(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env[MCP_CONTROL_PORT_ENV];
  if (raw === undefined || raw.trim() === "") return undefined;
  const port = Number(raw);
  return Number.isInteger(port) ? port : undefined;
}

export function createMcpControlLifecycle(
  options: McpControlLifecycleOptions,
): McpControlLifecycle {
  const env = options.env ?? process.env;
  const log: Logger = options.log ?? (() => undefined);
  let target: McpControlTarget | null = null;
  let lastError: string | null = null;
  // One serialized mutation queue: a click that arrives while a start or stop
  // is still running waits for it instead of opening a competing listener.
  let queue: Promise<unknown> = Promise.resolve();

  const effective = () => resolveMcpControlEffective({ dataDir: options.dataDir, env });

  const status = (): McpControlStatus => ({
    enabled: effective().enabled,
    running: options.getServer()?.isRunning === true,
    source: effective().source,
    connectionFile: mcpControlConnectionFile(options.dataDir),
    error: lastError,
  });

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /** Close the listener and mark the manifest inactive; returns a stop failure. */
  const closeServer = async (server: McpControlServer): Promise<string | null> => {
    let failure: string | null = null;
    try {
      // `stop()` closes the listener and rewrites the manifest with
      // `active: false`; the token file stays untouched for the next start.
      await server.stop();
    } catch (error) {
      failure = errorText(error);
    }
    if (options.getServer() === server) options.setServer(null);
    return failure;
  };

  const startServer = async (): Promise<McpControlStatus> => {
    if (!target) {
      lastError = "control plane cannot start before IPC registration completes";
      return status();
    }
    const server = new McpControlServer({
      dataDir: options.dataDir,
      invoke: target.invoke,
      channels: target.channels,
      controller: target.controller,
      version: target.version,
      port: requestedPort(env),
      log,
    });
    try {
      await server.start();
      if (!server.isRunning) throw new Error("control plane reported no active listener");
    } catch (error) {
      // A failed start leaves the saved preference exactly as it was and is
      // reported once: no automatic retry loop, no silent flip to `false`.
      lastError = errorText(error);
      options.setServer(null);
      return status();
    }
    options.setServer(server);
    // `start()` resolved, so the socket is listening and the manifest already
    // carries `active: true`; the URL is the only safe field to log.
    log("info", "MCP control plane started", { data: server.connectionInfo?.url });
    try {
      if (environmentMcpControlOverride(env) === undefined) {
        writeMcpControlPreference(options.dataDir, true);
      }
    } catch (error) {
      lastError = `control-plane preference could not be saved: ${errorText(error)}`;
      // The preference write was part of enabling, so the server this call
      // opened is rolled back and the previous value stands.
      const stopFailure = await closeServer(server);
      if (stopFailure) {
        log("warn", "MCP control plane rollback stop failed", { data: stopFailure });
      }
      return status();
    }
    lastError = null;
    return status();
  };

  const applyEnabled = async (enabled: boolean): Promise<McpControlStatus> => {
    const override = environmentMcpControlOverride(env);
    if (override !== undefined && override !== enabled) {
      // The launch environment decides this run. Persisting or acting on the
      // opposite request would show a state the next start would contradict.
      lastError =
        `${MCP_CONTROL_ENV}=${override ? "1" : "0"} controls the local MCP control plane ` +
        "for this launch; restart without that variable to change it";
      return status();
    }
    if (enabled) {
      if (options.getServer()?.isRunning === true) {
        // Already listening: repeated clicks must not open a second listener.
        lastError = null;
        return status();
      }
      return startServer();
    }
    const current = options.getServer();
    const stopFailure = current ? await closeServer(current) : null;
    let saveFailure: string | null = null;
    try {
      if (override === undefined) {
        writeMcpControlPreference(options.dataDir, false);
      }
    } catch (error) {
      saveFailure = errorText(error);
    }
    lastError = saveFailure
      ? `control-plane preference could not be saved: ${saveFailure}`
      : stopFailure
        ? `control plane could not be stopped cleanly: ${stopFailure}`
        : null;
    return status();
  };

  return {
    status,
    startFromPreference: (nextTarget) => {
      target = nextTarget;
      if (!effective().enabled) return Promise.resolve(status());
      return serialize(() => applyEnabled(true)).then((result) => {
        if (result.error) {
          log("warn", "MCP control plane did not start", { data: result.error });
        }
        return result;
      });
    },
    setEnabled: (enabled) => serialize(() => applyEnabled(enabled)),
  };
}

/**
 * The lifecycle the running desktop owns. `bootstrap/startup.ts` binds it
 * before IPC registration and `ipc/mcp-control-ipc.ts` resolves it at call
 * time, which keeps one instance without giving either module ownership of the
 * other's wiring.
 */
let activeLifecycle: McpControlLifecycle | null = null;

export function setActiveMcpControlLifecycle(lifecycle: McpControlLifecycle | null): void {
  activeLifecycle = lifecycle;
}

export function getActiveMcpControlLifecycle(): McpControlLifecycle | null {
  return activeLifecycle;
}
