import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectRecord } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { Button } from "../components/ui";
import {
  IconArchive,
  IconArchiveRestore,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconMore,
  IconPin,
  IconPlus,
  IconSearch,
  IconX,
} from "../components/icons";
import {
  loadRecentProjects,
  projectColor,
  type RecentProject,
} from "../lib/recent-projects";
import { collectSessionProjects } from "../lib/session-projects";
import {
  normalizeProjectPath,
  sessionMatchesProject,
} from "../lib/sidebar-session-groups";

function formatUpdated(ts?: number, locale?: string, neverLabel = "—") {
  if (!ts) return neverLabel;
  try {
    const elapsed = Date.now() - ts;
    const minutes = Math.round(elapsed / 60_000);
    if (minutes < 60 * 24 * 7) {
      const rtf = new Intl.RelativeTimeFormat(locale || undefined, {
        numeric: "auto",
      });
      if (minutes < 60) return rtf.format(-Math.max(minutes, 0), "minute");
      if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), "hour");
      return rtf.format(-Math.round(minutes / (60 * 24)), "day");
    }
    const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale || undefined, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    }).format(new Date(ts));
  } catch {
    return neverLabel;
  }
}

function shortenPath(path: string) {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const workspace = useAppStore((s) => s.workspace);
  const openProjectPaths = useAppStore((s) => s.openProjectPaths);
  const projectMeta = useAppStore((s) => s.projectMeta);
  const openProject = useAppStore((s) => s.openProject);
  const activateProject = useAppStore((s) => s.activateProject);
  const clearProject = useAppStore((s) => s.clearProject);
  const closeProject = useAppStore((s) => s.closeProject);
  const toggleProjectPinned = useAppStore((s) => s.toggleProjectPinned);
  const archiveProject = useAppStore((s) => s.archiveProject);
  const restoreProject = useAppStore((s) => s.restoreProject);
  const newSession = useAppStore((s) => s.newSession);
  const selectSession = useAppStore((s) => s.selectSession);
  const setPage = useAppStore((s) => s.setPage);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const showToast = useAppStore((s) => s.showToast);
  const sessions = useAppStore((s) => s.sessions);
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecentProjects());
  const [durableProjects, setDurableProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    void api
      .listProjects()
      .then(({ projects }) => {
        if (!canceled) setDurableProjects(projects);
      })
      .catch(() => {
        // Session-derived entries below keep the index useful if host listing fails.
      });
    return () => {
      canceled = true;
    };
  }, [sessions]);

  const items = useMemo(() => {
    const byPath = new Map<string, RecentProject>();
    for (const project of durableProjects) {
      const key = normalizeProjectPath(project.path);
      if (!key) continue;
      byPath.set(key, {
        path: project.path,
        name: project.name,
        openedAt: project.lastOpenedAt,
        pinned: project.pinned,
        color: projectColor(project.path),
      });
    }
    for (const project of recents) {
      const key = normalizeProjectPath(project.path);
      if (!key) continue;
      const existing = byPath.get(key);
      byPath.set(key, {
        ...existing,
        ...project,
        openedAt: Math.max(existing?.openedAt ?? 0, project.openedAt),
        pinned: project.pinned ?? existing?.pinned,
      });
    }
    for (const project of collectSessionProjects(sessions)) {
      const key = normalizeProjectPath(project.path);
      if (!key) continue;
      const existing = byPath.get(key);
      byPath.set(key, {
        path: existing?.path ?? project.path,
        name: existing?.name ?? project.name,
        branch: existing?.branch,
        openedAt: Math.max(existing?.openedAt ?? 0, project.updatedAt),
        pinned: existing?.pinned,
        color: existing?.color ?? projectColor(project.path),
      });
    }
    if (workspace?.path) {
      const key = normalizeProjectPath(workspace.path);
      const existing = key ? byPath.get(key) : undefined;
      if (key) {
        byPath.set(key, {
          path: workspace.path,
          name: workspace.name || existing?.name || workspace.path,
          branch: workspace.branch || existing?.branch,
          openedAt: Math.max(existing?.openedAt ?? 0, Date.now()),
          pinned: existing?.pinned,
          color: existing?.color ?? projectColor(workspace.path),
        });
      }
    }
    const merged = [...byPath.values()].map((project) => {
      const meta = projectMeta[normalizeProjectPath(project.path) || project.path] ?? {};
      return {
        ...project,
        pinned: meta.pinned ?? project.pinned,
        archived: meta.archived === true,
      };
    });
    return merged.sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        b.openedAt - a.openedAt ||
        a.path.localeCompare(b.path),
    );
  }, [durableProjects, recents, sessions, workspace, projectMeta]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        (p.branch || "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const activate = async (path: string): Promise<boolean> => {
    try {
      const key = normalizeProjectPath(path);
      const archived = Boolean(key && projectMeta[key]?.archived);
      if (normalizeProjectPath(workspace?.path) === normalizeProjectPath(path)) {
        if (archived) restoreProject(path);
        setPage("chat");
        return true;
      }
      const activated = await activateProject(path);
      if (!activated) {
        showToast(t("project.none"), { variant: "error" });
        return false;
      }
      if (archived) restoreProject(path);
      setRecents(loadRecentProjects());
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
      return false;
    }
  };

  const startTask = async (path: string) => {
    try {
      if (!(await activate(path))) return;
      await newSession({ projectPath: path });
      setPage("chat");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const openProjectSession = async (path: string, sessionId: string) => {
    if (!(await activate(path))) return;
    if (
      normalizeProjectPath(useAppStore.getState().workspace?.path) !==
      normalizeProjectPath(path)
    ) {
      return;
    }
    try {
      await selectSession(sessionId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const toggleProjectArchive = async (project: (typeof items)[number]) => {
    setMenuFor(null);
    if (project.archived) {
      restoreProject(project.path);
      return;
    }
    try {
      const projectKey = normalizeProjectPath(project.path);
      const isActive = normalizeProjectPath(workspace?.path) === projectKey;
      if (isActive) {
        const fallbackPath = [...openProjectPaths]
          .reverse()
          .find((path) => {
            const key = normalizeProjectPath(path);
            return key !== projectKey && !(key && projectMeta[key]?.archived);
          });
        if (fallbackPath) {
          const activated = await activateProject(fallbackPath);
          if (!activated) throw new Error(t("project.none"));
          // Project management actions should keep the archive visible.
          setSettingsTab("projects");
        } else {
          await clearProject();
        }
      }
      archiveProject(project.path);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    }
  };

  const closeProjectFromIndex = async (path: string) => {
    try {
      await closeProject(path);
      setSettingsTab("projects");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    }
  };

  return (
    <div className="settings-project-archive">
      <div className="projects-index">
        <div className="projects-index-header">
          <div className="projects-index-tools">
            <div className="projects-search-wrap">
              <IconSearch size={14} />
              <input
                className="projects-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("project.searchPlaceholder")}
                aria-label={t("project.searchPlaceholder")}
              />
            </div>
            <Button
              variant="primary"
              onClick={() => void openProject().then(() => setRecents(loadRecentProjects()))}
            >
              <IconPlus size={14} />
              {t("project.add")}
            </Button>
          </div>
        </div>

        <div className="projects-list" role="list" aria-label={t("project.title")}>
          {filtered.length === 0 ? (
            <div className="projects-empty">
              <div className="projects-empty-title">
                {items.length === 0
                  ? t("project.noProjects")
                  : t("project.noSearchResults")}
              </div>
              <div className="projects-empty-body">
                {items.length === 0
                  ? t("project.emptyIndexBody")
                  : t("project.noSearchResultsBody")}
              </div>
              {items.length === 0 ? (
                <Button
                  className="mt-4"
                  variant="primary"
                  onClick={() => void openProject().then(() => setRecents(loadRecentProjects()))}
                >
                  <IconPlus size={14} />
                  {t("project.add")}
                </Button>
              ) : null}
            </div>
          ) : (
            filtered.map((project) => {
              const active =
                normalizeProjectPath(workspace?.path) ===
                normalizeProjectPath(project.path);
              const archived = project.archived === true;
              const retained = openProjectPaths.some(
                (path) =>
                  normalizeProjectPath(path) === normalizeProjectPath(project.path),
              );
              const color = project.color || projectColor(project.path);
              const isOpen = !!expanded[project.path];
              const related = sessions
                .filter((session) => sessionMatchesProject(session, project.path))
                .slice(0, 4);
              return (
                <div
                  key={project.path}
                  role="listitem"
                  className={`projects-row-block ${active ? "active" : ""} ${archived ? "archived" : ""} ${menuFor === project.path ? "menu-open" : ""}`}
                >
                  <div className="projects-row">
                    <button
                      type="button"
                      className="projects-expand"
                      aria-label={t(
                        isOpen ? "project.collapseDetails" : "project.expandDetails",
                        { name: project.name },
                      )}
                      aria-expanded={isOpen}
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [project.path]: !prev[project.path] }))
                      }
                    >
                      {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </button>
                    <button
                      type="button"
                      className="projects-name-btn"
                      onClick={() => void activate(project.path)}
                      title={project.path}
                    >
                      <span className="projects-glyph" style={{ background: color }}>
                        <IconFolder size={14} />
                      </span>
                      <span className="projects-name-copy">
                        <span className="projects-name-title">
                          {project.name}
                          {project.pinned ? <span className="projects-pin-dot" /> : null}
                          {active ? (
                            <span className="projects-active-tag">{t("project.active")}</span>
                          ) : null}
                        </span>
                        <span className="projects-name-path">
                          {shortenPath(project.path)}
                          {project.branch ? (
                            <span className="projects-name-branch"> · {project.branch}</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <span className="projects-updated">
                      {formatUpdated(
                        project.openedAt,
                        i18n.resolvedLanguage || i18n.language,
                        t("project.updatedNever"),
                      )}
                    </span>
                    <div className="projects-menu-wrap">
                          <button
                            type="button"
                            className="projects-icon-btn"
                            aria-label={t("project.openActions", { name: project.name })}
                            title={t("project.openActions", { name: project.name })}
                            aria-haspopup="menu"
                            aria-expanded={menuFor === project.path}
                            onClick={() =>
                              setMenuFor((cur) => (cur === project.path ? null : project.path))
                            }
                          >
                            <IconMore size={16} />
                          </button>
                          {menuFor === project.path ? (
                            <div className="projects-menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuFor(null);
                                  void startTask(project.path);
                                }}
                              >
                                {t("project.newTask")}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  toggleProjectPinned(project.path, !project.pinned);
                                  setMenuFor(null);
                                }}
                              >
                                <IconPin size={14} />
                                {project.pinned
                                  ? t("project.unpin")
                                  : t("project.pin")}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => void toggleProjectArchive(project)}
                              >
                                {archived ? (
                                  <IconArchiveRestore size={14} />
                                ) : (
                                  <IconArchive size={14} />
                                )}
                                {archived
                                  ? t("project.restore", {
                                      defaultValue: "Restore project",
                                    })
                                  : t("project.archive", {
                                      defaultValue: "Archive project",
                                    })}
                              </button>
                              {retained ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setMenuFor(null);
                                    void closeProjectFromIndex(project.path);
                                  }}
                                >
                                  <IconX size={14} />
                                  {t("project.close")}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                    </div>
                  </div>
                  {isOpen ? (
                    <div className="projects-row-detail">
                      <div className="projects-detail-label">{t("project.sessions")}</div>
                      {related.length === 0 ? (
                        <div className="projects-detail-empty">{t("project.noSessions")}</div>
                      ) : (
                        <div className="projects-detail-tasks">
                          {related.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className="projects-detail-task"
                              onClick={() => void openProjectSession(project.path, s.id)}
                            >
                              {s.title || s.id}
                            </button>
                          ))}
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="projects-detail-new"
                        onClick={() => void startTask(project.path)}
                      >
                        <IconPlus size={13} />
                        {t("project.newTask")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
