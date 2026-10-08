import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { register, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

// Redirect filesystem discovery before loading the real launch/runtime modules.
// No user definitions, prompts, credentials or model services are consulted.
const fixtureHome = mkdtempSync(join(os.tmpdir(), "pi-team-launch-home-"));
const originalHomedir = os.homedir;
const originalReadFile = fsPromises.readFile;
const documentReads = [];
os.homedir = () => fixtureHome;
fsPromises.readFile = async (path, ...args) => {
  documentReads.push(String(path));
  return originalReadFile(path, ...args);
};
syncBuiltinESMExports();
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { capabilitiesFromModelConfig, genericModelConfig, modelConfigWithBinding } =
  await import("@pi-desktop/agent-runtime");
const { OAUTH_AUTH_KIND } = await import("../electron/main/oauth.ts");
const { createSessionLaunchRuntime } = await import("../electron/main/runtime/session-launch.ts");

test.after(() => {
  os.homedir = originalHomedir;
  fsPromises.readFile = originalReadFile;
  syncBuiltinESMExports();
  rmSync(fixtureHome, { recursive: true, force: true });
});

function fixture(t, { ownOAuth = false, forbidDelegation = false, missingTeam = false } = {}) {
  const root = mkdtempSync(join(fixtureHome, "project-"));
  const documentPath = join(root, "private-reviewer.md");
  const brokenPath = join(root, "broken.md");
  writeFileSync(documentPath, "---\nname: private-reviewer\ndescription: Fixture reviewer\nmodel: fixture/private\nfallbackModels: [fixture/backup]\n---\nReview the fixture.\n");
  writeFileSync(brokenPath, "---\nname: broken\n---\nMissing required description.\n");
  mkdirSync(join(root, ".pi"));
  writeFileSync(join(root, "AGENTS.md"), "Fixture project instructions.");
  writeFileSync(join(root, ".pi", "APPEND_SYSTEM.md"), "Fixture appended prompt.");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const own = {
    id: "parent-provider", vendorKey: "parent", name: "Parent", enabled: true,
    authKind: ownOAuth ? OAUTH_AUTH_KIND : "none", apiStyle: "openai-chat",
    baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "parent", thinkingLevels: ["off"] }],
  };
  const delegate = {
    ...own, id: "delegate-provider", vendorKey: "fixture", name: "Delegate", authKind: "api_key",
    models: [{ id: "private" }, { id: "backup" }, { id: "allowed", availableForSubagents: true }]
      .map((binding) => ({ ...binding, thinkingLevels: ["off"] })),
  };
  const vendor = {
    ...own, id: "delegate-vendor", vendorKey: "vendor", name: "Vendor", authKind: OAUTH_AUTH_KIND,
    models: [{ id: "available", availableForSubagents: true, thinkingLevels: ["off"] }],
  };
  const providers = [own, delegate, vendor];
  const shell = { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true };
  const hostCalls = [];
  const vendorCalls = [];
  const modelCalls = [];
  const warnings = [];
  const authBindings = [];
  const context = { teamSessionId: "lead", callerSessionId: "session", isLead: true };
  const guard = (operation) => {
    if (forbidDelegation) throw new Error(`Ordinary delegation accessed: ${operation}`);
  };
  const runtime = createSessionLaunchRuntime({
    runtimeState: {
      host: {
        isAvailable: () => true,
        call: async (method, params) => {
          hostCalls.push({ method, params });
          if (method === "commandShells.list") return { configuredId: "bash", effective: shell, fallback: false, choices: [shell] };
          if (method === "providers.list") return { providers };
          if (method === "providers.getSecret") {
            if (params.id !== own.id) guard("delegate credential");
            return { value: params.id === delegate.id ? "fixture-secret" : undefined };
          }
          if (method === "agents.active") {
            guard("definition registry");
            return { subagents: [{ id: "reviewer", path: documentPath }, { id: "broken", path: brokenPath }] };
          }
          if (method === "agents.disabledBuiltins") {
            guard("builtin activation registry");
            return { disabled: ["explorer"] };
          }
          if (method === "skills.active") return { skills: [] };
          if (method === "mcp.active") return { servers: [] };
          if (method === "project.group.context") return { context: { memory: { content: "Fixture memory." } } };
          if (method === "team.getRuntimeContext") return missingTeam ? null : context;
          throw new Error(`Unexpected Host call ${method}`);
        },
      },
      sidecar: { setVendorAuthBindings: (sessionId, bindings) => authBindings.push({ sessionId, bindings }) },
    },
    logger: { app: (...args) => warnings.push(args) },
    userMcp: { setRecords() {}, toolsForProject: async () => [] },
    plugins: { listLoaded: () => [], getSkills: () => [], getTools: () => [], getAgentExtensions: () => [] },
    sessionProjects: new Map(), dataDir: root,
    vendorOAuth: {
      bindingFor: async (providerId, modelId) => {
        vendorCalls.push({ providerId, modelId });
        if (providerId !== own.id) guard("delegate OAuth binding");
        const modelConfig = genericModelConfig(modelId, own.baseUrl);
        return { apiStyle: own.apiStyle, baseUrl: own.baseUrl, modelConfig, ...capabilitiesFromModelConfig(modelConfig) };
      },
    },
    modelsDevCatalog: {
      ensureLoaded: async () => {}, configureAccount() {},
      findModel: (input) => {
        modelCalls.push(input);
        if (input.providerId !== own.id) guard("delegate catalog model");
        return undefined;
      },
    },
    getWorkspacePath: () => root, pluginActiveInProject: () => true,
    bindingForModel: (provider, id) => provider.models.find((binding) => binding.id === id),
    effectiveSubagentModelConfig: (provider, id, catalog) => {
      guard("delegate model configuration");
      const modelConfig = modelConfigWithBinding(catalog, provider.models.find((binding) => binding.id === id));
      return { modelConfig, capabilities: capabilitiesFromModelConfig(modelConfig) };
    },
    normalizeThinkingLevel: () => "off",
  });
  const session = { providerId: own.id, modelId: "parent", projectPath: root };
  const launch = (executionProfile, overrides = {}) => runtime.resolveAgentRuntimeLaunch("session", { ...session, executionProfile }, {}, overrides);
  return { launch, hostCalls, vendorCalls, modelCalls, warnings, authBindings, context, documentPath, brokenPath, own, delegate, vendor };
}

for (const role of ["lead", "member"]) {
  test(`Team ${role} launches without reading ordinary Task configuration or unused models`, async (t) => {
    const f = fixture(t, { ownOAuth: true, forbidDelegation: true });
    f.context.isLead = role === "lead";
    if (role === "member") f.context.memberName = "Fixture engineer";
    const params = (await f.launch("team")).sidecarParams;
    assert.equal(params.executionProfile, "team");
    assert.equal(params.teamContext, f.context);
    assert.equal(params.provider.id, f.own.id);
    assert.equal(params.provider.authKind, OAUTH_AUTH_KIND);
    assert.equal(params.customSystemPrompt.append, "Fixture appended prompt.");
    assert.equal(params.projectMemory, "Fixture memory.");
    assert.ok(params.projectInstructions.entries.some((entry) => entry.content === "Fixture project instructions."));
    assert.deepEqual(params.subagents, []);
    assert.deepEqual(params.subagentProviders, {});
    assert.deepEqual(params.subagentModelKeys, []);
    assert.deepEqual(f.vendorCalls, [{ providerId: f.own.id, modelId: "parent" }]);
    assert.equal(f.modelCalls.length, 0);
    assert.equal(f.hostCalls.some(({ method }) => method.startsWith("agents.")), false);
    assert.equal(f.hostCalls.some(({ method }) => method === "providers.getSecret"), false);
    assert.equal(documentReads.includes(f.documentPath), false);
    assert.equal(documentReads.includes(f.brokenPath), false);
    assert.deepEqual(f.warnings, []);
    assert.deepEqual(f.authBindings.at(-1).bindings, [{ providerId: f.own.id }]);
  });
}

test("effective profile override controls launch isolation and keeps own non-OAuth binding", async (t) => {
  const f = fixture(t, { forbidDelegation: true });
  const params = (await f.launch("standard", { executionProfile: "team" })).sidecarParams;
  assert.equal(params.executionProfile, "team");
  assert.equal(params.teamContext, f.context);
  assert.deepEqual(params.subagents, []);
  assert.deepEqual(f.vendorCalls, []);
  assert.deepEqual(f.modelCalls.map(({ providerId, modelId }) => ({ providerId, modelId })), [{ providerId: f.own.id, modelId: "parent" }]);
  assert.deepEqual(f.hostCalls.filter(({ method }) => method === "providers.getSecret").map(({ params }) => params.id), [f.own.id]);
});

test("standard launches preserve definitions, builtin exclusions, private/fallback pins, opted-in models and diagnostics", async (t) => {
  const f = fixture(t);
  const params = (await f.launch("standard")).sidecarParams;
  assert.equal(params.executionProfile, "standard");
  assert.equal(params.teamContext, undefined);
  assert.equal(f.hostCalls.some(({ method }) => method === "team.getRuntimeContext"), false);
  assert.ok(f.hostCalls.some(({ method }) => method === "agents.active"));
  assert.ok(f.hostCalls.some(({ method }) => method === "agents.disabledBuiltins"));
  assert.ok(documentReads.includes(f.documentPath));
  assert.equal(params.subagents.some(({ name }) => name === "explorer"), false);
  const definition = params.subagents.find(({ name }) => name === "private-reviewer");
  assert.deepEqual(definition.model, { providerId: "fixture", modelId: "private" });
  assert.deepEqual(definition.fallbackModels, [{ providerId: "fixture", modelId: "backup" }]);
  assert.equal(params.subagentProviders["fixture/private"].apiKey, "fixture-secret");
  assert.equal(params.subagentProviders["fixture/backup"].id, f.delegate.id);
  assert.equal(params.subagentProviders["vendor/available"].id, f.vendor.id);
  assert.deepEqual(params.subagentModelKeys, ["fixture/allowed", "vendor/available"]);
  assert.ok(f.warnings.some(([, , message]) => message === "subagent definitions have problems"));
  assert.deepEqual(f.authBindings.at(-1).bindings, [{ providerId: f.vendor.id }]);
  assert.deepEqual(f.vendorCalls, [{ providerId: f.vendor.id, modelId: "available" }]);

  // Reusing the launch resolver across profiles must revoke delegated OAuth access.
  const team = (await f.launch("team")).sidecarParams;
  assert.deepEqual(team.subagents, []);
  assert.deepEqual(team.subagentProviders, {});
  assert.deepEqual(f.authBindings.at(-1).bindings, []);
  const restored = (await f.launch("team", { executionProfile: "standard" })).sidecarParams;
  assert.ok(restored.subagentProviders["fixture/private"]);
  assert.deepEqual(f.authBindings.at(-1).bindings, [{ providerId: f.vendor.id }]);
});

test("Team launch still rejects missing Host Team authority", async (t) => {
  const f = fixture(t, { missingTeam: true });
  await assert.rejects(f.launch("team"), { errorCode: "TEAM_CONTEXT_UNAVAILABLE" });
  assert.deepEqual(f.authBindings, [], "an unauthorized launch cannot publish credential bindings");
});
