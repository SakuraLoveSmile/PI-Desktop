/**
 * Backend router: the single seam that decides whether a renderer IPC call is
 * served by this desktop's local host-core (the default, byte-for-byte
 * unchanged) or forwarded to a paired remote `pi-host` over RACP-WS.
 *
 * The frozen architecture keeps this out of the per-domain IPC handlers and out
 * of the God-modules: `register.ts` consults `route()` from inside its `handle`
 * wrapper, and everything remote lives under `electron/main/remote/*`. A
 * session becomes remote only once a {@link RemoteBackend} is registered for its
 * id; until then — and for every local or `native-pi:` session — the router
 * returns {@link ROUTE_LOCAL} and the existing local handler runs.
 *
 * Renderer-visible session ids for remote sessions are namespaced
 * `remote:<hostKey>:<hostSessionId>`, mirroring the proven `native-pi:` prefix
 * (session-ipc.ts). The renderer never parses the prefix; it is resolved here.
 */

/** Sentinel telling the caller to run the existing local handler unchanged. */
export const ROUTE_LOCAL = Symbol("pi-desktop.route-local");

/** Namespaced-id prefix for sessions owned by a remote host. */
const REMOTE_PREFIX = "remote:";

/** A registered remote host's session, addressed by its renderer-visible id. */
export interface RemoteBackend {
  /**
   * Whether this backend can serve `channel`. A channel the remote profile does
   * not cover (e.g. a desktop-only setting) falls back to the local handler so
   * the renderer keeps working while the session's transcript stays remote.
   */
  handles(channel: string): boolean;
  /** Serve the call remotely, returning the value the renderer expects. */
  invoke(channel: string, args: readonly unknown[]): Promise<unknown>;
}

/** Result of {@link BackendRouter.route}: run locally, or a served remote value. */
export type RouteOutcome =
  | typeof ROUTE_LOCAL
  | { readonly remote: true; readonly value: unknown };

export interface BackendRouter {
  /** Bind a renderer-visible session id to the backend that owns it. */
  registerBackend(sessionId: string, backend: RemoteBackend): void;
  /** Release a session id (host disconnect, session delete, kill switch). */
  unregisterBackend(sessionId: string): void;
  /** The backend that should serve `(channel, args)`, or null for local. */
  resolveBackend(channel: string, args: readonly unknown[]): RemoteBackend | null;
  /** Route a renderer IPC call. */
  route(channel: string, args: readonly unknown[]): Promise<RouteOutcome>;
}

export type BackendRouterOptions = {
  /** Optional structured log for routing faults; defaults to a no-op. */
  log?: (level: "warn" | "error", message: string, data?: unknown) => void;
};

/** Build the namespaced id the renderer sees for a remote session. */
export function makeRemoteSessionId(hostKey: string, hostSessionId: string): string {
  if (hostKey.includes(":")) {
    throw Object.assign(new Error("remote hostKey must not contain ':'"), {
      errorCode: "INVALID_ARGUMENT",
    });
  }
  return `${REMOTE_PREFIX}${hostKey}:${hostSessionId}`;
}

export function isRemoteSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === "string" && sessionId.startsWith(REMOTE_PREFIX);
}

/** Split a `remote:<hostKey>:<hostSessionId>` id back into its parts. */
export function parseRemoteSessionId(
  sessionId: string,
): { hostKey: string; hostSessionId: string } | null {
  if (!sessionId.startsWith(REMOTE_PREFIX)) return null;
  const rest = sessionId.slice(REMOTE_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { hostKey: rest.slice(0, sep), hostSessionId: rest.slice(sep + 1) };
}

/**
 * Best-effort session id for a renderer IPC call. Desktop channels pass the
 * session id either as the first positional argument or as `sessionId` on the
 * first argument object; anything else has no session and is always local.
 */
export function sessionIdForCall(args: readonly unknown[]): string | null {
  const first = args[0];
  if (typeof first === "string") return isRemoteSessionId(first) ? first : null;
  if (first && typeof first === "object") {
    const id = (first as { sessionId?: unknown }).sessionId;
    if (typeof id === "string" && isRemoteSessionId(id)) return id;
  }
  return null;
}

export function createBackendRouter(options: BackendRouterOptions = {}): BackendRouter {
  const log = options.log ?? (() => undefined);
  const sessionBackends = new Map<string, RemoteBackend>();

  const resolveBackend = (
    channel: string,
    args: readonly unknown[],
  ): RemoteBackend | null => {
    const sessionId = sessionIdForCall(args);
    if (!sessionId) return null;
    const backend = sessionBackends.get(sessionId);
    if (!backend) return null;
    return backend.handles(channel) ? backend : null;
  };

  return {
    registerBackend(sessionId, backend) {
      sessionBackends.set(sessionId, backend);
    },
    unregisterBackend(sessionId) {
      sessionBackends.delete(sessionId);
    },
    resolveBackend,
    async route(channel, args) {
      const backend = resolveBackend(channel, args);
      if (!backend) return ROUTE_LOCAL;
      try {
        return { remote: true, value: await backend.invoke(channel, args) };
      } catch (error) {
        log("warn", `remote route failed for ${channel}`, error);
        throw error;
      }
    },
  };
}
