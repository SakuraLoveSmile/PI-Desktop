import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { expertTeamScopeRole, expertTeamModelOptions, expertTeamThinkingLevels,
  persistExpertTeamRole, persistExpertTeamProjectRemoval, ExpertTeamSettingsConflict } = await import("../src/features/settings/expert-team-settings.ts");
const { resolveExpertTeamRoleConfig } = await import("@pi-desktop/shared");

const settings = () => ({ theme: "dark", defaultMode: "agent", enterToSend: true,
  expertTeam: { schemaVersion: 1, userDefaults: { researcher: { providerId: "one", modelId: "alpha", tools: ["Read"] } },
    projectOverrides: { "/project-a": { researcher: { instructions: "Project A" } }, "/project-b": { qa: { tools: [] } } } } });

test("saving one scoped role preserves latest preferences, other roles and projects, and fieldwise inheritance", async () => {
  let stored = settings();
  const expected = expertTeamScopeRole(stored.expertTeam, "/project-a", "researcher");
  stored = { ...stored, theme: "light", expertTeam: { ...stored.expertTeam,
    userDefaults: { ...stored.expertTeam.userDefaults, fullstack: { instructions: "New concurrent default" } } } };
  const persisted = await persistExpertTeamRole({ scope: "/project-a", role: "researcher", expected,
    config: { instructions: "Edited A", thinkingLevel: "high" }, isCurrent: () => true,
    getSettings: async () => structuredClone(stored), setSettings: async (next) => { stored = { ...stored, expertTeam: structuredClone(next.expertTeam) }; } });
  assert.equal(persisted.theme, "light");
  assert.deepEqual(persisted.expertTeam.userDefaults.fullstack, { instructions: "New concurrent default" });
  assert.deepEqual(persisted.expertTeam.projectOverrides["/project-b"], { qa: { tools: [] } });
  assert.deepEqual(resolveExpertTeamRoleConfig(persisted.expertTeam, "researcher", "/project-a"), {
    providerId: "one", modelId: "alpha", tools: ["Read"], instructions: "Edited A", thinkingLevel: "high" });
  assert.equal(resolveExpertTeamRoleConfig(persisted.expertTeam, "researcher", "/project-b").instructions, undefined);
});

test("reset deletes only the selected override so future user default edits remain inherited", async () => {
  let stored = settings();
  const expected = expertTeamScopeRole(stored.expertTeam, "/project-a", "researcher");
  const result = await persistExpertTeamRole({ scope: "/project-a", role: "researcher", expected, config: undefined,
    isCurrent: () => true, getSettings: async () => stored, setSettings: async (next) => { stored = { ...stored, expertTeam: next.expertTeam }; } });
  assert.equal(result.expertTeam.projectOverrides["/project-a"], undefined);
  assert.deepEqual(result.expertTeam.projectOverrides["/project-b"], { qa: { tools: [] } });
  assert.deepEqual(resolveExpertTeamRoleConfig(result.expertTeam, "researcher", "/project-a"), result.expertTeam.userDefaults.researcher);
});

test("stale editors cancel before writes and concurrent same-role edits remain protected", async () => {
  const initial = settings();
  let writes = 0;
  const input = { scope: "", role: "researcher", expected: initial.expertTeam.userDefaults.researcher,
    config: { instructions: "Stale" }, getSettings: async () => initial, setSettings: async () => { writes++; } };
  assert.equal(await persistExpertTeamRole({ ...input, isCurrent: () => false }), null);
  const changed = { ...initial, expertTeam: { ...initial.expertTeam, userDefaults: { researcher: { tools: [] } } } };
  await assert.rejects(persistExpertTeamRole({ ...input, isCurrent: () => true, getSettings: async () => changed }), ExpertTeamSettingsConflict);
  assert.equal(writes, 0);
});

test("save failures propagate without substituting the local draft for confirmed host settings", async () => {
  const initial = settings();
  await assert.rejects(persistExpertTeamRole({ scope: "", role: "qa", expected: undefined,
    config: { tools: [] }, isCurrent: () => true, getSettings: async () => initial,
    setSettings: async () => { throw new Error("Host unavailable"); } }), /Host unavailable/);
  assert.equal(initial.expertTeam.userDefaults.qa, undefined);
});

test("model menu uses runnable configured routes and thinking ladder uses the selected model binding", () => {
  const provider = { id: "one", name: "Service", vendorKey: "custom", enabled: true, hasSecret: false, authKind: "none",
    supportsReasoning: true, supportedThinkingLevels: ["low", "high"], models: [
      { id: "alpha", thinkingLevels: ["low", "high"] }, { id: "plain", thinkingLevels: ["off"] } ] };
  assert.equal(expertTeamModelOptions([provider, { ...provider, id: "disabled", enabled: false }]).length, 2);
  assert.deepEqual(expertTeamThinkingLevels({ providerId: "one", modelId: "alpha" }, [provider], {}), ["omit", "low", "high"]);
  assert.deepEqual(expertTeamThinkingLevels({ providerId: "one", modelId: "plain" }, [provider], {}), ["omit", "off"]);
  assert.deepEqual(expertTeamThinkingLevels({ providerId: "removed", modelId: "alpha" }, [provider], {}), []);
});


test("Host CAS rebases once for different-role changes in the read-write gap, never losing preferences", async () => {
  let stored = settings();
  let attempts = 0;
  const expected = expertTeamScopeRole(stored.expertTeam, "", "qa");
  const result = await persistExpertTeamRole({ scope: "", role: "qa", expected, config: { instructions: "QA draft" },
    isCurrent: () => true, getSettings: async () => structuredClone(stored), setSettings: async (patch) => {
      assert.deepEqual(Object.keys(patch).sort(), ["expertTeam", "expertTeamExpected"]);
      if (++attempts === 1) {
        stored.theme = "light";
        stored.expertTeam.userDefaults.fullstack = { instructions: "Concurrent window" };
      }
      if (JSON.stringify(patch.expertTeamExpected) !== JSON.stringify(stored.expertTeam)) {
        throw Object.assign(new Error("Conflict"), { code: "TEAM_CONFIG_CONFLICT" });
      }
      stored = { ...stored, expertTeam: structuredClone(patch.expertTeam) };
    } });
  assert.equal(attempts, 2);
  assert.equal(result.theme, "light");
  assert.equal(result.expertTeam.userDefaults.fullstack.instructions, "Concurrent window");
  assert.equal(result.expertTeam.userDefaults.qa.instructions, "QA draft");
});

test("Host CAS same-role collision preserves the other window's edit without retrying a stale mutation", async () => {
  let stored = settings();
  let attempts = 0;
  const expected = expertTeamScopeRole(stored.expertTeam, "", "qa");
  await assert.rejects(persistExpertTeamRole({ scope: "", role: "qa", expected, config: { instructions: "Stale QA" },
    isCurrent: () => true, getSettings: async () => structuredClone(stored), setSettings: async () => {
      attempts++;
      stored.expertTeam.userDefaults.qa = { instructions: "Other window QA" };
      throw Object.assign(new Error("Conflict"), { code: "TEAM_CONFIG_CONFLICT" });
    } }), ExpertTeamSettingsConflict);
  assert.equal(attempts, 1);
  assert.equal(stored.expertTeam.userDefaults.qa.instructions, "Other window QA");
});

test("a removed project config can be explicitly cleared without touching other project overrides", async () => {
  let stored = settings();
  const result = await persistExpertTeamProjectRemoval({ scope: "/project-a", expected: stored.expertTeam.projectOverrides["/project-a"],
    isCurrent: () => true, getSettings: async () => structuredClone(stored), setSettings: async (patch) => {
      stored = { ...stored, expertTeam: patch.expertTeam };
    } });
  assert.equal(result.expertTeam.projectOverrides["/project-a"], undefined);
  assert.deepEqual(result.expertTeam.projectOverrides["/project-b"], { qa: { tools: [] } });
  assert.deepEqual(result.expertTeam.userDefaults, settings().expertTeam.userDefaults);
});
