import { describe, expect, it } from "vitest";
import { resolveExpertTeamRoleConfig, validateExpertTeamSettings, type ExpertTeamSettings } from "./expert-team-settings.js";

describe("expert settings contract", () => {
  const base = (): ExpertTeamSettings => ({ schemaVersion: 1, userDefaults: {}, projectOverrides: {} });
  it("accepts legacy absence and explicit empty overrides without changing defaults", () => {
    expect(resolveExpertTeamRoleConfig(undefined, "researcher")).toEqual({});
    expect(validateExpertTeamSettings(base())).toBe(true);
  });
  it("counts Unicode instructions consistently with the Host scalar boundary", () => {
    expect(validateExpertTeamSettings({ ...base(), userDefaults: { ui: { instructions: "😀".repeat(16000) } } })).toBe(true);
    expect(validateExpertTeamSettings({ ...base(), userDefaults: { ui: { instructions: "😀".repeat(16001) } } })).toBe(false);
  });
  it("rejects malformed versions, routes, tools, instructions and roles", () => {
    for (const value of [null, [], { ...base(), schemaVersion: 2 },
      { ...base(), userDefaults: { admin: {} } },
      { ...base(), userDefaults: { qa: { providerId: "provider" } } },
      { ...base(), userDefaults: { qa: { tools: ["Read", "Read"] } } },
      { ...base(), userDefaults: { qa: { tools: ["mcp_secret"] } } },
      { ...base(), userDefaults: { qa: { instructions: "a".repeat(16001) } } },
      { ...base(), userDefaults: { qa: { apiKey: "secret" } } },
      { ...base(), userDefaults: { qa: { thinkingLevel: "ultra" } } }]) {
      expect(validateExpertTeamSettings(value)).toBe(false);
    }
  });
  it("inherits per field while keeping route pairs atomic and projects isolated", () => {
    const settings: ExpertTeamSettings = { ...base(),
      userDefaults: { qa: { providerId: "user", modelId: "user-model", thinkingLevel: "high", tools: ["Read"], instructions: "User instructions" } },
      projectOverrides: { "/alpha": { qa: { providerId: "project", modelId: "project-model", tools: [], instructions: "" } } } };
    const alpha = resolveExpertTeamRoleConfig(settings, "qa", "/alpha");
    expect(alpha).toEqual({ providerId: "project", modelId: "project-model", thinkingLevel: "high", tools: [], instructions: "" });
    expect(resolveExpertTeamRoleConfig(settings, "qa", "/beta")).toEqual(settings.userDefaults.qa);
    expect(resolveExpertTeamRoleConfig(settings, "researcher", "/alpha")).toEqual({});
    alpha.tools?.push("Write");
    expect(settings.projectOverrides["/alpha"]?.qa?.tools).toEqual([]);
  });
});
