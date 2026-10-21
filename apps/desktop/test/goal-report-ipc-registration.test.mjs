import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
register(pathToFileURL(fileURLToPath(new URL("helpers/ts-import-hooks.mjs", import.meta.url))));
const { registerGoalReportIpc } = await import("../electron/main/ipc/goal-report-ipc.ts");
const { IPC, IPC_WHITELIST } = await import("@pi-desktop/shared");

test("Goal report and execution handlers register only whitelisted IPC and preserve scoped Host calls", async () => {
  const handlers = new Map(), calls = [];
  registerGoalReportIpc({ handle: (channel, handler) => handlers.set(channel, handler), getHost: () => ({ call: async (method, params) => { calls.push({ method, params }); return { ok: true }; } }) });
  for (const channel of handlers.keys()) assert.equal(IPC_WHITELIST.has(channel), true);
  await handlers.get(IPC.invoke.goalReportGet)({ sessionId: "session", executionId: "execution" });
  await handlers.get(IPC.invoke.goalReportList)({ sessionId: "session" });
  await handlers.get(IPC.invoke.goalReportRetry)({ sessionId: "session", executionId: "execution" });
  await handlers.get(IPC.invoke.goalReportGetAsset)({ sessionId: "session", executionId: "execution", screenshotId: "shot" });
  await handlers.get(IPC.invoke.goalExecutionGet)({ sessionId: "session", executionId: "execution" });
  assert.deepEqual(calls.map(call => call.method), ["goalReports.get", "goalReports.list", "goalReports.retry", "goalReports.getAsset", "goalExecutions.get"]);
  assert.equal(handlers.has(IPC.invoke.goalResume), true);
  assert.equal(handlers.has(IPC.invoke.goalClose), true);
});
