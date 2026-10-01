import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GLOBAL_SCOPE,
  type AgentCapabilityLevel,
  type McpControlStatus,
  type McpServerRecord,
  type McpServerStatus,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { useHostCollection } from "../../hooks/use-host-collection";
import {
  AgentCapabilityPage,
  AgentProjectPicker,
  CapabilityButton,
  CapabilityEmpty,
  CapabilityGroupHeader,
  CapabilityPanel,
  CapabilityRow,
  CapabilityRowMenu,
  CapabilityToggle,
  CapabilityToolbar,
  matchesCapabilitySearch,
  projectDisplayName,
  useAgentProjects,
  useArmedDelete,
  type CapabilityFilter,
  type CapabilityMenuItem,
} from "./AgentCapabilityLayout";
import {
  draftFromRecord,
  draftToInput,
  emptyMcpDraft,
  McpEditorSheet,
  type McpDraft,
} from "../extensions/McpEditorSheet";
import { McpMarketPanel } from "./McpMarketPanel";
import {
  IconArrowUpDown,
  IconKey,
  IconPencil,
  IconPlug,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTerminal,
  IconTrash,
} from "../icons";
import { TooltipButton, cx } from "../ui";

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

type McpEditorState = {
  draft: McpDraft;
  editing: McpServerRecord | null;
  level: AgentCapabilityLevel;
};

type McpCollection = {
  global: McpServerRecord[];
  project: McpServerRecord[];
  statuses: McpServerStatus[];
};

const EMPTY_MCP_COLLECTION: McpCollection = { global: [], project: [], statuses: [] };

export function AgentMcpPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const { selectedProjectPath, setSelectedProjectPath, options } = useAgentProjects();
  const fetchServers = useCallback(async (): Promise<McpCollection> => {
    const [global, project] = await Promise.all([
      api.listMcpServers({
        level: "global",
        ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
      }),
      selectedProjectPath
        ? api.listMcpServers({ level: "project", projectPath: selectedProjectPath })
        : Promise.resolve({
            servers: [] as McpServerRecord[],
            statuses: [] as McpServerStatus[],
          }),
    ]);
    return {
      global: global.servers ?? [],
      project: project.servers ?? [],
      statuses: [...(global.statuses ?? []), ...(project.statuses ?? [])],
    };
  }, [selectedProjectPath]);
  const {
    data: { global: globalServers, project: projectServers, statuses },
    setData: setServers,
    loading,
    refreshing,
    reload: load,
  } = useHostCollection(fetchServers, EMPTY_MCP_COLLECTION, (error) =>
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" }),
  );
  const setStatuses = (update: (current: McpServerStatus[]) => McpServerStatus[]) =>
    setServers((current) => ({ ...current, statuses: update(current.statuses) }));

  /**
   * The desktop's own local control endpoint (ADR 0203) is one machine setting,
   * not a row: it has no level, no project, and no document behind it, and the
   * host owns both its stored value and whether it is actually listening. `null`
   * means "not read yet", so the block never guesses "off" while it loads.
   */
  const [control, setControl] = useState<McpControlStatus | null>(null);
  const [controlReadError, setControlReadError] = useState<string | null>(null);
  const [controlLoading, setControlLoading] = useState(true);
  const [controlBusy, setControlBusy] = useState(false);

  const readControl = useCallback(async () => {
    setControlLoading(true);
    try {
      setControl(await api.mcpControlGet());
      setControlReadError(null);
    } catch (error) {
      setControlReadError(error instanceof Error ? error.message : String(error));
    } finally {
      setControlLoading(false);
    }
  }, []);

  useEffect(() => {
    void readControl();
  }, [readControl]);

  /**
   * Start or stop the endpoint. The host answers with the state it actually
   * reached — including a start that failed because the port is taken — so this
   * never flips the switch optimistically: the reason a start failed is the
   * whole point of the control.
   */
  const toggleControl = async (enabled: boolean) => {
    if (controlBusy || controlLoading) return;
    setControlBusy(true);
    try {
      const next = await api.mcpControlSet(enabled);
      setControl(next);
      setControlReadError(null);
      if (next.error) {
        showToast(next.error, { variant: "error" });
      } else {
        showToast(
          t(
            next.enabled && next.running
              ? "settings.mcpControl.turnedOn"
              : "settings.mcpControl.turnedOff",
          ),
          { variant: "success" },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setControlReadError(message);
      showToast(message, { variant: "error" });
      // A rejected call proves nothing about the host, so re-read it instead of
      // leaving the switch on a value only this window believes.
      await readControl();
    } finally {
      setControlBusy(false);
    }
  };
  const [filter, setFilter] = useState<CapabilityFilter>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<McpEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const pendingOAuthRef = useRef<{ unsubscribe: () => void } | null>(null);

  useEffect(() => {
    return () => {
      pendingOAuthRef.current?.unsubscribe();
      pendingOAuthRef.current = null;
    };
  }, []);
  const [view, setView] = useState<"servers" | "market">("servers");
  const { armed, setArmed } = useArmedDelete();

  const rowKey = (level: AgentCapabilityLevel, id: string) => `${level}:${id}`;
  const levelQuery = (level: AgentCapabilityLevel) => ({
    level,
    ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
  });

  const patchRow = (
    level: AgentCapabilityLevel,
    id: string,
    patch: Partial<McpServerRecord>,
  ) => {
    setServers((current) => ({
      ...current,
      [level]: current[level].map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  /** New servers land at whichever level the filter is pointing at. */
  const targetLevel: AgentCapabilityLevel = filter === "project" ? "project" : "global";

  const openCreate = () => {
    if (targetLevel === "project" && !selectedProjectPath) {
      showToast(t("settings.selectProjectFirst"), { variant: "error" });
      return;
    }
    setEditor({
      draft: {
        ...emptyMcpDraft(),
        scope:
          targetLevel === "global"
            ? GLOBAL_SCOPE
            : { mode: "projects", projects: [selectedProjectPath!] },
      },
      editing: null,
      level: targetLevel,
    });
  };

  const openEdit = (server: McpServerRecord, level: AgentCapabilityLevel) => {
    setMenuFor(null);
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
    setSaving(true);
    try {
      await api.upsertMcpServer(draftToInput(editor.draft, { level: editor.level, projectPath }));
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
      setSaving(false);
    }
  };

  const toggle = async (server: McpServerRecord, level: AgentCapabilityLevel) => {
    const key = rowKey(level, server.id);
    if (busyId) return;
    const next = !server.enabled;
    setBusyId(key);
    // Flip locally first: the host is the authority, but a round-trip of latency
    // on a switch reads as a broken control.
    patchRow(level, server.id, { enabled: next });
    try {
      await api.setMcpServerEnabled(server.id, next, levelQuery(level));
      showToast(
        t(next ? "settings.capabilityEnabled" : "settings.capabilityDisabled", {
          name: server.label || server.id,
        }),
        { variant: "success" },
      );
    } catch (error) {
      patchRow(level, server.id, { enabled: server.enabled });
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const testConnection = async (server: McpServerRecord, level: AgentCapabilityLevel) => {
    if (testingId) return;
    setTestingId(server.id);
    try {
      const result = await api.testMcpServer(server.id, {
        level,
        ...(level === "project" && selectedProjectPath
          ? { projectPath: selectedProjectPath }
          : {}),
      });
      setStatuses((current) => [
        ...current.filter((status) => status.serverId !== server.id),
        result.status,
      ]);
      if (result.status.state === "ready") {
        showToast(t("extensions.mcp.testReady", { count: result.status.toolCount }), {
          variant: "success",
        });
      } else if (result.status.authRequired) {
        showToast(t("extensions.mcp.authRequired"), { variant: "error" });
      } else if (result.status.state === "failed") {
        showToast(result.status.message || t("extensions.mcp.testFailed"), { variant: "error" });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setTestingId(null);
    }
  };

  const authorizeServer = async (server: McpServerRecord, level: AgentCapabilityLevel) => {
    if (authorizingId || pendingOAuthRef.current) return;
    setAuthorizingId(server.id);
    let activeLoginId: string | null = null;
    let unsubscribed = false;
    let unsubscribe = () => {};

    const finish = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      unsubscribe();
      if (pendingOAuthRef.current?.unsubscribe === unsubscribe) {
        pendingOAuthRef.current = null;
      }
    };

    const cleanup = () => {
      finish();
      setAuthorizingId(null);
    };

    unsubscribe = api.onMcpOAuth((event) => {
      if (activeLoginId && event.loginId !== activeLoginId) return;
      if (event.serverId !== server.id) return;

      if (event.kind === "done") {
        setStatuses((current) => [
          ...current.filter((status) => status.serverId !== server.id),
          event.status,
        ]);
        showToast(t("extensions.mcp.authReady", { count: event.status.toolCount }), {
          variant: "success",
        });
        cleanup();
      } else if (event.kind === "error") {
        showToast(event.message || t("extensions.mcp.authFailed"), { variant: "error" });
        cleanup();
      } else if (event.kind === "cancelled") {
        cleanup();
      }
    });
    pendingOAuthRef.current = { unsubscribe };

    try {
      showToast(t("extensions.mcp.authorizing"), { variant: "info" });
      const result = await api.startMcpOAuth(server.id, {
        level,
        ...(level === "project" && selectedProjectPath
          ? { projectPath: selectedProjectPath }
          : {}),
      });
      activeLoginId = result.loginId;
      if (!result.ok) {
        showToast(t("extensions.mcp.authFailed"), { variant: "error" });
        cleanup();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
      cleanup();
    }
  };

  const remove = async (server: McpServerRecord, level: AgentCapabilityLevel) => {
    const key = rowKey(level, server.id);
    setBusyId(key);
    try {
      await api.removeMcpServer(server.id, levelQuery(level));
      await load();
      showToast(t("settings.capabilityDeleted", { name: server.label || server.id }), {
        variant: "success",
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyId(null);
      setArmed(null);
    }
  };

  const visible = useMemo(() => {
    const match = (server: McpServerRecord) =>
      matchesCapabilitySearch(
        search,
        server.label,
        server.id,
        server.description,
        server.transport === "http" ? server.url : server.command,
      );
    return {
      global: globalServers.filter(match),
      project: projectServers.filter(match),
    };
  }, [globalServers, projectServers, search]);

  const counts = {
    all: visible.global.length + visible.project.length,
    global: visible.global.length,
    project: visible.project.length,
  };

  const projectName = useMemo(
    () =>
      options.find((project) => project.path === selectedProjectPath)?.name ??
      (selectedProjectPath ? projectDisplayName(selectedProjectPath) : undefined),
    [options, selectedProjectPath],
  );

  /** Where a move sends a row, named the way the toast should say it. */
  const moveTarget: Partial<Record<AgentCapabilityLevel, string>> = {
    global: t("settings.globalLevel"),
    project: selectedProjectPath
      ? `${t("settings.projectLevel")} · ${projectName ?? projectDisplayName(selectedProjectPath)}`
      : undefined,
  };

  /**
   * Move one row to the other level. The project picker owns the destination,
   * so the same action reads "Move into <project>" on a global row and "Move to
   * Global" on a project one.
   *
   * The host moves the document rather than copying it, and a destination that
   * already holds the id or name renames the arriving server, so the toast
   * reports the new name instead of pretending the id survived.
   */
  const move = async (server: McpServerRecord, level: AgentCapabilityLevel) => {
    const to: AgentCapabilityLevel = level === "global" ? "project" : "global";
    const target = moveTarget[to];
    if (!target) {
      showToast(t("settings.selectProjectFirst"), { variant: "error" });
      return;
    }
    const key = rowKey(level, server.id);
    setBusyId(key);
    try {
      const result = await api.transferMcpServer({
        id: server.id,
        from: levelQuery(level),
        to: levelQuery(to),
      });
      await load();
      const name = server.label || server.id;
      const arrived = result.server;
      showToast(
        arrived && arrived.id !== server.id
          ? t("settings.capabilityMovedRenamed", {
              name,
              target,
              newName: arrived.label || arrived.id,
            })
          : t("settings.capabilityMoved", { name, target }),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const renderRow = (server: McpServerRecord, level: AgentCapabilityLevel) => {
    const key = rowKey(level, server.id);
    const name = server.label || server.id;
    const status = statusFor(statuses, server);
    const busy = busyId === key;
    const testing = testingId === server.id;
    const authorizing = authorizingId === server.id;
    const isArmed = armed === key;
    const isHttp = server.transport === "http";
    const hasAuthHeader = Boolean(
      server.headers &&
      Object.keys(server.headers).some((k) => k.toLowerCase() === "authorization"),
    );
    const isOAuth = isHttp && (Boolean(status?.hasOauth) || !hasAuthHeader);
    const needsAuth =
      isHttp &&
      !hasAuthHeader &&
      Boolean(status?.authRequired);
    const items: CapabilityMenuItem[] = [
      {
        key: "test",
        label: t("extensions.mcp.test"),
        icon: <IconPlay size={14} />,
        disabled: testing || authorizing,
        onSelect: () => {
          setMenuFor(null);
          void testConnection(server, level);
        },
      },
      ...(isOAuth
        ? [
            {
              key: "authorize",
              label: status?.hasOauth
                ? t("extensions.mcp.reauthorize")
                : t("extensions.mcp.authorize"),
              icon: <IconKey size={14} />,
              disabled: testing || authorizing,
              onSelect: () => {
                setMenuFor(null);
                void authorizeServer(server, level);
              },
            } satisfies CapabilityMenuItem,
          ]
        : []),
      /**
       * A move needs a destination, so a global row offers it only while the
       * picker names a project; a project row always has Global to go back to.
       */
      ...(moveTarget[level === "global" ? "project" : "global"]
        ? [
            {
              key: "move",
              label:
                level === "global"
                  ? t("settings.capabilityMoveToProject", {
                      project:
                        projectName ?? projectDisplayName(selectedProjectPath ?? ""),
                    })
                  : t("settings.capabilityMoveToGlobal"),
              icon: <IconArrowUpDown size={14} />,
              onSelect: () => {
                setMenuFor(null);
                void move(server, level);
              },
            } satisfies CapabilityMenuItem,
          ]
        : []),
      {
        key: "remove",
        label: isArmed ? t("settings.capabilityRemoveConfirm") : t("extensions.mcp.remove"),
        icon: <IconTrash size={14} />,
        danger: true,
        onSelect: () => {
          if (isArmed) {
            setMenuFor(null);
            void remove(server, level);
          } else {
            setArmed(key);
          }
        },
      },
    ];
    return (
      <CapabilityRow
        key={key}
        glyph={server.transport === "http" ? <IconServer size={16} /> : <IconTerminal size={16} />}
        glyphState={status?.state}
        name={name}
        off={!server.enabled}
        menuOpen={menuFor === key}
        command={server.transport === "http" ? server.url : server.command}
        badges={
          <>
            <span className="agent-capability-badge is-level">
              {level === "global"
                ? t("settings.capabilityFilterGlobal")
                : t("settings.capabilityFilterProject")}
            </span>
            <span className="agent-capability-badge">
              {server.transport === "http"
                ? t("settings.transportHttp")
                : t("settings.transportStdio")}
            </span>
            {status && status.state !== "idle" ? (
              <span className={cx("agent-capability-badge", "is-status", `is-${status.state}`)}>
                <span className="agent-capability-status-dot" aria-hidden="true" />
                {status.state === "ready"
                  ? t("extensions.mcp.toolCount", { count: status.toolCount })
                  : t(`extensions.mcp.state.${status.state}`)}
              </span>
            ) : null}
            {needsAuth ? (
              <span className="agent-capability-badge is-status is-failed">
                {t("extensions.mcp.authRequired")}
              </span>
            ) : status?.hasOauth ? (
              <span className="agent-capability-badge is-status is-ready">
                {t("extensions.mcp.oauthBadge")}
              </span>
            ) : null}
          </>
        }
        description={server.description || t("settings.noCapabilityDescription")}
        actions={
          <>
            {needsAuth ? (
              <TooltipButton
                type="button"
                className="settings-icon-button is-action-highlight"
                ariaLabel={t("extensions.mcp.authorize")}
                tooltip={authorizing ? t("extensions.mcp.authorizing") : t("extensions.mcp.authorize")}
                disabled={busy || authorizing}
                onClick={() => void authorizeServer(server, level)}
              >
                <IconKey size={15} />
              </TooltipButton>
            ) : null}
            <TooltipButton
              type="button"
              className="settings-icon-button"
              ariaLabel={t("settings.editMcpOf", { name })}
              tooltip={t("settings.editMcp")}
              disabled={busy}
              onClick={() => openEdit(server, level)}
            >
              <IconPencil size={15} />
            </TooltipButton>
            <CapabilityRowMenu
              label={t("extensions.mcp.rowActions", { name })}
              items={items}
              disabled={busy}
              open={menuFor === key}
              onOpenChange={(open) => {
                setMenuFor(open ? key : null);
                if (!open) setArmed(null);
              }}
            />
            <CapabilityToggle
              checked={server.enabled}
              busy={busy || testing}
              label={t("settings.toggleCapability", { name })}
              onChange={() => void toggle(server, level)}
            />
          </>
        }
      />
    );
  };

  /**
   * The one block on this page that is not an installed server: the desktop's own
   * loopback control endpoint (ADR 0203). It sits above the level groups because
   * it belongs to this machine rather than to `~/.agents/servers` or a project,
   * so it never follows the level filter, the search, or the project picker, and
   * it carries no level or transport badge, no row menu, and no OAuth action.
   *
   * It is a strip rather than a row tile for the same reason: the setting is one
   * switch the host owns, not a document this page can move, rename, or delete.
   */
  const renderControlEndpoint = () => {
    /** A launch argument owns the value; the strip reports it, cannot change it. */
    const override = control?.source === "environment";
    const running = Boolean(control?.running);
    const enabled = Boolean(control?.enabled);
    /**
     * The host's own reason for a start, stop, or persist it could not apply. It
     * reports a request it refused — one that contradicts a launch argument, for
     * instance — in the same field, so this is a reason, not always a failure.
     */
    const hostError = control?.error ?? null;
    /** This window could not reach the host at all, which is a different failure. */
    const unreachable = controlReadError;
    /** Nothing listening while the value says it should be is the real failure. */
    const failed = !running && hostError !== null && (enabled || !override);
    /** No value and a host that did not answer: the state is simply unknown. */
    const unknown = !control && unreachable !== null;
    /**
     * "Retry start" belongs to a start that failed while the value still says
     * on. A refused or rolled-back request is not a broken endpoint — the
     * switch itself is that retry — so it shows its reason without a button
     * that cannot fix it. An explicit launch argument does not block this:
     * only a request opposite to its value is refused.
     */
    const canRetry = enabled && !running && hostError !== null;
    /** The only color on the strip, and only while it means something. */
    const status = failed
      ? {
          label: t("settings.mcpControl.failed"),
          className: "agent-capability-badge is-status is-failed",
          dot: true,
        }
      : running
        ? {
            label: t("settings.mcpControl.on"),
            className: "agent-capability-badge is-status is-ready",
            dot: true,
          }
        : {
            label: unknown
              ? t("settings.mcpControl.unavailable")
              : controlLoading && !control
                ? t("settings.mcpControl.reading")
                : t("settings.mcpControl.off"),
            className: "agent-capability-badge",
            dot: false,
          };
    const connectionFile = control?.connectionFile ?? null;
    return (
      <div className="agent-mcp-scope" role="presentation">
        <div className="agent-mcp-scope-copy">
          <div className="agent-capability-row-title">
            <span className="agent-mcp-scope-label">{t("settings.mcpControl.title")}</span>
            <span className="agent-capability-badge">
              {t("settings.mcpControl.thisMachine")}
            </span>
            {override ? (
              <span className="agent-capability-badge">
                {t("settings.mcpControl.envControlled")}
              </span>
            ) : null}
          </div>
          <div className="agent-capability-meta">
            <span className={status.className}>
              {status.dot ? (
                <span className="agent-capability-status-dot" aria-hidden="true" />
              ) : null}
              {status.label}
            </span>
            {running ? (
              <span className="agent-mcp-scope-hint">
                {t("settings.mcpControl.onHint")}
              </span>
            ) : failed || unknown ? null : (
              <span className="agent-mcp-scope-hint">
                {t("settings.mcpControl.offHint")}
              </span>
            )}
          </div>
          {failed ? (
            <span className="agent-mcp-scope-hint" role="alert">
              {hostError}
            </span>
          ) : unreachable ? (
            <span className="agent-mcp-scope-hint">
              {t("settings.mcpControl.unreachable", { message: unreachable })}
            </span>
          ) : hostError ? (
            <span className="agent-mcp-scope-hint">{hostError}</span>
          ) : null}
          {connectionFile ? (
            <div className="agent-capability-meta">
              <span className="agent-mcp-scope-hint">
                {t("settings.mcpControl.connectionFile")}
              </span>
              {/* Selectable on purpose: this path is the hand-off to a client. */}
              <code title={connectionFile}>{connectionFile}</code>
            </div>
          ) : null}
        </div>
        <div className="agent-capability-row-actions">
          {canRetry ? (
            <CapabilityButton
              onClick={() => void toggleControl(true)}
              busy={controlBusy}
            >
              <IconRefresh size={14} />
              {t("settings.mcpControl.retry")}
            </CapabilityButton>
          ) : null}
          {/* Effective value, so a saved "on" whose start failed stays on. */}
          <CapabilityToggle
            checked={enabled}
            busy={controlBusy || controlLoading}
            disabled={override}
            label={t("settings.mcpControl.toggle")}
            onChange={() => void toggleControl(!enabled)}
          />
        </div>
      </div>
    );
  };

  const showGlobal = filter !== "project";
  const showProject = filter !== "global";
  const addButton = (
    <CapabilityButton
      variant="primary"
      title={
        targetLevel === "project"
          ? t("settings.capabilityCreateInProject")
          : t("settings.capabilityCreateInGlobal")
      }
      onClick={openCreate}
    >
      <IconPlus size={14} />
      {t("settings.addMcp")}
    </CapabilityButton>
  );

  const marketButton = (
    <CapabilityButton
      onClick={() => setView("market")}
    >
      <IconServer size={14} />
      {t("settings.mcpMarket.browse")}
    </CapabilityButton>
  );

  if (view === "market") {
    return (
      <McpMarketPanel
        installedIds={[...globalServers, ...projectServers].map((server) => server.id)}
        onBack={() => {
          setView("servers");
          void load();
        }}
        onInstalled={() => {
          setView("servers");
          void load();
        }}
      />
    );
  }

  return (
    <AgentCapabilityPage
      toolbar={
        <CapabilityToolbar
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t("extensions.mcp.searchPlaceholder")}
          projectPicker={
            <AgentProjectPicker
              value={selectedProjectPath}
              options={options}
              label={t("settings.selectProject")}
              onChange={setSelectedProjectPath}
            />
          }
          actions={
            <>
              {addButton}
              {marketButton}
            </>
          }
        />
      }
    >
      <CapabilityPanel
        loading={loading}
        refreshing={refreshing}
        loadingLabel={t("settings.loadingCapabilities")}
      >
        {renderControlEndpoint()}
        {counts.all === 0 && search.trim() ? (
          <CapabilityEmpty
            message={t("settings.capabilityNoMatches")}
            icon={<IconServer size={18} />}
          />
        ) : (
          <>
            {showGlobal ? (
              <>
                <CapabilityGroupHeader
                  label={t("settings.globalLevel")}
                  path={GLOBAL_MCP_PATH}
                  count={visible.global.length}
                />
                {visible.global.length === 0 ? (
                  <CapabilityEmpty
                    message={t("settings.mcpEmpty")}
                    icon={<IconServer size={18} />}
                    action={addButton}
                  />
                ) : (
                  visible.global.map((server) => renderRow(server, "global"))
                )}
              </>
            ) : null}
            {showProject ? (
              <>
                <CapabilityGroupHeader
                  label={t("settings.projectLevel")}
                  path={projectMcpPath(selectedProjectPath)}
                  count={visible.project.length}
                />
                {!selectedProjectPath ? (
                  <CapabilityEmpty message={t("settings.selectProjectFirst")} />
                ) : visible.project.length === 0 ? (
                  <CapabilityEmpty
                    message={t("settings.mcpEmpty")}
                    icon={<IconServer size={18} />}
                  />
                ) : (
                  visible.project.map((server) => renderRow(server, "project"))
                )}
              </>
            ) : null}
          </>
        )}
      </CapabilityPanel>

      {editor ? (
        <McpEditorSheet
          draft={editor.draft}
          setDraft={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
          editing={editor.editing}
          saving={saving}
          status={editor.editing ? statusFor(statuses, editor.editing) : undefined}
          testing={testingId === editor.editing?.id}
          projects={[]}
          currentProjectPath={selectedProjectPath}
          managementLevel={editor.level}
          managementProjectName={projectName}
          onClose={() => {
            if (!saving && !testingId) setEditor(null);
          }}
          onSave={() => void save()}
          onTest={() => {
            if (editor.editing) void testConnection(editor.editing, editor.level);
          }}
        />
      ) : null}
    </AgentCapabilityPage>
  );
}
