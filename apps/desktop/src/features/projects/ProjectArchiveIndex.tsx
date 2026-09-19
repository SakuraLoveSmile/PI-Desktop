import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../../components/ui";
import { IconFolder, IconStar } from "../../components/icons";
import { projectColor } from "../../lib/recent-projects";
import { normalizeProjectPath } from "../../lib/sidebar-session-groups";
import {
  formatUpdated,
  GROUP_LABEL_KEYS,
  type GroupId,
  type ProjectIndexItem,
} from "../../lib/project-archive";

export function projectRowId(path: string) {
  return `projects-row-${path.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

function rowStatus(args: {
  project: ProjectIndexItem;
  workspacePath?: string | null;
  openProjectPaths: readonly string[];
}): "active" | "open" | "archived" | null {
  const { project, workspacePath, openProjectPaths } = args;
  if (project.archived === true) return "archived";
  if (normalizeProjectPath(workspacePath) === normalizeProjectPath(project.path)) {
    return "active";
  }
  if (
    openProjectPaths.some(
      (path) => normalizeProjectPath(path) === normalizeProjectPath(project.path),
    )
  ) {
    return "open";
  }
  return null;
}

export function ProjectArchiveIndex({
  groups,
  selectedPath,
  workspacePath,
  openProjectPaths,
  locale,
  sessionCounts,
  detail,
  onSelect,
  onActivate,
}: {
  groups: { id: GroupId; rows: ProjectIndexItem[] }[];
  selectedPath: string | null;
  workspacePath?: string | null;
  openProjectPaths: readonly string[];
  locale?: string;
  sessionCounts: Map<string, number>;
  detail?: ReactNode;
  onSelect: (path: string) => void;
  onActivate: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="projects-index">
      {groups.map((group) => (
        <section
          key={group.id}
          className="projects-group"
          aria-labelledby={`projects-group-${group.id}`}
        >
          <div className="projects-group-head">
            <h3 className="projects-group-label" id={`projects-group-${group.id}`}>
              {t(GROUP_LABEL_KEYS[group.id])}
            </h3>
            <span className="projects-group-count">{group.rows.length}</span>
          </div>
          <div className="projects-group-rows" role="list">
            {group.rows.map((project) => {
              const selected = selectedPath === project.path;
              const status = rowStatus({
                project,
                workspacePath,
                openProjectPaths,
              });
              const color = project.color || projectColor(project.path);
              const totalSessions = sessionCounts.get(project.path) ?? 0;
              return (
                <div
                  key={project.path}
                  id={projectRowId(project.path)}
                  role="listitem"
                  aria-selected={selected}
                  className={cx(
                    "projects-row-block",
                    selected && "selected",
                    status === "active" && "active",
                    status === "archived" && "archived",
                  )}
                >
                  <button
                    type="button"
                    className="projects-row"
                    title={project.path}
                    aria-label={t("project.selectProject", { name: project.name })}
                    aria-expanded={selected}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(project.path)}
                    onDoubleClick={() => onActivate(project.path)}
                  >
                    <span className="projects-glyph" style={{ background: color }}>
                      {project.pinned ? (
                        <IconStar size={15} fill="currentColor" aria-hidden />
                      ) : (
                        <IconFolder size={15} aria-hidden />
                      )}
                    </span>
                    <span className="projects-name-copy">
                      <span className="projects-name-title">
                        <span className="projects-name-text">{project.name}</span>
                        {status === "active" ? (
                          <span className="projects-tag is-active">{t("project.active")}</span>
                        ) : status === "open" ? (
                          <span className="projects-tag">{t("project.openTag")}</span>
                        ) : status === "archived" ? (
                          <span className="projects-tag is-archived">{t("project.archivedTag")}</span>
                        ) : null}
                      </span>
                      <span className="projects-name-meta">
                        <span className="projects-name-sessions">
                          {t("project.sessionsCount", { count: totalSessions })}
                        </span>
                      </span>
                    </span>
                    <span className="projects-updated">
                      {formatUpdated(project.openedAt, locale, t("project.updatedNever"))}
                    </span>
                  </button>
                  {selected && detail ? (
                    <div
                      className="projects-inspector"
                      role="region"
                      aria-label={project.name}
                    >
                      {detail}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
