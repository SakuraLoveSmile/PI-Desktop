#!/usr/bin/env node
/** E2E-166: real sidecar + deterministic local model transport; no external credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const requests = [];
const resolutions = [];
const scenarios = new Map();
const events = [];
const pending = new Map();
let sequence = 0;
const server = createServer(async (req, res) => {
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    const user = payload.messages.findLast((m) => m.role === "user");
    const userText = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
    const scenario = [...scenarios.values()].find((s) => userText.includes(s.marker));
    const isParent = payload.tools?.some((t) => t.function?.name === "Task");
    const first = scenario && isParent && !scenario.called;
    if (first) scenario.called = true;
    const delta = first
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${++sequence}`, type: "function", function: { name: "Task", arguments: JSON.stringify(scenario.args) } }] }
      : { role: "assistant", content: "Fixture finished." };
    const base = { id: `chatcmpl-${++sequence}`, object: "chat.completion.chunk", created: 1, model: payload.model };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const model = (modelId) => ({
  id: "fixture", name: "Fixture", baseUrl, modelId, apiKey: "", authKind: "none",
  apiStyle: "openai-chat", supportsReasoning: false, supportedThinkingLevels: ["off"],
});
const bindings = { "fixture/private": model("private"), "fixture/allowed": model("allowed") };
const definition = (name, pin) => ({
  name, description: "Read-only fixture", tools: ["Read"], prompt: "Return Fixture finished without using tools.",
  source: "user", ...(pin ? { model: { providerId: "fixture", modelId: pin } } : {}),
});
const child = spawn(process.execPath, [fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, PI_DESKTOP_PLAN_UI_PROBE: "1" },
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "host.proxy") {
    const { method, params } = message.params;
    if (method === "provider.resolveSubagentModel") {
      resolutions.push(params.key);
      send(params.key === "fixture/dynamic"
        ? { id: message.id, result: model("dynamic") }
        : { id: message.id, error: { code: -32000, message: "model is not enabled for delegation" } });
    } else {
      send({ id: message.id, result: method === "session.get" ? { session: { messages: [] } } : {} });
    }
  } else if (message.id != null) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  } else if (message.method === "agent.event") events.push(message.params);
});
function rpc(method, params) {
  const id = `test-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${method}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
async function until(predicate) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `sidecar scenario timed out\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function run(id, args, expectedModel, keys = ["fixture/allowed"], sessionId = id) {
  const marker = `scenario-${id}`;
  const before = requests.length;
  scenarios.set(id, { marker, args: { ...args, task: `Complete fixture ${id}.` } });
  await rpc("agent.prompt", {
    sessionId, turnId: id, content: marker, mode: "agent", provider: model("parent"), thinkingLevel: "off",
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    subagents: [definition("reviewer", "private"), definition("explorer")],
    subagentProviders: bindings, subagentModelKeys: keys,
  });
  await until(() => events.some((e) => e.sessionId === sessionId && e.turnId === id && e.event.type === "agent_end" && !e.parentToolCallId));
  const captured = requests.slice(before);
  const parent = captured.find((p) => p.tools?.some((t) => t.function?.name === "Task"));
  assert.ok(parent, "parent provider request reached local transport");
  const system = parent.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  assert.ok(!system.includes("`fixture/private`"), "private pin must not enter override catalog");
  assert.match(parent.tools.find((t) => t.function?.name === "Task").function.description, /Default model: fixture\/private/);
  const delegates = captured.filter((p) => !p.tools?.some((t) => t.function?.name === "Task"));
  if (expectedModel) assert.deepEqual(delegates.map((p) => p.model), [expectedModel]);
  else {
    assert.equal(delegates.length, 0, "forbidden override must not issue a provider request");
    assert.ok(captured.some((p) => p.messages.some((m) => m.role === "tool" && JSON.stringify(m.content).includes("not available for delegation"))));
  }
  console.log(`PASS E2E-166 ${id}`);
  return rpc("agent.testRuntimeIdentity", { sessionId });
}
try {
  await run("private-cross-definition", { agent: "explorer", model: "fixture/private" });
  assert.deepEqual(resolutions, ["fixture/private"]);
  await run("definition-default", { agent: "reviewer" }, "private");
  await run("allowed-overrides-pin", { agent: "reviewer", model: "fixture/allowed" }, "allowed");
  await run("on-demand-opt-in", { agent: "explorer", model: "fixture/dynamic" }, "dynamic");
  await run("session-inheritance", { agent: "explorer", model: "fixture/parent" }, "parent", []);
  const first = await run("before-revocation", { agent: "explorer", model: "fixture/allowed" }, "allowed", ["fixture/allowed"], "reload");
  const second = await run("after-revocation", { agent: "explorer", model: "fixture/allowed" }, undefined, [], "reload");
  assert.notEqual(first.runtimeId, second.runtimeId, "changed opt-in must retire an idle runtime");
  console.log("PASS E2E-166 changed opt-in rebuilds the sidecar runtime");
} finally {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  lines.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  await new Promise((resolve) => server.close(resolve));
}
