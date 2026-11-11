import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import test from "node:test";

register(new URL("helpers/ts-import-hooks.mjs", import.meta.url));
const { McpControlServer, createMcpControlController } = await import("../electron/main/mcp-control.ts");
const { registerGoalReportIpc } = await import("../electron/main/ipc/goal-report-ipc.ts");
const { IPC } = await import("@pi-desktop/shared");

const identity = { sessionId: "session", executionId: "goal", expectedVersion: 3 };
const hold = {
  ...identity, state: "blocked", version: 3,
  reasons: [{ code: "verdict_partial" }],
  progress: { items: [{ id: "device", label: "Device evidence", status: "failed" }] },
  draft: { verdict: "partial", limitations: ["No device evidence"], nextSteps: ["Supply a device"] },
};

async function fixture(t, hostCall = async () => ({ execution: { id: "goal", sessionId: "session" }, hold })) {
  const calls = [], resumes = [], handlers = new Map();
  registerGoalReportIpc({
    handle: (channel, handler) => handlers.set(channel, handler),
    getHost: () => ({ call: async (method, params) => {
      calls.push({ method, params });
      return hostCall(method, params);
    } }),
    resumeBlockedGoal: async (params) => {
      resumes.push(params);
      return { execution: { id: "goal" }, hold: { ...hold, state: "resumed" }, turnId: "next-turn" };
    },
  });
  const dataDir = mkdtempSync(join(tmpdir(), "pi-mcp-goal-"));
  const server = new McpControlServer({
    dataDir, port: 0,
    channels: { goalExecutionGet: IPC.invoke.goalExecutionGet, goalResume: IPC.invoke.goalResume, goalClose: IPC.invoke.goalClose, goalReportGet: IPC.invoke.goalReportGet },
    invoke: async (channel, args) => handlers.get(channel)(...args),
  });
  t.after(async () => { await server.stop(); rmSync(dataDir, { recursive: true, force: true }); });
  const info = await server.start();
  let id = 0, session;
  const rpc = async (method, params) => {
    const response = await fetch(info.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json", ...(session ? { "Mcp-Session-Id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    session ??= response.headers.get("mcp-session-id");
    return (await response.json()).result;
  };
  await rpc("initialize", { protocolVersion: "2025-06-18" });
  return { calls, resumes, rpc, call: (name, args) => rpc("tools/call", { name, arguments: args }) };
}

test("Goal tools discover the existing Main controls and return the complete blocked hold", async (t) => {
  const f = await fixture(t);
  const tools = (await f.rpc("tools/list")).tools;
  assert.deepEqual(tools.filter(tool => tool.name.startsWith("pi_goal_")).map(tool => tool.name),
    ["pi_goal_execution_get", "pi_goal_resume", "pi_goal_close", "pi_goal_report_get"]);
  assert.deepEqual(tools.find(tool => tool.name === "pi_goal_close").inputSchema.required,
    ["sessionId", "executionId", "expectedVersion", "action", "confirm"]);
  assert.deepEqual(tools.find(tool => tool.name === "pi_goal_resume").inputSchema.properties.modelOverride.required,
    ["providerId", "modelId"]);
  const described = (await f.call("pi_control_describe", {})).structuredContent;
  assert.deepEqual(described.map(operation => [operation.id, operation.risk]),
    [["goal/get", "read"], ["goal/resume", "dangerous"], ["goal/close", "dangerous"], ["goalReport/get", "read"]]);
  const read = await f.call("pi_goal_execution_get", { sessionId: "session", executionId: "goal" });
  assert.deepEqual(read.structuredContent.hold, hold);
  await f.call("pi_goal_execution_get", { sessionId: "session" });
  assert.deepEqual(f.calls, [
    { method: "goalExecutions.get", params: { sessionId: "session", executionId: "goal" } },
    { method: "goalExecutions.get", params: { sessionId: "session" } },
  ]);
});

test("accepted Goal report reads expose the trusted Host hash without leaking draft bodies", async (t) => {
  const report = {
    closure: "user_accepted", verdict: "partial", checks: [{ result: "failed" }],
    proposalId: "proposal", goal: { contractHash: "b".repeat(64) },
    assets: [{ assetId: "source", sha256: "c".repeat(64) }],
  };
  const trustedHash = "a".repeat(64);
  let payload = { state: "ready", report, reportSha256: trustedHash, fileBytes: 123, maxBytes: 456, integrity: "structured", verdict: "partial" };
  const f = await fixture(t, async (method) => {
    assert.equal(method, "goalReports.get");
    return payload;
  });
  const params = { sessionId: "session", executionId: "goal" };
  const named = await f.call("pi_goal_report_get", params);
  const generic = await f.call("pi_desktop_invoke", { operation: "goalReport/get", args: [params] });
  for (const result of [named.structuredContent, generic.structuredContent.result]) {
    assert.equal(result.report_sha256, trustedHash);
    assert.deepEqual(result.report, report);
    assert.equal(result.file_bytes, 123);
    assert.equal(result.max_bytes, 456);
    assert.equal(result.reportSha256, undefined);
  }
  payload = { ...payload, state: "draft" };
  const draft = (await f.call("pi_goal_report_get", params)).structuredContent;
  assert.equal(draft.state, "draft");
  assert.equal(draft.report, null);
  assert.equal(payload.report, report);
  const controller = createMcpControlController({ channels: { goalReportGet: IPC.invoke.goalReportGet }, invoke: async () => payload });
  const pluginRead = await controller.invoke({ operation: "goalReport/get", args: [params], source: "plugin" });
  assert.equal(pluginRead, payload);
});

test("Goal mutations require confirmation and keep the current identity, supplement and unverified result", async (t) => {
  const report = { closure: "user_accepted", verdict: "partial", checks: [{ result: "failed", exitCode: 1 }] };
  const f = await fixture(t, async () => ({ execution: { id: "goal", state: "completed" }, hold: { ...hold, state: "accepted" }, report }));
  for (const name of ["pi_goal_resume", "pi_goal_close"]) {
    const denied = await f.call(name, { ...identity, action: "accept", confirm: false });
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.error.code, "CONFIRMATION_REQUIRED");
  }
  assert.equal(f.calls.length + f.resumes.length, 0);
  const resume = { ...identity, message: "Use the attached evidence path", modelOverride: { providerId: "provider", modelId: "model" } };
  const continued = await f.call("pi_goal_resume", { ...resume, confirm: true });
  assert.equal(continued.structuredContent.turnId, "next-turn");
  assert.deepEqual(f.resumes, [resume]);
  const accepted = await f.call("pi_goal_close", { ...identity, action: "accept", confirm: true });
  assert.deepEqual(accepted.structuredContent.report, report);
  assert.deepEqual(f.calls.at(-1), { method: "goalExecutions.close", params: { ...identity, action: "accept" } });
  await f.call("pi_goal_close", { ...identity, action: "abandon", confirm: true });
  assert.equal(f.calls.at(-1).params.action, "abandon");
});

test("generic Goal control keeps confirmation and Main/Host version errors authoritative", async (t) => {
  const f = await fixture(t, async () => { throw Object.assign(new Error("Goal version changed"), { errorCode: "CONFLICT" }); });
  const input = { operation: "goal/close", args: [{ ...identity, action: "accept" }] };
  const denied = await f.call("pi_desktop_invoke", input);
  assert.equal(denied.structuredContent.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(f.calls.length, 0);
  const stale = await f.call("pi_desktop_invoke", { ...input, confirm: true });
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent.error.code, "CONFLICT");
  assert.deepEqual(f.calls.at(-1), { method: "goalExecutions.close", params: input.args[0] });
  const beforeInvalid = f.calls.length;
  for (const invalid of [
    { ...identity, action: "complete" },
    { ...identity, expectedVersion: 0.5, action: "accept" },
  ]) {
    const result = await f.call("pi_goal_close", { ...invalid, confirm: true });
    assert.equal(result.isError, true);
  }
  assert.equal(f.calls.length, beforeInvalid);
  const missingVersion = await f.call("pi_goal_resume", { sessionId: "session", executionId: "goal", confirm: true });
  assert.equal(missingVersion.structuredContent.error.code, "INVALID_PARAMS");
  for (const invalid of [
    { message: 42 },
    { modelOverride: null },
    { modelOverride: [] },
    { modelOverride: { providerId: "provider" } },
    { modelOverride: { providerId: " ", modelId: "model" } },
  ]) {
    const args = { ...identity, ...invalid };
    const named = await f.call("pi_goal_resume", { ...args, confirm: true });
    const generic = await f.call("pi_desktop_invoke", { operation: "goal/resume", args: [args], confirm: true });
    assert.equal(named.isError, true);
    assert.equal(generic.isError, true);
  }
  assert.equal(f.resumes.length, 0);
});
