import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { NativePiSessionService } from "./native-pi-session.js";
import {
  acquireNativePiSessionLease,
  guardNativePiSessionManager,
} from "./native-pi-session-lease.js";

const roots: string[] = [];

afterEach(() => {
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
