import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { NativePiSessionService } from "./native-pi-session.js";
import {
  acquireNativePiSessionLease,
  guardNativePiSessionManager,
} from "./native-pi-session-lease.js";

const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in native fixtures"));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(options: { newline?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-desktop-native-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const sessionRoot = join(agentDir, "sessions");
  const project = join(root, "project");
  const group = join(sessionRoot, "--project--");
  mkdirSync(group, { recursive: true });
  mkdirSync(project);
  const file = join(group, "fixture.jsonl");
  const entries = [
    { type: "session", version: 3, id: "native-id", timestamp: "2026-09-14T00:00:00.000Z", cwd: project },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-09-14T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 } },
    { type: "model_change", id: "m1", parentId: "u1", timestamp: "2026-09-14T00:00:02.000Z", provider: "test-provider", modelId: "test-model" },
    { type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-09-14T00:00:03.000Z", thinkingLevel: "high" },
    { type: "custom", id: "c1", parentId: "t1", timestamp: "2026-09-14T00:00:04.000Z", customType: "fixture", data: { preserved: true } },
    { type: "custom_message", id: "cm1", parentId: "c1", timestamp: "2026-09-14T00:00:05.000Z", customType: "fixture", content: "context", display: false },
    { type: "message", id: "a1", parentId: "cm1", timestamp: "2026-09-14T00:00:06.000Z", message: { role: "assistant", content: [{ type: "text", text: "answer" }], provider: "test-provider", model: "test-model", stopReason: "stop", timestamp: 2, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
    { type: "compaction", id: "cp1", parentId: "a1", timestamp: "2026-09-14T00:00:07.000Z", summary: "summary", firstKeptEntryId: "a1", tokensBefore: 10, retainedTail: [{ role: "user", content: "preserve unknown fields" }] },
    { type: "message", id: "branch", parentId: "u1", timestamp: "2026-09-14T00:00:08.000Z", message: { role: "assistant", content: [{ type: "text", text: "active branch" }], provider: "test-provider", model: "test-model", stopReason: "stop", timestamp: 3, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
    { type: "future_entry", id: "future", parentId: "branch", timestamp: "2026-09-14T00:00:09.000Z", opaque: { untouched: true } },
  ];
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n") + (options.newline === false ? "" : "\n");
  writeFileSync(file, text);
  return { root, agentDir, sessionRoot, project, file, text };
}

describe("NativePiSessionService", () => {
  it("lists and projects a native v3 tree without changing its bytes", async () => {
    const f = fixture();
    const service = new NativePiSessionService({ agentDir: f.agentDir, sessionRoot: f.sessionRoot });
    const before = readFileSync(f.file);
    const sessions = await service.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: "pi-native", projectPath: f.project, providerId: "test-provider", modelId: "test-model" });
    const detail = service.detail(sessions[0].id);
    expect(detail?.messages.map((message) => message.content)).toEqual(["hello", "active branch"]);
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("keeps a newline-less session browseable but read-only and byte-pure", async () => {
    const f = fixture({ newline: false });
    const service = new NativePiSessionService({ agentDir: f.agentDir, sessionRoot: f.sessionRoot });
    const sessions = await service.list();
    expect(sessions[0].readOnlyReason).toBe("missing-trailing-newline");
    expect(sessions[0].capabilities?.canPrompt).toBe(false);
    expect(readFileSync(f.file, "utf8")).toBe(f.text);
  });

  it("appends through SessionManager and refuses a stale concurrent writer", () => {
    const f = fixture();
    const lease = acquireNativePiSessionLease(f.file);
    const manager = SessionManager.open(f.file);
    guardNativePiSessionManager(manager, lease);
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "desktop turn" }], timestamp: Date.now() });
    const afterOwnAppend = readFileSync(f.file, "utf8");
    expect(afterOwnAppend).toContain("desktop turn");
    writeFileSync(f.file, `${afterOwnAppend}${JSON.stringify({ type: "custom", id: "foreign", parentId: manager.getLeafId(), timestamp: new Date().toISOString(), customType: "foreign" })}\n`);
    expect(() => manager.appendMessage({ role: "user", content: [{ type: "text", text: "must not write" }], timestamp: Date.now() })).toThrow(/changed/i);
    expect(readFileSync(f.file, "utf8")).not.toContain("must not write");
    lease.release();
  });

  it("continues through AgentSession and appends the faux-model turn to the original file", async () => {
    const f = fixture();
    const model = {
      id: "test-model",
      name: "Test Model",
      api: "openai-completions",
      provider: "test-provider",
      baseUrl: "http://127.0.0.1/unused",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    };
    const response: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "fixture response" }],
      api: "openai-completions",
      provider: "test-provider",
      model: "test-model",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const fauxRuntime = {
      getModel: () => model,
      hasConfiguredAuth: () => true,
      streamSimple: () => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: response });
          stream.push({ type: "done", reason: "stop", message: response });
          stream.end(response);
        });
        return stream;
      },
    };
    const service = new NativePiSessionService({
      agentDir: f.agentDir,
      sessionRoot: f.sessionRoot,
      modelRuntimeFactory: async () => fauxRuntime as any,
    });
    const [summary] = await service.list();
    const before = readFileSync(f.file, "utf8");
    await service.prompt(summary.id, "desktop prompt", () => undefined);
    await expect.poll(() => readFileSync(f.file, "utf8")).toContain("fixture response");
    const after = readFileSync(f.file, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.match(/desktop prompt/g)).toHaveLength(1);
    expect(after.match(/fixture response/g)).toHaveLength(1);
    const reopened = SessionManager.open(f.file);
    expect(reopened.getLeafId()).not.toBe("future");
    service.disposeAll();
  });

  it("reclaims a stale dead-owner lease only when the file stayed append-only", () => {
    const f = fixture();
    const first = acquireNativePiSessionLease(f.file);
    const lockPath = `${f.file}.pi-desktop.lock`;
    const record = JSON.parse(readFileSync(lockPath, "utf8"));
    first.release();
    writeFileSync(lockPath, `${JSON.stringify({ ...record, pid: 2_147_483_647 })}\n`);
    const reclaimed = acquireNativePiSessionLease(f.file);
    reclaimed.release();
  });

  it("blocks a second desktop writer and releases ownership", () => {
    const f = fixture();
    const first = acquireNativePiSessionLease(f.file);
    expect(() => acquireNativePiSessionLease(f.file)).toThrow(/already open/i);
    first.release();
    const next = acquireNativePiSessionLease(f.file);
    next.release();
  });
});

async function configuredFixture() {
  const f = fixture();
  writeFileSync(join(f.agentDir, "models.json"), JSON.stringify({ providers: {
    "test-provider": { baseUrl: "http://127.0.0.1/unused", api: "openai-completions", models: [{
      id: "test-model", name: "Fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16000, maxTokens: 1000,
    }] },
  } }));
  writeFileSync(join(f.agentDir, "auth.json"), JSON.stringify({ "test-provider": { type: "api_key", key: "synthetic-test-key" } }));
  writeFileSync(join(f.agentDir, "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 50 }, compaction: { enabled: false } }));
  return { ...f, modelRuntimeFactory: () => ModelRuntime.create({
    authPath: join(f.agentDir, "auth.json"), modelsPath: join(f.agentDir, "models.json"), allowModelNetwork: false,
  }) };
}

function response(stopReason: "stop" | "error" = "stop"): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text: "fixture reply" }], api: "openai-completions",
    provider: "test-provider", model: "test-model", stopReason, timestamp: Date.now(),
    ...(stopReason === "error" ? { errorMessage: "503 overloaded" } : {}),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

function fauxStream(message = response()) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
    else stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

describe("native continuation review regressions", () => {
  it("uses the real offline credential/catalog and reports missing exact auth/model", async () => {
    const f = await configuredFixture();
    const service = new NativePiSessionService({ agentDir: f.agentDir, sessionRoot: f.sessionRoot });
    const [summary] = await service.list();
    expect(summary.capabilities?.canPrompt).toBe(true);
    expect(service.detail(summary.id)?.capabilities?.canPrompt).toBe(true);
    writeFileSync(join(f.agentDir, "auth.json"), "{}");
    expect((await service.list())[0].readOnlyReason).toBe("provider-unavailable");
    expect(service.detail(summary.id)?.readOnlyReason).toBe("provider-unavailable");
    await expect(service.prompt(summary.id, "no fallback", () => {})).rejects.toMatchObject({ errorCode: "NATIVE_PI_PROVIDER_UNAVAILABLE" });
  });

  it("settles retries once, rejects overlap without disposal, acknowledges distinct durable users, and keeps own idle lease usable", async () => {
    const f = await configuredFixture();
    const events: import("@pi-desktop/shared").AgentEventEnvelope[] = [];
    let calls = 0;
    const requestTools: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation((_model, context) => {
      requestTools.push(context.tools ?? []);
      calls++;
      if (calls === 1) return fauxStream(response("error"));
      const stream = createAssistantMessageEventStream();
      void gate.then(() => { const m = response(); stream.push({ type: "done", reason: "stop", message: m }); stream.end(m); });
      return stream;
    });
    const service = new NativePiSessionService(f);
    try {
      const [summary] = await service.list();
      await service.prompt(summary.id, "same prompt", (e) => events.push(e), "optimistic-1");
      await expect.poll(() => calls).toBe(2);
      expect(events.filter((e) => e.event.type === "agent_end")).toHaveLength(0);
      expect(service.status(summary.id).status.isRunning).toBe(true);
      expect(service.detail(summary.id)?.capabilities).toMatchObject({ canPrompt: false, canStop: true });
      await expect(service.prompt(summary.id, "overlap", () => {})).rejects.toMatchObject({ errorCode: "AGENT_BUSY" });
      expect(service.status(summary.id).status.isRunning).toBe(true);
      release();
      await expect.poll(() => events.filter((e) => e.event.type === "agent_end").length).toBe(1);
      expect((await service.list())[0].capabilities?.canPrompt).toBe(true);
      expect(service.detail(summary.id)?.capabilities?.canPrompt).toBe(true);
      await service.prompt(summary.id, "same prompt", (e) => events.push(e), "optimistic-2");
      await expect.poll(() => events.filter((e) => e.event.type === "agent_end").length).toBe(2);
      const acknowledgements = events.filter((e) => e.event.type === "user_message_persisted").map((e) => e.event);
      expect(acknowledgements).toHaveLength(2);
      expect(acknowledgements).toMatchObject([{ optimisticMessageId: "optimistic-1" }, { optimisticMessageId: "optimistic-2" }]);
      const users = service.detail(summary.id)!.messages.filter((m) => m.content === "same prompt");
      expect(users).toHaveLength(2);
      expect(new Set(users.map((m) => m.id)).size).toBe(2);
      expect(readFileSync(f.file, "utf8")).not.toContain("optimistic-");
      expect(requestTools).toEqual([[], [], []]);
      const foreign = new NativePiSessionService(f);
      expect((await foreign.list())[0].readOnlyReason).toBe("busy");
    } finally { release(); service.disposeAll(); }
    expect(existsSync(`${f.file}.pi-desktop.lock`)).toBe(false);
  });

  it("makes reclaimable dead-owner leases reachable via list/detail without stealing live leases", async () => {
    const f = await configuredFixture();
    const lease = acquireNativePiSessionLease(f.file);
    const record = JSON.parse(readFileSync(`${f.file}.pi-desktop.lock`, "utf8"));
    lease.release();
    writeFileSync(`${f.file}.pi-desktop.lock`, JSON.stringify({ ...record, pid: 2147483647 }));
    const service = new NativePiSessionService(f);
    const [summary] = await service.list();
    expect(summary.capabilities?.canPrompt).toBe(true);
    expect(service.detail(summary.id)?.capabilities?.canPrompt).toBe(true);
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(() => fauxStream());
    await service.prompt(summary.id, "reclaimed", () => {});
    await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
    service.disposeAll();
  });

  it("binds native startup/resources once before prompting with guarded original-file appends", async () => {
    const f = await configuredFixture();
    mkdirSync(join(f.agentDir, "extensions"));
    const skill = join(f.root, "fixture-skill.md");
    writeFileSync(skill, "---\nname: fixture-skill\ndescription: Discovered fixture skill\n---\nFixture instructions\n");
    writeFileSync(join(f.agentDir, "extensions", "fixture.js"), `export default function(pi) {
      let restored = false;
      pi.on("session_start", (_event, ctx) => {
        restored = ctx.sessionManager.getEntries().some(e => e.customType === "fixture" && e.data?.preserved);
        pi.appendEntry("startup", { restored, mode: ctx.mode, hasUI: ctx.hasUI });
        pi.setActiveTools(["read", "bash", "write", "edit"]);
      });
      pi.on("resources_discover", () => ({ skillPaths: [${JSON.stringify(skill)}] }));
      pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + " RESTORED=" + restored }));
    }`);
    const requests: { systemPrompt?: string; tools: unknown[]; messages: unknown }[] = [];
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation((_model, context) => {
      requests.push({ systemPrompt: context.systemPrompt, tools: context.tools ?? [], messages: context.messages });
      return fauxStream();
    });
    const service = new NativePiSessionService(f);
    try {
      const [summary] = await service.list();
      await service.prompt(summary.id, "/skill:fixture-skill test startup", () => {});
      await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
      expect(requests).toHaveLength(1);
      expect(requests[0].systemPrompt).toContain("RESTORED=true");
      expect(JSON.stringify(requests[0].messages)).toContain("Fixture instructions");
      expect(requests[0].tools).toEqual([]);
      const text = readFileSync(f.file, "utf8");
      expect(text.startsWith(f.text)).toBe(true);
      expect(text.match(/"customType":"startup"/g)).toHaveLength(1);
      expect(text).toContain('"hasUI":false');
      expect(text).toContain('"restored":true');
    } finally { service.disposeAll(); }
  });

  it("disposes session and releases ownership on bind failure so opening can be retried", async () => {
    const f = await configuredFixture();
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(() => fauxStream());
    const bind = vi.spyOn(AgentSession.prototype, "bindExtensions").mockRejectedValueOnce(new Error("binding failed"));
    const dispose = vi.spyOn(AgentSession.prototype, "dispose");
    const service = new NativePiSessionService(f);
    const [summary] = await service.list();
    await expect(service.prompt(summary.id, "test", () => {})).rejects.toThrow("binding failed");
    expect(bind).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(existsSync(`${f.file}.pi-desktop.lock`)).toBe(false);
    expect(service.status(summary.id).status.isRunning).toBe(false);
  });

  it("aborts after persistence without removing or replacing the native user row", async () => {
    const f = await configuredFixture();
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation((_model, _ctx, options) => {
      const stream = createAssistantMessageEventStream();
      options?.signal?.addEventListener("abort", () => {
        const m = { ...response(), stopReason: "aborted" as const, content: [] };
        stream.push({ type: "error", reason: "aborted", error: m }); stream.end(m);
      });
      return stream;
    });
    const service = new NativePiSessionService(f);
    try {
      const [summary] = await service.list();
      await service.prompt(summary.id, "preserve on stop", () => {}, "optimistic-abort");
      await expect.poll(() => service.detail(summary.id)!.messages.filter((m) => m.content === "preserve on stop").length).toBe(1);
      await service.abort(summary.id);
      expect(service.detail(summary.id)!.messages.filter((m) => m.content === "preserve on stop")).toHaveLength(1);
      expect(service.status(summary.id).status.isRunning).toBe(false);
    } finally { service.disposeAll(); }
  });
});


describe("independent native ownership, identity and tool regressions", () => {
  it("keeps an owned settled lease promptable across refreshes", async () => {
    const f = await configuredFixture();
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(() => fauxStream());
    const service = new NativePiSessionService(f);
    try {
      const [summary] = await service.list();
      await service.prompt(summary.id, "first", () => {});
      await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
      expect((await service.list())[0].capabilities?.canPrompt).toBe(true);
      expect(service.detail(summary.id)?.capabilities?.canPrompt).toBe(true);
      await service.prompt(summary.id, "second", () => {});
      await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
      expect(service.detail(summary.id)!.messages.filter((m) => m.content === "second")).toHaveLength(1);
    } finally { service.disposeAll(); }
  });

  it("acknowledges persisted native user IDs before terminal completion without storing caller IDs", async () => {
    const f = await configuredFixture();
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(() => fauxStream());
    const service = new NativePiSessionService(f);
    const events: import("@pi-desktop/shared").AgentEventEnvelope[] = [];
    try {
      const [summary] = await service.list();
      for (const optimisticId of ["caller-1", "caller-2"]) {
        await service.prompt(summary.id, "identical", (event) => events.push(event), optimisticId);
        await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
      }
      const acks = events.filter((e) => e.event.type === "user_message_persisted");
      expect(acks).toHaveLength(2);
      for (const ack of acks) {
        if (ack.event.type !== "user_message_persisted") throw new Error("wrong event");
        const durableId = ack.event.message.id;
        expect(service.detail(summary.id)!.messages.some((m) => m.id === durableId)).toBe(true);
        expect(events.findIndex((e) => e.turnId === ack.turnId && e.event.type === "agent_end")).toBeGreaterThan(events.indexOf(ack));
      }
      expect(readFileSync(f.file, "utf8")).not.toContain("caller-");
    } finally { service.disposeAll(); }
  });

  it("sends zero native tools to the model", async () => {
    const f = await configuredFixture();
    const requests: unknown[] = [];
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation((_model, context) => { requests.push(context.tools ?? []); return fauxStream(); });
    const service = new NativePiSessionService(f);
    try {
      const [summary] = await service.list();
      await service.prompt(summary.id, "no tools", () => {});
      await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
      expect(requests).toEqual([[]]);
    } finally { service.disposeAll(); }
  });

  it("cleans up a real failing startup hook and permits a repaired extension to bind", async () => {
    const f = await configuredFixture();
    mkdirSync(join(f.agentDir, "extensions"));
    const extension = join(f.agentDir, "extensions", "bad.js");
    writeFileSync(extension, 'export default function(pi) { pi.on("session_start", () => { throw new Error("fixture startup failure"); }); }');
    const service = new NativePiSessionService(f);
    const [summary] = await service.list();
    await expect(service.prompt(summary.id, "bad startup", () => {})).rejects.toThrow("fixture startup failure");
    expect(existsSync(`${f.file}.pi-desktop.lock`)).toBe(false);
    rmSync(extension);
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(() => fauxStream());
    try {
      await service.prompt(summary.id, "repaired", () => {});
      await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
    } finally { service.disposeAll(); }
  });
});


describe("native settlement and reclaim boundaries", () => {
  it("publishes terminal completion only after delayed settled hooks append", async () => {
    const f = await configuredFixture();
    mkdirSync(join(f.agentDir, "extensions"));
    writeFileSync(join(f.agentDir, "extensions", "settled.js"), `export default function(pi) {
      pi.on("agent_settled", async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        pi.appendEntry("settled-persisted", { done: true });
      });
    }`);
    vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(() => fauxStream());
    const service = new NativePiSessionService(f);
    const terminalBytes: string[] = [];
    try {
      const [summary] = await service.list();
      await service.prompt(summary.id, "settle fully", (envelope) => {
        if (envelope.event.type === "agent_end") terminalBytes.push(readFileSync(f.file, "utf8"));
      });
      await expect.poll(() => service.status(summary.id).status.isRunning).toBe(false);
      expect(terminalBytes).toHaveLength(1);
      expect(terminalBytes[0]).toContain('"customType":"settled-persisted"');
      expect(service.detail(summary.id)?.capabilities?.canPrompt).toBe(true);
    } finally { service.disposeAll(); }
  });

  it("permits only complete same-file append extensions for dead-local capability recovery", async () => {
    const f = await configuredFixture();
    const lease = acquireNativePiSessionLease(f.file);
    const lockPath = `${f.file}.pi-desktop.lock`;
    const record = JSON.parse(readFileSync(lockPath, "utf8"));
    lease.release();
    const service = new NativePiSessionService(f);
    for (const lock of [record, { ...record, hostname: "remote-fixture", pid: 2147483647 }, { pid: 2147483647 }, "malformed"]) {
      writeFileSync(lockPath, typeof lock === "string" ? lock : JSON.stringify(lock));
      expect((await service.list())[0].readOnlyReason).toBe("busy");
    }
    writeFileSync(lockPath, JSON.stringify({ ...record, pid: 2147483647 }));
    writeFileSync(f.file, f.text + JSON.stringify({ type: "custom", id: "append", parentId: "future", customType: "recovered", timestamp: new Date().toISOString() }) + "\n");
    expect((await service.list())[0].capabilities?.canPrompt).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(2147483647);
    const reclaimed = acquireNativePiSessionLease(f.file);
    reclaimed.release();
    writeFileSync(lockPath, JSON.stringify({ ...record, pid: 2147483647 }));
    writeFileSync(f.file, f.text.replace('"hello"', '"changed"'));
    expect((await service.list())[0].readOnlyReason).toBe("busy");
  });
});
