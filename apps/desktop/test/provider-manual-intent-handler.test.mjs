/**
 * Behavior tests for the manual "Fetch list" intent at the provider IPC boundary.
 *
 * The renderer marks its one explicit manual action with
 * `intent: "manual-fetch-list"`. That field is the *only* thing that may enable
 * the supplemental macOS Local Network trigger, it must never be persisted or
 * forwarded, and every other caller keeps the byte-for-byte request and result
 * shape it had before. The real registered handler is exercised here with the
 * real HTTP discovery path pointed at a loopback server; only genuinely external
 * boundaries (host RPC, catalog snapshot, socket/DNS, OAuth, logger) are faked.
 *
 * A loopback server proves request/response wiring and result semantics. It
 * cannot prove a macOS Local Network authorization, which is not observable
 * from an automated test at all.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";
import ts from "typescript";
import { IPC } from "../../../packages/shared/src/protocol.ts";

// The discovery sweep and the catalog read use bundler-style relative imports.
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const shared = await import("@pi-desktop/shared");
const modelDiscovery = await import("../electron/main/model-discovery.ts");
const providerEndpointProbe = await import("../electron/main/provider-endpoint-probe.ts");
const modelsDev = await import("../electron/main/models-dev-catalog.ts");

/** Minimal CJS loader for the main-process module under test. */
function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected IPC dependency: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

const OAUTH_PROVIDER = {
  id: "oauth-account",
  name: "Vendor account",
  vendorKey: "openai-codex",
  authKind: "oauth",
  apiStyle: "openai_codex_responses",
};

const KEYED_PROVIDER = {
  id: "lan-gateway",
  name: "LAN gateway",
  vendorKey: "custom",
  apiStyle: "chat_completions",
  authKind: "api_key_and_base_url",
  models: [],
};

/**
 * Register the real handler once per test with fakes for the external edges.
 *
 * `events` is the ordering record: the fake trigger and the loopback HTTP server
 * both append to it, so "trigger before HTTP discovery" is an observed sequence
 * rather than an assumption about the source.
 */
async function harness(t, options = {}) {
  const events = [];
  const hostCalls = [];
  const logs = [];
  const servers = [];

  const server = http.createServer((req, res) => {
    events.push(["http", req.url]);
    if (options.httpStatus && options.httpStatus !== 200) {
      res.writeHead(options.httpStatus);
      res.end("denied");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "lan-fixture" }] }));
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const listening of servers) listening.close();
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const triggerCalls = [];
  const localNetworkPermission = {
    trigger: async (url) => {
      triggerCalls.push(url);
      events.push(["trigger"]);
      return options.triggerResult ?? { status: "attempted", stage: "connect", reason: "connect-established" };
    },
    dispose: () => {},
  };
  const providers = (options.providers ?? [KEYED_PROVIDER]).map((provider) => ({
    ...provider,
    baseUrl: provider.baseUrl ?? baseUrl,
  }));
  const modelsDevCatalog = {
    ensureLoaded: async () => true,
    loadLocal: async () => true,
    refresh: async () => true,
    getStatus: () => ({ loaded: true, source: "bundled", catalogPath: "", providerCount: 0 }),
    findModel: () => undefined,
    anthropicThinkingFor: () => undefined,
    modelsForProvider: () => options.catalogModels ?? [],
  };

  const { registerProviderIpc } = load("../electron/main/ipc/provider-ipc.ts", {
    "@pi-desktop/shared": {
      IPC,
      ErrorCodes: { TIMEOUT: "TIMEOUT" },
      inferEndpointProfile: shared.inferEndpointProfile,
      normalizeApiStyle: shared.normalizeApiStyle,
      resolveBindingLimits: shared.resolveBindingLimits,
    },
    "../oauth": { OAUTH_AUTH_KIND: "oauth" },
    "../model-discovery": modelDiscovery,
    "../provider-endpoint-probe": providerEndpointProbe,
    "@pi-desktop/agent-runtime": {
      modelConfigWithBinding: (catalogConfig) => catalogConfig,
    },
    "../models-dev-catalog": {
      catalogModelConfigFor: modelsDev.catalogModelConfigFor,
      modelInfoFromModelsDev: modelsDev.modelInfoFromModelsDev,
    },
    "../host-process": {},
    "../logger": {},
    "./types": {},
  });

  const handlers = new Map();
  registerProviderIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => ({
      call: async (method, input) => {
        hostCalls.push([method, input]);
        if (method === "providers.list") return { providers };
        if (method === "providers.listModels") return { models: options.cachedModels ?? [] };
        if (method === "providers.getSecret") return { value: "stored-secret" };
        if (method === "providers.cacheModels") return { ok: true };
        throw new Error(`unexpected host call: ${method}`);
      },
    }),
    modelsDevCatalog,
    vendorOAuth: options.vendorOAuth ?? {},
    logger: {
      app: (scope, level, message, payload) => logs.push({ scope, level, message, payload }),
    },
    enrichProvider: (provider) => provider,
    listRuntimeProviders: async () => providers,
    enrichProviderList: async (result) => result,
    bindingForModel: () => undefined,
    localNetworkPermission,
  });
  const handler = handlers.get(IPC.invoke.providersListModels);
  assert.equal(typeof handler, "function", "the provider model-list handler is not registered");
  return {
    call: (input) => handler(input),
    baseUrl,
    events,
    hostCalls,
    logs,
    triggerCalls,
  };
}

test("a manual Fetch list request carries the intent into the trigger before HTTP discovery", async (t) => {
  const h = await harness(t);
  const result = await h.call({
    providerId: KEYED_PROVIDER.id,
    baseUrl: h.baseUrl,
    apiStyle: "chat_completions",
    intent: "manual-fetch-list",
  });
  assert.equal(result.source, "remote");
  assert.deepEqual(
    result.models.map((model) => model.modelId),
    ["lan-fixture"],
  );
  assert.deepEqual(h.triggerCalls, [h.baseUrl], "the manual intent must reach the trigger exactly once");
  assert.deepEqual(
    h.events.slice(0, 2),
    [["trigger"], ["http", "/models"]],
    "the trigger must run before the HTTP discovery request",
  );
  // The manual field is a request marker only: nothing may forward it.
  for (const [method, input] of h.hostCalls) {
    assert.ok(
      input === undefined || !Object.hasOwn(input, "intent"),
      `${method} received the transient intent field`,
    );
  }
});

test("automatic and debounced discovery omit the intent and never trigger", async (t) => {
  const h = await harness(t);
  await h.call({ providerId: KEYED_PROVIDER.id, baseUrl: h.baseUrl, apiStyle: "chat_completions" });
  await h.call({ providerId: KEYED_PROVIDER.id, baseUrl: h.baseUrl, apiStyle: "chat_completions", source: "refresh" });
  assert.deepEqual(h.triggerCalls, []);
  assert.deepEqual(
    h.events.map((event) => event[0]),
    ["http", "http"],
  );
});

test("a non-matching intent is never treated as manual", async (t) => {
  const h = await harness(t);
  for (const intent of ["manual", "manual-fetch", "refresh", "MANUAL-FETCH-LIST", "", 1, null, {}]) {
    await h.call({ providerId: KEYED_PROVIDER.id, baseUrl: h.baseUrl, intent });
  }
  assert.deepEqual(h.triggerCalls, [], "only the exact manual intent may enable the trigger");
});

test("the legacy string request form keeps working without triggering", async (t) => {
  const h = await harness(t);
  const result = await h.call(KEYED_PROVIDER.id);
  assert.equal(result.source, "remote");
  assert.deepEqual(
    result.models.map((model) => model.modelId),
    ["lan-fixture"],
  );
  assert.deepEqual(h.triggerCalls, []);
  for (const [method, input] of h.hostCalls) {
    assert.ok(
      input === undefined || !Object.hasOwn(input, "intent"),
      `${method} received the transient intent field`,
    );
  }
});

test("cache hydration and OAuth accounts bypass the trigger", async (t) => {
  const cached = await harness(t, { cachedModels: [{ modelId: "cached-model", displayName: "cached-model" }] });
  const cacheResult = await cached.call({
    providerId: KEYED_PROVIDER.id,
    baseUrl: cached.baseUrl,
    source: "cache",
    intent: "manual-fetch-list",
  });
  assert.equal(cacheResult.source, "cache");
  assert.deepEqual(cached.triggerCalls, [], "cache hydration must not prompt");

  const oauth = await harness(t, {
    providers: [OAUTH_PROVIDER],
    vendorOAuth: { listModels: async () => [{ modelId: "vendor-model", apiStyle: "openai_codex_responses" }] },
  });
  const oauthResult = await oauth.call({
    providerId: OAUTH_PROVIDER.id,
    baseUrl: oauth.baseUrl,
    apiStyle: "openai_codex_responses",
    intent: "manual-fetch-list",
  });
  assert.equal(oauthResult.source, "remote");
  assert.deepEqual(oauth.triggerCalls, [], "a vendor account must not probe the local network");
});

test("an OAuth account whose vendor list is empty still bypasses the trigger", async (t) => {
  const h = await harness(t, {
    providers: [OAUTH_PROVIDER],
    vendorOAuth: { listModels: async () => [] },
  });
  await h.call({
    providerId: OAUTH_PROVIDER.id,
    baseUrl: h.baseUrl,
    apiStyle: "openai_codex_responses",
    intent: "manual-fetch-list",
  });
  assert.deepEqual(h.triggerCalls, [], "the OAuth branch must stay outside the manual trigger");
});

test("a failed or unfruitful trigger never replaces the discovery result", async (t) => {
  for (const triggerResult of [
    { status: "failed", stage: "connect", reason: "connect-error", code: "EACCES" },
    { status: "skipped", stage: "hostname", reason: "address-not-local" },
    { status: "attempted", stage: "connect", reason: "connect-unconfirmed" },
  ]) {
    const h = await harness(t, { triggerResult });
    const result = await h.call({
      providerId: KEYED_PROVIDER.id,
      baseUrl: h.baseUrl,
      intent: "manual-fetch-list",
    });
    assert.equal(result.source, "remote");
    assert.deepEqual(
      result.models.map((model) => model.modelId),
      ["lan-fixture"],
    );
    assert.equal(result.error, undefined, "a supplemental trigger verdict is not a discovery error");
    assert.deepEqual(h.triggerCalls, [h.baseUrl]);
  }
});

test("HTTP failure keeps the fallback semantics and the sanitized diagnostic", async (t) => {
  const h = await harness(t, { httpStatus: 401 });
  const result = await h.call({
    providerId: KEYED_PROVIDER.id,
    baseUrl: h.baseUrl,
    intent: "manual-fetch-list",
  });
  assert.equal(result.source, "fallback");
  assert.match(String(result.error), /401/);
  assert.deepEqual(h.triggerCalls, [h.baseUrl], "the trigger still runs on the manual path");

  const diagnostic = h.logs.find((entry) => entry.message.includes("local network"));
  if (diagnostic) {
    const text = JSON.stringify(diagnostic);
    assert.ok(!text.includes("127.0.0.1"), "the diagnostic must not carry the endpoint");
    assert.ok(!text.includes("stored-secret"), "the diagnostic must not carry credentials");
  }
});

test("the trigger diagnostic is sanitized when it fails", async (t) => {
  const h = await harness(t, {
    triggerResult: { status: "failed", stage: "connect", reason: "connect-error", code: "EHOSTUNREACH" },
  });
  await h.call({
    providerId: KEYED_PROVIDER.id,
    baseUrl: h.baseUrl,
    apiKey: "sk-super-secret",
    intent: "manual-fetch-list",
  });
  const diagnostic = h.logs.find((entry) => entry.message.includes("local network"));
  assert.ok(diagnostic, "a failed trigger must be observable in the log");
  const text = JSON.stringify(diagnostic);
  assert.ok(!text.includes("sk-super-secret"), "the diagnostic must not carry the API key");
  assert.ok(!text.includes("127.0.0.1"), "the diagnostic must not carry the endpoint");
  assert.match(text, /EHOSTUNREACH/);
});
