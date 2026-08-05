import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoot = (relativePath) =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
const readDesktop = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("Plan artifact runtime uses the terminating SubmitPlan contract", async () => {
  const [runtime, sidecar, main] = await Promise.all([
    readRoot("packages/agent-runtime/src/runtime.ts"),
    readRoot("packages/agent-runtime/src/sidecar.ts"),
    readDesktop("electron/main/index.ts"),
  ]);

  assert.match(runtime, /name: "SubmitPlan"/);
  assert.match(runtime, /title: Type\.String/);
  assert.match(runtime, /markdown: Type\.String/);
  assert.match(runtime, /question: Type\.String/);
  assert.match(runtime, /terminate: true/);
  assert.doesNotMatch(runtime, /ExitPlanMode/);
  assert.match(sidecar, /agent\.executeApprovedPlan/);
  assert.match(main, /plans\.queuedExecutions/);
  assert.match(main, /plans\.claimExecution/);
  assert.match(main, /plans\.finishExecution/);
  assert.match(main, /createNotification/);

  const resolveStart = main.indexOf("handle(IPC.invoke.plansResolve");
  const resolveSource = main.slice(resolveStart, main.indexOf("handle(IPC.invoke.pluginList", resolveStart));
  assert.match(resolveSource, /if \(action === "approve"\)/);
  assert.doesNotMatch(resolveSource, /action === "reject"[\s\S]*dispatchApprovedPlan/);
});

test("Electron retains the stable Plan IPC names and protocol version", async () => {
  const [protocol, main] = await Promise.all([
    readRoot("packages/shared/src/protocol.ts"),
    readDesktop("electron/main/index.ts"),
  ]);

  assert.match(protocol, /PROTOCOL_VERSION = 9/);
  assert.match(protocol, /SCHEMA_VERSION = 10/);
  assert.match(protocol, /plansPending:/);
  assert.match(protocol, /plansResolve:/);
  assert.match(protocol, /plansChanged:/);
  assert.match(main, /IPC\.invoke\.plansPending/);
  assert.match(main, /IPC\.invoke\.plansResolve/);
});
