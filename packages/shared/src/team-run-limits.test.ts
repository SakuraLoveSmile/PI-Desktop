import { expect, it } from "vitest";
import { DEFAULT_TEAM_RUN_LIMITS, validateExpertTeamSettings, validateTeamRunLimits } from "./expert-team-settings.js";
it("legacy settings keep six/ten-hour default limits and accept a live user policy", () => {
  expect(DEFAULT_TEAM_RUN_LIMITS).toEqual({ enabled: true, softMs: 21_600_000, hardMs: 36_000_000 });
  const legacy = { schemaVersion: 1, userDefaults: {}, projectOverrides: {} };
  expect(validateExpertTeamSettings(legacy)).toBe(true);
  expect(validateExpertTeamSettings({ ...legacy, runLimits: DEFAULT_TEAM_RUN_LIMITS })).toBe(true);
  expect(validateExpertTeamSettings({ ...legacy, runLimits: { ...DEFAULT_TEAM_RUN_LIMITS, enabled: false } })).toBe(true);
});
it.each([null, {}, { ...DEFAULT_TEAM_RUN_LIMITS, softMs: 0 }, { ...DEFAULT_TEAM_RUN_LIMITS, hardMs: 21_600_000 },
  { ...DEFAULT_TEAM_RUN_LIMITS, hardMs: Infinity }, { ...DEFAULT_TEAM_RUN_LIMITS, softMs: 1.5 },
  { ...DEFAULT_TEAM_RUN_LIMITS, hardMs: Number.MAX_SAFE_INTEGER + 1 }, { ...DEFAULT_TEAM_RUN_LIMITS, cost: 5 }])("rejects malformed wall-clock policy %j", (policy) => {
  expect(validateTeamRunLimits(policy)).toBe(false);
});
