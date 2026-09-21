import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTrustedExtensionCache, TrustedExtensionRunner } from "./runner.js";
import type {
  TrustedExtensionBridge,
  TrustedExtensionCommand,
  TrustedExtensionDiagnostic,
  TrustedExtensionSpec,
  TrustedExtensionUiRequest,
  TrustedExtensionUiResponse,
} from "./index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-ext-runner-"));
  clearTrustedExtensionCache();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

function spec(name: string, source: string): TrustedExtensionSpec {
  const entry = join(root, `${name}.ts`);
  writeFileSync(entry, source);
  return { id: entry, entry, label: name, source: "user", root };
}

type BridgeLog = {
  commands: TrustedExtensionCommand[][];
  diagnostics: TrustedExtensionDiagnostic[][];
  ui: TrustedExtensionUiRequest[];
  sessionName?: string;
  userMessages: unknown[];
};

function fakeBridge(
  answers: Partial<Record<TrustedExtensionUiRequest["kind"], TrustedExtensionUiResponse>> = {},
): { bridge: TrustedExtensionBridge; log: BridgeLog } {
  const log: BridgeLog = { commands: [], diagnostics: [], ui: [], userMessages: [] };
  const bridge: TrustedExtensionBridge = {
    sessionId: "s1",
    cwd: root,
    getModel: () => ({ id: "m" }),
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    getContextUsage: () => ({ tokens: 1, contextWindow: 10, percent: 10 }),
    compact: () => {},
    getSystemPrompt: () => "base",
    getActiveTools: () => ["read"],
    getAllTools: () => [{ name: "read", description: "r", active: true }],
    setActiveTools: () => {},
    getSessionName: () => log.sessionName,
    setSessionName: (name) => {
      log.sessionName = name;
    },
    sendUserMessage: (content) => {
      log.userMessages.push(content);
    },
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    requestUi: async (_ext, request) => {
      log.ui.push(request);
      return answers[request.kind] ?? ({ kind: request.kind } as TrustedExtensionUiResponse);
    },
    publishCommands: (commands) => {
      log.commands.push(commands);
    },
    publishDiagnostics: (diagnostics) => {
      log.diagnostics.push(diagnostics);
    },
  };
  return { bridge, log };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TrustedExtensionRunner", () => {
  it("bounds startup and shutdown waits and reports the stalled event", async () => {
    const ext = spec("stalled", `export default function (pi) {
      pi.on("session_start", (_event, ctx) => { pi.setSessionName("starting"); return new Promise(() => {}); });
      pi.on("session_shutdown", () => { pi.setSessionName("closing"); return new Promise(() => {}); });
    }`);
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    vi.useFakeTimers();
    const loading = runner.load();
    await vi.waitFor(() => expect(log.sessionName).toBe("starting"));
    await vi.advanceTimersByTimeAsync(30_000);
    await loading;
    const closing = runner.dispose();
    await vi.waitFor(() => expect(log.sessionName).toBe("closing"));
    await vi.advanceTimersByTimeAsync(30_000);
    await closing;
    expect(runner.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "handler_timeout", member: "session_start" }),
      expect.objectContaining({ kind: "handler_timeout", member: "session_shutdown" }),
    ]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retires pending dispatches before shutdown and ignores their late results", async () => {
    const ext = spec("late", `export default function (pi) {
      pi.on("tool_call", async (_event, ctx) => {
        pi.setSessionName("waiting");
        await ctx.ui.confirm("wait", "release");
        return { block: true, reason: "late" };
      });
      pi.on("tool_call", () => { pi.setSessionName("stale handler"); });
      pi.on("session_shutdown", () => { pi.setSessionName("closed"); });
    }`);
    const { bridge, log } = fakeBridge();
    let release!: (value: TrustedExtensionUiResponse) => void;
    bridge.requestUi = () => new Promise((resolve) => { release = resolve; });
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    const pending = runner.emit("tool_call", { type: "tool_call" });
    await runner.dispose();
    release({ kind: "confirm", value: true });
    expect(await pending).toBeUndefined();
    expect(log.sessionName).toBe("closed");
    expect(runner.getDiagnostics()).toEqual([]);
  });

  it("runs shutdown once when two owners dispose concurrently", async () => {
    const ext = spec("shutdown", `export default function (pi) {
      pi.on("session_shutdown", async (_event, ctx) => {
        await ctx.ui.confirm("closing", "release");
      });
    }`);
    const { bridge } = fakeBridge();
    const request = vi.fn(async () => ({ kind: "confirm" as const, value: true }));
    bridge.requestUi = request;
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    await Promise.all([runner.dispose(), runner.dispose()]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not publish a factory that is still loading when disposed", async () => {
    const ext = spec("factory", `export default async function (pi) {
      pi.registerCommand("late", { handler: () => {} });
      pi.setSessionName("factory entered");
      await new Promise(() => {});
    }`);
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    const loading = runner.load();
    await vi.waitFor(() => expect(log.sessionName).toBe("factory entered"));
    await runner.dispose();
    await loading;
    expect(log.commands.flat()).toEqual([]);
    expect(runner.getLoadReports()).toEqual([]);
  });

  it("times out one result handler, ignores its late failure, and preserves the next result", async () => {
    const ext = spec("timeout", `export default function (pi) {
      pi.on("tool_call", async (_event, ctx) => {
        await ctx.ui.confirm("wait", "release");
        throw new Error("late failure");
      });
      pi.on("tool_call", () => ({ block: true, reason: "second handler" }));
    }`);
    const { bridge } = fakeBridge();
    let release!: (value: TrustedExtensionUiResponse) => void;
    bridge.requestUi = () => new Promise((resolve) => { release = resolve; });
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    vi.useFakeTimers();
    const pending = runner.emit("tool_call", { type: "tool_call" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual({ block: true, reason: "second handler" });
    release({ kind: "confirm", value: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({ kind: "handler_timeout", member: "tool_call", count: 1 }),
    ]);
    await runner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports deferred events without preventing supported handlers from loading", async () => {
    const ext = spec("capabilities", `export default function (pi) {
      pi.on("input", () => {});
      pi.on("resources_discover", () => {});
      pi.on("before_agent_start", () => ({ systemPrompt: "supported" }));
    }`);
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    expect(runner.getDiagnostics().map((entry) => entry.member)).toEqual([
      "on:input", "on:resources_discover",
    ]);
    expect(await runner.emit("before_agent_start", {})).toEqual({ systemPrompt: "supported" });
    await runner.dispose();
  });

  it("skips a stalled factory and still loads a healthy extension", async () => {
    const stalled = spec("stalled-factory", `export default async function (pi) {
      pi.setSessionName("factory waiting");
      await new Promise(() => {});
    }`);
    const healthy = spec("healthy", `export default function (pi) {
      pi.on("before_agent_start", () => ({ systemPrompt: "healthy" }));
    }`);
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [stalled, healthy], bridge });
    vi.useFakeTimers();
    const loading = runner.load();
    await vi.waitFor(() => expect(log.sessionName).toBe("factory waiting"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await loading).map((report) => report.state)).toEqual(["error", "loaded"]);
    expect(await runner.emit("before_agent_start", {})).toEqual({ systemPrompt: "healthy" });
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({ kind: "factory_error", message: "handler exceeded 30000ms" }),
    ]);
    await runner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loads a TypeScript extension, registers its tool, and runs hooks", async () => {
    const ext = spec(
      "fx",
      `import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
type P = { a: number; b: number };
export default function (pi: any) {
  pi.registerTool(defineTool({
    name: "fx_add", description: "add", parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
    async execute(_id: string, p: P, _s: any, _u: any, ctx: any) {
      return { content: [{ type: "text", text: String(p.a + p.b) + ":" + ctx.cwd.length }], details: {} };
    },
  }));
  pi.on("before_agent_start", (e: any) => ({ systemPrompt: e.systemPrompt + " +marker" }));
  pi.on("tool_call", (e: any) => e.toolName === "bash" ? { block: true, reason: "no bash" } : undefined);
  pi.on("session_start", (e: any, ctx: any) => { (globalThis as any).__started = e.reason + ctx.hasUI; });
}
`,
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge, reservedToolNames: () => ["read"] });
    const reports = await runner.load();
    expect(reports).toEqual([
      { extensionId: ext.id, state: "loaded", toolNames: ["fx_add"], commandNames: [], agentNames: [], eventNames: ["before_agent_start", "tool_call", "session_start"] },
    ]);
    expect((globalThis as { __started?: string }).__started).toBe("startuptrue");

    const [tool] = runner.getAgentTools();
    expect(tool.name).toBe("fx_add");
    expect(tool.executionMode).toBe("sequential");
    const result = await tool.execute("c1", { a: 2, b: 3 });
    expect(result.content[0]).toEqual({ type: "text", text: `5:${root.length}` });

    const start = await runner.emit<{ systemPrompt?: string }>("before_agent_start", {
      type: "before_agent_start", prompt: "hi", systemPrompt: "base",
    });
    expect(start?.systemPrompt).toBe("base +marker");
    const blocked = await runner.emit<{ block?: boolean }>("tool_call", { type: "tool_call", toolName: "bash", toolCallId: "t", input: {} });
    expect(blocked).toEqual({ block: true, reason: "no bash" });
    const allowed = await runner.emit("tool_call", { type: "tool_call", toolName: "read", toolCallId: "t", input: {} });
    expect(allowed).toBeUndefined();
    expect(runner.getDiagnostics()).toEqual([]);
  });

  it("registers a plugin-owned agent and exposes its stream model", async () => {
    const ext = spec(
      "agent",
      `export default function (pi: any) {
  pi.registerAgent({
    id: "commandcode",
    name: "Command Code",
    models: [{ id: "cc-1", name: "Command Code 1" }],
    complete: async (model: any) => ({
      role: "assistant", content: [{ type: "text", text: model.id }],
      api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    }),
  });
}`,
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    const [agent] = runner.getAgents();
    expect(agent.name).toBe("Command Code");
    expect(agent.models[0].id).toBe("cc-1");
    const result = await agent.stream(agent.models[0], {} as any).result();
    expect(result.content).toEqual([{ type: "text", text: "cc-1" }]);
  });

  it("registerProvider is the same plugin-owned shape as registerAgent", async () => {
    // The upstream alias takes a `complete` implementation as readily as a
    // stream, in both of its call forms.
    const ext = spec(
      "provider",
      `export default function (pi: any) {
  const complete = async (model: any) => ({
    role: "assistant", content: [{ type: "text", text: model.id }],
    api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  });
  pi.registerProvider({ id: "object-form", name: "Object form", models: [{ id: "obj-1" }], complete });
  pi.registerProvider("pair-form", { name: "Pair form", models: [{ id: "pair-1" }], complete });
}`,
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    const reports = await runner.load();
    expect([...reports[0].agentNames].sort()).toEqual(["object-form", "pair-form"]);
    expect(runner.getDiagnostics()).toEqual([]);

    const pair = runner.getAgents().find((agent) => agent.id === "pair-form");
    expect(pair?.models[0].id).toBe("pair-1");
    const result = await pair!.stream(pair!.models[0], {} as any).result();
    expect(result.content).toEqual([{ type: "text", text: "pair-1" }]);
  });


  it("keeps loading when one module throws and reports the error", async () => {
    const bad = spec("bad", `throw new Error("boom at load");`);
    const noDefault = spec("nodefault", `export const x = 1;`);
    const factoryThrows = spec("factory", `export default function () { throw new Error("factory boom"); }`);
    const good = spec("good", `export default function (pi: any) { pi.registerCommand("greet", { handler: async () => {} }); }`);
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [bad, noDefault, factoryThrows, good], bridge });
    const reports = await runner.load();
    expect(reports.map((r) => r.state)).toEqual(["error", "error", "error", "loaded"]);
    const kinds = runner.getDiagnostics().map((d) => [d.extensionId === bad.id ? "bad" : d.extensionId === noDefault.id ? "nodefault" : "factory", d.kind, d.message]);
    expect(kinds).toEqual([
      ["bad", "load_error", "boom at load"],
      ["nodefault", "load_error", "module has no default export function"],
      ["factory", "factory_error", "factory boom"],
    ]);
    expect(runner.getDiagnostics().find((d) => d.kind === "load_error")?.stack).toContain("boom at load");
    expect(log.commands.at(-1)).toEqual([{ extensionId: good.id, extensionLabel: "good", name: "greet" }]);
  });

  it("makes unsupported members and pi-tui imports inert with diagnostics", async () => {
    const ext = spec(
      "tui",
      `import { Text, Box, matchesKey } from "@earendil-works/pi-tui";
export default function (pi: any) {
  const t = new Text("x"); t.setText("y");
  matchesKey({}, "ctrl+c");
  pi.registerShortcut("ctrl+x", { handler() {} });
  pi.sendMessage({ customType: "x", content: "hi" });
  pi.sendMessage({ customType: "y", content: "hi" });
  pi.on("session_start", (_e: any, ctx: any) => {
    const d = ctx.ui.setWidget("k", () => null); d();
    ctx.ui.setStatus("k", "busy");
    ctx.ui.notify("hello", "warning");
  });
  pi.on("user_bash", () => {});
  pi.on("made_up_event", () => {});
}
`,
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    const [report] = await runner.load();
    expect(report.state).toBe("loaded");
    await flush();
    const byMember = Object.fromEntries(runner.getDiagnostics().map((d) => [`${d.kind}:${d.member}`, d.count]));
    expect(byMember).toEqual({
      // `Box` is imported but never touched, so it is never reported.
      "stub_symbol:Text": 1,
      "stub_symbol:matchesKey": 1,
      "unsupported_api:registerShortcut": 1,
      "unsupported_api:sendMessage": 2,
      "unsupported_api:ui.setWidget": 1,
      "unsupported_api:on:made_up_event": 1,
      "unsupported_api:on:user_bash": 1,
    });
    expect(log.ui).toEqual([
      { kind: "setStatus", key: "k", text: "busy" },
      { kind: "notify", message: "hello", level: "warning" },
    ]);
    expect(log.diagnostics.length).toBeGreaterThan(0);

    // A second session reuses the cached module: the import-time stub
    // symbols are replayed so its diagnostics say the same thing.
    const second = new TrustedExtensionRunner({ specs: [ext], bridge: fakeBridge().bridge });
    await second.load();
    await flush();
    expect(second.getDiagnostics().map((d) => `${d.kind}:${d.member}`)).toContain("stub_symbol:Text");
  });

  it("rejects colliding tool and command names, first registration wins", async () => {
    const a = spec("a", `export default function (pi: any) {
  pi.registerTool({ name: "read", description: "", parameters: {}, execute: async () => ({ content: [], details: {} }) });
  pi.registerTool({ name: "fx", description: "", parameters: {}, execute: async () => ({ content: [{ type: "text", text: "a" }], details: {} }) });
  pi.registerCommand("go", { handler: async () => {} });
}`);
    const b = spec("b", `export default function (pi: any) {
  pi.registerTool({ name: "fx", description: "", parameters: {}, execute: async () => ({ content: [{ type: "text", text: "b" }], details: {} }) });
  pi.registerCommand("go", { handler: async () => {} });
}`);
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [a, b], bridge, reservedToolNames: () => ["read"] });
    await runner.load();
    expect(runner.getAgentTools().map((t) => t.name)).toEqual(["fx"]);
    expect(runner.getCommands().map((c) => c.extensionId)).toEqual([a.id]);
    expect(runner.getDiagnostics().map((d) => [d.kind, d.member])).toEqual([
      ["rejected_registration", "read"],
      ["rejected_registration", "fx"],
      ["rejected_registration", "go"],
    ]);
  });

  it("runs commands with prompts round-tripping through the bridge", async () => {
    const ext = spec("cmd", `export default function (pi: any) {
  pi.registerCommand("greet", { description: "say hi", async handler(args: string, ctx: any) {
    const name = await ctx.ui.input("Name?");
    const color = await ctx.ui.select("Color", ["red", "blue"]);
    const ok = await ctx.ui.confirm("Sure?", "really");
    pi.setSessionName(name + "/" + color + "/" + ok + "/" + args);
    ctx.sendUserMessage("follow up");
    const r = await pi.exec("node", ["-e", "process.stdout.write('out')"]);
    (globalThis as any).__exec = r;
  } });
}`);
    const { bridge, log } = fakeBridge({
      input: { kind: "input", value: "Ann" },
      select: { kind: "select", value: "blue" },
      confirm: { kind: "confirm", value: true },
    });
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    expect(await runner.runCommand("greet", "now")).toBe(true);
    expect(await runner.runCommand("missing", "")).toBe(false);
    expect(log.sessionName).toBe("Ann/blue/true/now");
    expect(log.userMessages).toEqual(["follow up"]);
    expect((globalThis as { __exec?: { stdout: string; code: number } }).__exec).toMatchObject({ stdout: "out", code: 0 });
  });

  it("folds context results, and records a stalled handler as a timeout", async () => {
    const ext = spec("ctx", `export default function (pi: any) {
  pi.on("context", (e: any) => ({ messages: [...e.messages, { role: "user", content: "extra" }] }));
  pi.on("context", (e: any) => ({ messages: e.messages.slice(0, 1) }));
  pi.on("tool_result", () => { throw new Error("nope"); });
}`);
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    const messages = [{ role: "user", content: "one" }, { role: "assistant", content: "two" }];
    const folded = await runner.emit<{ messages: unknown[] }>(
      "context",
      { type: "context", messages },
      (acc, next) => next,
    );
    // The second handler saw the original payload, not the first handler's output.
    expect(folded?.messages).toEqual([messages[0]]);
    await runner.emit("tool_result", { type: "tool_result", toolName: "x", toolCallId: "1", input: {}, content: [], details: {}, isError: false });
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({ kind: "handler_error", member: "tool_result", message: "nope" }),
    ]);
    await runner.dispose();
    expect(await runner.emit("turn_start", { type: "turn_start" })).toBeUndefined();
  });
});
