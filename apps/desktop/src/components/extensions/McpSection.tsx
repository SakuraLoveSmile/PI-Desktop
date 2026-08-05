import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  activationState,
  type ActivationScope,
  type McpServerRecord,
  type McpServerStatus,
  type ProjectRecord,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Button, cx } from "../ui";
import {
  IconCircleAlert,
  IconClipboard,
  IconMore,
  IconPencil,
  IconPlay,
  IconPlus,
  IconServer,
  IconTerminal,
  IconTrash,
} from "../icons";
import { ScopeControl } from "./ScopeControl";
import { McpEditorSheet, draftFromRecord, draftToInput, emptyMcpDraft, type McpDraft } from "./McpEditorSheet";
import { McpImportSheet } from "./McpImportSheet";

/**
 * The MCP tab: servers the user owns, with no plugin in between.
 *
 * Each row leads with connection state, because "is it talking to me" is the
 * question a user opens this page with. Scope sits on the row rather than behind
 * an edit sheet: changing where a server applies is a routine decision and
 * should not require opening a form.
 */
export function McpSection({
  projects,
  currentProjectPath,
  query,
}: {
  projects: readonly ProjectRecord[];
  currentProjectPath?: string | null;
  query: string;
}) {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServerRecord[]>([]);
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [editing, setEditing] = useState<McpServerRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const res = await api.listMcpServers();
      setServers(res.servers ?? []);
      setStatuses(Object.fromEntries((res.statuses ?? []).map((s) => [s.serverId, s])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Another window — or an import — can change the set, so the list follows the
    // same change event the plugin list does.
    return api.onPluginChanged(() => void load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rowMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rowMenuRef.current?.contains(event.target as Node)) setRowMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRowMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [rowMenu]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const rows = needle
      ? servers.filter((server) =>
          [server.label, server.id, server.description, server.command, server.url].some((field) =>
            field?.toLocaleLowerCase().includes(needle),
          ),
        )
      : servers;
    return [...rows].sort(
      (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    );
  }, [servers, query]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    await run(async () => {
      await api.upsertMcpServer(draftToInput(draft));
      await load();
      setDraft(null);
      setEditing(null);
    });
    setSaving(false);
  };

  const test = async (id: string) => {
    setTestingId(id);
    await run(async () => {
      const res = await api.testMcpServer(id);
      if (res.status) setStatuses((cur) => ({ ...cur, [id]: res.status }));
    });
    setTestingId(null);
  };

  const importServers = async (text: string) => {
    setSaving(true);
    await run(async () => {
      const res = await api.importMcpServers(text);
      await load();
      setImportOpen(false);
      if (res.failed?.length) {
        setError(
          t("extensions.mcp.importPartial", {
            count: res.imported?.length ?? 0,
            failed: res.failed.map((entry) => `${entry.id}: ${entry.reason}`).join("; "),
          }),
        );
      }
    });
    setSaving(false);
  };

  return (
    <div className="ext-panel">
      <div className="ext-section-head">
        <div className="ext-section-copy">
          <h2 className="ext-section-title">{t("extensions.mcp.title")}</h2>
          <p className="ext-section-sub">{t("extensions.mcp.subtitle")}</p>
        </div>
        <div className="ext-section-actions">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <IconClipboard size={14} />
            {t("extensions.mcp.import")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setDraft(emptyMcpDraft());
            }}
          >
            <IconPlus size={14} />
            {t("extensions.mcp.add")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="ext-inline-error" role="alert">
          <IconCircleAlert size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="settings-panel ext-empty">
          <p className="ext-empty-body">{t("common.loading")}</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="settings-panel ext-empty">
          <span className="ext-empty-icon" aria-hidden>
            <IconServer size={18} />
          </span>
          <p className="ext-empty-title">{t("extensions.mcp.empty")}</p>
          <p className="ext-empty-body">{t("extensions.mcp.emptyBody")}</p>
          <div className="ext-empty-actions">
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setDraft(emptyMcpDraft());
              }}
            >
              {t("extensions.mcp.add")}
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              {t("extensions.mcp.import")}
            </Button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="settings-panel ext-empty">
          <p className="ext-empty-title">{t("extensions.noMatches")}</p>
        </div>
      ) : (
        <div className="settings-panel ext-list" role="list">
          {visible.map((server) => {
            const status = statuses[server.id];
            const state = activationState(server);
            const menuOpen = rowMenu === server.id;
            return (
              <div
                key={server.id}
                role="listitem"
                className={cx("ext-row", state === "off" && "is-off", menuOpen && "menu-open")}
              >
                <span
                  className={cx("ext-row-glyph", status && `is-${status.state}`)}
                  aria-hidden
                  title={status ? t(`extensions.mcp.state.${status.state}`) : undefined}
                >
                  {server.transport === "http" ? (
                    <IconServer size={15} />
                  ) : (
                    <IconTerminal size={15} />
                  )}
                </span>
                <div className="ext-row-copy">
                  <div className="ext-row-title">
                    <span className="ext-row-name">{server.label || server.id}</span>
                    <span className="ext-tag">{t(`extensions.mcp.transport${server.transport === "http" ? "Http" : "Stdio"}`)}</span>
                    {status && status.state !== "idle" ? (
                      <span className={cx("ext-state-tag", `is-${status.state}`)}>
                        {status.state === "ready"
                          ? t("extensions.mcp.toolCount", { count: status.toolCount })
                          : t(`extensions.mcp.state.${status.state}`)}
                      </span>
                    ) : null}
                  </div>
                  <div className="ext-row-meta">
                    <code className="ext-row-cmd">
                      {server.transport === "http"
                        ? server.url
                        : [server.command, ...(server.args ?? [])].join(" ")}
                    </code>
                  </div>
                  {server.description ? (
                    <p className="ext-row-desc">{server.description}</p>
                  ) : null}
                  {status?.state === "failed" && status.message ? (
                    <p className="ext-row-error">{status.message}</p>
                  ) : null}
                  {status?.state === "ready" && status.toolNames?.length ? (
                    <div className="ext-tool-chips">
                      {status.toolNames.slice(0, 6).map((name) => (
                        <span key={name} className="ext-tool-chip">
                          {name}
                        </span>
                      ))}
                      {status.toolNames.length > 6 ? (
                        <span className="ext-tool-chip is-more">
                          {t("extensions.mcp.moreTools", { count: status.toolNames.length - 6 })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="ext-row-controls">
                  <ScopeControl
                    target={server}
                    label={server.label || server.id}
                    projects={projects}
                    currentProjectPath={currentProjectPath}
                    onSetEnabled={(enabled) =>
                      run(async () => {
                        await api.setMcpServerEnabled(server.id, enabled);
                        await load();
                      })
                    }
                    onSetScope={(scope: ActivationScope) =>
                      run(async () => {
                        await api.setMcpServerScope(server.id, scope);
                        await load();
                      })
                    }
                  />
                  <div className="ext-row-actions">
                    <button
                      type="button"
                      className="plugins-icon-btn"
                      aria-label={t("extensions.mcp.edit")}
                      title={t("extensions.mcp.edit")}
                      onClick={() => {
                        setEditing(server);
                        setDraft(draftFromRecord(server));
                      }}
                    >
                      <IconPencil size={15} />
                    </button>
                    <div className="plugins-menu-wrap" ref={menuOpen ? rowMenuRef : undefined}>
                      <button
                        type="button"
                        className="plugins-icon-btn"
                        aria-label={t("extensions.mcp.rowActions", { name: server.label })}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setRowMenu((cur) => (cur === server.id ? null : server.id))}
                      >
                        <IconMore size={15} />
                      </button>
                      {menuOpen ? (
                        <div className="plugins-menu is-end" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={testingId === server.id}
                            onClick={() => {
                              setRowMenu(null);
                              void test(server.id);
                            }}
                          >
                            <IconPlay size={14} />
                            {testingId === server.id
                              ? t("extensions.mcp.testing")
                              : t("extensions.mcp.test")}
                          </button>
                          <div className="plugins-menu-sep" />
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              setRowMenu(null);
                              void run(async () => {
                                await api.removeMcpServer(server.id);
                                await load();
                              });
                            }}
                          >
                            <IconTrash size={14} />
                            {t("extensions.mcp.remove")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <McpEditorSheet
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          saving={saving}
          status={editing ? statuses[editing.id] : undefined}
          testing={testingId === editing?.id}
          projects={projects}
          currentProjectPath={currentProjectPath}
          onClose={() => {
            setDraft(null);
            setEditing(null);
          }}
          onSave={() => void save()}
          onTest={() => editing && void test(editing.id)}
        />
      ) : null}

      {importOpen ? (
        <McpImportSheet
          saving={saving}
          onClose={() => setImportOpen(false)}
          onImport={(text) => void importServers(text)}
        />
      ) : null}
    </div>
  );
}
