import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isDefaultSessionTitle, useAppStore } from "../stores/app-store";
import { normalizeProjectPath } from "../lib/sidebar-session-groups";
import {
  sidebarSessionStatus,
  type SidebarSessionStatus,
} from "../lib/sidebar-session-status";
import type { ProjectWorkspace, SessionSummary } from "@pi-desktop/shared";
import type {
  ProjectMeta,
  SessionMeta,
  SessionSort,
} from "../lib/sidebar-preferences";
import { BrandLogo } from "./BrandLogo";
import { NotificationCenter } from "./NotificationCenter";
import {
  IconArchive,
  IconArchiveRestore,
  IconArrowUpDown,
  IconAt,
  IconBranch,
  IconCheck,
  IconChevronDown,
  IconCircleAlert,
  IconNewSession,
  IconFolder,
  IconFileText,
  IconMore,
  IconNewProject,
  IconPin,
  IconSearch,
  IconSidebar,
  IconSettings,
  IconSliders,
  IconUser,
  IconX,
} from "./icons";

type ProjectEntry = {
  path: string;
  key: string;
  name: string;
  sessions: SessionSummary[];
  open: boolean;
  active: boolean;
  meta: ProjectMeta;
};

function projectName(path: string, fallback?: string) {
  if (fallback?.trim()) return fallback.trim();
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalTimestamp(value?: string): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionArchived(
  session: SessionSummary,
  meta: SessionMeta | undefined,
): boolean {
  return Boolean(meta?.archived || (session as SessionSummary & { archived?: boolean }).archived);
}

function sessionPinned(
  session: SessionSummary,
  meta: SessionMeta | undefined,
): boolean {
  return Boolean(meta?.pinned || (session as SessionSummary & { pinned?: boolean }).pinned);
}

function projectMetaFor(
  path: string,
  projectMeta: Record<string, ProjectMeta>,
): ProjectMeta {
  return projectMeta[normalizeProjectPath(path) || path] ?? projectMeta[path] ?? {};
}

function projectDomId(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sidebar-project-${(hash >>> 0).toString(36)}`;
}

function firstSessionDate(
  sessions: SessionSummary[],
  field: "createdAt" | "updatedAt",
): number | null {
  const values = sessions
    .map((session) => timestamp(session[field]))
    .filter((value) => value > 0);
  return values.length ? Math.min(...values) : null;
}

function lastSessionDate(
  sessions: SessionSummary[],
  field: "createdAt" | "updatedAt",
): number | null {
  const values = sessions
    .map((session) => timestamp(session[field]))
    .filter((value) => value > 0);
  return values.length ? Math.max(...values) : null;
}

function compareOptionalDate(
  a: number | null,
  b: number | null,
  descending: boolean,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return descending ? b - a : a - b;
}

export function Sidebar({
  onOpenSearch,
  onToggleSidebar,
  sidebarToggleShortcut,
}: {
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  sidebarToggleShortcut: string;
}) {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workspace = useAppStore((s) => s.workspace);
  const openProjects = useAppStore((s) => s.openProjects);
  const openProjectPathsState = useAppStore((s) => s.openProjectPaths);
  const activeProjectPathState = useAppStore((s) => s.activeProjectPath);
  const projectMeta = useAppStore((s) => s.projectMeta);
  const projectCollapsed = useAppStore((s) => s.projectCollapsed);
  const sessionMeta = useAppStore((s) => s.sessionMeta);
  const sessionView = useAppStore((s) => s.sessionView);
  const projectSort = useAppStore((s) => s.projectSort);
  const runningSessions = useAppStore((s) => s.runningSessions);
  const sessionOutcomes = useAppStore((s) => s.sessionOutcomes);
  const setPage = useAppStore((s) => s.setPage);
  const settings = useAppStore((s) => s.settings);
  const page = useAppStore((s) => s.page);
  const selectSession = useAppStore((s) => s.selectSession);
  const newSession = useAppStore((s) => s.newSession);
  const forkSessionAction = useAppStore((s) => s.forkSession);
  const openProject = useAppStore((s) => s.openProject);
  const clearProject = useAppStore((s) => s.clearProject);
  const activateProject = useAppStore((s) => s.activateProject);
  const closeProjectAction = useAppStore((s) => s.closeProject);
  const toggleSessionPinned = useAppStore((s) => s.toggleSessionPinned);
  const archiveSessionAction = useAppStore((s) => s.archiveSession);
  const restoreSession = useAppStore((s) => s.restoreSession);
  const deleteSessionAction = useAppStore((s) => s.deleteSession);
  const setSessionSort = useAppStore((s) => s.setSessionSort);
  const setSessionArchiveVisibility = useAppStore((s) => s.setSessionArchiveVisibility);
  const toggleProjectPinned = useAppStore((s) => s.toggleProjectPinned);
  const archiveProjectAction = useAppStore((s) => s.archiveProject);
  const restoreProject = useAppStore((s) => s.restoreProject);
  const setProjectCollapsed = useAppStore((s) => s.setProjectCollapsed);
  const setProjectSort = useAppStore((s) => s.setProjectSort);
  const showToast = useAppStore((s) => s.showToast);

  const [profileOpen, setProfileOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuFirstItemRef = useRef<HTMLButtonElement | null>(null);

  const showArchived = sessionView.archived;
  const sessionSort = sessionView.sort;
  const displaySessionSort: Exclude<SessionSort, "manual"> =
    sessionSort === "manual" ? "recent" : sessionSort;
  const displayProjectSort: Exclude<SessionSort, "manual"> =
    projectSort === "manual" ? "recent" : projectSort;
  const activeProjectPath = normalizeProjectPath(activeProjectPathState ?? workspace?.path);
  const openProjectPaths = useMemo(
    () =>
      openProjectPathsState
        .map((path) => normalizeProjectPath(path))
        .filter((path): path is string => Boolean(path)),
    [openProjectPathsState],
  );

  const closeMenus = useCallback((restoreFocus = true) => {
    const trigger = menuTriggerRef.current;
    setProfileOpen(false);
    setSortOpen(false);
    setSessionMenu(null);
    setProjectMenu(null);
    setMenuPosition(null);
    if (restoreFocus && trigger) requestAnimationFrame(() => trigger.focus());
  }, []);

  const placeMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 220)),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  // Context-menu variant: anchor to the pointer. The menu is positioned by
  // its right edge, so keep that edge far enough from the left border for
  // the 184px menu to stay on screen.
  const placeMenuAtPoint = useCallback((x: number, y: number) => {
    setMenuPosition({
      top: Math.max(8, Math.min(y + 4, window.innerHeight - 220)),
      right: Math.min(
        Math.max(8, window.innerWidth - x),
        Math.max(8, window.innerWidth - 192),
      ),
    });
  }, []);

  const openSessionRowMenu = useCallback(
    (sessionId: string, trigger: HTMLButtonElement | null) => {
      menuTriggerRef.current = trigger;
      setSortOpen(false);
      setProjectMenu(null);
      setSessionMenu(sessionId);
    },
    [],
  );

  const openProjectRowMenu = useCallback(
    (projectKey: string, trigger: HTMLButtonElement | null) => {
      menuTriggerRef.current = trigger;
      setSortOpen(false);
      setSessionMenu(null);
      setProjectMenu(projectKey);
    },
    [],
  );

  useEffect(() => {
    if (!profileOpen && !sortOpen && !sessionMenu && !projectMenu) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (profileRef.current?.contains(target)) return;
      if ((target as Element)?.closest?.(".sidebar-popover, .sidebar-row-menu")) return;
      closeMenus(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeMenus();
    };
    const onViewportChange = () => closeMenus(false);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [profileOpen, sortOpen, sessionMenu, projectMenu, closeMenus]);

  useEffect(() => {
    if (!sessionMenu && !projectMenu && !sortOpen && !profileOpen) return;
    requestAnimationFrame(() => menuFirstItemRef.current?.focus());
  }, [sessionMenu, projectMenu, sortOpen, profileOpen]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
      ),
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };

  const taskTitle = useCallback((title?: string | null) => {
    const value = (title || "").trim();
    return isDefaultSessionTitle(value) ? t("chat.untitledTask") : value;
  }, [t]);

  const filtered = useMemo(() => {
    const candidates = showArchived
      ? sessions
      : sessions.filter(
          (session) => !sessionArchived(session, sessionMeta[session.id]),
        );
    // Keep at most one empty draft in each project/temporary scope.
    const keptEmptyScopes = new Set<string>();
    const cleaned: SessionSummary[] = [];
    for (const session of candidates) {
      if (!isDefaultSessionTitle(session.title)) {
        cleaned.push(session);
        continue;
      }
      const scope = normalizeProjectPath(session.projectPath) ?? "(temporary)";
      if (session.id === activeSessionId && page === "chat") {
        if (!keptEmptyScopes.has(scope)) cleaned.push(session);
        keptEmptyScopes.add(scope);
        continue;
      }
      if (keptEmptyScopes.has(scope)) continue;
      cleaned.push(session);
      keptEmptyScopes.add(scope);
    }
    return cleaned;
  }, [
    sessions,
    activeSessionId,
    page,
    showArchived,
    sessionMeta,
  ]);

  const compareSessions = useCallback((a: SessionSummary, b: SessionSummary) => {
    const aMeta = sessionMeta[a.id] ?? {};
    const bMeta = sessionMeta[b.id] ?? {};
    const archiveOrder = Number(sessionArchived(a, aMeta)) - Number(sessionArchived(b, bMeta));
    if (archiveOrder !== 0) return archiveOrder;
    const pinOrder = Number(sessionPinned(b, bMeta)) - Number(sessionPinned(a, aMeta));
    if (pinOrder !== 0) return pinOrder;
    if (displaySessionSort === "name") {
      const byName = taskTitle(a.title).localeCompare(taskTitle(b.title), undefined, {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
    } else if (displaySessionSort === "oldest") {
      const byCreated = compareOptionalDate(
        optionalTimestamp(a.createdAt),
        optionalTimestamp(b.createdAt),
        false,
      );
      if (byCreated !== 0) return byCreated;
    } else if (displaySessionSort === "created") {
      const byCreated = compareOptionalDate(
        optionalTimestamp(a.createdAt),
        optionalTimestamp(b.createdAt),
        true,
      );
      if (byCreated !== 0) return byCreated;
    } else {
      const byRecent = compareOptionalDate(
        optionalTimestamp(a.updatedAt),
        optionalTimestamp(b.updatedAt),
        true,
      );
      if (byRecent !== 0) return byRecent;
    }
    return a.id.localeCompare(b.id);
  }, [displaySessionSort, sessionMeta, taskTitle]);

  const projectEntries = useMemo(() => {
    const byPath = new Map<string, ProjectEntry>();
    const add = (rawPath: string, name?: string, open = false) => {
      const normalized = normalizeProjectPath(rawPath);
      if (!normalized) return;
      const existing = byPath.get(normalized);
      if (existing) {
        existing.open ||= open;
        if (name && existing.name === projectName(existing.path)) existing.name = name;
        return;
      }
      byPath.set(normalized, {
        path: rawPath,
        key: normalized,
        name: projectName(rawPath, name),
        sessions: [],
        open,
        active: normalized === activeProjectPath,
        meta: projectMetaFor(rawPath, projectMeta),
      });
    };
    for (const path of openProjectPaths) {
      const record = openProjects.find(
        (project) => normalizeProjectPath(project.path) === path,
      );
      add(path, record?.name, true);
    }
    if (workspace?.path) add(workspace.path, workspace.name, true);
    for (const session of filtered) {
      const sessionPath = normalizeProjectPath(session.projectPath);
      if (!sessionPath) continue;
      // A closed project remains discoverable in Projects, but its historical
      // sessions must not recreate a sidebar tab that the user just closed.
      const entry = byPath.get(sessionPath);
      if (entry) entry.sessions.push(session);
    }
    const result = [...byPath.values()].filter(
      (entry) => showArchived || !entry.meta.archived,
    );
    for (const entry of result) entry.sessions.sort(compareSessions);
    result.sort((a, b) => {
      const archiveOrder = Number(!!a.meta.archived) - Number(!!b.meta.archived);
      if (archiveOrder !== 0) return archiveOrder;
      const pinOrder = Number(!!b.meta.pinned) - Number(!!a.meta.pinned);
      if (pinOrder !== 0) return pinOrder;
      if (displayProjectSort === "name") {
        const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        if (byName !== 0) return byName;
      } else if (
        displayProjectSort === "oldest" ||
        displayProjectSort === "created"
      ) {
        const dateForProject =
          displayProjectSort === "oldest" ? firstSessionDate : lastSessionDate;
        const aCreated = dateForProject(a.sessions, "createdAt");
        const bCreated = dateForProject(b.sessions, "createdAt");
        const byCreated = compareOptionalDate(
          aCreated,
          bCreated,
          displayProjectSort === "created",
        );
        if (byCreated !== 0) return byCreated;
      } else {
        const aRecent = lastSessionDate(a.sessions, "updatedAt");
        const bRecent = lastSessionDate(b.sessions, "updatedAt");
        const byRecent = compareOptionalDate(aRecent, bRecent, true);
        if (byRecent !== 0) return byRecent;
      }
      return a.key.localeCompare(b.key);
    });
    return result;
  }, [
    filtered,
    openProjectPaths,
    openProjects,
    workspace,
    activeProjectPath,
    projectMeta,
    showArchived,
    displayProjectSort,
    sessionMeta,
    compareSessions,
  ]);

  const temporarySessions = useMemo(
    () => filtered
      .filter((session) => !normalizeProjectPath(session.projectPath))
      .sort(compareSessions),
    [filtered, compareSessions],
  );
  const renderSessionStatus = (status: SidebarSessionStatus) => {
    const labelKey =
      status === "running"
        ? "nav.sessionRunning"
        : status === "selected"
          ? "nav.sessionSelected"
          : status === "completed"
            ? "nav.sessionCompleted"
            : "nav.sessionFailed";
    const fallback =
      status === "running"
        ? "In progress"
        : status === "selected"
          ? "Selected"
          : status === "completed"
            ? "Completed"
            : "Failed";
    const label = t(labelKey, { defaultValue: fallback });
    return (
      <span className={`thread-item-status ${status}`} aria-label={label} title={label}>
        {status === "completed" ? <IconCheck size={10} aria-hidden /> : null}
        {status === "failed" ? <IconCircleAlert size={11} aria-hidden /> : null}
      </span>
    );
  };

  const reportError = useCallback(
    (error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    },
    [showToast],
  );

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
    });
  }, []);

  const selectProject = async (path: string): Promise<boolean> => {
    const normalized = normalizeProjectPath(path);
    if (!normalized) return false;
    if (normalized === activeProjectPath) return true;
    try {
      return Boolean(await activateProject(path));
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const selectProjectSession = async (session: SessionSummary): Promise<boolean> => {
    if (session.projectPath && !(await selectProject(session.projectPath))) return false;
    await selectSession(session.id);
    focusComposer();
    return true;
  };

  const selectTemporarySession = async (sessionId: string) => {
    try {
      if (workspace) await clearProject();
      await selectSession(sessionId);
      focusComposer();
    } catch (error) {
      reportError(error);
    }
  };

  const setCollapsed = (path: string, value: boolean) => {
    const normalized = normalizeProjectPath(path) || path;
    setProjectCollapsed(normalized, value);
  };

  const setSort = (next: SessionSort) => {
    setSessionSort(next);
    setProjectSort(next);
    closeMenus();
  };

  const toggleShowArchived = () => {
    const next = !showArchived;
    setSessionArchiveVisibility(next);
    closeMenus();
  };

  const toggleSessionPin = (session: SessionSummary) => {
    toggleSessionPinned(session.id);
    closeMenus();
  };

  const archiveSession = async (session: SessionSummary) => {
    const archived = sessionArchived(session, sessionMeta[session.id]);
    const wasActive = activeSessionId === session.id;
    const next =
      !archived && wasActive
        ? session.projectPath
          ? projectEntries
              .find((entry) => entry.key === normalizeProjectPath(session.projectPath))
              ?.sessions.find(
                (item) =>
                  item.id !== session.id &&
                  !sessionArchived(item, sessionMeta[item.id]),
              )
          : temporarySessions.find(
              (item) =>
                item.id !== session.id &&
                !sessionArchived(item, sessionMeta[item.id]),
            )
        : undefined;
    try {
      closeMenus();
      if (archived) {
        restoreSession(session.id);
        return;
      }
      if (wasActive && next) {
        if (!(await selectProjectSession(next))) return;
        archiveSessionAction(session.id);
        return;
      }
      if (wasActive) {
        // Archive first so an empty active draft is not reused as its own
        // replacement. Restore it if creating the fallback draft fails.
        archiveSessionAction(session.id);
        try {
          await newSession({ projectPath: session.projectPath ?? null });
        } catch (error) {
          restoreSession(session.id);
          throw error;
        }
        return;
      }
      archiveSessionAction(session.id);
    } catch (error) {
      reportError(error);
    }
  };

  const deleteSession = async (session: SessionSummary) => {
    closeMenus();
    const wasActive = activeSessionId === session.id;
    const sameScope = session.projectPath
      ? projectEntries.find(
          (entry) => entry.key === normalizeProjectPath(session.projectPath),
        )?.sessions ?? []
      : temporarySessions;
    const next = wasActive
      ? sameScope.find(
          (item) =>
            item.id !== session.id &&
            !sessionArchived(item, sessionMeta[item.id]),
        ) ?? projectEntries
          .flatMap((entry) => entry.sessions)
          .find(
            (item) =>
              item.id !== session.id &&
              !sessionArchived(item, sessionMeta[item.id]),
          )
      : undefined;
    try {
      await deleteSessionAction(session.id);
      if (wasActive) {
        if (next) await selectProjectSession(next);
        else await newSession({ projectPath: session.projectPath ?? null });
      }
    } catch (error) {
      reportError(error);
    }
  };

  const openSessionFolder = async (session: SessionSummary) => {
    closeMenus(false);
    try {
      await (await import("../lib/api")).api.openSessionFolder(session.id);
    } catch (error) {
      reportError(error);
    }
  };

  const forkSession = async (session: SessionSummary) => {
    closeMenus(false);
    try {
      await forkSessionAction(session.id);
      focusComposer();
    } catch (error) {
      reportError(error);
    }
  };

  const toggleProjectPin = (entry: ProjectEntry) => {
    toggleProjectPinned(entry.path);
    closeMenus();
  };

  const archiveProject = async (entry: ProjectEntry) => {
    const archived = Boolean(entry.meta.archived);
    const wasActive = entry.active;
    const next = !archived
      ? projectEntries.find(
          (candidate) =>
            candidate.key !== entry.key && !candidate.meta.archived,
        )
      : undefined;
    try {
      closeMenus();
      if (archived) {
        restoreProject(entry.path);
        return;
      }
      // Move the visible context before hiding the active project. This
      // prevents an archived, invisible project from remaining active.
      if (wasActive) {
        if (next) {
          if (!(await selectProject(next.path))) return;
        } else {
          await clearProject();
        }
      }
      archiveProjectAction(entry.path);
    } catch (error) {
      reportError(error);
    }
  };

  const closeProject = async (entry: ProjectEntry) => {
    closeMenus();
    try {
      await closeProjectAction(entry.path);
    } catch (error) {
      reportError(error);
    }
  };

  const createSession = async (options?: { projectPath?: string | null }) => {
    try {
      await newSession(options);
      focusComposer();
    } catch (error) {
      reportError(error);
    }
  };

  const createProjectSession = async (path: string) => {
    if (!(await selectProject(path))) return;
    await createSession({ projectPath: path });
  };

  const openProjectPicker = async () => {
    try {
      await openProject();
    } catch (error) {
      reportError(error);
    }
  };

  const renderSessionRows = (
    items: SessionSummary[],
    options?: { temporary?: boolean; projectPath?: string },
  ) => items.map((session) => {
    const meta = sessionMeta[session.id] ?? {};
    const active = page === "chat" && activeSessionId === session.id;
    const archived = sessionArchived(session, meta);
    const running = Boolean(runningSessions[session.id]);
    const status = sidebarSessionStatus({
      running,
      selected: active,
      outcome: sessionOutcomes[session.id],
    });
    return (
      <div
        key={session.id}
        className={`thread-item ${active ? "active" : ""} ${archived ? "archived" : ""}`}
        data-sidebar-session-row={session.id}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          placeMenuAtPoint(event.clientX, event.clientY);
          openSessionRowMenu(
            session.id,
            event.currentTarget.querySelector<HTMLButtonElement>(
              '[data-action="session-menu"]',
            ),
          );
        }}
      >
        <button
          type="button"
          className="thread-item-main"
          onClick={() => void (options?.temporary ? selectTemporarySession(session.id) : selectProjectSession(session))}
          title={taskTitle(session.title)}
          aria-current={active ? "page" : undefined}
        >
          {status ? renderSessionStatus(status) : null}
          {sessionPinned(session, meta) ? (
            <IconPin size={11} className="thread-item-pin" aria-hidden />
          ) : null}
          <span className="thread-item-title">{taskTitle(session.title)}</span>
        </button>
        <div className="sidebar-row-actions">
          <button
            type="button"
            className="thread-item-more"
            data-action="session-menu"
            aria-label={t("nav.sessionActions", { defaultValue: "Session actions" })}
            aria-haspopup="menu"
            aria-expanded={sessionMenu === session.id}
            onClick={(event) => {
              event.stopPropagation();
              if (sessionMenu === session.id) {
                closeMenus();
                return;
              }
              placeMenu(event);
              openSessionRowMenu(session.id, event.currentTarget);
            }}
          >
            <IconMore size={14} />
          </button>
        </div>
      </div>
    );
  });

  const renderProjectGroup = (entry: ProjectEntry) => {
    const collapsedProject = entry.meta.collapsed ?? projectCollapsed[entry.key] ?? false;
    const projectId = projectDomId(entry.key);
    const isMenuOpen = projectMenu === entry.key;
    return (
      <section
        key={entry.key}
        className={`sidebar-session-group project-group ${entry.active ? "active" : ""} ${entry.meta.archived ? "archived" : ""}`}
        aria-labelledby={projectId}
        data-sidebar-project-group={entry.key}
      >
        <div
          className="sidebar-session-group-header"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            placeMenuAtPoint(event.clientX, event.clientY);
            openProjectRowMenu(
              entry.key,
              event.currentTarget.querySelector<HTMLButtonElement>(
                ".project-more",
              ),
            );
          }}
        >
          <button
            type="button"
            id={projectId}
            className="sidebar-session-group-title project-toggle"
            title={entry.path}
            aria-expanded={!collapsedProject}
            aria-controls={`${projectId}-sessions`}
            data-action="toggle-project-collapse"
            onClick={() => void (async () => {
              if (!entry.active && !(await selectProject(entry.path))) return;
              setCollapsed(entry.path, !collapsedProject);
            })()}
          >
            <IconChevronDown
              size={13}
              className={`sidebar-disclosure-icon ${collapsedProject ? "collapsed" : ""}`}
            />
            <IconFolder size={13} />
            <span>{entry.name}</span>
            {entry.active ? <span className="sidebar-project-active-dot" aria-label={t("project.active", { defaultValue: "Active" })} /> : null}
          </button>
          <button
            type="button"
            className="sidebar-session-group-add"
            title={entry.active ? t("project.newTask") : t("project.openAndNewTask", { defaultValue: "Open project and create task" })}
            aria-label={entry.active ? t("project.newTask") : t("project.openAndNewTask", { defaultValue: "Open project and create task" })}
            onClick={() => void createProjectSession(entry.path)}
          >
            <IconNewSession size={13} />
          </button>
          <div className="sidebar-menu-wrap">
            <button
              type="button"
              className="thread-item-more project-more"
              aria-label={t("project.openActions", { name: entry.name })}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                if (isMenuOpen) {
                  closeMenus();
                  return;
                }
                placeMenu(event);
                openProjectRowMenu(entry.key, event.currentTarget);
              }}
            >
              <IconMore size={14} />
            </button>
          </div>
        </div>
        {!collapsedProject ? (
          <div id={`${projectId}-sessions`} className="sidebar-session-group-body project">
            {entry.sessions.length > 0 ? renderSessionRows(entry.sessions, { projectPath: entry.path }) : (
              <div className="sidebar-session-empty">{t("nav.noProjectSessions")}</div>
            )}
          </div>
        ) : null}
      </section>
    );
  };

  const renderFloatingMenu = () => {
    if (
      !menuPosition ||
      typeof document === "undefined" ||
      (!sessionMenu && !projectMenu && !sortOpen)
    ) {
      return null;
    }
    if (sortOpen) {
      return createPortal(
        <div
          className="sidebar-popover sidebar-sort-menu sidebar-floating-menu"
          role="menu"
          onKeyDown={onMenuKeyDown}
          style={{ top: menuPosition.top, right: menuPosition.right }}
        >
          <div className="sidebar-popover-title">
            {t("nav.sortSessions", { defaultValue: "Sort sessions" })}
          </div>
          {(["recent", "oldest", "name", "created"] as const).map((value, index) => (
            <button ref={index === 0 ? menuFirstItemRef : undefined} key={value} type="button" role="menuitemradio" aria-checked={displaySessionSort === value} className={displaySessionSort === value ? "selected" : ""} data-sort={value} onClick={() => setSort(value)}>
              <span>{value === "recent" ? t("nav.sortRecent", { defaultValue: "Recently updated" }) : value === "oldest" ? t("nav.sortOldest", { defaultValue: "Oldest first" }) : value === "name" ? t("nav.sortName", { defaultValue: "Name" }) : t("nav.sortCreated", { defaultValue: "Created date" })}</span>
              {displaySessionSort === value ? <span className="sidebar-sort-check">✓</span> : null}
            </button>
          ))}
          <div className="sidebar-popover-divider" />
          <button type="button" role="menuitemcheckbox" aria-checked={showArchived} data-action="toggle-show-archived" onClick={toggleShowArchived}>
            <span>{showArchived ? t("nav.hideArchived", { defaultValue: "Hide archived" }) : t("nav.showArchived", { defaultValue: "Show archived" })}</span>
            <span className={`sidebar-checkbox ${showArchived ? "checked" : ""}`}>{showArchived ? "✓" : ""}</span>
          </button>
        </div>,
        document.body,
      );
    }
    const session = sessionMenu
      ? sessions.find((item) => item.id === sessionMenu)
      : undefined;
    const entry = projectMenu
      ? projectEntries.find((item) => item.key === projectMenu)
      : undefined;
    if (!session && !entry) return null;
    return createPortal(
      <div
        className="sidebar-row-menu sidebar-floating-menu"
        role="menu"
        onKeyDown={onMenuKeyDown}
        style={{ top: menuPosition.top, right: menuPosition.right }}
      >
        {session ? (
          <>
            <button
              ref={menuFirstItemRef}
              type="button"
              role="menuitem"
              data-action="toggle-session-pin"
              onClick={() => toggleSessionPin(session)}
            >
              <IconPin size={14} />
              {sessionPinned(session, sessionMeta[session.id])
                ? t("nav.unpinTask", { defaultValue: "Unpin" })
                : t("nav.pinTask", { defaultValue: "Pin" })}
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="toggle-session-archive"
              onClick={() => void archiveSession(session)}
            >
              {sessionArchived(session, sessionMeta[session.id]) ? (
                <IconArchiveRestore size={14} />
              ) : (
                <IconArchive size={14} />
              )}
              {sessionArchived(session, sessionMeta[session.id])
                ? t("nav.restoreTask", { defaultValue: "Restore" })
                : t("nav.archiveTask", { defaultValue: "Archive" })}
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="fork-session"
              disabled={Boolean(runningSessions[session.id])}
              onClick={() => void forkSession(session)}
            >
              <IconBranch size={14} />
              {t("nav.createBranch")}
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="open-session-folder"
              onClick={() => void openSessionFolder(session)}
            >
              <IconFolder size={14} />
              {t("nav.openTaskFolder", { defaultValue: "Open folder" })}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              data-action="delete-session"
              onClick={() => void deleteSession(session)}
            >
              <IconX size={14} />
              {t("nav.deleteTask", { defaultValue: "Delete" })}
            </button>
          </>
        ) : null}
        {entry ? (
          <>
            <button
              ref={menuFirstItemRef}
              type="button"
              role="menuitem"
              onClick={() =>
                void selectProject(entry.path).then((ok) => {
                  if (ok) {
                    closeMenus(false);
                    focusComposer();
                  }
                })
              }
            >
              <IconFolder size={14} />
              {entry.active
                ? t("project.active", { defaultValue: "Active" })
                : t("project.switch", { defaultValue: "Switch" })}
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="toggle-project-pin"
              onClick={() => toggleProjectPin(entry)}
            >
              <IconPin size={14} />
              {entry.meta.pinned ? t("project.unpin") : t("project.pin")}
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="toggle-project-archive"
              onClick={() => void archiveProject(entry)}
            >
              {entry.meta.archived ? (
                <IconArchiveRestore size={14} />
              ) : (
                <IconArchive size={14} />
              )}
              {entry.meta.archived
                ? t("project.restore", { defaultValue: "Restore project" })
                : t("project.archive", { defaultValue: "Archive project" })}
            </button>
            {entry.open ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => void closeProject(entry)}
              >
                <IconX size={14} />
                {t("project.close")}
              </button>
            ) : null}
          </>
        ) : null}
      </div>,
      document.body,
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-macos-drag-row" aria-hidden="true" />
      <div className="sidebar-header">
        <button
          type="button"
          className="brand no-drag"
          data-nav="home"
          title={t("nav.home")}
          aria-label={t("nav.home")}
          onClick={() => setPage("chat")}
        >
          <BrandLogo size={20} />
          <span>{t("app.shellName")}</span>
        </button>
        <div className="sidebar-header-actions no-drag">
          <button
            type="button"
            className="icon-btn"
            title={t("nav.search")}
            aria-label={t("nav.search")}
            onClick={onOpenSearch}
          >
            <IconSearch size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`${t("nav.collapseSidebar")} (${sidebarToggleShortcut})`}
            aria-label={t("nav.collapseSidebar")}
            aria-expanded={true}
            data-nav="toggle-sidebar"
            onClick={onToggleSidebar}
          >
            <IconSidebar size={15} />
          </button>
        </div>
      </div>

      <div className="no-drag flex min-h-0 flex-1 flex-col px-2 pb-1.5">

        <button className="nav-item new-task-btn mb-1" data-nav="new-task" onClick={() => void createSession()}>
          <IconNewSession size={15} />
          <span>{t("nav.newTask")}</span>
        </button>

        <nav className="mb-0.5 space-y-0 px-0.5">
          <button className={`nav-item ${page === "plugins" ? "active" : ""}`} data-nav="plugins" onClick={() => setPage("plugins")}>
            <IconAt size={15} />
            <span>{t("nav.plugins")}</span>
          </button>
        </nav>

        <div className="sidebar-list-toolbar">
          <span className="sidebar-list-label">{t("nav.projects")}</span>
          <button
            type="button"
            className="sidebar-toolbar-button"
            data-action="new-project"
            title={t("nav.newProject")}
            aria-label={t("nav.newProject")}
            onClick={() => void openProjectPicker()}
          >
            <IconNewProject size={14} />
          </button>
        </div>

        <div
          className="sidebar-session-groups min-h-0 flex-1 overflow-auto px-0.5"
          onScroll={() => {
            if (sessionMenu || projectMenu || sortOpen) closeMenus(false);
          }}
        >
          {projectEntries.length > 0 ? projectEntries.map(renderProjectGroup) : (
            <section className="sidebar-session-group" aria-labelledby="sidebar-project-group-label">
              <div className="sidebar-session-group-header">
                <button type="button" id="sidebar-project-group-label" className="sidebar-session-group-title" onClick={() => void openProjectPicker()}>
                  <IconFolder size={13} />
                  <span>{t("project.open")}</span>
                </button>
              </div>
            </section>
          )}
          <section
            className="sidebar-standalone-sessions"
            aria-labelledby="sidebar-standalone-sessions-label"
            data-sidebar-session-section="temporary"
          >
            <div className="sidebar-list-toolbar sidebar-list-toolbar-secondary">
              <span id="sidebar-standalone-sessions-label" className="sidebar-list-label">
                {t("nav.sessions", { defaultValue: "Sessions" })}
              </span>
              <div className="sidebar-toolbar-actions">
                <button
                  type="button"
                  className="sidebar-toolbar-button"
                  data-action="new-standalone-session"
                  title={t("nav.newTemporarySession")}
                  aria-label={t("nav.newTemporarySession")}
                  onClick={() => void createSession({ projectPath: null })}
                >
                  <IconNewSession size={14} />
                </button>
                <div className="sidebar-menu-wrap">
                  <button
                    type="button"
                    className={`sidebar-toolbar-button ${sortOpen ? "active" : ""}`}
                    data-action="session-sort"
                    aria-label={t("nav.sortSessions", { defaultValue: "Sort sessions" })}
                    aria-haspopup="menu"
                    aria-expanded={sortOpen}
                    onClick={(event) => {
                      if (sortOpen) {
                        closeMenus();
                        return;
                      }
                      placeMenu(event);
                      menuTriggerRef.current = event.currentTarget;
                      setSessionMenu(null);
                      setProjectMenu(null);
                      setSortOpen(true);
                    }}
                  >
                    <IconArrowUpDown size={14} />
                  </button>
                </div>
              </div>
            </div>
            <div className="sidebar-session-group-body standalone">
              {temporarySessions.length > 0 ? renderSessionRows(temporarySessions, { temporary: true }) : (
                <div className="sidebar-session-empty">{t("nav.noTemporarySessions")}</div>
              )}
            </div>
          </section>
        </div>

        <div className="sidebar-footer no-drag" ref={profileRef}>
          {profileOpen ? (
            <div id="sidebar-profile-menu" className="profile-menu" role="menu" onKeyDown={onMenuKeyDown}>
              <div className="profile-menu-identity" role="presentation">
                <span className="profile-menu-avatar" aria-hidden>
                  <IconUser size={15} />
                </span>
                <span className="profile-menu-copy">
                  <strong>{t("nav.custom")}</strong>
                  <small>{t("nav.localProfile")}</small>
                </span>
              </div>
              <div className="profile-menu-divider" role="separator" />
              <button ref={menuFirstItemRef} className="profile-menu-item" role="menuitem" data-nav="settings" onClick={() => { setProfileOpen(false); setPage("settings"); }}>
                <IconSettings size={15} />
                <span>{t("nav.settings")}</span>
              </button>
              <button className="profile-menu-item" role="menuitem" onClick={async () => { setProfileOpen(false); try { await (await import("../lib/api")).api.openLogs(); } catch { /* ignore */ } }}>
                <IconFileText size={15} />
                <span>{t("nav.profileLogs")}</span>
              </button>
              <button className="profile-menu-item" role="menuitem" onClick={async () => {
                setProfileOpen(false);
                const current = useAppStore.getState().settings;
                if (!current) return;
                const order = ["system", "light", "dark"] as const;
                const index = order.indexOf((current.theme as (typeof order)[number]) || "system");
                const theme = order[(index + 1) % order.length];
                try {
                  await (await import("../lib/api")).api.setSettings({ ...current, theme });
                  useAppStore.setState({ settings: { ...current, theme } });
                } catch { /* ignore */ }
              }}>
                <IconSliders size={15} />
                <span>{t("nav.profileTheme")}</span>
                <span className="meta">{settings?.theme || "system"}</span>
              </button>
            </div>
          ) : null}
          <button className={`footer-profile ${profileOpen ? "active" : ""}`} data-nav="profile" aria-haspopup="menu" aria-controls="sidebar-profile-menu" aria-expanded={profileOpen} onClick={(event) => { menuTriggerRef.current = event.currentTarget; setProfileOpen((value) => !value); }} title={t("nav.openProfileMenu")}>
            <span className="footer-profile-avatar" aria-hidden>
              <IconUser size={14} />
            </span>
            <span className="footer-profile-copy">
              <span className="footer-profile-name">{t("nav.custom")}</span>
              <span className="footer-profile-status">{t("nav.localProfile")}</span>
            </span>
            <IconChevronDown className={`footer-profile-chevron ${profileOpen ? "open" : ""}`} size={13} aria-hidden />
          </button>
          <NotificationCenter onBeforeOpen={() => closeMenus(false)} />
        </div>
      </div>
      {renderFloatingMenu()}
    </aside>
  );
}
