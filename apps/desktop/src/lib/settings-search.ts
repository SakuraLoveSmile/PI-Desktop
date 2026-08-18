/**
 * Data-only index of the settings IA, shared by the settings page nav and
 * the global search dialog. Keyword keys are the i18n keys of the rows
 * rendered inside each tab; search matches their translations, so a query
 * like "主题" or "theme" can surface the tab that owns the row.
 */

export type SettingsTabId =
  | "general"
  | "ai"
  | "shortcuts"
  | "instructions"
  | "agent"
  | "import"
  | "projects"
  | "about";

export type SettingsNavEntry = {
  id: SettingsTabId;
  labelKey: string;
  /** i18n keys of the rows inside the tab; search matches their translations. */
  keywordKeys: string[];
};

export const SETTINGS_NAV: SettingsNavEntry[] = [
  {
    id: "general",
    labelKey: "settings.general",
    keywordKeys: [
      "settings.appearance",
      "settings.theme",
      "settings.language",
      "settings.font",
      "settings.closeBehaviorTitle",
      "settings.closeBehaviorTray",
      "settings.closeBehaviorQuit",
      "settings.defaultsTitle",
      "settings.mode",
      "settings.commandShell",
      "settings.enterToSend",
    ],
  },
  {
    id: "ai",
    labelKey: "settings.ai",
    keywordKeys: [
      "settings.permissions",
      "settings.permissionMode",
      "settings.permissionModeAsk",
      "settings.permissionModeAcceptEdits",
      "settings.permissionModeAuto",
    ],
  },
  {
    id: "shortcuts",
    labelKey: "settings.shortcuts",
    keywordKeys: [
      "settings.keyboard",
      "settings.shortcutAction.openSearch",
      "settings.shortcutAction.openCommandPalette",
      "settings.shortcutAction.toggleSidebar",
      "settings.shortcutAction.openWorkPanel",
    ],
  },
  {
    id: "instructions",
    labelKey: "settings.instructions",
    keywordKeys: [
      "settings.instructionsGlobal",
      "settings.instructionsPath",
    ],
  },
  {
    id: "agent",
    labelKey: "settings.configuration",
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
    keywordKeys: [
      "settings.application",
      "settings.logs",
      "updates.title",
      "settings.developer",
      "settings.developerMode",
      "settings.devTools",
    ],
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
