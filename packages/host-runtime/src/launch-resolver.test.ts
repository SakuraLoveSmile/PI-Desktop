import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createHeadlessLaunchResolver, type HostProviderRecord } from "./launch-resolver.js";

type Call = { method: string; params: Record<string, unknown> };

function hostWith(providers: HostProviderRecord[], secrets: Record<string, string> = {}, projectContext: unknown = { context: null }) {
  const calls: Call[] = [];
  return {
    calls,
    host: {
      async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params });
        switch (method) {
          case "commandShells.list":
            return {
              configuredId: null,
              effective: { id: "bash", label: "bash", available: true, dialect: "posix", isDefault: true },
              fallback: true,
              choices: [{ id: "bash", label: "bash", available: true, dialect: "posix", isDefault: true }],
            } as T;
          case "providers.list":
            return { providers } as T;
          case "providers.getSecret":
            return { value: secrets[String(params.id)] } as T;
          case "skills.active":
            return { skills: [{ id: "review", name: "Review", enabled: true, description: "Review code" }] } as T;
          case "agents.active":
            return { subagents: [] } as T;
          case "agents.disabledBuiltins":
            return { disabled: [] } as T;
          case "project.group.context":
            return projectContext as T;
          case "project.memory.get":
            return { memory: { content: "remember me" } } as T;
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    },
  };
}

const provider: HostProviderRecord = {
  id: "p1",
  name: "OpenAI",
  vendorKey: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: [
    { id: "gpt-a", contextWindow: 128_000, maxTokens: 8_192, thinkingLevels: ["off"], defaultThinkingLevel: null, availableForSubagents: false },
  ],
  authKind: "api_key",
  hasSecret: true,
  enabled: true,
};

describe("createHeadlessLaunchResolver", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])(
    "uses the authoritative memory alias without falling back to slot notes (empty=%s, grouped=%s)", async (empty, grouped) => {
    const root = await mkdtemp(join(tmpdir(), "memory-alias-launch-"));
    const slot = join(root, "slot-1");
    const owner = join(root, "real-project");
    await mkdir(slot);
    await mkdir(owner);
    await writeFile(join(slot, "AGENTS.md"), "Slot file instructions.");
    await writeFile(join(owner, "AGENTS.md"), "Real root untracked instructions must stay private.");
    try {
      const memoryAlias = { memory: { content: empty ? "" : "Real project notes.", entries: [] },
        instructions: empty ? "" : "Real group instructions." };
      const { host, calls } = hostWith([provider], { p1: "sk-test" }, {
        context: grouped ? { roots: [{ path: owner }, { path: join(owner, "additional") }],
          instructions: "Stale slot group instructions.", memory: { content: "Stale slot group notes." } } : null, memoryAlias,
      });
      const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: root, log: () => undefined });
      const launch = await resolver.resolve("slot-session", { projectPath: slot }, {});
      expect(launch.projectPath).toBe(slot);
      expect(launch.sidecarParams.projectPath).toBe(slot);
      expect(launch.sidecarParams.projectMemory).toBe(empty ? undefined : "Real project notes.");
      expect(launch.sidecarParams.projectMemoryAlias).toEqual(memoryAlias);
      const instructions = JSON.stringify(launch.sidecarParams.projectInstructions);
      expect(instructions).toContain("Slot file instructions.");
      expect(instructions).not.toContain("Real root untracked instructions");
      expect(instructions).not.toContain(owner);
      expect(instructions).not.toContain("Primary root:");
      expect(instructions).not.toContain("Additional root:");
      expect(instructions).not.toContain("Stale slot group");
      expect(calls.filter(call => call.method === "project.memory.get")).toEqual([]);
      expect(calls.find(call => call.method === "project.group.context")?.params).toEqual({ path: slot });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("keeps ordinary group roots, memory and instructions when no alias exists", async () => {
    const { host, calls } = hostWith([provider], { p1: "sk-test" }, { context: {
      roots: [{ path: "/ordinary/project" }, { path: "/ordinary/additional" }],
      instructions: "Ordinary group rules.", memory: { content: "Ordinary group notes." },
    } });
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    const launch = await resolver.resolve("ordinary", { projectPath: "/ordinary/project" }, {});
    expect(launch.sidecarParams.projectMemory).toBe("Ordinary group notes.");
    expect(launch.sidecarParams.projectMemoryAlias).toBeUndefined();
    const instructions = JSON.stringify(launch.sidecarParams.projectInstructions);
    expect(instructions).toContain("Ordinary group rules.");
    expect(instructions).toContain("Primary root: /ordinary/project");
    expect(instructions).toContain("Additional root: /ordinary/additional");
    expect(calls.some(call => call.method === "project.memory.get")).toBe(false);
  });

  it("resolves the session's provider, its secret, the shell, skills and project memory", async () => {
    const { host, calls } = hostWith([provider], { p1: "sk-test" });
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    const launch = await resolver.resolve(
      "s1",
      { providerId: "p1", modelId: "gpt-a", projectPath: "/work/project" },
      { defaultMode: "agent" },
    );
    expect(launch.providerId).toBe("p1");
    expect(launch.modelId).toBe("gpt-a");
    expect(launch.projectPath).toBe("/work/project");
    expect(launch.sidecarParams.provider.apiKey).toBe("sk-test");
    expect(launch.sidecarParams.provider.modelConfig?.name).toBe("gpt-a");
    expect(launch.sidecarParams.scratchDir).toBe("/data/scratch/s1");
    expect(launch.sidecarParams.pluginSkills).toEqual([{ id: "review", name: "Review", description: "Review code" }]);
    expect(launch.sidecarParams.pluginTools).toEqual([]);
    expect(launch.sidecarParams.projectMemory).toBe("remember me");
    expect(launch.sidecarParams.commandShell).toMatchObject({ id: "bash" });
    expect(launch.sidecarParams.infiniteProviderRetry).toBe(false);
    expect(calls.some((call) => call.method === "providers.getSecret")).toBe(true);
  });

  it("preserves the durable interaction policy and rejects unknown policies", async () => {
    const { host } = hostWith([provider], { p1: "sk-test" });
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    for (const mode of ["interactive", "unattended"]) {
      expect((await resolver.resolve("s", { interactionMode: mode }, {})).sidecarParams.interactionMode).toBe(mode);
    }
    expect((await resolver.resolve("s", {}, {})).sidecarParams.interactionMode).toBe("interactive");
    for (const invalid of ["unknown", null, true]) {
      await expect(resolver.resolve("s", { interactionMode: invalid }, {})).rejects.toMatchObject({ errorCode: "INVALID_PARAMS" });
    }
  });

  it("uses only the full wire ID binding for a routed model, retaining its request ID", async () => {
    const routedId = "proxy/model";
    const row: HostProviderRecord = {
      ...provider,
      models: [
        { id: "model", contextWindow: 16_000, contextWindowSource: "user", maxTokens: 2_048, thinkingLevels: ["off"], defaultThinkingLevel: "off" },
        { id: " PROXY/MODEL ", contextWindow: 32_000, contextWindowSource: "user", maxTokens: 4_096, thinkingLevels: ["high"], defaultThinkingLevel: "high" },
      ],
    };
    const { host } = hostWith([row], { p1: "sk-test" });
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    const routed = await resolver.resolve("s1", { providerId: "p1", modelId: routedId }, {});
    expect(routed.modelId).toBe(routedId);
    expect(routed.sidecarParams.provider.modelId).toBe(routedId);
    expect(routed.sidecarParams.provider.modelConfig).toMatchObject({ name: routedId, contextWindow: 32_000, maxTokens: 4_096 });
    expect(routed.sidecarParams.thinkingLevel).toBe("high");

    const plain = await resolver.resolve("s1", { providerId: "p1", modelId: "model" }, {});
    expect(plain.sidecarParams.provider.modelConfig).toMatchObject({ name: "model", contextWindow: 16_000, maxTokens: 2_048 });
    expect(plain.sidecarParams.thinkingLevel).toBe("off");

    row.models = [row.models![0]];
    const unbound = await resolver.resolve("s1", { providerId: "p1", modelId: routedId }, {});
    expect(unbound.sidecarParams.provider.modelConfig).toMatchObject({ name: routedId, contextWindow: 128_000, maxTokens: 8_192 });
    expect(unbound.sidecarParams.thinkingLevel).toBe("off");
    expect(unbound.sidecarParams.provider.modelId).toBe(routedId);
  });

  it("forwards the opt-in infinite provider retry setting", async () => {
    const { host } = hostWith([provider], { p1: "sk-test" });
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    const launch = await resolver.resolve(
      "s1",
      { providerId: "p1", modelId: "gpt-a" },
      { defaultMode: "agent", infiniteProviderRetry: true },
    );
    expect(launch.sidecarParams.infiniteProviderRetry).toBe(true);
  });

  it("falls back to the default provider and refuses a provider without a secret", async () => {
    const { host } = hostWith([provider, { ...provider, id: "p2", name: "Other", hasSecret: false }], { p1: "sk" });
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    const launch = await resolver.resolve("s1", {}, { defaultProviderId: "p1", defaultModelId: "gpt-a" });
    expect(launch.providerId).toBe("p1");
    await expect(resolver.resolve("s1", { providerId: "p2", modelId: "gpt-a" }, {})).rejects.toMatchObject({
      errorCode: "PROVIDER_SECRET_MISSING",
    });
  });

  it("refuses vendor accounts and plugin agents, which need the desktop", async () => {
    const { host } = hostWith([{ ...provider, authKind: "oauth" }]);
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    await expect(resolver.resolve("s1", { providerId: "p1" }, {})).rejects.toMatchObject({ errorCode: "MODEL_NOT_CONFIGURED" });
    await expect(resolver.resolve("s1", { providerId: "extension-agent:plugin.x%2Fagent" }, {})).rejects.toMatchObject({
      errorCode: "MODEL_NOT_CONFIGURED",
    });
  });

  it("fails with a typed error when no provider exists or the host is gone", async () => {
    const { host } = hostWith([]);
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir: "/data", log: () => undefined });
    await expect(resolver.resolve("s1", {}, {})).rejects.toMatchObject({ errorCode: "MODEL_NOT_CONFIGURED" });
    const offline = createHeadlessLaunchResolver({ getHost: () => null, dataDir: "/data", log: () => undefined });
    await expect(offline.resolve("s1", {}, {})).rejects.toMatchObject({ errorCode: "HOST_UNAVAILABLE" });
  });
});
