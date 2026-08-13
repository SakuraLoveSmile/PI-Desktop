import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  activationState,
  type ActivationScope,
  type ProjectRecord,
  type UserSkillRecord,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Button, cx } from "../ui";
import {
  IconBookOpen,
  IconCircleAlert,
  IconDownload,
  IconFolderOpen,
  IconMore,
  IconPencil,
  IconPlus,
  IconTrash,
} from "../icons";
import { ScopeControl } from "./ScopeControl";
import {
  MAX_SKILL_BYTES,
  SkillEditorSheet,
  draftFromSkill,
  emptySkillDraft,
  skillTemplate,
  type SkillDraft,
} from "./SkillEditorSheet";

/**
 * The Skills tab: markdown documents the user writes, reaching the model through
 * the same catalog-plus-`Skill`-tool path as plugin skills (D174).
 *
 * The row shows the description rather than truncating the body, because the
 * description is what the model actually sees when deciding whether to open the
 * skill — so it is also what the user needs to be able to judge at a glance.
 */
export function SkillsSection({
  projects,
  currentProjectPath,
  query,
}: {
  projects: readonly ProjectRecord[];
  currentProjectPath?: string | null;
  query: string;
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<UserSkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [editing, setEditing] = useState<UserSkillRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const load = () => {
    if (loadInFlightRef.current) return loadInFlightRef.current;
    const request = (async () => {
      try {
        const res = await api.listUserSkills();
        setSkills(res.skills ?? []);
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
      ? skills.filter((skill) =>
          [skill.name, skill.id, skill.description].some((field) =>
            field?.toLocaleLowerCase().includes(needle),
          ),
        )
      : skills;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [skills, query]);

  const create = () => {
    setEditing(null);
    setDraft({ ...emptySkillDraft(), body: skillTemplate("") });
  };

  const openEdit = async (skill: UserSkillRecord) => {
    // The body lives on disk, not in the list payload, so editing reads it first
    // rather than shipping every document into the renderer up front.
    await run(async () => {
      const res = await api.readUserSkill(skill.id);
      setEditing(res.skill ?? skill);
      setDraft(draftFromSkill(res.skill ?? skill, res.body ?? ""));
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    await run(async () => {
      if (editing) {
        await api.updateUserSkill(editing.id, {
          name: draft.name.trim(),
          description: draft.description.trim(),
          body: draft.body,
          enabled: draft.enabled,
          scope: draft.scope,
        });
      } else {
        await api.createUserSkill({
          name: draft.name.trim(),
          description: draft.description.trim(),
          body: draft.body,
          enabled: draft.enabled,
          scope: draft.scope,
        });
      }
      await load();
      setDraft(null);
      setEditing(null);
    });
    setSaving(false);
  };

  const importSkill = () =>
    run(async () => {
      const res = await api.importUserSkill();
      if (res.canceled) return;
      await load();
    });

  return (
    <div className="ext-panel">
      <div className="ext-section-head">
        <div className="ext-section-copy">
          <h2 className="ext-section-title">{t("extensions.skills.title")}</h2>
        </div>
        <div className="ext-section-actions">
          <Button variant="secondary" onClick={() => void importSkill()}>
            <IconDownload size={14} />
            {t("extensions.skills.import")}
          </Button>
          <Button variant="primary" onClick={create}>
            <IconPlus size={14} />
            {t("extensions.skills.add")}
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
      ) : skills.length === 0 ? (
        <div className="settings-panel ext-empty">
          <span className="ext-empty-icon" aria-hidden>
            <IconBookOpen size={18} />
          </span>
          <p className="ext-empty-title">{t("extensions.skills.empty")}</p>
          <div className="ext-empty-actions">
            <Button variant="primary" onClick={create}>
              {t("extensions.skills.add")}
            </Button>
            <Button variant="secondary" onClick={() => void importSkill()}>
              {t("extensions.skills.import")}
            </Button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="settings-panel ext-empty">
          <p className="ext-empty-title">{t("extensions.noMatches")}</p>
        </div>
      ) : (
        <div className="settings-panel ext-list" role="list">
          {visible.map((skill) => {
            const state = activationState(skill);
            const menuOpen = rowMenu === skill.id;
            const oversized = skill.sizeBytes > MAX_SKILL_BYTES;
            return (
              <div
                key={skill.id}
                role="listitem"
                className={cx("ext-row", state === "off" && "is-off", menuOpen && "menu-open")}
              >
                <span className="ext-row-glyph is-skill" aria-hidden>
                  <IconBookOpen size={15} />
                </span>
                <div className="ext-row-copy">
                  <div className="ext-row-title">
                    <span className="ext-row-name">{skill.name}</span>
                    <code className="ext-row-id">{skill.id}</code>
                    {skill.source === "imported" ? (
                      <span className="ext-tag">{t("extensions.skills.imported")}</span>
                    ) : null}
                    {oversized ? (
                      <span className="ext-state-tag is-failed">
                        {t("extensions.skills.tooBigTag")}
                      </span>
                    ) : null}
                  </div>
                  {skill.description ? (
                    <p className="ext-row-desc">{skill.description}</p>
                  ) : (
                    <p className="ext-row-desc is-muted">{t("extensions.skills.noDescription")}</p>
                  )}
                  <div className="ext-row-meta">
                    <span>
                      {t("extensions.skills.size", { kb: Math.max(1, Math.round(skill.sizeBytes / 1024)) })}
                    </span>
                  </div>
                </div>
                <div className="ext-row-controls">
                  <ScopeControl
                    target={skill}
                    label={skill.name}
                    projects={projects}
                    currentProjectPath={currentProjectPath}
                    onSetEnabled={(enabled) =>
                      run(async () => {
                        await api.setUserSkillEnabled(skill.id, enabled);
                        await load();
                      })
                    }
                    onSetScope={(scope: ActivationScope) =>
                      run(async () => {
                        await api.setUserSkillScope(skill.id, scope);
                        await load();
                      })
                    }
                  />
                  <div className="ext-row-actions">
                    <button
                      type="button"
                      className="plugins-icon-btn"
                      aria-label={t("extensions.skills.edit")}
                      title={t("extensions.skills.edit")}
                      onClick={() => void openEdit(skill)}
                    >
                      <IconPencil size={15} />
                    </button>
                    <div className="plugins-menu-wrap" ref={menuOpen ? rowMenuRef : undefined}>
                      <button
                        type="button"
                        className="plugins-icon-btn"
                        aria-label={t("extensions.skills.rowActions", { name: skill.name })}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setRowMenu((cur) => (cur === skill.id ? null : skill.id))}
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
                              void run(() => api.revealUserSkill(skill.id));
                            }}
                          >
                            <IconFolderOpen size={14} />
                            {t("extensions.skills.reveal")}
                          </button>
                          <div className="plugins-menu-sep" />
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              setRowMenu(null);
                              void run(async () => {
                                await api.removeUserSkill(skill.id);
                                await load();
                              });
                            }}
                          >
                            <IconTrash size={14} />
                            {t("extensions.skills.remove")}
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
        <SkillEditorSheet
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
          onReveal={editing ? () => void run(() => api.revealUserSkill(editing.id)) : undefined}
        />
      ) : null}
    </div>
  );
}
