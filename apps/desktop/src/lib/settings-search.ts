/**
 * Data-only index of the settings IA, shared by the settings page nav and
 * the global search dialog. Keyword keys include translated row titles,
 * options, and help copy; search matches their translations, so a query
 * like "主题" or "theme" can surface the tab that owns the row.
 */

export type SettingsTabId =
  | "general"
  | "ai"
  | "shortcuts"
  | "instructions"
  | "agent"
  | "skills"
  | "mcp"
  | "subagents"
  | "expertTeam"
  | "import"
  | "projects"
  | "memory"
  | "sync"
  | "remoteHosts"
  | "voice"
  | "about";

export type SettingsNavGroupId =
  | "preferences"
  | "agent"
  | "workspace"
  | "system";

export const SETTINGS_NAV_GROUP_LABELS: Record<SettingsNavGroupId, string> = {
  preferences: "settings.groupPreferences",
  agent: "settings.groupAgent",
  workspace: "settings.groupWorkspace",
  system: "settings.groupSystem",
};

export type SettingsNavEntry = {
  id: SettingsTabId;
  /** Short label used by the rail and settings search results. */
  labelKey: string;
  /** Descriptive title used at the top of the selected settings page. */
  titleKey: string;
  /** Visual-only rail grouping; search remains a flat destination index. */
  group: SettingsNavGroupId;
  /** i18n keys of the rows inside the tab; search matches their translations. */
  keywordKeys: string[];
  /** Visible row/card titles and the option/help keywords owned by each one. */
  searchTargets?: Record<string, readonly string[]>;
  /**
   * Destination only exists while `AppSettings.developerMode` is on; the
   * rail, the page, and settings search drop it together.
   */
  developerOnly?: true;
  /** Surface is omitted from packaged builds; development builds retain it. */
  developmentOnly?: true;
  /** Localized Experimental badge shown beside the rail row and page title. */
  experimentalBadgeKey?: string;
};

export const SETTINGS_NAV: SettingsNavEntry[] = [
  {
    id: "general",
    labelKey: "settings.nav.general",
    titleKey: "settings.general",
    group: "preferences",
    keywordKeys: [
      "settings.appearance",
      "settings.storage.title",
      "settings.storage.dataPath",
      "settings.storage.cache",
      "settings.storage.clearCache",
      "settings.storage.backup",
      "settings.theme",
      "settings.language",
      "settings.languageAuto",
      "settings.font",
      "settings.fontSize",
      "settings.closeBehaviorTitle",
      "settings.closeBehaviorTray",
      "settings.closeBehaviorQuit",
      "settings.power",
      "settings.keepAwakeWhileRunning",
      "settings.keepAwakeWhileRunningDesc",
      "settings.network",
      "settings.proxy",
      "settings.proxySystem",
      "settings.proxyDirect",
      "settings.proxyCustom",
      "settings.proxyUrl",
      "settings.networkRelaxedMode",
      "settings.networkRelaxedModeDesc",
      "settings.networkRelaxedModeStrictDesc",
      "settings.preventScreenSleep",
      "settings.preventScreenSleepDesc",
    ],
    searchTargets: {
      "settings.appearance": [],
      "settings.storage.title": ["settings.storage.backup"],
      "settings.storage.dataPath": [],
      "settings.storage.cache": ["settings.storage.clearCache"],
      "settings.theme": [],
      "settings.language": ["settings.languageAuto"],
      "settings.font": [],
      "settings.fontSize": [],
      "settings.power": [],
      "settings.keepAwakeWhileRunning": ["settings.keepAwakeWhileRunningDesc"],
      "settings.network": [],
      "settings.proxy": ["settings.proxySystem", "settings.proxyDirect", "settings.proxyCustom", "settings.proxyUrl"],
      "settings.networkRelaxedMode": ["settings.networkRelaxedModeDesc", "settings.networkRelaxedModeStrictDesc"],
      "settings.preventScreenSleep": ["settings.preventScreenSleepDesc"],
    },
  },
  {
    id: "ai",
    labelKey: "settings.nav.ai",
    titleKey: "settings.ai",
    group: "preferences",
    keywordKeys: [
      "settings.permissions",
      "settings.permissionMode",
      "settings.permissionModeAsk",
      "settings.permissionModeAcceptEdits",
      "settings.permissionModeAuto",
      "settings.defaultsTitle",
      "settings.executionDefaults",
      "settings.conversationDisplay",
      "settings.mode",
      "settings.commandShell",
      "settings.linkOpenTarget",
      "settings.enterToSend",
      "settings.infiniteProviderRetry",
      "settings.infiniteProviderRetryDesc",
      "settings.smoothStreaming",
      "settings.smoothStreamingDesc",
      "settings.thinkingDisplayMode",
      "settings.thinkingDisplayDetailed",
      "settings.thinkingDisplayCompact",
      "settings.contextUsageDisplay",
      "settings.contextUsageDisplayRemaining",
      "settings.contextUsageDisplayUsed",
      "settings.promptEnhancementTitle",
      "settings.promptEnhancementDesc",
      "settings.promptEnhancementCustomTemplate",
      "settings.promptEnhancementEdit",
      "settings.promptEnhancementUserTemplate",
      "settings.promptEnhancementModelTitle",
      "settings.promptEnhancementModel",
      "settings.promptEnhancementModelFollow",
      "settings.promptEnhancementThinking",
      "settings.advisorTitle",
      "settings.advisorModel",
      "settings.largePasteThreshold",
    ],
    searchTargets: {
      "settings.permissions": [],
      "settings.permissionMode": ["settings.permissionModeAsk", "settings.permissionModeAcceptEdits", "settings.permissionModeAuto"],
      "settings.executionDefaults": ["settings.defaultsTitle"],
      "settings.conversationDisplay": [],
      "settings.mode": [],
      "settings.commandShell": [],
      "settings.linkOpenTarget": [],
      "settings.enterToSend": [],
      "settings.infiniteProviderRetry": ["settings.infiniteProviderRetryDesc"],
      "settings.smoothStreaming": ["settings.smoothStreamingDesc"],
      "settings.thinkingDisplayMode": ["settings.thinkingDisplayDetailed", "settings.thinkingDisplayCompact"],
      "settings.contextUsageDisplay": ["settings.contextUsageDisplayRemaining", "settings.contextUsageDisplayUsed"],
      "settings.promptEnhancementTitle": ["settings.promptEnhancementDesc", "settings.promptEnhancementModelTitle", "settings.promptEnhancementThinking"],
      "settings.promptEnhancementCustomTemplate": ["settings.promptEnhancementEdit", "settings.promptEnhancementUserTemplate"],
      "settings.promptEnhancementModel": ["settings.promptEnhancementModelFollow"],
      "settings.largePasteThreshold": [],
    },
  },
  {
    id: "voice",
    labelKey: "liveVoice.title",
    titleKey: "liveVoice.title",
    group: "preferences",
    keywordKeys: [
      "liveVoice.title",
      "liveVoice.description",
      "liveVoice.enable",
      "liveVoice.provider",
      "liveVoice.model",
      "liveVoice.voice",
      "liveVoice.adapters.codex-live.title",
      "liveVoice.adapters.gemini-live.title",
      "liveVoice.adapters.openai-realtime.title",
    ],
    searchTargets: {
      "liveVoice.title": ["liveVoice.description", "liveVoice.model", "liveVoice.voice"],
      "liveVoice.enable": [],
      "liveVoice.provider": [],
      "liveVoice.adapters.codex-live.title": [],
      "liveVoice.adapters.gemini-live.title": [],
      "liveVoice.adapters.openai-realtime.title": [],
    },
  },
  {
    id: "shortcuts",
    labelKey: "settings.nav.shortcuts",
    titleKey: "settings.shortcuts",
    group: "preferences",
    keywordKeys: [
      "settings.keyboard",
      "settings.shortcutAction.openSearch",
      "settings.shortcutAction.openCommandPalette",
      "settings.shortcutAction.toggleSidebar",
      "settings.shortcutAction.openWorkPanel",
    ],
    searchTargets: {
      "settings.keyboard": ["settings.shortcutAction.openSearch", "settings.shortcutAction.openCommandPalette", "settings.shortcutAction.toggleSidebar", "settings.shortcutAction.openWorkPanel"],
    },
  },
  {
    id: "instructions",
    labelKey: "settings.nav.instructions",
    titleKey: "settings.instructions",
    group: "agent",
    keywordKeys: [
      "settings.instructionsGlobal",
      "settings.instructionsPath",
    ],
    searchTargets: { "settings.instructionsGlobal": ["settings.instructionsPath"] },
  },
  {
    id: "agent",
    labelKey: "settings.nav.models",
    titleKey: "settings.configuration",
    group: "agent",
    keywordKeys: [
      "settings.providers",
      "settings.models",
      "settings.defaultModel",
      "settings.imageModel",
      "settings.apiKey",
      "settings.baseUrl",
      "settings.apiStyle",
      // Subscription accounts share the service list (D625).
      "settings.vendorAccounts",
      "settings.vendorSubscription",
    ],
    searchTargets: {
      "settings.defaultModel": [],
      "settings.defaultsTitle": ["settings.imageModel"],
      "settings.providers": ["settings.models", "settings.apiKey", "settings.baseUrl", "settings.apiStyle", "settings.vendorAccounts", "settings.vendorSubscription"],
    },
  },
  {
    id: "skills",
    labelKey: "settings.nav.skills",
    titleKey: "settings.skills",
    group: "agent",
    keywordKeys: [
      "settings.skillsGlobalPath",
      "settings.skillsProjectPath",
      "settings.globalScopeDescription",
      "settings.projectScopeDescription",
      "settings.importSkill",
      "settings.capabilityFilterGlobal",
      "settings.capabilityFilterProject",
      "extensions.skills.add",
      "extensions.skills.edit",
      "extensions.skills.remove",
      "extensions.skills.reveal",
    ],
  },
  {
    id: "mcp",
    labelKey: "settings.nav.mcp",
    titleKey: "settings.mcp",
    group: "agent",
    keywordKeys: [
      "settings.mcpGlobalPath",
      "settings.mcpProjectPath",
      "settings.globalScopeDescription",
      "settings.projectScopeDescription",
      "settings.addMcp",
      "settings.editMcp",
      "settings.transport",
      "settings.capabilityFilterGlobal",
      "settings.capabilityFilterProject",
      "extensions.mcp.test",
      "extensions.mcp.remove",
      // T6.6：本机控制接口条带（设置搜索可直接命中 MCP 页）。
      "settings.mcpControl.title",
    ],
  },
  {
    id: "subagents",
    labelKey: "settings.nav.subagents",
    titleKey: "settings.subagents",
    group: "agent",
    keywordKeys: [
      "settings.subagentsGlobalPath",
      "settings.subagentsOnlyGlobal",
      "settings.globalScopeDescription",
      "extensions.subagents.add",
      "extensions.subagents.edit",
      "extensions.subagents.remove",
      "extensions.subagents.reveal",
      "extensions.subagents.copy",
      "extensions.subagents.sourceBuiltin",
      "extensions.subagents.presetExplorerName",
      "extensions.subagents.presetReviewerName",
      "extensions.subagents.presetTestRunnerName",
      "extensions.subagents.presetFixerName",
      "extensions.subagents.presetUiDesignerName",
      "extensions.subagents.tools",
    ],
  },
  {
    id: "expertTeam",
    labelKey: "settings.expertTeam.title",
    titleKey: "settings.expertTeam.title",
    group: "agent",
    keywordKeys: [
      "settings.expertTeam.builtinTitle",
      "settings.expertTeam.model",
      "settings.expertTeam.thinking",
      "settings.expertTeam.tools",
      "settings.expertTeam.instructions",
    ],
  },
  {
    id: "import",
    labelKey: "settings.nav.import",
    titleKey: "settings.import",
    group: "workspace",
    keywordKeys: [
      "settings.importTitle",
      "settings.importModelsTitle",
      "settings.importSourceClaudeCode",
      "settings.importSourceOpenCode",
      "settings.importSourceCodex",
      "settings.importSourcePi",
      "settings.importSourceCcSwitch",
    ],
  },
  {
    id: "projects",
    labelKey: "settings.nav.projects",
    titleKey: "settings.projectArchive",
    group: "workspace",
    keywordKeys: [
      "project.title",
      "project.searchPlaceholder",
      "project.archive",
      "project.restore",
      "project.delete",
    ],
  },
  {
    id: "memory",
    labelKey: "settings.nav.memory",
    titleKey: "settings.memory.title",
    group: "workspace",
    keywordKeys: [
      "settings.memory.projectsTitle",
      "project.autoMemoryToggle",
      "project.memoryAdd",
      "project.memoryRemove",
    ],
    searchTargets: {
      "settings.memory.projectsTitle": ["project.autoMemoryToggle", "project.memoryAdd", "project.memoryRemove"],
    },
  },
  {
    id: "sync",
    labelKey: "settings.nav.sync",
    titleKey: "settings.configSync.title",
    group: "system",
    developerOnly: true,
    developmentOnly: true,
    experimentalBadgeKey: "settings.configSync.experimental",
    keywordKeys: [
      "settings.configSync.connectionTitle",
      "settings.configSync.endpoint",
      "settings.configSync.statusTitle",
      "settings.configSync.categoriesTitle",
      "settings.configSync.approvalsTitle",
      "settings.configSync.syncNow",
    ],
    searchTargets: {
      "settings.configSync.connectionTitle": ["settings.configSync.endpoint"],
    },
  },
  {
    id: "remoteHosts",
    labelKey: "settings.nav.remoteHosts",
    titleKey: "settings.remoteHosts.title",
    group: "system",
    developerOnly: true,
    developmentOnly: true,
    experimentalBadgeKey: "settings.remoteHosts.experimental",
    keywordKeys: [
      "settings.remoteHosts.title",
      "settings.remoteHosts.addTitle",
      "settings.remoteHosts.addSsh",
      "settings.remoteHosts.addPair",
      "settings.remoteHosts.pair",
      "settings.remoteHosts.fieldUrl",
      "settings.remoteHosts.fieldPairingToken",
      "settings.remoteHosts.sshHost",
      "settings.remoteHosts.sshAuthMode",
      "settings.remoteHosts.sshPassword",
      "settings.remoteHosts.statusOnline",
      "settings.remoteHosts.statusOffline",
      "settings.remoteHosts.experimental",
    ],
    searchTargets: {
      "settings.remoteHosts.addTitle": ["settings.remoteHosts.addSsh", "settings.remoteHosts.addPair", "settings.remoteHosts.pair", "settings.remoteHosts.fieldUrl", "settings.remoteHosts.fieldPairingToken", "settings.remoteHosts.sshHost", "settings.remoteHosts.sshAuthMode", "settings.remoteHosts.sshPassword"],
    },
  },
  {
    id: "about",
    labelKey: "settings.nav.info",
    titleKey: "settings.about",
    group: "system",
    keywordKeys: [
      "settings.application",
      "settings.logs",
      "settings.feedback",
      "updates.title",
      "updates.preferenceTitle",
      "settings.developer",
      "settings.developerMode",
      "settings.devTools",
    ],
    searchTargets: {
      "settings.application": [],
      "settings.logs": [],
      "settings.feedback": [],
      "updates.title": [],
      "updates.preferenceTitle": [],
      "settings.developer": [],
      "settings.developerMode": [],
      "settings.devTools": [],
    },
  },
];

/**
 * Destinations the current mode offers. Unavailable destinations are omitted
 * from navigation and search rather than disabled.
 */
export function visibleSettingsNav(
  developerMode: boolean,
  includeDevelopmentOnly = true,
): SettingsNavEntry[] {
  return SETTINGS_NAV.filter(
    (entry) =>
      (entry.developerOnly !== true || developerMode) &&
      (entry.developmentOnly !== true || includeDevelopmentOnly),
  );
}

/** True when a stale selection points to a destination the current mode hides. */
export function isSettingsDestinationHidden(
  tab: SettingsTabId,
  developerMode: boolean,
  includeDevelopmentOnly = true,
): boolean {
  return !visibleSettingsNav(developerMode, includeDevelopmentOnly).some(
    (entry) => entry.id === tab,
  );
}

export type SettingsSearchHit = {
  tab: SettingsTabId;
  tabLabelKey: string;
  /** Visible row/card title; null for a category match or a dynamic target. */
  rowKey: string | null;
};

export type SettingsSearchOptions = {
  limit?: number;
  /** Search mirrors the rail, so developer-only tabs stay out of results. */
  developerMode?: boolean;
  /** Packaged builds omit experimental surfaces, even with developer mode on. */
  includeDevelopmentOnly?: boolean;
};

export function searchSettings(
  query: string,
  t: (key: string) => string,
  {
    limit = 8,
    developerMode = false,
    includeDevelopmentOnly = true,
  }: SettingsSearchOptions = {},
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SettingsSearchHit[] = [];
  for (const entry of visibleSettingsNav(developerMode, includeDevelopmentOnly)) {
    const categoryLabels = [t(entry.labelKey), t(entry.titleKey)].map((label) => label.trim().toLowerCase());
    const targets = new Set<string | null>();
    if (categoryLabels.some((label) => label.includes(q))) targets.add(null);
    for (const key of entry.keywordKeys) {
      if (t(key).toLowerCase().includes(q)) {
        // Dialog fields, option names, and help copy are searchable, but they
        // are not scroll anchors. Only known visible titles can be targets.
        const rowKey = Object.entries(entry.searchTargets ?? {}).find(
          ([title, aliases]) => title === key || aliases.includes(key),
        )?.[0] ?? null;
        targets.add(rowKey && !categoryLabels.includes(t(rowKey).trim().toLowerCase()) ? rowKey : null);
      }
    }
    for (const rowKey of targets) {
      hits.push({ tab: entry.id, tabLabelKey: entry.labelKey, rowKey });
    }
  }
  return hits.slice(0, limit);
}
