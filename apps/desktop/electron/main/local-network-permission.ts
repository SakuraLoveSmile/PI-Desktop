/**
 * Supplemental macOS Local Network prompt trigger.
 *
 * macOS 15+ gates local-network traffic behind a user alert. Apple treats a UDP
 * `connect()` as an implicit trigger for that alert and sends no traffic for it,
 * so a manual "Fetch list" against a LAN endpoint can raise the alert before the
 * request that actually needs the permission. None of the verdicts here means
 * "permission granted": a callback is trigger evidence, and the user can revoke
 * access in System Settings at any time, so nothing is memoized and a later call
 * always probes again.
 *
 * Nothing is ever written: no `send`, no payload, no HTTP request, no header, no
 * credential. The socket exists only to be connected. Diagnostics carry a
 * `status`, a `stage`, a `reason` and an error `code` — never the endpoint, its
 * host, its port or anything derived from them.
 *
 * Address and proxy-route classification belongs to the shared public-network
 * policy; this module decides which of those classes may be dialled, and nothing
 * else. Electron is imported lazily inside the default proxy lookup, so the
 * module can be loaded outside Electron, including by `node --test`.
 */
import { createSocket as createDatagramSocket } from "node:dgram";
import { lookup as lookupHostname } from "node:dns/promises";
import { classifyIpLiteral, classifyProxyRoute } from "@pi-desktop/shared";

/** What one trigger call concluded. */
export type LocalNetworkTriggerStatus = "skipped" | "attempted" | "failed";

/** The phase a verdict belongs to. */
export type LocalNetworkTriggerStage =
  | "lifecycle"
  | "platform"
  | "endpoint"
  | "hostname"
  | "proxy"
  | "resolve"
  | "connect";

export type LocalNetworkTriggerResult = {
  status: LocalNetworkTriggerStatus;
  stage: LocalNetworkTriggerStage;
  /** Fixed vocabulary, lowercase-hyphenated. NEVER contains URL text, credentials, query, headers or a pointer at such data. */
  reason: string;
  /** Node/Electron error code for a failed stage (e.g. "ENOTFOUND", "EACCES"). Absent otherwise. */
  code?: string;
};

export type LocalNetworkPermissionSocket = {
  connect(port: number, address: string, callback: () => void): void;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  removeAllListeners(event?: string): void;
  close(): void;
};

export type LocalNetworkPermissionDependencies = {
  platform: NodeJS.Platform;
  /** Chromium's `Session.resolveProxy` answer for the endpoint URL (e.g. "DIRECT", "PROXY host:port"). */
  resolveProxy(url: string): Promise<string>;
  /** One bounded main-process lookup. */
  lookup(hostname: string, options: { all: true }): Promise<Array<{ address: string; family: number }>>;
  createSocket(family: 4 | 6): LocalNetworkPermissionSocket;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type LocalNetworkPermissionController = {
  trigger(baseUrl: string): Promise<LocalNetworkTriggerResult>;
  dispose(): void;
};

/** Total budget for a probe: proxy lookup, resolution and the connect together. */
const DEFAULT_BUDGET_MS = 1_500;

/**
 * The address classes that belong to the network the user's own machine is on,
 * so dialling one is what raises the alert: RFC1918 private, IPv4 and scoped
 * IPv6 link-local, ULA and site-local. `loopback` and `public` raise no Local
 * Local Network alert; `benchmark` is a TUN proxy's fake-IP pool rather than a
 * target; the classes that name no destination at all (`unspecified`,
 * `multicast`, `documentation`, `reserved`, `cgnat`, `invalid`) can never be
 * one either. A scope-less IPv6 link-local is refused with its own reason below.
 */
const LOCAL_ADDRESS_KINDS: ReadonlySet<string> = new Set([
  "private",
  "link-local",
  "ula",
  "site-local",
]);

/** The phase a budget can expire in, which is what names the verdict. */
type TriggerPhase = "proxy" | "resolve" | "connect";

/** Why a candidate address cannot be dialled; the fixed vocabulary of the address gate. */
type AddressRefusal = "address-not-local" | "link-local-without-scope" | "no-local-address";

type AddressVerdict = { address: string } | { refusal: AddressRefusal };

/** The endpoint a probe would dial, reduced to what the trigger needs. */
type TriggerEndpoint = {
  /** Coalescing key: protocol, host and effective port, case-folded. */
  key: string;
  /** The endpoint URL as the WHATWG parser normalizes it, for `resolveProxy`. */
  url: string;
  /** Hostname with brackets, trailing dot and case normalized away. */
  host: string;
  /** The host when it is an IP literal, so no DNS is ever performed for it. */
  literal?: string;
  /** The port the request would use: explicit, else the protocol default. */
  port: number;
};

type EndpointVerdict = { endpoint: TriggerEndpoint } | { refusal: LocalNetworkTriggerResult };

/** One in-flight probe, shared by every caller of the same endpoint. */
type TriggerOperation = {
  key: string;
  promise: Promise<LocalNetworkTriggerResult>;
  resolve: (result: LocalNetworkTriggerResult) => void;
  settled: boolean;
  phase: TriggerPhase;
  timer: unknown;
  socket?: LocalNetworkPermissionSocket;
};

/** A verdict, so no branch can invent a fifth field or carry `code: undefined`. */
function verdict(
  status: LocalNetworkTriggerStatus,
  stage: LocalNetworkTriggerStage,
  reason: string,
  code?: string,
): LocalNetworkTriggerResult {
  return code ? { status, stage, reason, code } : { status, stage, reason };
}

/** A Node/Electron error code, and nothing that could carry resolver or endpoint text. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : undefined;
}

/** A promise whose settlement the caller decides. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

/** The address without its IPv6 zone identifier (`fe80::1%en0` → `fe80::1`). */
function addressWithoutZone(address: string): string {
  const zone = address.indexOf("%");
  return zone === -1 ? address : address.slice(0, zone);
}

/** Whether the address is an IPv6 literal, which is what a zone identifier qualifies. */
function isIpv6Address(address: string): boolean {
  return addressWithoutZone(address).includes(":");
}

/**
 * Classify one candidate address, or refuse it with the reason that describes it.
 *
 * An IPv6 link-local reaches its neighbour only through the interface a zone
 * identifier names, so one without a zone is refused on its own terms instead of
 * the general one: it is a target the user can still name correctly, not an
 * address this app may never dial.
 */
function judgeAddress(address: string): AddressVerdict {
  const scoped = address.includes("%");
  const kind = classifyIpLiteral(scoped ? addressWithoutZone(address) : address);
  if (kind === "link-local" && isIpv6Address(address) && !scoped) {
    return { refusal: "link-local-without-scope" };
  }
  return LOCAL_ADDRESS_KINDS.has(kind) ? { address } : { refusal: "address-not-local" };
}

/**
 * The first address the resolver offered that this machine's own network owns,
 * in resolver order. A public address and a `benchmark` fake-IP answer are never
 * dialled, and a scope-less IPv6 link-local is skipped — but its specific reason
 * is reported only when it explains every candidate that failed.
 */
function chooseAddress(
  records: ReadonlyArray<{ address: string; family: number }>,
): AddressVerdict {
  let candidates = 0;
  let scopeLessLinkLocal = 0;
  for (const record of records) {
    const candidate = typeof record?.address === "string" ? record.address.trim() : "";
    if (!candidate) continue;
    candidates += 1;
    const judged = judgeAddress(candidate);
    if ("address" in judged) return judged;
    if (judged.refusal === "link-local-without-scope") scopeLessLinkLocal += 1;
  }
  return scopeLessLinkLocal > 0 && scopeLessLinkLocal === candidates
    ? { refusal: "link-local-without-scope" }
    : { refusal: "no-local-address" };
}

/** Normalize a URL hostname: case, brackets and trailing dots. */
function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.+$/, "");
}

/** `localhost` and its subdomains never leave the machine, so they raise no alert. */
function isLoopbackName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

/**
 * Read the endpoint a probe would dial, or the verdict that refuses the URL.
 *
 * Everything here is synchronous and network-free: a URL that fails this gate
 * may not touch the proxy resolver, the resolver, a socket or a budget.
 */
function readEndpoint(baseUrl: string): EndpointVerdict {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { refusal: verdict("skipped", "endpoint", "invalid-url") };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { refusal: verdict("skipped", "endpoint", "unsupported-protocol") };
  }
  if (parsed.username || parsed.password) {
    return { refusal: verdict("skipped", "endpoint", "credentials-present") };
  }
  const host = normalizeHostname(parsed.hostname);
  if (!host) return { refusal: verdict("skipped", "endpoint", "invalid-url") };
  if (isLoopbackName(host)) {
    return { refusal: verdict("skipped", "hostname", "loopback-name") };
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  return {
    endpoint: {
      key: `${parsed.protocol}//${host}:${port}`,
      url: parsed.href,
      host,
      literal: host.includes(":") || classifyIpLiteral(host) !== "invalid" ? host : undefined,
      port,
    },
  };
}

/**
 * Ask the Chromium session that carries the request which route it takes.
 * Electron is loaded here rather than imported at the top level, so every other
 * branch of this module stays loadable without it.
 */
async function resolveProxyWithChromium(url: string): Promise<string> {
  const { session } = await import("electron");
  return session.defaultSession.resolveProxy(url);
}

/** One main-process lookup. The trigger never retries it. */
async function lookupWithResolver(
  hostname: string,
  options: { all: true },
): Promise<Array<{ address: string; family: number }>> {
  return lookupHostname(hostname, options);
}

/** A UDP socket whose only use is `connect()`. */
function createUdpSocket(family: 4 | 6): LocalNetworkPermissionSocket {
  return createDatagramSocket(family === 6 ? "udp6" : "udp4");
}

/**
 * One controller per owner of the trigger. Every dependency is injectable, which
 * is how the behavior is testable without Electron, DNS or a real socket, and a
 * caller that injects nothing gets the real platform, session, resolver, socket
 * and timers.
 */
export function createLocalNetworkPermissionController(
  options: {
    dependencies?: Partial<LocalNetworkPermissionDependencies>;
    /** Total budget for proxy lookup + resolution + connect. Default 1500. */
    budgetMs?: number;
    /**
     * Application lifecycle which disposes this controller on shutdown. The
     * controller registers the listener and `dispose()` removes it again.
     */
    lifecycle?: {
      on(event: "will-quit", listener: () => void): unknown;
      removeListener(event: "will-quit", listener: () => void): unknown;
    };
  } = {},
): LocalNetworkPermissionController {
  const dependencies: LocalNetworkPermissionDependencies = {
    platform: options.dependencies?.platform ?? process.platform,
    resolveProxy: options.dependencies?.resolveProxy ?? resolveProxyWithChromium,
    lookup: options.dependencies?.lookup ?? lookupWithResolver,
    createSocket: options.dependencies?.createSocket ?? createUdpSocket,
    setTimer: options.dependencies?.setTimer ?? ((callback, ms) => setTimeout(callback, ms)),
    clearTimer:
      options.dependencies?.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      }),
  };
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  /** The one probe per endpoint in flight; an entry disappears when it settles. */
  const pending = new Map<string, TriggerOperation>();
  let disposed = false;
  let lifecycleAttached = false;

  /** The verdict a caller gets once this controller is disposed. */
  function disposedVerdict(): LocalNetworkTriggerResult {
    return verdict("skipped", "lifecycle", "disposed");
  }

  /**
   * Close a socket that may never have entered a running state — a datagram
   * socket that never bound, connected or sent throws on `close()`. The verdict
   * is already decided by then, and the OS reclaims the handle.
   */
  function closeQuietly(socket: LocalNetworkPermissionSocket): void {
    try {
      socket.close();
    } catch {
      // Nothing to recover: the socket is unreachable from here on either way.
    }
  }

  /** Deliver exactly one verdict per probe, and release everything it held. */
  function finish(operation: TriggerOperation, result: LocalNetworkTriggerResult): void {
    if (operation.settled) return;
    operation.settled = true;
    dependencies.clearTimer(operation.timer);
    const socket = operation.socket;
    operation.socket = undefined;
    if (socket) {
      socket.removeAllListeners("error");
      closeQuietly(socket);
    }
    if (pending.get(operation.key) === operation) pending.delete(operation.key);
    operation.resolve(result);
  }

  /** Too late to confirm anything: the verdict names the phase the budget cut. */
  function deadlineReached(operation: TriggerOperation): void {
    if (operation.settled) return;
    if (operation.phase === "connect") {
      finish(operation, verdict("attempted", "connect", "connect-unconfirmed"));
      return;
    }
    finish(
      operation,
      verdict("skipped", operation.phase === "proxy" ? "proxy" : "resolve", "deadline"),
    );
  }

  /**
   * Issue the one UDP `connect()` that can raise the alert, and nothing else:
   * no `send`, no payload, no bind.
   */
  function connect(operation: TriggerOperation, address: string, port: number): void {
    if (operation.settled) return;
    let socket: LocalNetworkPermissionSocket;
    try {
      socket = dependencies.createSocket(isIpv6Address(address) ? 6 : 4);
    } catch (error) {
      finish(operation, verdict("failed", "connect", "connect-error", errorCode(error)));
      return;
    }
    operation.socket = socket;
    socket.on("error", (error) => {
      finish(operation, verdict("failed", "connect", "connect-error", errorCode(error)));
    });
    operation.phase = "connect";
    try {
      socket.connect(port, address, () => {
        finish(operation, verdict("attempted", "connect", "connect-established"));
      });
    } catch (error) {
      finish(operation, verdict("failed", "connect", "connect-error", errorCode(error)));
    }
  }

  /** The address to dial, or `undefined` when the probe already settled. */
  async function chooseTargetAddress(
    operation: TriggerOperation,
    endpoint: TriggerEndpoint,
  ): Promise<string | undefined> {
    if (endpoint.literal !== undefined) {
      const literal = judgeAddress(endpoint.literal);
      if ("refusal" in literal) {
        finish(operation, verdict("skipped", "hostname", literal.refusal));
        return undefined;
      }
      return literal.address;
    }
    let records: ReadonlyArray<{ address: string; family: number }>;
    try {
      records = await dependencies.lookup(endpoint.host, { all: true });
    } catch (error) {
      if (operation.settled) return undefined;
      finish(operation, verdict("failed", "resolve", "resolve-failed", errorCode(error)));
      return undefined;
    }
    // The budget may have expired while the resolver worked: a late answer must
    // not open a socket afterwards.
    if (operation.settled) return undefined;
    const chosen = chooseAddress(records);
    if ("refusal" in chosen) {
      finish(operation, verdict("skipped", "hostname", chosen.refusal));
      return undefined;
    }
    return chosen.address;
  }

  /** The phases of one probe — route, address, connect — inside the one budget. */
  async function probe(operation: TriggerOperation, endpoint: TriggerEndpoint): Promise<void> {
    try {
      operation.phase = "proxy";
      let proxyList: unknown;
      try {
        proxyList = await dependencies.resolveProxy(endpoint.url);
      } catch (error) {
        if (operation.settled) return;
        finish(operation, verdict("failed", "proxy", "route-check-failed", errorCode(error)));
        return;
      }
      if (operation.settled) return;
      const route = classifyProxyRoute(proxyList);
      if (route !== "direct") {
        // On a proxied route this app dials the proxy, so the local resolver's
        // answer describes no connection it makes; an unreadable route is never
        // permission either.
        finish(
          operation,
          verdict("skipped", "proxy", route === "proxied" ? "proxied-route" : "unknown-route"),
        );
        return;
      }

      operation.phase = "resolve";
      const address = await chooseTargetAddress(operation, endpoint);
      if (address === undefined) return;
      connect(operation, address, endpoint.port);
    } catch (error) {
      // No phase above may reject, but a caller must never wait forever, so an
      // unexpected throw still settles the probe.
      if (operation.settled) return;
      finish(
        operation,
        operation.phase === "connect"
          ? verdict("failed", "connect", "connect-error", errorCode(error))
          : verdict("failed", "resolve", "resolve-failed", errorCode(error)),
      );
    }
  }

  /** Start the one probe an endpoint gets while it is in flight. */
  function startProbe(endpoint: TriggerEndpoint): TriggerOperation {
    const deferredVerdict = deferred<LocalNetworkTriggerResult>();
    const operation: TriggerOperation = {
      key: endpoint.key,
      promise: deferredVerdict.promise,
      resolve: deferredVerdict.resolve,
      settled: false,
      phase: "proxy",
      timer: undefined,
    };
    pending.set(operation.key, operation);
    operation.timer = dependencies.setTimer(() => deadlineReached(operation), budgetMs);
    void probe(operation, endpoint);
    return operation;
  }

  function trigger(baseUrl: string): Promise<LocalNetworkTriggerResult> {
    if (disposed) return Promise.resolve(disposedVerdict());
    if (dependencies.platform !== "darwin") {
      return Promise.resolve(verdict("skipped", "platform", "not-macos"));
    }
    const read = readEndpoint(baseUrl);
    if ("refusal" in read) return Promise.resolve(read.refusal);
    const inFlight = pending.get(read.endpoint.key);
    if (inFlight) return inFlight.promise;
    return startProbe(read.endpoint).promise;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (lifecycleAttached) {
      lifecycleAttached = false;
      options.lifecycle?.removeListener("will-quit", onWillQuit);
    }
    for (const operation of [...pending.values()]) {
      finish(operation, disposedVerdict());
    }
    pending.clear();
  }

  const onWillQuit = (): void => {
    dispose();
  };

  if (options.lifecycle) {
    options.lifecycle.on("will-quit", onWillQuit);
    lifecycleAttached = true;
  }

  return { trigger, dispose };
}

let defaultController: LocalNetworkPermissionController | undefined;

/**
 * Trigger through the process-wide controller. The instance is created on first
 * use, so importing this module starts no timer, socket or listener.
 */
export function trigger(baseUrl: string): Promise<LocalNetworkTriggerResult> {
  defaultController ??= createLocalNetworkPermissionController();
  return defaultController.trigger(baseUrl);
}

/**
 * Dispose the process-wide controller. Disposal is permanent: once this has run,
 * a later `trigger` reports `disposed` instead of starting a new probe.
 */
export function dispose(): void {
  (defaultController ??= createLocalNetworkPermissionController()).dispose();
}
