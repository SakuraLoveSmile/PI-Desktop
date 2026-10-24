import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AppSettings,
  GlobalPermissionMode,
  PluginScenicThemesDestinationMeta,
  ShortcutPlatform,
} from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import {
  isSettingsDestinationHidden,
  visibleSettingsNav,
} from "../../lib/settings-search";
import { Badge, Button, SegmentedControl, SettingsToggle } from "../../components/ui";
import { SettingsNavigation } from "./SettingsNavigation";
import { ModelConfigPage } from "../../components/settings/ModelConfigPage";
import { KeyboardShortcutsSection } from "../../components/settings/KeyboardShortcutsSection";
import { FontFamilyRow } from "../../components/settings/FontFamilyRow";
import { ThinkingDisplayModeRow } from "../../components/settings/ThinkingDisplayModeRow";
import { FontSizeRow } from "../../components/settings/FontSizeRow";
import { LanguageRow } from "../../components/settings/LanguageRow";
import { SettingsMenuSelect } from "../../components/settings/SettingsMenuSelect";
import { ThemeRow } from "../../components/settings/ThemeRow";
import { NetworkProxySection } from "../../components/settings/NetworkProxySection";
import { ProjectsPage } from "../../pages/ProjectsPage";
import { AgentSkillsPage } from "../../components/settings/AgentSkillsPage";
import { AgentMcpPage } from "../../components/settings/AgentMcpPage";
import { AgentSubagentsPage } from "../../components/settings/AgentSubagentsPage";
import { RemoteHostsPage } from "../../components/settings/RemoteHostsPage";
import { VoiceSettingsSection } from "./voice/VoiceSettingsSection";
import {
  CommandShellRow,
  ContextUsageDisplayRow,
  LargePasteThresholdRow,
  LinkOpenTargetRow,
  SettingsCard,
  SettingsRow,
} from "./primitives";
import { AgentInstructionsSection, UpdatesRow } from "./agent-sections";
import { ImportSection } from "./import-page";
import { PromptEnhancementCard } from "./prompt-enhancement-card";
import { AdvisorCard } from "./advisor-card";
import { CloseBehaviorSection, DeveloperSection } from "./developer-sections";
import { PluginScenicThemesDestination } from "../../components/settings/PluginScenicThemesDestination";
import { ConfigSyncPage } from "../../components/settings/ConfigSyncPage";
import { StorageSettingsSection } from "./StorageSettingsSection";
import { ExpertTeamSettingsPage } from "./ExpertTeamSettingsPage";
import { MemorySettingsPage } from "./MemorySettingsPage";

export function SettingsPage() {
  const { t } = useTranslation();
  const tab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const settingsAnchor = useAppStore((s) => s.settingsAnchor);
  const settingsTabNonce = useAppStore((s) => s.settingsTabNonce);
  const setSettingsAnchor = useAppStore((s) => s.setSettingsAnchor);
  const setPage = useAppStore((s) => s.setPage);
  const settings = useAppStore((s) => s.settings);
  const version = useAppStore((s) => s.version);
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const activeSession = useAppStore((s) =>
    s.sessions.find((item) => item.id === s.activeSessionId),
  );
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const platform = (window.piDesktop?.platform ?? "darwin") as ShortcutPlatform;

  // Experimental feature surfaces remain available in development builds only.
  const includeDevelopmentOnly = import.meta.env.DEV;
  const developerMode = settings?.developerMode === true;
  const navEntries = useMemo(
    () => visibleSettingsNav(developerMode, includeDevelopmentOnly),
    [developerMode, includeDevelopmentOnly],
  );
  const tabHidden = isSettingsDestinationHidden(
    tab,
    developerMode,
    includeDevelopmentOnly,
  );

  const [recoveringSettings, setRecoveringSettings] = useState(!settings);
  const [settingsRecoveryFailed, setSettingsRecoveryFailed] = useState(false);
  const [extensions, setExtensions] = useState<PluginScenicThemesDestinationMeta[]>([]);
  const [activeExtension, setActiveExtension] = useState<PluginScenicThemesDestinationMeta | null>(null);
  const seenSettingsTabNonce = useRef(settingsTabNonce);
  // setSettingsTab means "show this built-in category", even when the tab id
  // does not change. Dismiss a plugin page before paint; an anchor-only deep
  // link has to do the same or the row lookup hits the plugin instead.
  if (
    seenSettingsTabNonce.current !== settingsTabNonce ||
    (activeExtension && settingsAnchor)
  ) {
    seenSettingsTabNonce.current = settingsTabNonce;
    if (activeExtension) setActiveExtension(null);
  }
  const contentRef = useRef<HTMLDivElement>(null);
  const destination = activeExtension ? `extension:${activeExtension.ref}` : `builtin:${tab}`;

  useLayoutEffect(() => {
    // Reset before paint and before the search-anchor effect positions its row.
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [destination]);

  useEffect(() => {
    const refresh = () => void api.listPluginScenicThemesDestinations().then(setExtensions, () => setExtensions([]));
    refresh();
    return api.onPluginChanged(refresh);
  }, []);

  useEffect(() => {
    if (activeExtension && !extensions.some((entry) => entry.ref === activeExtension.ref)) {
      setActiveExtension(null);
      setSettingsTab("general");
    }
  }, [activeExtension, extensions, setSettingsTab]);

  // A hidden destination must not keep rendering: leave the page the rail no
  // longer offers (for example Cloud sync or Remote Hosts after developer mode
  // is switched off) and fall back to General.
  useEffect(() => {
    if (!settings || !tabHidden) return;
    setSettingsTab("general");
  }, [settings, tabHidden, setSettingsTab]);

  const recoverSettings = useCallback(async () => {
    setRecoveringSettings(true);
    setSettingsRecoveryFailed(false);
    try {
      const recovered = await api.getSettings();
      useAppStore.setState({ settings: recovered });
    } catch {
      setSettingsRecoveryFailed(true);
    } finally {
      setRecoveringSettings(false);
    }
  }, []);

  useEffect(() => {
    if (settings) return;
    void recoverSettings();
  }, [settings, recoverSettings]);

  // Arriving from the global search dialog: scroll to and flash the row
  // whose title matches the pending anchor key. This runs after the
  // destination reset and before paint, so a category change does not flash
  // the top. Rows are located by their translated title so async tab content
  // (providers, import) needs no per-row wiring; a short retry window covers
  // late mounts.
  useLayoutEffect(() => {
    if (!settingsAnchor) return;
    const target = t(settingsAnchor).trim();
    let cancelled = false;
    let timer: number | undefined;
    const tryFind = (attempt: number) => {
      if (cancelled) return;
      const titles = document.querySelectorAll<HTMLElement>(
        ".settings-content .settings-row-title, .settings-content .settings-card-heading",
      );
      const match = [...titles].find(
        (node) => node.textContent?.trim() === target,
      );
      if (match) {
        const row =
          match.closest<HTMLElement>(".settings-row") ??
          match.closest<HTMLElement>(".settings-card-block") ??
          match;
        row.scrollIntoView({ block: "center" });
        row.classList.add("settings-anchor-flash");
        window.setTimeout(
          () => row.classList.remove("settings-anchor-flash"),
          1800,
        );
        setSettingsAnchor(null);
        return;
      }
      if (attempt < 8) timer = window.setTimeout(() => tryFind(attempt + 1), 120);
      else setSettingsAnchor(null);
    };
    tryFind(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [settingsAnchor, tab, t, setSettingsAnchor]);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed" | "refreshFailed">("idle");
  const saveGeneration = useRef(0);
  const [refreshingSavedSettings, setRefreshingSavedSettings] = useState(false);
  const refreshSavedSettings = async (generation: number) => {
    const confirmedSettings = await api.getSettings();
    if (generation !== saveGeneration.current) return;
    useAppStore.setState({ settings: confirmedSettings });
    await refreshProviders();
  };
  const saveSettings = async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    const generation = ++saveGeneration.current;
    setSaveState("saving");
    setRefreshingSavedSettings(false);
    try {
      await api.setSettings(patch);
    } catch (error) {
      if (generation === saveGeneration.current) setSaveState("failed");
      throw error;
    }
    try {
      await refreshSavedSettings(generation);
      if (generation === saveGeneration.current) setSaveState("saved");
    } catch {
      // Persistence already succeeded. A failed read must never ask users to
      // save again or make an explicit editor retain a false failure state.
      if (generation === saveGeneration.current) setSaveState("refreshFailed");
    }
  };
  const savePreference = async (patch: Partial<AppSettings>) => {
    try { await saveSettings(patch); }
    catch { /* The page's persistent save status reports this failure. */ }
  };

  const selectPluginTheme = async (theme: string) => {
    await saveSettings({ theme: theme as AppSettings["theme"] });
  };

  const activeNavItem = navEntries.find((item) => item.id === tab);
  const activeTitleKey = activeNavItem?.titleKey ?? "settings.title";
  const tabNeedsSettings = ["general", "ai", "shortcuts", "agent", "expertTeam"].includes(tab);

  return (
    <div className="settings-shell settings-shell-full">
      <div className="settings-titlebar" aria-hidden="true" />
      <SettingsNavigation
        entries={navEntries}
        tab={tab}
        developerMode={developerMode}
        includeDevelopmentOnly={includeDevelopmentOnly}
        extensions={extensions}
        activeExtension={activeExtension}
        onSelect={(nextTab, rowKey) => {
          setActiveExtension(null);
          setSettingsTab(nextTab);
          setSettingsAnchor(rowKey);
        }}
        onSelectExtension={setActiveExtension}
        onBack={() => setPage("chat")}
      />

      <div className="settings-content" ref={contentRef}>
        <div className="settings-content-inner">
          <div className="settings-content-enter">
          <h1 className="settings-section-title">
            <span>{activeExtension?.label ?? t(activeTitleKey)}</span>
            {!activeExtension && activeNavItem?.experimentalBadgeKey ? (
              <Badge tone="warning">{t(activeNavItem.experimentalBadgeKey)}</Badge>
            ) : null}
          </h1>
          {saveState !== "idle" && <div className={`settings-save-feedback is-${saveState}`} role={saveState === "failed" ? "alert" : "status"}>
            <span>{t(`settings.saveState.${saveState}`)}</span>
            {saveState === "refreshFailed" && <Button size="sm" disabled={refreshingSavedSettings} onClick={() => {
              const generation = ++saveGeneration.current;
              setRefreshingSavedSettings(true);
              void refreshSavedSettings(generation).then(
                () => { if (generation === saveGeneration.current) setSaveState("saved"); },
                () => { if (generation === saveGeneration.current) setSaveState("refreshFailed"); },
              ).finally(() => { if (generation === saveGeneration.current) setRefreshingSavedSettings(false); });
            }}>{t("settings.configSync.retry")}</Button>}
          </div>}

          {activeExtension ? (
            <PluginScenicThemesDestination destination={activeExtension} selectTheme={selectPluginTheme} />
          ) : <>

          {tabNeedsSettings && !settings ? (
            <div className="settings-recovery" role="status" aria-live="polite">
              {recoveringSettings ? (
                <>
                  <span className="route-pending-indicator" aria-hidden />
                  <span>{t("common.loading")}</span>
                </>
              ) : settingsRecoveryFailed ? (
                <>
                  <span>{t("errors.HOST_UNAVAILABLE")}</span>
                  <Button variant="secondary" onClick={() => void recoverSettings()}>
                    {t("errors.action.retry")}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "general" && settings && (
            <div className="settings-stack">
              <SettingsCard title={t("settings.appearance")}>
                <ThemeRow settings={settings} saveSettings={savePreference} />
                <LanguageRow settings={settings} saveSettings={savePreference} />
                <FontFamilyRow settings={settings} saveSettings={saveSettings} />
                <FontSizeRow settings={settings} saveSettings={savePreference} />
              </SettingsCard>

              <SettingsCard title={t("settings.power")}>
                <SettingsRow
                  title={t("settings.keepAwakeWhileRunning")}
                  description={t("settings.keepAwakeWhileRunningDesc")}
                >
                  <SettingsToggle
                    checked={settings.keepAwakeWhileRunning === true}
                    label={t("settings.keepAwakeWhileRunning")}
                    onChange={() => void savePreference({
                      keepAwakeWhileRunning: settings.keepAwakeWhileRunning !== true,
                    })}
                  />
                </SettingsRow>
                <SettingsRow
                  title={t("settings.preventScreenSleep")}
                  description={t("settings.preventScreenSleepDesc")}
                >
                  <SettingsToggle
                    checked={settings.preventScreenSleep === true}
                    label={t("settings.preventScreenSleep")}
                    onChange={() => void savePreference({ preventScreenSleep: !settings.preventScreenSleep })}
                  />
                </SettingsRow>
              </SettingsCard>

              {platform !== "darwin" && <CloseBehaviorSection />}
              <NetworkProxySection settings={settings} saveSettings={saveSettings} />
              <StorageSettingsSection />
            </div>
          )}

          {tab === "ai" && settings && (
            <div className="settings-stack">
              <SettingsCard title={t("settings.permissions")}>
                <SettingsRow
                  title={t("settings.permissionMode")}
                  description={t("settings.permissionModeDesc")}
                >
                  <SettingsMenuSelect
                    className="settings-permission-select"
                    label={t("settings.permissionMode")}
                    value={settings.defaultPermissionMode ?? "ask"}
                    onChange={(mode) =>
                      void savePreference({
                        defaultPermissionMode: mode as GlobalPermissionMode,
                      })
                    }
                    options={[
                      { id: "ask", label: t("settings.permissionModeAsk") },
                      {
                        id: "accept-edits",
                        label: t("settings.permissionModeAcceptEdits"),
                      },
                      { id: "auto", label: t("settings.permissionModeAuto") },
                    ]}
                  />
                </SettingsRow>
                {activeSession ? (
                  <SettingsRow
                    title={t("settings.activeSessionPermission", "Active session override")}
                    detail={t(activeSession.permissionMode && activeSession.permissionMode !== "inherit"
                      ? "settings.activeSessionOverrideState" : "settings.activeSessionInheritState")}
                    description={
                      activeSession.permissionMode && activeSession.permissionMode !== "inherit"
                        ? t(
                            "settings.activeSessionOverrideDesc",
                            "Current session has an explicit override. Reset to use the global default.",
                          )
                        : t(
                            "settings.activeSessionInheritDesc",
                            "Current session inherits the global default.",
                          )
                    }
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="text-sm text-secondary">
                        {t(
                          `settings.permissionMode${
                            activeSession.permissionMode === "auto"
                              ? "Auto"
                              : activeSession.permissionMode === "accept-edits"
                                ? "AcceptEdits"
                                : activeSession.permissionMode === "ask"
                                  ? "Ask"
                                  : (settings.defaultPermissionMode === "auto"
                                      ? "Auto"
                                      : settings.defaultPermissionMode === "accept-edits"
                                        ? "AcceptEdits"
                                        : "Ask")
                          }`,
                        )}
                        {(!activeSession.permissionMode || activeSession.permissionMode === "inherit") && (
                          <span className="text-xs text-muted" style={{ marginLeft: 4 }}>
                            ({t("chat.permissionInherit", "Default")})
                          </span>
                        )}
                      </span>
                      {activeSession.permissionMode && activeSession.permissionMode !== "inherit" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            void configureActiveSession({
                              mode: activeSession.mode,
                              providerId: activeSession.providerId,
                              modelId: activeSession.modelId,
                              thinkingLevel: activeSession.thinkingLevel,
                              permissionMode: "inherit",
                              executionProfile: activeSession.executionProfile,
                            });
                          }}
                        >
                          {t("settings.resetToInherit", "Reset to default")}
                        </Button>
                      )}
                    </div>
                  </SettingsRow>
                ) : null}
              </SettingsCard>

              <SettingsCard title={t("settings.executionDefaults")}>
                <SettingsRow title={t("settings.mode")} description={t("settings.modeDesc")}>
                  <SegmentedControl
                    value={settings.defaultMode ?? "agent"}
                    onChange={(value) => void savePreference({ defaultMode: value })}
                    options={[
                      { value: "agent", label: t("settings.modeAgent") },
                      { value: "plan", label: t("settings.modePlan") },
                      { value: "goal", label: t("settings.modeGoal") },
                    ]}
                    label={t("settings.mode")}
                    role="group"
                  />
                </SettingsRow>
                <CommandShellRow settings={settings} saveSettings={saveSettings} />
                <SettingsRow
                  title={t("settings.infiniteProviderRetry")}
                  description={t("settings.infiniteProviderRetryDesc")}
                >
                  <SettingsToggle
                    checked={settings.infiniteProviderRetry === true}
                    label={t("settings.infiniteProviderRetry")}
                    onChange={() => void savePreference({ infiniteProviderRetry: settings.infiniteProviderRetry !== true })}
                  />
                </SettingsRow>
              </SettingsCard>

              <SettingsCard title={t("settings.conversationDisplay")}>
                <LinkOpenTargetRow settings={settings} saveSettings={savePreference} />
                <ThinkingDisplayModeRow settings={settings} saveSettings={savePreference} />
                <ContextUsageDisplayRow
                  settings={settings}
                  saveSettings={savePreference}
                />
                <SettingsRow
                  title={t("settings.enterToSend")}
                  description={t("settings.enterToSendDesc")}
                >
                  <SettingsToggle
                    checked={settings.enterToSend}
                    label={t("settings.enterToSend")}
                    onChange={() => void savePreference({ enterToSend: !settings.enterToSend })}
                  />
                </SettingsRow>

                <SettingsRow
                  title={t("settings.autoGenerateSessionTitles")}
                  description={t("settings.autoGenerateSessionTitlesDesc")}
                >
                  <SettingsToggle
                    checked={settings.autoGenerateSessionTitles !== false}
                    label={t("settings.autoGenerateSessionTitles")}
                    onChange={() =>
                      void savePreference({
                        autoGenerateSessionTitles:
                          !(settings.autoGenerateSessionTitles !== false),
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  title={t("settings.smoothStreaming")}
                  description={t("settings.smoothStreamingDesc")}
                >
                  <SettingsToggle
                    checked={settings.smoothStreaming !== false}
                    label={t("settings.smoothStreaming")}
                    onChange={() => void savePreference({ smoothStreaming: !(settings.smoothStreaming !== false) })}
                  />
                </SettingsRow>
                <LargePasteThresholdRow
                  settings={settings}
                  saveSettings={savePreference}
                />
              </SettingsCard>

              <PromptEnhancementCard
                settings={settings}
                saveSettings={saveSettings}
              />

              <AdvisorCard
                settings={settings}
                saveSettings={saveSettings}
              />
            </div>
          )}

          {tab === "voice" && !tabHidden && settings && (
            <VoiceSettingsSection
              t={t}
              settings={settings}
              saveSettings={saveSettings}
            />
          )}

          {tab === "shortcuts" && settings && (
            <div className="settings-stack">
              <KeyboardShortcutsSection
                settings={settings}
                platform={platform}
                saveSettings={saveSettings}
              />
            </div>
          )}

          {tab === "agent" && <ModelConfigPage />}

          {tab === "skills" && <AgentSkillsPage />}

          {tab === "mcp" && <AgentMcpPage />}

          {tab === "subagents" && <AgentSubagentsPage />}

          {tab === "instructions" && <AgentInstructionsSection />}

          {tab === "import" && <ImportSection />}

          {tab === "expertTeam" && settings && <ExpertTeamSettingsPage />}
          {tab === "projects" && <ProjectsPage />}
          {tab === "memory" && <MemorySettingsPage />}

          {tab === "sync" && !tabHidden && <ConfigSyncPage />}

          {tab === "remoteHosts" && !tabHidden && <RemoteHostsPage />}

          {tab === "about" && (
            <div className="settings-stack">
              <SettingsCard title={t("settings.applicationSupport")}>
                <SettingsRow title={t("settings.application")}>
                  <div className="settings-about-meta">
                    <div className="font-medium">
                      {version?.name || "Pi-Desktop-Plus"} {version?.version}
                    </div>
                    <details className="settings-technical-details">
                      <summary>{t("settings.technicalDetails")}</summary>
                      <span>{t("settings.protocolVersion", { version: version?.protocolVersion ?? "—" })}</span>
                      <span>{t("settings.hostVersion", { version: version?.hostVersion ?? "—" })}</span>
                    </details>
                  </div>
                </SettingsRow>
                <SettingsRow title={t("settings.logs")}>
                  <Button variant="secondary" onClick={() => void api.openLogs()}>
                    {t("settings.openLogs")}
                  </Button>
                </SettingsRow>
                <SettingsRow
                  title={t("settings.feedback")}
                  description={t("settings.feedbackDesc")}
                >
                  <Button
                    variant="secondary"
                    onClick={() => void api.openFeedback().catch(() => undefined)}
                  >
                    {t("settings.openFeedback")}
                  </Button>
                </SettingsRow>
              </SettingsCard>
              <SettingsCard title={t("settings.softwareUpdates")}>
                <UpdatesRow
                  currentVersion={version?.version}
                  settings={settings ?? null}
                  saveSettings={saveSettings}
                />
              </SettingsCard>

              {settings && (
                <DeveloperSection settings={settings} saveSettings={saveSettings} />
              )}
            </div>
          )}
          </>}

          </div>
        </div>
      </div>
    </div>
  );
}
