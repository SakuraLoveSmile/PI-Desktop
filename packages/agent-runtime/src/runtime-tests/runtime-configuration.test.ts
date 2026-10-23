import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { type RuntimeProviderConfig } from "../runtime.js";
import { provider, createRuntime, runtimeMatches } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime configuration matching", () => {

  it("retires an idle runtime when project memory changes", async () => {
    const runtime = createRuntime({ projectMemory: "Use the staging database." });
    expect(runtimeMatches(runtime, { projectMemory: "Use the staging database." })).toBe(true);
    expect(runtimeMatches(runtime, { projectMemory: "Use the production database." })).toBe(false);
    await runtime.dispose();
  });

  it("reuses a runtime only while its Advisor binding is unchanged", async () => {
    const advisorProvider = { ...provider, id: "advisor-fixture", modelId: "advisor-model" };
    const runtime = createRuntime({ advisorProvider });
    expect(runtimeMatches(runtime)).toBe(true);
    expect(runtimeMatches(runtime, { advisorProvider: undefined })).toBe(false);
    expect(runtimeMatches(runtime, { advisorProvider: { ...advisorProvider, modelId: "another-model" } })).toBe(false);
    await runtime.dispose();
  });

  it("accepts no-auth providers and reuses only an exact pi configuration", async () => {
    const runtime = createRuntime();

    expect(runtimeMatches(runtime)).toBe(true);
    expect(runtimeMatches(runtime, { mode: "plan" })).toBe(false);
    expect(
      runtimeMatches(runtime, {
        provider: { ...provider, authKind: "api_key" },
      }),
    ).toBe(false);
    expect(
      runtimeMatches(runtime, {
        provider: { ...provider, modelId: "another-model" },
      }),
    ).toBe(false);
    expect(runtimeMatches(runtime, { thinkingLevel: "high" })).toBe(false);

    await runtime.dispose();
  });

  it("stops once at a successful finishTurn boundary and lets errors settle", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    agent.state.isStreaming = true;

    expect(runtime.requestGracefulStop()).toEqual({ requested: true });
    expect(await agent.finishTurn({ message: { stopReason: "error" } })).toBeUndefined();
    expect(await agent.finishTurn({ message: { stopReason: "aborted" } })).toBeUndefined();
    expect(await agent.finishTurn({ message: { stopReason: "stop" } })).toEqual({ action: "end" });
    expect(await agent.finishTurn({ message: { stopReason: "stop" } })).toBeUndefined();

    agent.state.isStreaming = false;
    expect(runtime.requestGracefulStop()).toEqual({ requested: false });
    await runtime.dispose();
  });

  it("keeps a vendor-account runtime across turns despite a fresh auth resolver", async () => {
    // The sidecar injects a new `resolveAuth` closure on every launch. If that
    // counted as a configuration change, an OAuth session would rebuild its
    // runtime — and lose its warm state — once per turn.
    const oauthProvider: RuntimeProviderConfig = {
      ...provider,
      apiKey: "",
      authKind: "oauth",
      resolveAuth: async () => ({ apiKey: "token-turn-1" }),
    };
    const runtime = createRuntime({ provider: oauthProvider });

    expect(
      runtimeMatches(runtime, {
        provider: {
          ...oauthProvider,
          resolveAuth: async () => ({ apiKey: "token-turn-2" }),
        },
      }),
    ).toBe(true);
    // Everything else about the row still has to match.
    expect(
      runtimeMatches(runtime, {
        provider: { ...oauthProvider, modelId: "another-model" },
      }),
    ).toBe(false);
    expect(
      runtimeMatches(runtime, {
        provider: { ...oauthProvider, headers: { "User-Agent": "Custom/1" } },
      }),
    ).toBe(false);

    await runtime.dispose();
  });
});
