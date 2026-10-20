#!/usr/bin/env node
/** Real Node sidecar + parent proxy + Rust/SQLite; only the model is local/deterministic. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv.includes("--worktree-memory")) {
  const { runWorktreeMemoryContext } = await import("./e2e/worktree-memory-context.mjs");
  await runWorktreeMemoryContext(root);
} else {
const scratch = await mkdtemp(join(tmpdir(), "pi-project-context-"));
const workspace = join(scratch, "workspace");
const second = join(scratch, "other-project");
const home = join(scratch, "sidecar-home");
await Promise.all([workspace, second, home].map(path => mkdir(path)));
await writeFile(join(workspace, "source.ts"), "const codeMarker = 1;\n");
const host = new Host(resolveHostBinary(), join(scratch, "data"));
const calls = [];
let sourceSession;
let sidecar;
let serverError;
const server = createServer(async (req, res) => {
  try {
    let body = "";
    for await (const part of req) body += part;
    const request = JSON.parse(body);
    const messages = request.messages;
    const lastUser = messages.findLastIndex(m => m.role === "user");
    const text = typeof messages[lastUser]?.content === "string" ? messages[lastUser].content
      : (messages[lastUser]?.content ?? []).map(p => p.text ?? "").join("\n");
    const after = messages.slice(lastUser + 1);
    const toolResults = after.filter(m => m.role === "tool");
    const tools = (request.tools ?? []).map(t => t.function?.name ?? t.name);
    calls.push({ text, tools, messages });
    let tool;
    if (text.includes("FIXTURE_REMEMBER") && !toolResults.length) {
      assert(tools.includes("ProjectMemory"));
      tool = { name: "ProjectMemory", args: { action: "upsert", title: "Stack", content: "Use pnpm and preserve verification evidence." } };
    } else if (text.includes("FIXTURE_HISTORY")) {
      if (!toolResults.length) tool = { name: "ProjectHistory", args: { action: "search", query: "pnpm" } };
      else if (toolResults.length === 1) {
        const hit = JSON.parse(toolResults[0].content).hits.find(h => h.sessionId === sourceSession);
        assert(hit?.matches.length, "historical source not returned");
        tool = { name: "ProjectHistory", args: { action: "read", targetSessionId: hit.sessionId, messageId: hit.matches[0].messageId } };
      } else assert.match(toolResults.at(-1).content, /previous verification/);
    } else if (text.includes("FIXTURE_CODE") && !toolResults.length) {
      tool = { name: "CodeSearch", args: { query: "codemarker" } };
    } else if (text.includes("FIXTURE_CODE") && toolResults.length) {
      assert.match(toolResults.at(-1).content, /source.ts/);
    } else if (text.includes("FIXTURE_OFF")) {
      assert(!tools.includes("ProjectMemory"), "disabled recording leaked a write tool");
      const serialized = JSON.stringify(messages);
      assert.match(serialized, /Use pnpm and preserve verification evidence/);
    } else if (text.includes("FIXTURE_OTHER")) {
      assert(!tools.includes("ProjectMemory"));
      assert(!JSON.stringify(messages).includes("Use pnpm and preserve verification evidence"));
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const base = { id: randomUUID(), object: "chat.completion.chunk", created: 1, model: request.model };
    const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base,
      choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (tool) {
      emit({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
        function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] });
      emit({}, "tool_calls");
    } else { emit({ role: "assistant", content: "Fixture verified." }); emit({}, "stop"); }
    res.end("data: [DONE]\n\n");
  } catch (error) {
    serverError = error;
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(error) } }));
  }
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await host.start();
  await host.call("workspace.set", { path: workspace });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const { provider } = await host.call("providers.create", { name: "Local context fixture", vendorKey: "custom",
    type: "openai_compatible", protocol: "openai_compatible", baseUrl, authKind: "none", apiStyle: "chat_completions",
    defaultModelId: "context-fixture", models: [{ id: "context-fixture" }] });
  const create = async path => (await host.call("session.create", { projectPath: path, title: "Context fixture",
    mode: "agent", providerId: provider.id, modelId: "context-fixture", permissionMode: "auto" })).session;
  const session = await create(workspace);
  const old = await create(workspace); sourceSession = old.id;
  const other = await create(second);
  await host.call("session.appendMessage", { sessionId: old.id, message: { id: "historic-source", role: "user",
    content: "Use pnpm; previous verification passed the isolated checks.", createdAt: "2026-10-08T00:00:00Z" } });
  const editor = (await host.call("project.memory.editor.get", { path: workspace })).editor;
  assert.equal(editor.autoRecordEnabled, false);
  await host.call("project.autoMemory.setEnabled", { path: workspace, expectedOwner: editor.owner, enabled: true });
  const launch = () => {
    sidecar = new AgentSidecar({ launch: { command: process.execPath,
      args: [join(root, "packages/agent-runtime/dist/sidecar.js")], cwd: scratch,
      env: { ...process.env, HOME: home, PI_DESKTOP_DATA_DIR: join(scratch, "data") } },
      onStderr: text => { if (process.env.DEBUG_CONTEXT) process.stderr.write(text); } });
    sidecar.setHost({ call: (method, params) => host.call(method, params), onNotification: () => () => {}, onExit: () => () => {} });
  };
  launch();
  const prompt = async (active, content) => {
    sidecar.setProjectInstructionRoot(active.id, active.projectPath);
    const turnId = randomUUID();
    let unsubscribe;
    let timer;
    const done = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("context fixture turn did not finish")), 20000);
      unsubscribe = sidecar.onNotification((method, payload) => {
        if (method !== "agent.event" || payload.sessionId !== active.id || payload.turnId !== turnId) return;
        if (payload.event.type === "error") reject(new Error(JSON.stringify(payload.event.error)));
        if (payload.event.type === "agent_end") resolve();
      });
    });
    try {
      await sidecar.call("agent.prompt", { sessionId: active.id, turnId, content, mode: "agent", projectPath: active.projectPath,
        thinkingLevel: "off", subagents: [], pluginTools: [], pluginSkills: [], trustedExtensions: [],
        provider: { id: provider.id, name: "Fixture", modelId: "context-fixture", baseUrl, apiKey: "", authKind: "none",
          apiStyle: "chat_completions", supportsReasoning: false, supportedThinkingLevels: ["off"],
          modelConfig: { source: "generic", name: "Fixture", baseUrl, reasoning: false, input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
        commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true } });
      await done;
      if (serverError) throw serverError;
    } finally { clearTimeout(timer); unsubscribe?.(); }
  };
  await prompt(session, "FIXTURE_REMEMBER: remember the project package manager.");
  const recorded = (await host.call("project.memory.editor.get", { path: workspace })).editor;
  assert.match(recorded.memory.content, /Use pnpm/);
  await assert.rejects(host.call("project.memory.editor.save", { path: workspace,
    expectedOwner: editor.owner, expectedMemory: editor.memory, entries: [] }), e => e.errorCode === "CONFLICT");
  await prompt(session, "FIXTURE_HISTORY: recall earlier verification with its source.");
  await prompt(session, "FIXTURE_CODE: locate the code marker.");
  await host.call("project.autoMemory.setEnabled", { path: workspace, expectedOwner: recorded.owner, enabled: false });
  await prompt(session, "FIXTURE_OFF: use saved preferences with recording disabled.");
  await prompt(other, "FIXTURE_OTHER: check this separate project's context.");
  await sidecar.dispose(); sidecar = undefined;
  await host.stop(); await host.start(); launch();
  await prompt(session, "FIXTURE_OFF: recall the saved preference after restarting both processes.");
  assert.equal(calls.length, 10, "no background model calls beyond the requested turns/tool continuations");
  console.log("PROJECT_CONTEXT " + JSON.stringify({ ok: true, model: "local deterministic HTTP",
    state: "isolated real sidecar/parent proxy/Rust/SQLite", checks: ["opt-in-agent-write", "real-snapshot-conflict",
      "historical-search-read-source", "code-search-tool", "recording-off-read-context", "other-project-isolation",
      "both-process-restart-recall", "no-extra-background-model-call"] }));
} finally {
  await sidecar?.dispose(); await host.stop();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
}
