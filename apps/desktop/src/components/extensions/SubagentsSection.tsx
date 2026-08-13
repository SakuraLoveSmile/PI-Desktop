import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_SUBAGENT_MAX_TURNS,
  activationState,
  isSubagentMutatingTool,
  subagentModelKey,
  type ActivationScope,
  type ProjectRecord,
  type SubagentDefinition,
  type UserSubagentRecord,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Button, cx } from "../ui";
import {
  IconBot,
  IconCircleAlert,
  IconCopy,
  IconFolderOpen,
  IconMore,
  IconPencil,
  IconPlus,
  IconShield,
  IconTrash,
} from "../icons";
import { ScopeControl } from "./ScopeControl";
import {
  MAX_SUBAGENT_BYTES,
  SubagentEditorSheet,
  draftFromDefinition,
  draftFromRecord,
  emptySubagentDraft,
  subagentTemplate,
  type SubagentDraft,
} from "./SubagentEditorSheet";

/**
 * The Subagents tab: delegates the main agent can spawn through `Task` (ADR 0062).
 *
 * Two lists, because there are three sources and only one of them is writable.
 * The user's own definitions live in a registry and can be edited, scoped and
 * deleted; builtins and project `.pi/agents` documents are shown read-only with a
 * "copy as mine" action. The second list is the effective catalog — exactly what
 * `Task` offers in this project right now — so a definition that quietly lost its
 * name to a higher-precedence source is visible rather than mysterious (D202).
 */
export function SubagentsSection({
  projects,
  currentProjectPath,
  query,
}: {
  projects: readonly ProjectRecord[];
  currentProjectPath?: string | null;
  query: string;
}) {
  const { t } = useTranslation();
  const [subagents, setSubagents] = useState<UserSubagentRecord[]>([]);
  const [catalog, setCatalog] = useState<SubagentDefinition[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SubagentDraft | null>(null);
  const [editing, setEditing] = useState<UserSubagentRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const load = () => {
    if (loadInFlightRef.current) return loadInFlightRef.current;
    const request = (async () => {
      try {
        const [list, effective] = await Promise.all([
          api.listUserSubagents(),
          api.subagentCatalog(),
        ]);
        setSubagents(list.subagents ?? []);
        setCatalog(effective.subagents ?? []);
        setDiagnostics(effective.diagnostics ?? []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    loadInFlightRef.current = request;
    void request.then(
      () => {
        if (loadInFlightRef.current === request) loadInFlightRef.current = null;
      },
      () => {
        if (loadInFlightRef.current === request) loadInFlightRef.current = null;
      },
    );
    return request;
  };

  useEffect(() => {
    void load();
    const offPluginChanged = api.onPluginChanged(() => void load());
    // The registry lives in host-core, so a call that races its teardown or a
    // supervised restart leaves this panel holding a transport error for a
    // registry that is fine. Reload when the host is back rather than waiting
    // for a mutation to clear the banner.
    const offHostStatus = api.onHostStatus((status) => {
      if (status.ok) void load();
    });
    return () => {
      offPluginChanged();
      offHostStatus();
    };
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

  const matches = (fields: Array<string | undefined>) => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    return fields.some((field) => field?.toLocaleLowerCase().includes(needle));
  };

  const visible = useMemo(
    () =>
      [...subagents]
        .filter((record) => matches([record.name, record.description]))
        .sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subagents, query],
  );

  /** Builtins and project documents: shown, never edited in place. */
  const readOnly = useMemo(
    () =>
      catalog
        .filter((definition) => definition.source !== "user")
        .filter((definition) => matches([definition.name, definition.description])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, query],
  );

  /** Names a project document owns; a project document outranks the registry. */
  const claimedByProject = useMemo(
    () =>
      new Set(
        catalog
          .filter((definition) => definition.source === "project")
          .map((definition) => definition.name),
      ),
    [catalog],
  );

  /** Names `Task` currently offers, so an inactive registry entry is visible. */
  const effectiveNames = useMemo(
    () => new Set(catalog.map((definition) => definition.name)),
    [catalog],
  );

  const create = () => {
    setEditing(null);
    setDraft({ ...emptySubagentDraft(), body: subagentTemplate("") });
  };

  const copyDefinition = (definition: SubagentDefinition) => {
    setEditing(null);
    setDraft(draftFromDefinition(definition));
  };

  const openEdit = async (record: UserSubagentRecord) => {
    // The prompt body lives on disk, not in the list payload, so editing reads it
    // rather than shipping every document into the renderer up front.
    await run(async () => {
      const res = await api.readUserSubagent(record.id);
      setEditing(res.subagent ?? record);
      setDraft(draftFromRecord(res.subagent ?? record, res.body ?? ""));
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    await run(async () => {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        tools: draft.tools,
        // An empty string clears the pin; an empty level clears the override.
        model: draft.model.trim(),
        thinkingLevel: draft.thinkingLevel,
        maxTurns: draft.maxTurns,
        body: draft.body,
        enabled: draft.enabled,
        scope: draft.scope,
      };
      if (editing) await api.updateUserSubagent(editing.id, input);
      else await api.createUserSubagent(input);
      await load();
      setDraft(null);
      setEditing(null);
    });
    setSaving(false);
  };

  const toolChips = (tools: readonly string[]) => (
    <div className="ext-tool-chips">
      {tools.map((tool) => (
        <span
          key={tool}
          className={cx("ext-tool-chip", isSubagentMutatingTool(tool) && "is-mutating")}
        >
          {tool}
        </span>
      ))}
    </div>
  );

  return (
    <div className="ext-panel">
      <div className="ext-section-head">
        <div className="ext-section-copy">
          <h2 className="ext-section-title">{t("extensions.subagents.title")}</h2>
        </div>
        <div className="ext-section-actions">
          <Button variant="primary" onClick={create}>
            <IconPlus size={14} />
            {t("extensions.subagents.add")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="ext-inline-error" role="alert">
          <IconCircleAlert size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {diagnostics.length ? (
        <div className="ext-inline-error" role="status">
          <IconCircleAlert size={14} />
          <span>{diagnostics.join(" · ")}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="settings-panel ext-empty">
          <p className="ext-empty-body">{t("common.loading")}</p>
        </div>
      ) : (
        <>
          {subagents.length === 0 ? (
            <div className="settings-panel ext-empty">
              <span className="ext-empty-icon" aria-hidden>
                <IconBot size={18} />
              </span>
              <p className="ext-empty-title">{t("extensions.subagents.empty")}</p>
              <div className="ext-empty-actions">
                <Button variant="primary" onClick={create}>
                  {t("extensions.subagents.add")}
                </Button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="settings-panel ext-empty">
              <p className="ext-empty-title">{t("extensions.noMatches")}</p>
            </div>
          ) : (
            <div className="settings-panel ext-list" role="list">
              {visible.map((record) => {
                const state = activationState(record);
                const menuOpen = rowMenu === record.id;
                const shadowed = claimedByProject.has(record.name);
                const inactive =
                  state !== "off" && !effectiveNames.has(record.name);
                const oversized = record.sizeBytes > MAX_SUBAGENT_BYTES;
                return (
                  <div
                    key={record.id}
                    role="listitem"
                    className={cx(
                      "ext-row",
                      state === "off" && "is-off",
                      menuOpen && "menu-open",
                    )}
                  >
                    <span className="ext-row-glyph is-subagent" aria-hidden>
                      <IconBot size={15} />
                    </span>
                    <div className="ext-row-copy">
                      <div className="ext-row-title">
                        <span className="ext-row-name">{record.name}</span>
                        <code className="ext-row-id">
                          {t("extensions.subagents.handle", { name: record.name })}
                        </code>
                        {shadowed ? (
                          <span className="ext-state-tag is-warn">
                            {t("extensions.subagents.shadowedByProject")}
                          </span>
                        ) : inactive ? (
                          <span className="ext-tag">
                            {t("extensions.subagents.notHere")}
                          </span>
                        ) : null}
                        {oversized ? (
                          <span className="ext-state-tag is-failed">
                            {t("extensions.subagents.tooBigTag")}
                          </span>
                        ) : null}
                      </div>
                      <p className="ext-row-desc">{record.description}</p>
                      <div className="ext-row-meta">
                        {toolChips(record.tools)}
                        <span>
                          {t("extensions.subagents.turns", {
                            turns: record.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS,
                          })}
                        </span>
                        {record.model ? <span>{record.model}</span> : null}
                        {record.thinkingLevel ? (
                          <span>
                            {t("extensions.subagents.thinkingMeta", {
                              level: record.thinkingLevel,
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="ext-row-controls">
                      <ScopeControl
                        target={record}
                        label={record.name}
                        projects={projects}
                        currentProjectPath={currentProjectPath}
                        onSetEnabled={(enabled) =>
                          run(async () => {
                            await api.setUserSubagentEnabled(record.id, enabled);
                            await load();
                          })
                        }
                        onSetScope={(scope: ActivationScope) =>
                          run(async () => {
                            await api.setUserSubagentScope(record.id, scope);
                            await load();
                          })
                        }
                      />
                      <div className="ext-row-actions">
                        <button
                          type="button"
                          className="plugins-icon-btn"
                          aria-label={t("extensions.subagents.edit")}
                          title={t("extensions.subagents.edit")}
                          onClick={() => void openEdit(record)}
                        >
                          <IconPencil size={15} />
                        </button>
                        <div
                          className="plugins-menu-wrap"
                          ref={menuOpen ? rowMenuRef : undefined}
                        >
                          <button
                            type="button"
                            className="plugins-icon-btn"
                            aria-label={t("extensions.subagents.rowActions", {
                              name: record.name,
                            })}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            onClick={() =>
                              setRowMenu((cur) => (cur === record.id ? null : record.id))
                            }
                          >
                            <IconMore size={15} />
                          </button>
                          {menuOpen ? (
                            <div className="plugins-menu is-end" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setRowMenu(null);
                                  void run(() => api.revealSubagent({ id: record.id }));
                                }}
                              >
                                <IconFolderOpen size={14} />
                                {t("extensions.subagents.reveal")}
                              </button>
                              <div className="plugins-menu-sep" />
                              <button
                                type="button"
                                role="menuitem"
                                className="danger"
                                onClick={() => {
                                  setRowMenu(null);
                                  void run(async () => {
                                    await api.removeUserSubagent(record.id);
                                    await load();
                                  });
                                }}
                              >
                                <IconTrash size={14} />
                                {t("extensions.subagents.remove")}
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

          {readOnly.length ? (
            <>
              <div className="ext-section-head is-sub">
                <div className="ext-section-copy">
                  <h3 className="ext-section-title">
                    {t("extensions.subagents.providedTitle")}
                  </h3>
                </div>
              </div>
              <div className="settings-panel ext-list" role="list">
                {readOnly.map((definition) => {
                  const key = `${definition.source}:${definition.name}`;
                  const menuOpen = rowMenu === key;
                  return (
                    <div
                      key={key}
                      role="listitem"
                      className={cx("ext-row", "is-provided", menuOpen && "menu-open")}
                    >
                      <span className="ext-row-glyph" aria-hidden>
                        {definition.source === "builtin" ? (
                          <IconShield size={15} />
                        ) : (
                          <IconFolderOpen size={15} />
                        )}
                      </span>
                      <div className="ext-row-copy">
                        <div className="ext-row-title">
                          <span className="ext-row-name">{definition.name}</span>
                          <span className="ext-tag">
                            {definition.source === "builtin"
                              ? t("extensions.subagents.sourceBuiltin")
                              : t("extensions.subagents.sourceProject")}
                          </span>
                        </div>
                        <p className="ext-row-desc">{definition.description}</p>
                        <div className="ext-row-meta">
                          {toolChips(definition.tools)}
                          <span>
                            {t("extensions.subagents.turns", {
                              turns: definition.maxTurns,
                            })}
                          </span>
                          {definition.model ? (
                            <span>{subagentModelKey(definition.model)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="ext-row-controls">
                        <div className="ext-row-actions">
                          <button
                            type="button"
                            className="plugins-icon-btn"
                            aria-label={t("extensions.subagents.copy")}
                            title={t("extensions.subagents.copy")}
                            onClick={() => copyDefinition(definition)}
                          >
                            <IconCopy size={15} />
                          </button>
                          {definition.filePath ? (
                            <div
                              className="plugins-menu-wrap"
                              ref={menuOpen ? rowMenuRef : undefined}
                            >
                              <button
                                type="button"
                                className="plugins-icon-btn"
                                aria-label={t("extensions.subagents.rowActions", {
                                  name: definition.name,
                                })}
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                onClick={() =>
                                  setRowMenu((cur) => (cur === key ? null : key))
                                }
                              >
                                <IconMore size={15} />
                              </button>
                              {menuOpen ? (
                                <div className="plugins-menu is-end" role="menu">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setRowMenu(null);
                                      void run(() =>
                                        api.revealSubagent({
                                          path: definition.filePath,
                                        }),
                                      );
                                    }}
                                  >
                                    <IconFolderOpen size={14} />
                                    {t("extensions.subagents.reveal")}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </>
      )}

      {draft ? (
        <SubagentEditorSheet
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          saving={saving}
          projects={projects}
          currentProjectPath={currentProjectPath}
          onClose={() => {
            setDraft(null);
            setEditing(null);
          }}
          onSave={() => void save()}
          onReveal={
            editing ? () => void run(() => api.revealSubagent({ id: editing.id })) : undefined
          }
        />
      ) : null}
    </div>
  );
}
