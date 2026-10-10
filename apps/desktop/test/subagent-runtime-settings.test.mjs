import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { persistSubagentLimit } = await import("../src/components/settings/subagent-runtime-settings.ts");
const { api } = await import("../src/lib/api.ts");
const { IPC, normalizeSubagentLimits } = await import("@pi-desktop/shared");

function bridge({ failWrite = false } = {}) {
  const writes = [];
  let stored = { theme: "light", defaultMode: "agent", enterToSend: true, onboardingDismissed: true,
    expertTeam: { schemaVersion: 1, userDefaults: {}, projectOverrides: {} } };
  globalThis.window = { piDesktop: { platform: "darwin", invoke: async (channel, patch) => {
    if (channel === IPC.invoke.settingsSet) {
      if (failWrite) return { ok: false, error: { code: "INTERNAL", message: "Host unavailable" } };
      writes.push(structuredClone(patch));
      stored = { ...stored, ...patch };
    } else assert.equal(channel, IPC.invoke.settingsGet);
    return { ok: true, data: structuredClone(stored) };
  } } };
  return { writes, stored: () => structuredClone(stored) };
}

test("subagent settings save and reload through the settings API without overwriting other preferences", async () => {
  const previous = globalThis.window;
  try {
    const host = bridge();
    assert.deepEqual(normalizeSubagentLimits(await api.getSettings()), { maxDepth: 1, maxConcurrency: 10 });
    assert.equal((await persistSubagentLimit("subagentMaxDepth", "3")).subagentMaxDepth, 3);
    assert.equal((await persistSubagentLimit("subagentMaxConcurrency", "12")).subagentMaxConcurrency, 12);
    assert.deepEqual(normalizeSubagentLimits(await api.getSettings()), { maxDepth: 3, maxConcurrency: 12 });
    await persistSubagentLimit("subagentMaxDepth", "0");
    assert.deepEqual(normalizeSubagentLimits(await api.getSettings()), { maxDepth: 0, maxConcurrency: 12 });
    assert.deepEqual(host.writes, [{ subagentMaxDepth: 3 }, { subagentMaxConcurrency: 12 }, { subagentMaxDepth: 0 }]);
    assert.equal(host.stored().theme, "light");
    assert.deepEqual(host.stored().expertTeam, { schemaVersion: 1, userDefaults: {}, projectOverrides: {} });
  } finally { globalThis.window = previous; }
});

test("empty, fractional and out-of-range drafts do not write settings", async () => {
  const previous = globalThis.window;
  try {
    const host = bridge();
    for (const draft of ["", " ", "-1", "9", "1.5", "NaN", "Infinity"]) {
      assert.equal(await persistSubagentLimit("subagentMaxDepth", draft), null);
    }
    for (const draft of ["", "0", "33", "1.5", "no"]) {
      assert.equal(await persistSubagentLimit("subagentMaxConcurrency", draft), null);
    }
    assert.deepEqual(host.writes, []);
  } finally { globalThis.window = previous; }
});

test("failed saves preserve the stored settings and expose the Host error", async () => {
  const previous = globalThis.window;
  try {
    const host = bridge({ failWrite: true });
    await assert.rejects(persistSubagentLimit("subagentMaxDepth", "3"), /Host unavailable/);
    assert.deepEqual(normalizeSubagentLimits(host.stored()), { maxDepth: 1, maxConcurrency: 10 });
  } finally { globalThis.window = previous; }
});
