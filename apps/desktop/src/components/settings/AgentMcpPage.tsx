import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GLOBAL_SCOPE,
  type AgentCapabilityLevel,
  type McpServerRecord,
  type McpServerStatus,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import {
  AgentCapabilityColumn,
  AgentProjectPicker,
  CapabilityButton,
  CapabilityEmpty,
  CapabilityToggle,
  projectDisplayName,
  useAgentProjects,
} from "./AgentCapabilityLayout";
import {
  draftFromRecord,
  emptyMcpDraft,
  McpEditorSheet,
  type McpDraft,
  draftToInput,
} from "../extensions/McpEditorSheet";
import { IconPencil, IconPlus, IconServer, IconTerminal } from "../icons";
import { cx } from "../ui";

const GLOBAL_MCP_PATH = "~/.agents/servers";

function projectMcpPath(projectPath: string | null): string {
  return projectPath ? `${projectPath}/.agents/servers` : "<project-root>/.agents/servers";
}

function statusFor(
  statuses: readonly McpServerStatus[],
  server: McpServerRecord,
): McpServerStatus | undefined {
  return statuses.find((status) => status.serverId === server.id);
}

function McpRow({
  server,
  status,
  onEdit,
  onToggle,
  busy,
  disabled,
}: {
  server: McpServerRecord;
  status?: McpServerStatus;
  onEdit: () => void;
  onToggle: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const name = server.label || server.id;
  const target = server.transport === "http" ? server.url : server.command;
  return (
    <div className={cx("agent-capability-row", !server.enabled && "is-off")} role="listitem">
      <span className={cx("agent-capability-glyph", status && `is-${status.state}`)} aria-hidden="true">
        {server.transport === "http" ? <IconServer size={16} /> : <IconTerminal size={16} />}
      </span>
      <div className="agent-capability-copy">
        <div className="agent-capability-row-title">
          <span className="agent-capability-name">{name}</span>
          <span className="agent-capability-badge">
            {server.transport === "http"
              ? t("settings.transportHttp")
              : t("settings.transportStdio")}
          </span>
          {status && status.state !== "idle" ? (
            <span className={cx("agent-capability-badge", `is-${status.state}`)}>
              {status.state === "ready"
                ? t("extensions.mcp.toolCount", { count: status.toolCount })
                : t(`extensions.mcp.state.${status.state}`)}
            </span>
          ) : null}
        </div>
        <code className="agent-capability-command">{target || server.id}</code>
        <p className="agent-capability-description">
          {server.description || t("settings.noCapabilityDescription")}
        </p>
      </div>
      <div className="agent-capability-row-actions">
        <button
          type="button"
          className="plugins-icon-btn agent-capability-edit"
          aria-label={t("settings.editMcpOf", { name })}
          title={t("settings.editMcp")}
          disabled={disabled || busy}
          onClick={onEdit}
        >
          <IconPencil size={15} />
        </button>
        <CapabilityToggle
          checked={server.enabled}
          busy={busy}
          label={t("settings.toggleCapability", { name })}
          onChange={onToggle}
        />
      </div>
    </div>
  );
}

export function AgentMcpPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const { selectedProjectPath, setSelectedProjectPath, options } = useAgentProjects();
  const [globalServers, setGlobalServers] = useState<McpServerRecord[]>([]);
  const [projectServers, setProjectServers] = useState<McpServerRecord[]>([]);
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    draft: McpDraft;
    editing: McpServerRecord | null;
    level: AgentCapabilityLevel;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [global, project] = await Promise.all([
        api.listMcpServers({
          level: "global",
          ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
        }),
        selectedProjectPath
          ? api.listMcpServers({ level: "project", projectPath: selectedProjectPath })
          : Promise.resolve({ servers: [] as McpServerRecord[], statuses: [] as McpServerStatus[] }),
      ]);
      setGlobalServers(global.servers ?? []);
      setProjectServers(project.servers ?? []);
      setStatuses([...(global.statuses ?? []), ...(project.statuses ?? [])]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
      setGlobalServers([]);
      setProjectServers([]);
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectPath, showToast]);

  useEffect(() => {
    void load();
    const offPluginChanged = api.onPluginChanged(() => void load());
    const offHostStatus = api.onHostStatus((status) => {
      if (status.ok) void load();
    });
    return () => {
      offPluginChanged();
      offHostStatus();
    };
  }, [load]);

  const openCreate = (level: AgentCapabilityLevel) => {
    if (level === "project" && !selectedProjectPath) {
      showToast(t("settings.selectProjectFirst"), { variant: "error" });
      return;
    }
    setEditor({
      draft: {
        ...emptyMcpDraft(),
        scope:
          level === "global"
            ? GLOBAL_SCOPE
            : { mode: "projects", projects: [selectedProjectPath!] },
      },
      editing: null,
      level,
    });
  };

  const openEdit = (server: McpServerRecord, level: AgentCapabilityLevel) => {
    setEditor({ draft: draftFromRecord(server), editing: server, level });
  };

  const save = async () => {
    if (!editor) return;
    const projectPath = editor.level === "project" ? selectedProjectPath ?? undefined : undefined;
    const candidateId = editor.draft.id.trim();
    const candidateLabel = editor.draft.label.trim().toLocaleLowerCase();
    const sameLevel = (editor.level === "global" ? globalServers : projectServers).some(
      (server) =>
        server.id !== editor.editing?.id &&
        (server.id === candidateId ||
          (!!candidateLabel && server.label.trim().toLocaleLowerCase() === candidateLabel)),
    );
    if (sameLevel) {
      showToast(t("settings.mcpDuplicate"), { variant: "error" });
      return;
    }
    setBusyKey("save");
    try {
      await api.upsertMcpServer(
        draftToInput(editor.draft, { level: editor.level, projectPath }),
      );
      await load();
      showToast(
        t(editor.editing ? "settings.mcpSaved" : "settings.mcpAdded", {
          name: editor.draft.label || editor.draft.id,
        }),
        { variant: "success" },
      );
      setEditor(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  const toggle = async (server: McpServerRecord, level: AgentCapabilityLevel) => {
    const key = `${level}:${server.id}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await api.setMcpServerEnabled(server.id, !server.enabled, {
        level,
        ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
      });
      await load();
      showToast(
        t(server.enabled ? "settings.capabilityDisabled" : "settings.capabilityEnabled", {
          name: server.label || server.id,
        }),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  const testConnection = async () => {
    if (!editor?.editing || testingId) return;
    const serverId = editor.editing.id;
    setTestingId(serverId);
    try {
      const result = await api.testMcpServer(serverId, {
        level: editor.level,
        ...(editor.level === "project" && selectedProjectPath
          ? { projectPath: selectedProjectPath }
          : {}),
      });
      setStatuses((current) => [
        ...current.filter((status) => status.serverId !== serverId),
        result.status,
      ]);
      if (result.status.state === "ready") {
        showToast(t("extensions.mcp.testReady", { count: result.status.toolCount }), {
          variant: "success",
        });
      } else if (result.status.state === "failed") {
        showToast(result.status.message || t("extensions.mcp.testFailed"), {
          variant: "error",
        });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setTestingId(null);
    }
  };

  const renderRows = (rows: readonly McpServerRecord[], level: AgentCapabilityLevel) =>
    rows.length === 0 ? (
      <CapabilityEmpty message={t("settings.mcpEmpty")} icon={<IconServer size={18} />} />
    ) : (
      rows.map((server) => (
        <McpRow
          key={server.id}
          server={server}
          status={statusFor(statuses, server)}
          busy={loading || busyKey !== null}
          disabled={loading || busyKey !== null}
          onEdit={() => openEdit(server, level)}
          onToggle={() => void toggle(server, level)}
        />
      ))
    );

  const projectName = useMemo(
    () =>
      options.find((project) => project.path === selectedProjectPath)?.name ??
      (selectedProjectPath ? projectDisplayName(selectedProjectPath) : undefined),
    [options, selectedProjectPath],
  );

  return (
    <div className="agent-capability-page">
      <p className="agent-capability-intro">{t("settings.capabilityPriority")}</p>
      <div className="agent-capability-columns">
        <AgentCapabilityColumn
          title={t("settings.globalLevel")}
          path={GLOBAL_MCP_PATH}
          scope="global"
          count={globalServers.length}
          action={
            <CapabilityButton
              variant="primary"
              disabled={loading}
              busy={busyKey !== null}
              onClick={() => openCreate("global")}
            >
              <IconPlus size={14} />
              {t("settings.addMcp")}
            </CapabilityButton>
          }
          loading={loading}
          empty={t("settings.loadingCapabilities")}
        >
          {renderRows(globalServers, "global")}
        </AgentCapabilityColumn>

        <AgentCapabilityColumn
          title={t("settings.projectLevel")}
          path={projectMcpPath(selectedProjectPath)}
          scope="project"
          count={projectServers.length}
          action={
            <>
              <AgentProjectPicker
                value={selectedProjectPath}
                options={options}
                label={t("settings.selectProject")}
                disabled={loading || busyKey !== null}
                onChange={setSelectedProjectPath}
              />
              <CapabilityButton
                variant="primary"
                disabled={!selectedProjectPath || loading}
                busy={busyKey !== null}
                onClick={() => openCreate("project")}
              >
                <IconPlus size={14} />
                {t("settings.addMcp")}
              </CapabilityButton>
            </>
          }
          loading={loading}
          empty={t("settings.loadingCapabilities")}
        >
          {!selectedProjectPath ? (
            <CapabilityEmpty message={t("settings.selectProjectFirst")} />
          ) : (
            renderRows(projectServers, "project")
          )}
        </AgentCapabilityColumn>
      </div>

      {editor ? (
        <McpEditorSheet
          draft={editor.draft}
          setDraft={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
          editing={editor.editing}
          saving={busyKey === "save"}
          status={editor.editing ? statusFor(statuses, editor.editing) : undefined}
          testing={testingId === editor.editing?.id}
          projects={[]}
          currentProjectPath={selectedProjectPath}
          managementLevel={editor.level}
          managementProjectName={projectName}
          onClose={() => {
            if (!busyKey && !testingId) setEditor(null);
          }}
          onSave={() => void save()}
          onTest={() => void testConnection()}
        />
      ) : null}
    </div>
  );
}
