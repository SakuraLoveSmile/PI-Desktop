import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  IconCheck,
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconSearch,
  IconTerminal,
} from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, cx, Input, TooltipButton } from "../../../components/ui";
import {
  filterSwitcherProjects,
  listSwitcherProjects,
  normalizeProjectPath,
} from "../../../lib/sidebar-preferences";
import { useAppStore } from "../../../stores/app-store";

export function ComposerProjectMenu({
  path,
  name,
  disabled = false,
}: {
  path?: string | null;
  name?: string | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const openProjectPaths = useAppStore((state) => state.openProjectPaths);
  const openProjects = useAppStore((state) => state.openProjects);
  const workspace = useAppStore((state) => state.workspace);
  const projectMeta = useAppStore((state) => state.projectMeta);
  const projectSort = useAppStore((state) => state.projectSort);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const remote = useAppStore((state) =>
    state.sessions.some(
      (session) => session.id === state.activeSessionId && session.source === "remote",
    ),
  );
  const newSession = useAppStore((state) => state.newSession);
  const openProject = useAppStore((state) => state.openProject);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setPage = useAppStore((state) => state.setPage);
  const showToast = useAppStore((state) => state.showToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const blocked = disabled || remote;
  const activeKey = normalizeProjectPath(path);
  const label = name || t("chat.workspaceMenu.noWorkspace");
  const projects = useMemo(
    () => listSwitcherProjects({
      openProjectPaths, openProjects, workspace, projectMeta, projectSort,
    }),
    [openProjectPaths, openProjects, workspace, projectMeta, projectSort],
  );
  const visible = useMemo(
    () => filterSwitcherProjects(projects, query),
    [projects, query],
  );
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // A portaled menu must not keep the preceding session's actions reachable.
  useEffect(() => { close(); }, [activeSessionId, path, blocked, close]);

  useEffect(() => {
    const current = visible.findIndex((project) => project.key === activeKey);
    setHighlight(current < 0 ? 0 : current);
  }, [activeKey, visible]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    const owner = useAppStore.getState().activeSessionId;
    const ownerSession = useAppStore.getState().sessions.find((session) => session.id === owner);
    if (blocked || busyRef.current || owner !== activeSessionId || ownerSession?.source === "remote") return;
    busyRef.current = true;
    setBusy(true);
    close();
    try {
      await action();
    } catch (error) {
      if (mountedRef.current && useAppStore.getState().activeSessionId === owner) {
        showToast(t("chat.workspaceMenu.actionFailed", {
          message: error instanceof Error ? error.message : String(error),
        }), { variant: "error" });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [activeSessionId, blocked, close, showToast, t]);

  const selectProject = (nextPath: string | null) => {
    if (blocked || busyRef.current) return;
    if (normalizeProjectPath(nextPath) === activeKey) {
      close();
      return;
    }
    // newSession owns project activation and fences stale navigation results.
    void runAction(() => newSession({ projectPath: nextPath }));
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || visible.length === 0) return;
    const fromSearch = event.target instanceof HTMLInputElement;
    const fromRow = rowRefs.current.indexOf(event.target as HTMLButtonElement);
    if (!fromSearch && fromRow < 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = fromSearch
        ? highlight
        : (fromRow + delta + visible.length) % visible.length;
      setHighlight(next);
      rowRefs.current[next]?.focus();
      rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && fromSearch && visible[highlight]) {
      event.preventDefault();
      selectProject(visible[highlight].path);
    }
  };

  return (
    <AnchoredMenu
      className="composer-footer-project"
      menuClassName="composer-footer-menu composer-project-menu"
      label={t("project.switchProject")}
      role="menu"
      side="top"
      align="start"
      initialFocus="input"
      open={open && !blocked}
      onClose={close}
      onMenuKeyDown={onMenuKeyDown}
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className="composer-workspace-item composer-footer-trigger"
          tooltip={path || label}
          ariaLabel={`${t("project.switchProject")}: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open && !blocked}
          disabled={blocked || busy}
          onClick={() => {
            if (busyRef.current) return;
            if (open) close();
            else setOpen(true);
          }}
        >
          <IconFolderOpen size={14} aria-hidden />
          <span>{label}</span>
        </TooltipButton>
      )}
    >
      <div className="composer-footer-menu-search">
        <IconSearch size={16} aria-hidden />
        <Input
          value={query}
          placeholder={t("chat.workspaceMenu.projectSearch")}
          aria-label={t("chat.workspaceMenu.projectSearch")}
          aria-controls={listId}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="composer-footer-menu-list" id={listId} role="none">
        {visible.length === 0 ? (
          <div className="composer-footer-menu-empty" role="status">
            {t("chat.workspaceMenu.noProjects")}
          </div>
        ) : visible.map((project, index) => (
          <TooltipButton
            key={project.key}
            ref={(node) => { rowRefs.current[index] = node; }}
            type="button"
            role="menuitemradio"
            aria-checked={project.key === activeKey}
            tooltip={project.path}
            ariaLabel={project.name}
            className={cx("composer-footer-menu-item",
              project.key === activeKey && "is-current",
              highlight === index && "is-active")}
            disabled={busy || blocked}
            onFocus={() => setHighlight(index)}
            onMouseEnter={() => setHighlight(index)}
            onClick={() => selectProject(project.path)}
          >
            <IconFolder size={16} aria-hidden />
            <span className="composer-footer-menu-name">{project.name}</span>
            {project.key === activeKey && <IconCheck size={16} className="composer-footer-menu-check" aria-hidden />}
          </TooltipButton>
        ))}
      </div>
      <div className="composer-footer-menu-divider" aria-hidden />
      <Button variant="ghost" type="button" role="menuitem"
        className="composer-footer-menu-item" disabled={busy || blocked}
        onClick={() => void runAction(openProject)}>
        <IconPlus size={16} aria-hidden />
        <span>{t("chat.workspaceMenu.newWorkspace")}</span>
      </Button>
      <Button variant="ghost" type="button" role="menuitem"
        className="composer-footer-menu-item" disabled={busy || blocked}
        onClick={() => {
          if (blocked || busyRef.current) return;
          const current = useAppStore.getState();
          if (current.activeSessionId !== activeSessionId || current.sessions.some(
            (session) => session.id === current.activeSessionId && session.source === "remote",
          )) return;
          close();
          setSettingsTab("remoteHosts");
          setPage("settings");
        }}>
        <IconTerminal size={16} aria-hidden />
        <span>{t("chat.workspaceMenu.connectSsh")}</span>
      </Button>
      <Button variant="ghost" type="button" role="menuitem"
        className="composer-footer-menu-item" disabled={busy || blocked}
        onClick={() => selectProject(null)}>
        <IconFolder size={16} aria-hidden />
        <span>{t("chat.workspaceMenu.noWorkspace")}</span>
      </Button>
    </AnchoredMenu>
  );
}
