import { IPC } from "@pi-desktop/shared";

const stamp = "2026-10-23T00:00:00.000Z";
export function modelFixtureProvider(id = "fixture-service") {
  return { id, name: "Fixture service", vendorKey: "custom", type: "openai_compatible",
    protocol: "openai_compatible", enabled: true, authKind: "api_key_and_base_url",
    apiStyle: "chat_completions", baseUrl: "https://fixture.invalid/v1", hasSecret: true,
    supportsReasoning: false, supportedThinkingLevels: ["off"], createdAt: stamp, updatedAt: stamp,
    defaultModelId: "fixture-chat", models: [{ id: "fixture-chat", thinkingLevels: ["off"], defaultThinkingLevel: "off" }] };
}

/** Explicit fixture services only; every unowned IPC is returned to the caller. */
export function createModelsFixture(parameters = new URLSearchParams()) {
  const accountPreview = parameters.get("models") === "account";
  const account = { ...modelFixtureProvider("fixture-account"), name: "Fixture subscription",
    vendorKey: "fixture-oauth", authKind: "oauth", hasSecret: false, hasOauth: true,
    oauthAccountLabel: "Preview account" };
  const providers = parameters.get("models") === "empty" ? [] : [accountPreview ? account : modelFixtureProvider()];
  const oauthListeners = new Set();
  let activeLoginId = null;
  let loginSequence = 0;
  const emitLogin = (event) => {
    for (const listener of oauthListeners) listener({ loginId: activeLoginId, vendorId: "fixture-oauth", ...event });
  };
  const calls = [];
  const controls = { failSave: false, failRefresh: false, failDiscovery: false, failTest: false };
  const catalog = { loaded: true, source: "bundled", catalogPath: "/fixture/models.json", providerCount: 1, modelCount: 2 };
  const channels = new Set([IPC.invoke.providersList, IPC.invoke.providersCreate, IPC.invoke.providersUpdate,
    IPC.invoke.providersDelete, IPC.invoke.providersSetSecret, IPC.invoke.providersTest,
    IPC.invoke.providersListModels, IPC.invoke.providersLookupModel, IPC.invoke.providersModelCatalogStatus,
    IPC.invoke.providersRefreshModelCatalog, IPC.invoke.providersOauthVendors]);
  if (accountPreview) {
    channels.add(IPC.invoke.providersOauthStart);
    channels.add(IPC.invoke.providersOauthRespond);
    channels.add(IPC.invoke.providersOauthCancel);
    channels.add(IPC.invoke.providersOauthDelete);
  }
  function invoke(channel, input) {
    if (!channels.has(channel)) return { handled: false };
    calls.push({ channel, input: structuredClone(input) });
    let data;
    const find = () => {
      const provider = providers.find((row) => row.id === (input?.id ?? input));
      if (!provider) throw new Error("Unknown fixture service");
      return provider;
    };
    switch (channel) {
      case IPC.invoke.providersList:
        if (controls.failRefresh) throw new Error("Fixture refresh failed");
        data = { providers: structuredClone(providers) }; break;
      case IPC.invoke.providersCreate: {
        if (controls.failSave) throw new Error("Fixture save failed");
        if (!input.name || !input.models?.length) throw new Error("Fixture service requires a name and model");
        const row = { ...modelFixtureProvider(`fixture-${providers.length + 1}`), ...input, hasSecret: Boolean(input.secretValue) };
        delete row.secretValue;
        providers.push(row); data = { provider: structuredClone(row) }; break;
      }
      case IPC.invoke.providersUpdate: {
        if (controls.failSave) throw new Error("Fixture save failed");
        const row = find(); Object.assign(row, input);
        if (input.secretValue) row.hasSecret = true;
        delete row.secretValue; data = { provider: structuredClone(row) }; break;
      }
      case IPC.invoke.providersDelete: {
        const row = find(); providers.splice(providers.indexOf(row), 1); data = { ok: true }; break;
      }
      case IPC.invoke.providersSetSecret:
        find().hasSecret = Boolean(input.secretValue); data = { ok: true }; break;
      case IPC.invoke.providersTest:
        find(); data = controls.failTest ? { ok: false, message: "Fixture connection refused" } : { ok: true }; break;
      case IPC.invoke.providersListModels:
        if (controls.failDiscovery) throw new Error("Fixture model list unavailable");
        data = { source: input.source === "cache" ? "cache" : "remote", models: ["fixture-chat", "fixture-chat-2"].map((id) => ({
          modelId: id, displayName: id, providerId: input.providerId ?? "fixture-service", source: "discovered",
          capabilities: ["text"], supportedThinkingLevels: ["off"], contextWindow: 32000, maxTokens: 4000,
        })) }; break;
      case IPC.invoke.providersLookupModel: data = { info: null }; break;
      case IPC.invoke.providersModelCatalogStatus: data = { status: catalog }; break;
      case IPC.invoke.providersRefreshModelCatalog: data = { refreshed: true, status: catalog }; break;
      case IPC.invoke.providersOauthVendors:
        data = { vendors: accountPreview ? [{ vendorId: "fixture-oauth", name: "Fixture subscription",
          loginLabel: "Preview account sign-in", isSubscription: true,
          accounts: providers.filter((row) => row.authKind === "oauth").map((row) => ({
            providerId: row.id, accountLabel: row.oauthAccountLabel, connected: Boolean(row.hasOauth),
          })) }] : [] }; break;
      case IPC.invoke.providersOauthStart:
        if (input !== "fixture-oauth") throw new Error("Unknown fixture OAuth vendor");
        if (activeLoginId) throw new Error("Fixture OAuth login is already active");
        activeLoginId = `fixture-login-${++loginSequence}`;
        data = { loginId: activeLoginId };
        // The real renderer session buffers early events until Start resolves.
        // This fixture never opens a browser or begins real provider polling.
        emitLogin({ kind: "progress", message: "Fixture sign-in is waiting. No account or network service is contacted." });
        emitLogin({ kind: "authUrl", url: "https://fixture.invalid/oauth", opened: false });
        emitLogin({ kind: "prompt", request: { promptId: "fixture-code", type: "manual_code",
          message: "Paste a preview authorization code", placeholder: "Fixture code" } });
        break;
      case IPC.invoke.providersOauthRespond:
        if (!activeLoginId || input.loginId !== activeLoginId || input.promptId !== "fixture-code") {
          throw new Error("Unknown fixture OAuth prompt");
        }
        emitLogin({ kind: "progress", message: "Preview code received. Waiting for cancellation; no real authentication is performed." });
        data = { ok: true }; break;
      case IPC.invoke.providersOauthCancel:
        if (!activeLoginId || input !== activeLoginId) { data = { ok: false }; break; }
        emitLogin({ kind: "cancelled" }); activeLoginId = null; data = { ok: true }; break;
      case IPC.invoke.providersOauthDelete: {
        const row = find();
        if (row.authKind !== "oauth") throw new Error("Fixture row is not an OAuth account");
        providers.splice(providers.indexOf(row), 1); data = { ok: true }; break;
      }
      default: throw new Error(`Missing model fixture branch: ${channel}`);
    }
    return { handled: true, data };
  }
  return { invoke, providers, calls, controls,
    on(channel, listener) {
      if (channel !== IPC.event.providersOauth) return () => {};
      oauthListeners.add(listener);
      return () => oauthListeners.delete(listener);
    },
  };
}
