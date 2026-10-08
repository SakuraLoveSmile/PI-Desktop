import type {
  AppSettings,
  ExpertTeamPresetId,
  ExpertTeamRoleConfig,
  ExpertTeamSettings,
  ModelInfo,
  ProviderPublic,
  SessionThinkingLevel,
} from "@pi-desktop/shared";
import { sessionThinkingMenuLevels, THINKING_LEVELS } from "@pi-desktop/shared";
import { subagentModelChoices } from "../../components/settings/subagent-models";
import { thinkingProviderForModel } from "../chat/composer/model";

export const EXPERT_TEAM_USER_SCOPE = "";
type ExpertTeamWrite = { expertTeam: ExpertTeamSettings; expertTeamExpected: ExpertTeamSettings | null };

export function expertTeamScopeRole(
  settings: ExpertTeamSettings | undefined,
  scope: string,
  role: ExpertTeamPresetId,
): ExpertTeamRoleConfig | undefined {
  return scope ? settings?.projectOverrides[scope]?.[role] : settings?.userDefaults[role];
}

export function expertTeamRouteValue(config: ExpertTeamRoleConfig): string {
  return config.providerId && config.modelId ? JSON.stringify([config.providerId, config.modelId]) : "";
}

export function expertTeamModelOptions(providers: readonly ProviderPublic[]) {
  return subagentModelChoices(providers).map((choice) => ({
    id: expertTeamRouteValue(choice),
    label: `${choice.providerName} · ${choice.modelId}`,
    providerId: choice.providerId,
    modelId: choice.modelId,
  }));
}

export function expertTeamThinkingLevels(
  config: ExpertTeamRoleConfig,
  providers: readonly ProviderPublic[],
  catalogs: Record<string, ModelInfo[]>,
): SessionThinkingLevel[] {
  if (!config.providerId || !config.modelId) return sessionThinkingMenuLevels(THINKING_LEVELS);
  const provider = providers.find((item) => item.id === config.providerId);
  if (!provider) return [];
  const effective = thinkingProviderForModel(provider, config.modelId, catalogs[provider.id]);
  return sessionThinkingMenuLevels(effective?.supportsReasoning ? effective.supportedThinkingLevels : ["off"]);
}

export class ExpertTeamSettingsConflict extends Error {
  readonly confirmedSettings?: AppSettings;
  constructor(confirmedSettings?: AppSettings) {
    super("Expert team role changed while editing");
    this.confirmedSettings = confirmedSettings;
  }
}

/** Replace one scoped role in freshly fetched settings, preserving every other field. */
export function replaceExpertTeamRole(
  settings: AppSettings,
  scope: string,
  role: ExpertTeamPresetId,
  config: ExpertTeamRoleConfig | undefined,
  expected: ExpertTeamRoleConfig | undefined,
): AppSettings {
  const existing = expertTeamScopeRole(settings.expertTeam, scope, role);
  if (JSON.stringify(existing) !== JSON.stringify(expected)) throw new ExpertTeamSettingsConflict(settings);
  const team: ExpertTeamSettings = settings.expertTeam ?? {
    schemaVersion: 1, userDefaults: {}, projectOverrides: {},
  };
  const roles = { ...(scope ? team.projectOverrides[scope] : team.userDefaults) };
  if (config && Object.keys(config).length) roles[role] = { ...config };
  else delete roles[role];
  const next = { ...team, projectOverrides: { ...team.projectOverrides } };
  if (!scope) next.userDefaults = roles;
  else if (Object.keys(roles).length) next.projectOverrides[scope] = roles;
  else delete next.projectOverrides[scope];
  return { ...settings, expertTeam: next };
}

/** Cancellation before persistence stops a stale editor from submitting to the Host. */
export async function persistExpertTeamRole({
  scope, role, config, expected, isCurrent, getSettings, setSettings,
}: {
  scope: string;
  role: ExpertTeamPresetId;
  config: ExpertTeamRoleConfig | undefined;
  expected: ExpertTeamRoleConfig | undefined;
  isCurrent: () => boolean;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: ExpertTeamWrite) => Promise<unknown>;
}): Promise<AppSettings | null> {
  return persistExpertTeamMutation({ isCurrent, getSettings, setSettings,
    mutate: (latest) => replaceExpertTeamRole(latest, scope, role, config, expected) });
}

/** Removed projects remain visible until their saved overrides are explicitly cleared. */
export async function persistExpertTeamProjectRemoval({
  scope, expected, isCurrent, getSettings, setSettings,
}: {
  scope: string;
  expected: Partial<Record<ExpertTeamPresetId, ExpertTeamRoleConfig>> | undefined;
  isCurrent: () => boolean;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: ExpertTeamWrite) => Promise<unknown>;
}): Promise<AppSettings | null> {
  return persistExpertTeamMutation({ isCurrent, getSettings, setSettings, mutate: (latest) => {
    if (JSON.stringify(latest.expertTeam?.projectOverrides[scope]) !== JSON.stringify(expected)) {
      throw new ExpertTeamSettingsConflict(latest);
    }
    if (!latest.expertTeam) return latest;
    const projectOverrides = { ...latest.expertTeam.projectOverrides };
    delete projectOverrides[scope];
    return { ...latest, expertTeam: { ...latest.expertTeam, projectOverrides } };
  } });
}

async function persistExpertTeamMutation({ isCurrent, getSettings, setSettings, mutate }: {
  isCurrent: () => boolean;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: ExpertTeamWrite) => Promise<unknown>;
  mutate: (latest: AppSettings) => AppSettings;
}): Promise<AppSettings | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = await getSettings();
    if (!isCurrent()) return null;
    const next = mutate(latest);
    if (!next.expertTeam) return latest;
    try {
      // The Host merges top-level patches and compares the team snapshot under
      // its settings lock. Never send unrelated preferences from this editor.
      await setSettings({ expertTeam: next.expertTeam, expertTeamExpected: latest.expertTeam ?? null });
    } catch (error) {
      const conflict = typeof error === "object" && error !== null &&
        (("code" in error && error.code === "TEAM_CONFIG_CONFLICT") ||
         ("errorCode" in error && error.errorCode === "TEAM_CONFIG_CONFLICT"));
      if (!conflict) throw error;
      if (attempt === 1) throw new ExpertTeamSettingsConflict();
      // One rebase preserves edits to other roles. mutate rejects any change
      // to this editor's own role instead of silently replacing it.
      continue;
    }
    return getSettings();
  }
  throw new ExpertTeamSettingsConflict();
}
