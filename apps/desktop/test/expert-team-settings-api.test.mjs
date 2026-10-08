import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { api } = await import("../src/lib/api.ts");
const { IPC } = await import("@pi-desktop/shared");

const team = (instructions) => ({ schemaVersion: 1,
  userDefaults: { researcher: { instructions } }, projectOverrides: {} });

function preload(t, invoke) {
  const previous = globalThis.window;
  globalThis.window = { piDesktop: { invoke } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test("ordinary full-settings snapshots save preferences without replaying expert-team config", async (t) => {
  const stale = { defaultMode: "agent", theme: "light", enterToSend: false, expertTeam: team("Stale window") };
  let stored = { defaultMode: "agent", theme: "dark", expertTeam: team("Fresh editor") };
  preload(t, async (channel, patch) => {
    assert.equal(channel, IPC.invoke.settingsSet);
    assert.equal(Object.hasOwn(patch, "expertTeam"), false);
    assert.equal(Object.hasOwn(patch, "expertTeamExpected"), false);
    stored = { ...stored, ...structuredClone(patch) };
    return { ok: true, data: null };
  });
  await api.setSettings(stale);
  assert.equal(stored.theme, "light");
  assert.equal(stored.enterToSend, false);
  assert.equal(stored.expertTeam.userDefaults.researcher.instructions, "Fresh editor");
  assert.equal(stale.expertTeam.userDefaults.researcher.instructions, "Stale window", "Input snapshot is never mutated");
});

test("dedicated team writes preserve explicit config and CAS metadata, including initially absent config", async (t) => {
  const calls = [];
  preload(t, async (channel, patch) => {
    assert.equal(channel, IPC.invoke.settingsSet);
    calls.push(structuredClone(patch));
    return { ok: true, data: null };
  });
  const previous = team("Before");
  const next = team("After");
  await api.setSettings({ expertTeam: next, expertTeamExpected: previous });
  await api.setSettings({ expertTeam: next, expertTeamExpected: null });
  assert.deepEqual(calls, [
    { expertTeam: next, expertTeamExpected: previous },
    { expertTeam: next, expertTeamExpected: null },
  ]);
});

test("Host CAS conflicts stay observable through the public settings wrapper", async (t) => {
  preload(t, async () => ({ ok: false, error: { code: "TEAM_CONFIG_CONFLICT", message: "Team changed" } }));
  await assert.rejects(api.setSettings({ expertTeam: team("Draft"), expertTeamExpected: null }),
    (error) => error.code === "TEAM_CONFIG_CONFLICT" && error.message === "Team changed");
});
