import { SESSION_THINKING_LEVELS, type SessionThinkingLevel } from "./types/models.js";

export const EXPERT_TEAM_PRESET_IDS = [
  "researcher", "fullstack", "qa", "reviewer", "ui", "debugger",
] as const;
export const EXPERT_TEAM_CONFIGURABLE_TOOLS = ["Read", "Glob", "Grep", "BrowserPreview", "Bash", "Edit", "Write"] as const;
export type ExpertTeamPresetId = (typeof EXPERT_TEAM_PRESET_IDS)[number];

export type ExpertTeamRoleConfig = {
  /** A route is atomic: configure both fields, or inherit both. */
  providerId?: string;
  modelId?: string;
  thinkingLevel?: SessionThinkingLevel;
  /** Absent inherits the existing profile. Empty means no optional tools. */
  tools?: string[];
  instructions?: string;
};
export type ExpertTeamSettings = {
  schemaVersion: 1;
  userDefaults: Partial<Record<ExpertTeamPresetId, ExpertTeamRoleConfig>>;
  /** Keys are canonical paths from the Host's existing project catalog. */
  projectOverrides: Record<string, Partial<Record<ExpertTeamPresetId, ExpertTeamRoleConfig>>>;
};
/** Host snapshot, never accepted from model proposals or read live from settings. */
export type ExpertTeamConfigSnapshot = {
  presetId: ExpertTeamPresetId;
  tools?: string[];
  instructions?: string;
};

export function isExpertTeamPresetId(value: unknown): value is ExpertTeamPresetId {
  return typeof value === "string" && EXPERT_TEAM_PRESET_IDS.some((id) => id === value);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedId(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= max;
}
function validConfig(value: unknown): boolean {
  if (!object(value) || Object.keys(value).some((key) =>
    !["providerId", "modelId", "thinkingLevel", "tools", "instructions"].includes(key))) return false;
  if ((value.providerId !== undefined) !== (value.modelId !== undefined)) return false;
  if (value.providerId !== undefined &&
    (!boundedId(value.providerId, 128) || !boundedId(value.modelId, 256))) return false;
  if (value.thinkingLevel !== undefined &&
    !SESSION_THINKING_LEVELS.some((level) => level === value.thinkingLevel)) return false;
  if (value.instructions !== undefined &&
    (typeof value.instructions !== "string" || Array.from(value.instructions).length > 16000)) return false;
  if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.length > 256 ||
    value.tools.some((tool) => !EXPERT_TEAM_CONFIGURABLE_TOOLS.some((allowed) => allowed === tool)) || new Set(value.tools).size !== value.tools.length)) return false;
  return true;
}
function validRoles(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, config]) =>
    isExpertTeamPresetId(key) && validConfig(config));
}
/** Structural validation; the Host also verifies project and provider ownership. */
export function validateExpertTeamSettings(value: unknown): value is ExpertTeamSettings {
  return object(value) && value.schemaVersion === 1 &&
    Object.keys(value).every((key) => ["schemaVersion", "userDefaults", "projectOverrides"].includes(key)) &&
    validRoles(value.userDefaults) && object(value.projectOverrides) &&
    Object.keys(value.projectOverrides).length <= 1024 &&
    Object.entries(value.projectOverrides).every(([path, roles]) => boundedId(path, 4096) && validRoles(roles));
}
/** Fieldwise project inheritance; route pairs are validated atomically on entry. */
export function resolveExpertTeamRoleConfig(
  settings: ExpertTeamSettings | undefined,
  presetId: ExpertTeamPresetId,
  projectPath?: string | null,
): ExpertTeamRoleConfig {
  const config = { ...settings?.userDefaults[presetId],
    ...(projectPath ? settings?.projectOverrides[projectPath]?.[presetId] : undefined) };
  return { ...config, ...(config.tools !== undefined ? { tools: [...config.tools] } : {}) };
}
