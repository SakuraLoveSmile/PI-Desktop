import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ThinkingLevel } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { thinkingLevelForProvider } from "./Composer";
import { ModelSelect } from "./ModelSelect";
import {
  IconSidebar,
  IconNewSession,
  IconSearch,
  IconSliders,
  IconSettings,
} from "./icons";

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      value as ThinkingLevel,
    )
  );
}

function projectName(path?: string | null, name?: string | null) {
  if (name) return name;
  if (!path) return null;
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function isDefaultSessionTitle(title?: string | null) {
  const trimmed = (title || "").trim().toLowerCase();
  if (!trimmed) return true;
  return ["new task", "new chat", "新建任务", "新对话"].includes(trimmed);
}

export function ConversationTopbar({
  sidebarCollapsed,
  workPanelOpen,
  onToggleSidebar,
  onNewTask,
  onOpenSearch,
  onOpenCommandPalette,
  onOpenSettings,
}: {
  sidebarCollapsed: boolean;
  workPanelOpen: boolean;
  onToggleSidebar: () => void;
  onNewTask: () => void;
  onOpenSearch: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const runningSessions = useAppStore((s) => s.runningSessions);
  const isRunning = useAppStore((s) => s.isRunning);
  const workspace = useAppStore((s) => s.workspace);
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const showToast = useAppStore((s) => s.showToast);

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const mode = activeSession?.mode ?? settings?.defaultMode ?? "agent";
  const provider = providers.find(
    (candidate) =>
      candidate.id === (activeSession?.providerId ?? settings?.defaultProviderId),
  );
  const modelId =
    activeSession?.modelId ?? settings?.defaultModelId ?? provider?.defaultModelId;
  const thinkingLevel: ThinkingLevel = isThinkingLevel(activeSession?.thinkingLevel)
    ? activeSession!.thinkingLevel
    : "off";

  const taskTitle = isDefaultSessionTitle(activeSession?.title)
    ? t("chat.untitledTask")
    : activeSession?.title || t("chat.untitledTask");
  const project = projectName(workspace?.path, workspace?.name);
  const sessionRunning = Boolean(activeSessionId && runningSessions[activeSessionId]);
  const busy = isRunning || sessionRunning;

  const setMode = useCallback(
    async (next: "chat" | "agent") => {
      if (busy) return;
      try {
        await configureActiveSession({
          mode: next,
          providerId: provider?.id,
          modelId,
          thinkingLevel: thinkingLevelForProvider(provider, thinkingLevel),
        });
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
      }
    },
    [busy, configureActiveSession, provider, modelId, thinkingLevel, showToast],
  );

  return (
    <div
      className={`conversation-topbar${sidebarCollapsed ? " ct-collapsed" : ""}${
        workPanelOpen ? " ct-work-panel-open" : ""
      }`}
      role="toolbar"
      aria-label={t("nav.conversation")}
    >
      <div className="ct-left">
        {sidebarCollapsed ? (
          <button
            type="button"
            className="ct-icon-btn"
            title={t("nav.toggleSidebar")}
            aria-label={t("nav.toggleSidebar")}
            onClick={onToggleSidebar}
          >
            <IconSidebar size={15} />
          </button>
        ) : null}
        <div className="ct-title-wrap" title={project ? `${project} · ${taskTitle}` : taskTitle}>
          {project ? <span className="ct-project">{project}</span> : null}
          <span className="ct-title">{taskTitle}</span>
        </div>
        {busy ? (
          <span className="ct-running" title={t("chat.running")}>
            <span className="ct-running-dot" aria-hidden />
            <span>{t("chat.running")}</span>
          </span>
        ) : null}
      </div>

      <div className="ct-right">
        <div className="ct-mode" role="group" aria-label={t("settings.mode")}>
          <button
            type="button"
            className={`ct-mode-btn ${mode === "chat" ? "active" : ""}`}
            aria-pressed={mode === "chat"}
            disabled={busy}
            onClick={() => void setMode("chat")}
          >
            {t("settings.modeChat")}
          </button>
          <button
            type="button"
            className={`ct-mode-btn ${mode === "agent" ? "active" : ""}`}
            aria-pressed={mode === "agent"}
            disabled={busy}
            onClick={() => void setMode("agent")}
          >
            {t("settings.modeAgent")}
          </button>
        </div>

        <ModelSelect />

        <div className="ct-actions">
          <button
            type="button"
            className="ct-icon-btn"
            title={t("nav.newTask")}
            aria-label={t("nav.newTask")}
            onClick={onNewTask}
          >
            <IconNewSession size={15} />
          </button>
          <button
            type="button"
            className="ct-icon-btn"
            title={t("nav.search")}
            aria-label={t("nav.search")}
            onClick={onOpenSearch}
          >
            <IconSearch size={15} />
          </button>
          <button
            type="button"
            className="ct-icon-btn"
            title={t("nav.commandPalette")}
            aria-label={t("nav.commandPalette")}
            onClick={onOpenCommandPalette}
          >
            <IconSliders size={15} />
          </button>
          <button
            type="button"
            className="ct-icon-btn"
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
            onClick={onOpenSettings}
          >
            <IconSettings size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
