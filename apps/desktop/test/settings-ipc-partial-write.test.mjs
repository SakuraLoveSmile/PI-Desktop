import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { IPC } = await import("@pi-desktop/shared");
const { registerSettingsIpc } = await import("../electron/main/ipc/settings-ipc.ts");

function fixture({ reject = false } = {}) {
  const handlers = new Map();
  const applied = [];
  const configured = [];
  let current = { defaultMode: "agent", theme: "dark", language: "zh-CN", enterToSend: true,
    developerMode: true, keybindings: { "chat.send": "mod+enter" },
    networkPolicy: { mode: "strict" }, networkProxy: { mode: "custom", url: "http://127.0.0.1:8080" } };
  const host = { binaryPath: "fixture-host", async call(method, input) {
    if (method === "settings.get") return structuredClone(current);
    assert.equal(method, "settings.set");
    if (reject) throw new Error("TEAM_CONFIG_CONFLICT");
    const { expertTeamExpected, ...patch } = input;
    current = { ...current, ...patch };
    return structuredClone(current);
  } };
  registerSettingsIpc({
    registrar: { handle(channel, handler) { handlers.set(channel, handler); } },
    getHost: () => host, getSidecar: () => ({ async call(method, input) { configured.push({ method, input }); } }),
    dataDir: "fixture-data", normalizeSettings: value => value, validateSettingsWrite: value => value,
    testNetworkProxy: async () => {},
    applyNetworkProxyFromAppSettings: async settings => { applied.push({ kind: "network", settings }); },
    currentNetworkProxy: () => applied.findLast(item => item.kind === "network")?.settings.networkProxy,
    applyApplicationMenuSettings: settings => { applied.push({ kind: "menu", settings }); },
    applyDeveloperMode: settings => { applied.push({ kind: "developer", settings }); },
    applyPreventScreenSleep: () => {}, applyKeepAwakeWhileRunning: () => {}, applyUpdatePreference: () => {},
    resolveEffectiveCommandShell: async () => {},
  });
  return { write: input => handlers.get(IPC.invoke.settingsSet)(input), applied, configured, current: () => current };
}
for (const patch of [
  { expertTeam: { schemaVersion: 1, userDefaults: { qa: { tools: ["Read"] } }, projectOverrides: {} }, expertTeamExpected: null },
  { theme: "light" },
]) {
  test(`partial ${"expertTeam" in patch ? "expert configuration" : "theme"} write preserves Main network, menu and developer settings`, async () => {
    const f = fixture();
    const result = await f.write(patch);
    for (const effect of f.applied) assert.deepEqual(effect.settings, result, `${effect.kind} must apply the complete committed Host settings`);
    assert.equal(f.applied.find(item => item.kind === "network").settings.networkPolicy.mode, "strict");
    assert.equal(f.applied.find(item => item.kind === "developer").settings.developerMode, true);
    assert.deepEqual(f.configured[0].input.networkProxy, result.networkProxy);
    assert(!("expertTeamExpected" in result));
  });
}
test("a rejected expert configuration write leaves Main side effects untouched", async () => {
  const f = fixture({ reject: true });
  await assert.rejects(f.write({ expertTeam: {}, expertTeamExpected: null }), /TEAM_CONFIG_CONFLICT/);
  assert.deepEqual(f.applied, []);
  assert.deepEqual(f.configured, []);
  assert.equal(f.current().networkPolicy.mode, "strict");
});
