import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

async function loadScope(t) {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());
  return server.ssrLoadModule("/electron/main/live-voice/work-scope.ts");
}

test("work scope requires the still-active call binding and a supported local session", async (t) => {
  const { requireSupportedWorkSession } = await loadScope(t);
  const bindings = new Map([["call-a", { workSessionId: "session-a" }]]);
  let lookups = 0;
  const host = {
    call: async () => {
      lookups += 1;
      return { sessions: [{ id: "session-a", source: "desktop" }] };
    },
  };

  assert.deepEqual(await requireSupportedWorkSession({ host, bindings, sessionId: "session-a", callId: "call-a" }), {
    id: "session-a",
    source: "desktop",
  });
  await assert.rejects(
    requireSupportedWorkSession({ host, bindings, sessionId: "session-a", callId: "call-b" }),
    { errorCode: "LIVE_WORK_SESSION_UNAVAILABLE" },
  );
  await assert.rejects(
    requireSupportedWorkSession({
      host: { call: async () => ({ sessions: [{ id: "session-a", source: "pi-native" }] }) },
      bindings,
      sessionId: "session-a",
      callId: "call-a",
    }),
    { errorCode: "LIVE_WORK_BACKEND_UNSUPPORTED" },
  );
  await assert.rejects(
    requireSupportedWorkSession({
      host: { call: async () => ({ sessions: [{ id: "session-a", source: "remote" }] }) },
      bindings,
      sessionId: "session-a",
      callId: "call-a",
    }),
    { errorCode: "LIVE_WORK_BACKEND_UNSUPPORTED" },
  );
  assert.equal(lookups, 1, "an invalid call binding is rejected before Host access");
});

test("a work session removed while Host metadata is being read cannot pass revalidation", async (t) => {
  const { requireSupportedWorkSession } = await loadScope(t);
  const bindings = new Map([["call-a", { workSessionId: "session-a" }]]);
  let finishLookup;
  let lookupStarted;
  const started = new Promise((resolve) => { lookupStarted = resolve; });
  const host = {
    call: () => new Promise((resolve) => {
      finishLookup = resolve;
      lookupStarted();
    }),
  };

  const validation = requireSupportedWorkSession({ host, bindings, sessionId: "session-a", callId: "call-a" });
  await started;
  bindings.delete("call-a");
  finishLookup({ sessions: [{ id: "session-a", source: "desktop" }] });
  await assert.rejects(validation, { errorCode: "LIVE_WORK_SESSION_UNAVAILABLE" });
});
