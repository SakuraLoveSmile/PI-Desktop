/**
 * Data-only index of the settings IA, shared by the settings page nav and
 * the global search dialog. Keyword keys are the i18n keys of the rows
 * rendered inside each tab; search matches their translations, so a query
 * like "主题" or "theme" can surface the tab that owns the row.
 */

export type SettingsTabId = "general" | "agent" | "import" | "projects" | "about";

export type SettingsNavGroupId = "personal" | "integrations" | "system";

export type SettingsNavEntry = {
  id: SettingsTabId;
  labelKey: string;
  groupId: SettingsNavGroupId;
  /** i18n keys of the rows inside the tab; search matches their translations. */
  keywordKeys: string[];
};

export const SETTINGS_GROUP_LABEL_KEYS: Record<
  SettingsNavGroupId,
  string | undefined
> = {
  personal: "settings.groupPersonal",
  integrations: "settings.groupIntegrations",
  system: undefined,
};

export const SETTINGS_NAV: SettingsNavEntry[] = [
  {
    id: "general",
    labelKey: "settings.general",
    groupId: "personal",
    keywordKeys: [
      "settings.appearance",
      "settings.theme",
      "settings.language",
      "settings.mode",
      "settings.enterToSend",
      "settings.contextCompaction",
      "settings.contextCompactionEnabled",
      "settings.contextCompactionReserve",
      "settings.contextCompactionRecent",
      "settings.permissions",
      "settings.permissionMode",
      "settings.keyboard",
      "settings.shortcutAction.openSearch",
      "settings.shortcutAction.openCommandPalette",
      "settings.shortcutAction.toggleSidebar",
      "settings.developer",
      "settings.developerMode",
      "settings.devTools",
    ],
  },
  {
    id: "agent",
    labelKey: "settings.configuration",
    groupId: "integrations",
    keywordKeys: [
      "settings.providers",
      "settings.models",
      "settings.defaultModel",
      "settings.apiKey",
      "settings.baseUrl",
      "settings.apiStyle",
    ],
  },
  {
    id: "import",
    labelKey: "settings.import",
    groupId: "integrations",
    keywordKeys: [
      "settings.importTitle",
      "settings.importSourceClaudeCode",
      "settings.importSourceOpenCode",
      "settings.importSourceCodex",
    ],
  },
  {
    id: "projects",
    labelKey: "settings.projectArchive",
    groupId: "system",
    keywordKeys: [
      "project.title",
      "project.searchPlaceholder",
      "project.archive",
      "project.restore",
    ],
  },
  {
    id: "about",
    labelKey: "settings.about",
    groupId: "system",
    keywordKeys: ["settings.application", "settings.logs", "updates.title"],
  },
];

export type SettingsSearchHit = {
  tab: SettingsTabId;
  tabLabelKey: string;
  /** Matched row key; null when the tab label itself matched. */
  rowKey: string | null;
};

export function searchSettings(
  query: string,
  t: (key: string) => string,
  limit = 8,
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SettingsSearchHit[] = [];
  for (const entry of SETTINGS_NAV) {
    if (t(entry.labelKey).toLowerCase().includes(q)) {
      hits.push({ tab: entry.id, tabLabelKey: entry.labelKey, rowKey: null });
    }
    for (const key of entry.keywordKeys) {
      if (t(key).toLowerCase().includes(q)) {
        hits.push({ tab: entry.id, tabLabelKey: entry.labelKey, rowKey: key });
      }
    }
  }
  return hits.slice(0, limit);
}
