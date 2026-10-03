/**
 * Isolated Electron IPC smoke for the manual Local Network trigger.
 *
 * The renderer's API-format fixture can only prove the request/response wiring
 * it stubs. This scenario runs the *real* registered provider IPC handler inside
 * a real Electron main process, over a real `ipcMain`/`ipcRenderer` round trip,
 * against a real loopback HTTP endpoint, with the real permission controller
 * whose Electron boundary (the default session's proxy route) is the real one.
 * Only the edges that would touch the OS are injected: the UDP socket factory
 * and the address lookup. A real UDP connect would raise a Local Network alert,
 * which this smoke has no authorization to do.
 *
 * What it proves: the intent-gated wiring order (trigger before HTTP discovery),
 * that automatic callers never trigger, that the real default-session route is
 * consulted, that a proxied, unknown or loopback target skips without touching
 * the transport, that cache hydration and a disposed controller never probe, the
 * unchanged `{ models, source, error? }` response shape, and sanitized
 * diagnostics.
 *
 * What it cannot prove: a macOS Local Network authorization, the native alert,
 * the System Settings entry, or a real LAN HTTP response. A loopback fixture
 * proves request/response wiring only. See
 * `E2E-MAC-local-network-manual-discovery` in the E2E test plan.
 */
import http from "node:http";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { IPC } from "../../packages/shared/src/protocol";
import { registerProviderIpc } from "../../apps/desktop/electron/main/ipc/provider-ipc";
import { createLocalNetworkPermissionController } from "../../apps/desktop/electron/main/local-network-permission";
import type { ProviderIpcDependencies } from "../../apps/desktop/electron/main/ipc/provider-ipc";

const PROBE_PREFIX = "LOCAL_NETWORK_SMOKE ";

const order: string[] = [];
const socketRecords: string[] = [];
const routeQueries: string[] = [];
const hostCalls: string[] = [];
const diagnostics: Array<{ message: string; payload: unknown }> = [];
const verdicts: Record<string, unknown> = {};

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** The most recent trigger diagnostic, which is the only one this module logs. */
function lastTriggerDiagnostic(): string {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const entry = diagnostics[index]!;
    if (entry.message.includes("local network trigger")) return JSON.stringify(entry);
  }
  return "{}";
}

function fakeSocket() {
  return {
    connect(port: number, address: string, callback: () => void) {
      const record = `connect:${address}:${port}`;
      order.push(`socket:${record}`);
      socketRecords.push(record);
      // The module must never write to the socket; this object has no writer,
      // so a send/bind attempt would throw instead of passing silently.
      setImmediate(callback);
    },
    on(event: string) {
      socketRecords.push(`on:${event}`);
    },
    removeAllListeners(event?: string) {
      socketRecords.push(`removeAllListeners:${event ?? "*"}`);
    },
    close() {
      socketRecords.push("close");
    },
  };
}

/** Serve the LAN fixture answer the plan's T3 scenario describes. */
async function startLanFixture(): Promise<{ url: string }> {
  const server = http.createServer((request, response) => {
    order.push(`http:${request.url}`);
    if (request.url !== "/v1/models") {
      response.writeHead(404);
      response.end("{}");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "lan-fixture" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/v1` };
}

async function run(): Promise<void> {
  // Record when the HTTP discovery request is issued, so `order` proves the
  // trigger settled before it whatever endpoint that request names.
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: any, init?: any) => {
    order.push(`fetch:${typeof input === "string" ? input : (input?.url ?? "")}`);
    return realFetch(input, init);
  }) as typeof fetch;
  const fixture = await startLanFixture();
  const provider = {
    id: "lan-gateway",
    name: "LAN gateway",
    vendorKey: "custom",
    baseUrl: fixture.url,
    apiStyle: "chat_completions",
    authKind: "api_key_and_base_url",
    models: [],
  };

  // The controller's real Electron edge: the same default session that carries
  // discovery fetch. Wrapping it records the route query without replacing it.
  const defaultSession = session.defaultSession;
  const realResolveProxy = defaultSession.resolveProxy.bind(defaultSession);
  defaultSession.resolveProxy = async (url: string) => {
    routeQueries.push(url);
    return realResolveProxy(url);
  };

  const modelsDevCatalog = {
    ensureLoaded: async () => true,
    loadLocal: async () => true,
    refresh: async () => true,
    getStatus: () => ({ loaded: true, source: "bundled", catalogPath: "", providerCount: 0 }),
    findModel: () => undefined,
    configureAccount: () => {},
    modelsForProvider: () => [],
  };

  const host = {
    call: async (method: string, input?: unknown) => {
      hostCalls.push(`${method}:${JSON.stringify(input ?? null)}`);
      if (method === "providers.list") return { providers: [provider] };
      if (method === "providers.listModels") {
        return { models: [{ modelId: "cached-model", displayName: "cached-model" }] };
      }
      if (method === "providers.getSecret") return { value: "stored-secret" };
      if (method === "providers.cacheModels") return { ok: true };
      throw new Error(`unexpected host call: ${method}`);
    },
  };

  /** Register the whole provider IPC surface again with a different controller. */
  const registerWith = (localNetworkPermission: unknown) => {
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
    registeredChannels.clear();
    registerProviderIpc({
      registrar: {
        handle: (channel: string, fn: (...args: any[]) => Promise<any>) => {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, (_event, ...args) => fn(...args));
          registeredChannels.add(channel);
        },
      },
      getHost: () => host,
      modelsDevCatalog,
      vendorOAuth: {},
      logger: {
        app: (_scope: string, _level: string, message: string, payload: unknown) =>
          diagnostics.push({ message, payload }),
      },
      enrichProvider: (value: any) => value,
      listRuntimeProviders: async () => [provider],
      enrichProviderList: async (result: any) => result,
      bindingForModel: () => undefined,
      localNetworkPermission,
    } as unknown as ProviderIpcDependencies);
  };
  const registeredChannels = new Set<string>();

  // The real boundaries for the host-facing half: the address lookup and the UDP
  // socket are injected, the Chromium route stays the real default session's.
  const localNetworkPermission = createLocalNetworkPermissionController({
    dependencies: {
      platform: "darwin",
      lookup: async () => [{ address: "192.168.1.20", family: 4 }],
      createSocket: () => fakeSocket() as never,
    },
  });
  registerWith(localNetworkPermission);

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: `${__dirname}/preload.cjs`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(`${__dirname}/index.html`);
  const invoke = async (input: unknown) => {
    const result = await window.webContents.executeJavaScript(
      `window.piSmoke.invoke(${JSON.stringify(IPC.invoke.providersListModels)}, ${JSON.stringify(input)})`,
    );
    return result as { models: Array<{ modelId: string }>; source: string; error?: string };
  };

  // 1. The manual action on a loopback endpoint: the real default-session route
  //    is consulted, the loopback address is refused by the trigger's own policy,
  //    and the real HTTP discovery request still runs and answers.
  order.length = 0;
  const routesBefore = routeQueries.length;
  const manual = await invoke({
    providerId: provider.id,
    baseUrl: fixture.url,
    apiStyle: "chat_completions",
    intent: "manual-fetch-list",
  });
  verdicts.manual = {
    source: manual.source,
    modelIds: manual.models.map((model) => model.modelId),
    order: [...order],
    responseKeys: Object.keys(manual).sort(),
    routeQueriesAdded: routeQueries.length - routesBefore,
    diagnostic: lastTriggerDiagnostic(),
  };
  assert(manual.source === "remote", `manual request must reach the endpoint: ${JSON.stringify(manual)}`);
  assert(
    manual.models.some((model) => model.modelId === "lan-fixture"),
    "the LAN fixture model must come back through IPC",
  );
  assert(
    order[0]?.startsWith("fetch:"),
    `the loopback discovery request must still be issued: ${JSON.stringify(order)}`,
  );
  assert(
    routeQueries.length - routesBefore === 1,
    "the real default-session proxy route must be consulted once per manual request",
  );
  assert(socketRecords.length === 0, "a loopback endpoint must never open a socket");
  const manualDiagnostic = lastTriggerDiagnostic();
  assert(
    manualDiagnostic.includes("local network trigger skipped") &&
      manualDiagnostic.includes("address-not-local"),
    `a loopback endpoint must be refused with its own reason: ${manualDiagnostic}`,
  );
  assert(
    !manualDiagnostic.includes("127.0.0.1") && !manualDiagnostic.includes("stored-secret"),
    `the diagnostic leaked an endpoint or a credential: ${manualDiagnostic}`,
  );
  assert(
    !hostCalls.some((call) => call.includes("intent")),
    `the transient intent reached the host: ${JSON.stringify(hostCalls)}`,
  );

  // 2. Automatic shapes never trigger, and the legacy string form still works.
  order.length = 0;
  const automatic = await invoke({
    providerId: provider.id,
    baseUrl: fixture.url,
    apiStyle: "chat_completions",
  });
  const refreshed = await invoke({
    providerId: provider.id,
    baseUrl: fixture.url,
    apiStyle: "chat_completions",
    source: "refresh",
  });
  const legacy = await invoke(provider.id);
  verdicts.automatic = {
    source: automatic.source,
    refreshedSource: refreshed.source,
    legacySource: legacy.source,
    routeQueriesAdded: routeQueries.length - routesBefore,
    sockets: socketRecords.length,
  };
  assert(automatic.source === "remote" && refreshed.source === "remote" && legacy.source === "remote");
  assert(routeQueries.length - routesBefore === 1, "automatic discovery must not ask for a proxy route");
  assert(socketRecords.length === 0, "automatic discovery must not open a socket");

  // 3. A local-network literal target on this host's real route. Whether that
  //    route is direct or proxied, the verdict must be a trigger verdict, a
  //    proxied or unknown route must not open a socket, and the discovery result
  //    and its error must survive exactly as they do without the trigger.
  order.length = 0;
  const routeVerdict = await invoke({
    providerId: provider.id,
    baseUrl: "http://[fd00::1]:8000/v1",
    apiStyle: "chat_completions",
    intent: "manual-fetch-list",
  });
  const routeDiagnostic = lastTriggerDiagnostic();
  const routeSkipped =
    routeDiagnostic.includes("proxied-route") || routeDiagnostic.includes("unknown-route");
  verdicts.localLiteralRealRoute = {
    source: routeVerdict.source,
    hasError: typeof routeVerdict.error === "string",
    order: [...order],
    diagnostic: routeDiagnostic,
    routeQueriesAdded: routeQueries.length - routesBefore,
  };
  assert(
    routeDiagnostic.includes("local network trigger"),
    `a manual local request must produce a trigger verdict: ${routeDiagnostic}`,
  );
  assert(
    routeSkipped ? socketRecords.length === 0 : socketRecords.includes("connect:fd00::1:8000"),
    `a proxied or unknown route must not open a socket: ${JSON.stringify(socketRecords)}`,
  );
  assert(routeVerdict.source !== "remote", "the unreachable literal must not report remote models");
  assert(
    typeof routeVerdict.error === "string",
    `the discovery failure must be preserved as the result error: ${JSON.stringify(routeVerdict)}`,
  );
  assert(
    !routeDiagnostic.includes("fd00::1") && !routeDiagnostic.includes("8000"),
    `the diagnostic leaked the address or the port: ${routeDiagnostic}`,
  );

  /*
    4. The connect path itself, with the route boundary injected as direct. This
       is the ordering claim the renderer fixture cannot make: the trigger settles
       — socket connected, listener removed, socket closed — before the HTTP
       discovery request is issued, and its verdict never replaces the result.
  */
  const directPermission = createLocalNetworkPermissionController({
    dependencies: {
      platform: "darwin",
      resolveProxy: async () => "DIRECT",
      lookup: async () => [{ address: "192.168.1.20", family: 4 }],
      createSocket: () => fakeSocket() as never,
    },
  });
  registerWith(directPermission);
  order.length = 0;
  const socketsBeforeConnect = socketRecords.length;
  const directVerdict = await invoke({
    providerId: provider.id,
    baseUrl: "http://[fd00::1]:8000/v1",
    apiStyle: "chat_completions",
    intent: "manual-fetch-list",
  });
  verdicts.directConnect = {
    source: directVerdict.source,
    hasError: typeof directVerdict.error === "string",
    order: [...order],
    socketRecords: socketRecords.slice(socketsBeforeConnect),
    diagnostic: lastTriggerDiagnostic(),
  };
  assert(
    socketRecords.includes("connect:fd00::1:8000"),
    `a ULA literal on a direct route must reach the connect attempt: ${JSON.stringify(socketRecords)}`,
  );
  assert(
    socketRecords.includes("close") && socketRecords.includes("removeAllListeners:error"),
    `the connect attempt must clean up after itself: ${JSON.stringify(socketRecords)}`,
  );
  assert(
    order.findIndex((entry) => entry.startsWith("fetch:")) >
      order.findIndex((entry) => entry.startsWith("socket:connect:")),
    `the trigger must settle before HTTP discovery starts: ${JSON.stringify(order)}`,
  );
  assert(
    lastTriggerDiagnostic().includes("local network trigger attempted"),
    `an attempted trigger must be observable: ${lastTriggerDiagnostic()}`,
  );
  assert(
    directVerdict.source !== "remote" && typeof directVerdict.error === "string",
    `the trigger verdict must not replace the discovery result: ${JSON.stringify(directVerdict)}`,
  );

  // 5. Cache hydration bypasses the trigger even with the manual intent present.
  registerWith(localNetworkPermission);
  const socketsBeforeCache = socketRecords.length;
  const cache = await invoke({
    providerId: provider.id,
    baseUrl: fixture.url,
    intent: "manual-fetch-list",
    source: "cache",
  });
  verdicts.cache = { source: cache.source, socketsAdded: socketRecords.length - socketsBeforeCache };
  assert(cache.source === "cache", `cache hydration must read the local table: ${JSON.stringify(cache)}`);
  assert(socketRecords.length === socketsBeforeCache, "cache hydration must never open a socket");

  // 6. Disposal is final: no further trigger, no further proxy query or socket.
  localNetworkPermission.dispose();
  directPermission.dispose();
  const socketsBeforeDispose = socketRecords.length;
  const routesBeforeDispose = routeQueries.length;
  const afterDispose = await invoke({
    providerId: provider.id,
    baseUrl: fixture.url,
    intent: "manual-fetch-list",
  });
  verdicts.afterDispose = {
    source: afterDispose.source,
    socketsAdded: socketRecords.length - socketsBeforeDispose,
    routeQueriesAdded: routeQueries.length - routesBeforeDispose,
    diagnostic: lastTriggerDiagnostic(),
  };
  assert(afterDispose.source === "remote", "discovery must keep working after disposal");
  assert(
    socketRecords.length === socketsBeforeDispose && routeQueries.length === routesBeforeDispose,
    "a disposed controller must not start another operation",
  );
  assert(
    lastTriggerDiagnostic().includes("disposed"),
    `the disposed verdict must be observable: ${lastTriggerDiagnostic()}`,
  );
  localNetworkPermission.dispose();
}

app.whenReady().then(async () => {
  let result: Record<string, unknown>;
  try {
    await run();
    result = {
      ok: true,
      verdicts,
      responseShape: "{ models, source, error? }",
      nativePermission: "not exercised: requires an operator Allow on a clean macOS state",
      loopbackCaveat:
        "a loopback fixture proves request/response wiring, not Local Network authorization",
    };
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error), verdicts };
  }
  console.log(PROBE_PREFIX + JSON.stringify(result));
  app.exit(result.ok === true ? 0 : 1);
});
