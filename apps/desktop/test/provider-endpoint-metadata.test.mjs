/**
 * A custom endpoint on a published host still gets that publisher's metadata.
 *
 * The reported failure: a custom row pointed at `https://open.bigmodel.cn/api/v1`
 * (the Zhipu OpenAI Responses endpoint) listed its models but showed a generic
 * 128k / 8k text-only row for every one of them, while the same models are fully
 * described in models.dev — the catalog only accepted that host's own published
 * path, and the row declared no publisher of its own.
 *
 * This drives the real `providersListModels` handler with the bundled snapshot,
 * so it pins the whole chain: discovery, endpoint resolution, catalog anchoring.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const { registerProviderIpc } = await import("../electron/main/ipc/provider-ipc.ts");
const { ModelsDevCatalog } = await import("../electron/main/models-dev-catalog.ts");
const { IPC } = await import("@pi-desktop/shared");

const catalogPath = new URL("../resources/models.dev/api.json", import.meta.url).pathname;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Register the real list-models handler against one row and one served list. */
async function listModelsFor(t, row, body) {
  const catalog = new ModelsDevCatalog({ catalogPath });
  assert.equal(await catalog.ensureLoaded(), true, "the bundled snapshot must load");

  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).endsWith("/models") ? jsonResponse(body) : new Response("", { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  const handlers = new Map();
  registerProviderIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => ({
      call: async (method) => {
        if (method === "providers.list") return { providers: [row] };
        if (method === "providers.getSecret") return { value: "sk-secret" };
        if (method === "providers.get") return { provider: row };
        return {};
      },
    }),
    modelsDevCatalog: catalog,
    vendorOAuth: {},
    logger: { app: () => {} },
    enrichProvider: (provider) => provider,
    listRuntimeProviders: async () => [row],
    enrichProviderList: (result) => result,
    bindingForModel: () => undefined,
  });

  const handler = handlers.get(IPC.invoke.providersListModels);
  assert.equal(typeof handler, "function", "list-models handler is not registered");
  return { result: await handler({ providerId: row.id, source: "refresh" }), calls };
}

test("a custom row on a published host gets that publisher's model metadata", async (t) => {
  const row = {
    id: "row-1",
    name: "Zhipu",
    vendorKey: "custom",
    baseUrl: "https://open.bigmodel.cn/api/v1",
    apiStyle: "responses",
    models: [],
    authKind: "api_key_and_base_url",
    headers: {},
  };
  const { result, calls } = await listModelsFor(t, row, {
    models: [{ slug: "glm-5.3", display_name: "glm-5.3" }],
  });

  assert.deepEqual(calls, ["https://open.bigmodel.cn/api/v1/models"]);
  // The address the user typed answered, so it stays the row's address.
  assert.equal(result.effectiveBaseUrl, "https://open.bigmodel.cn/api/v1");

  const [model] = result.models;
  assert.equal(model.modelId, "glm-5.3", "the wire id is the one the service served");
  assert.equal(model.catalogSource, "models.dev", "the host identified the publisher");
  assert.equal(model.contextWindow, 1_000_000);
  assert.equal(model.maxTokens, 131_072);
  for (const capability of ["tools", "reasoning"]) {
    assert.ok(model.capabilities.includes(capability), `expected ${capability} capability`);
  }
});

test("a custom row on a host the catalog does not know keeps generic defaults", async (t) => {
  const row = {
    id: "row-2",
    name: "Relay",
    vendorKey: "custom",
    baseUrl: "https://relay.example/v1",
    apiStyle: "chat_completions",
    models: [],
    authKind: "api_key_and_base_url",
    headers: {},
  };
  const { result } = await listModelsFor(t, row, { data: [{ id: "some-private-model" }] });

  const [model] = result.models;
  assert.equal(model.catalogSource, undefined);
  assert.equal(model.contextWindow, 128_000);
  assert.deepEqual(model.capabilities, ["text"]);
});
