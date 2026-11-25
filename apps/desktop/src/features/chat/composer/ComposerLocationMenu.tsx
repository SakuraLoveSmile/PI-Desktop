import type { GitWorkspaceSnapshot } from "@pi-desktop/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconBranch, IconMonitor, IconPlus } from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, cx, Tooltip, TooltipButton } from "../../../components/ui";
import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";
import { canCreateWorktree, composerFooterMenuKeyDown, managedWorktrees } from "./composer-git-menu";
import {
  StripMenuBanner,
  StripMenuField,
  StripMenuHeader,
  StripMenuSubmit,
  StripRowBody,
  StripTriggerTail,
} from "./strip-menu-parts";

export type ComposerLocationMenuProps = {
  git: GitWorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  disabled: boolean;
  /** A task is running in this project: the rows are inert and the menu says why. */
  locked?: boolean;
  remote?: boolean;
  onReload: () => void;
  onLocal: () => Promise<void>;
  onWorktree: (path: string) => Promise<void>;
  onCreateWorktree: (branch: string) => Promise<void>;
};

export type LocationMenuView = "root" | "worktrees" | "create";

export type ComposerLocationMenuBodyProps = {
  view: LocationMenuView;
  git: GitWorkspaceSnapshot | null;
  isWorktree: boolean;
  remote: boolean;
  /** Rows are inert: read-only session, loading, a request in flight, or a running task. */
  blocked: boolean;
  locked: boolean;
  canCreate: boolean;
  pending: boolean;
  loading: boolean;
  busy: boolean;
  name: string;
  diagnostic: string | null;
  onName: (value: string) => void;
  onBack: () => void;
  onChooseLocal: () => void;
  onOpenWorktrees: () => void;
  onPickWorktree: (path: string, current: boolean) => void;
  onNewWorktree: () => void;
  onSubmit: () => void;
};

/** The location menu's contents: Local / Worktree, the managed worktrees, or the create form. */
export function ComposerLocationMenuBody({
  view, git, isWorktree, remote, blocked, locked, canCreate, pending, loading, busy, name, diagnostic,
  onName, onBack, onChooseLocal, onOpenWorktrees, onPickWorktree, onNewWorktree, onSubmit,
}: ComposerLocationMenuBodyProps) {
  const { t } = useTranslation();
  const worktrees = managedWorktrees(git);
  const localCurrent = !isWorktree && !remote;
  return <>
    {view === "root" ? <>
      {locked ? <StripMenuBanner>{t("chat.workspaceMenu.runLocked")}</StripMenuBanner> : null}
      <div className="composer-footer-list" role="none">
        <Button type="button" variant="ghost" role="menuitemradio" aria-checked={localCurrent} aria-selected={localCurrent}
          className="composer-footer-item is-two-line" disabled={blocked} onClick={onChooseLocal}>
          <StripRowBody
            icon={<IconMonitor size={15} className="composer-footer-lead" aria-hidden />}
            name={t("chat.workspaceMenu.localMode")}
            sub={t("chat.workspaceMenu.localModeDesc")}
            current={localCurrent}
          />
        </Button>
        <Button type="button" variant="ghost" role="menuitemradio" aria-checked={isWorktree} aria-selected={isWorktree}
          className="composer-footer-item is-two-line" disabled={blocked || !git} onClick={onOpenWorktrees}>
          <StripRowBody
            icon={<IconBranch size={15} className="composer-footer-lead" aria-hidden />}
            name={t("chat.workspaceMenu.worktreeMode")}
            sub={t("chat.workspaceMenu.worktreeModeDesc")}
            current={isWorktree}
          />
        </Button>
      </div>
    </> : view === "create" ? (
      <form className="composer-footer-form" onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}>
        <StripMenuHeader title={t("chat.workspaceMenu.newWorktree")} backLabel={t("chat.workspaceMenu.back")} disabled={pending} onBack={onBack} />
        <StripMenuField
          label={t("chat.workspaceMenu.worktreeName")}
          hint={t("chat.workspaceMenu.worktreeHint")}
          value={name}
          disabled={blocked}
          onChange={onName}
        />
        <StripMenuSubmit label={t("chat.workspaceMenu.createWorktree")} disabled={!canCreate || !name.trim()} />
      </form>
    ) : <>
      <StripMenuHeader title={t("chat.workspaceMenu.worktreeMode")} backLabel={t("chat.workspaceMenu.back")} disabled={pending} onBack={onBack} />
      <div className="composer-footer-list" role="menu" aria-label={t("chat.workspaceMenu.worktreeMode")}>
        {worktrees.map((worktree) => {
          const current = normalizeProjectPath(worktree.path) === normalizeProjectPath(git?.rootPath);
          return <Tooltip key={worktree.path} label={worktree.path} className="composer-footer-row-tooltip">
            <Button type="button" variant="ghost" role="menuitemradio" aria-checked={current}
              className="composer-footer-item" disabled={blocked}
              onClick={() => onPickWorktree(worktree.path, current)}>
              <StripRowBody
                icon={<IconBranch size={15} className="composer-footer-lead" aria-hidden />}
                name={worktree.branch || worktree.path}
                current={current}
              />
            </Button>
          </Tooltip>;
        })}
      </div>
      <div className="composer-footer-divider" />
      <Button type="button" variant="ghost" className="composer-footer-item is-action" disabled={!canCreate} onClick={onNewWorktree}>
        <IconPlus size={15} className="composer-footer-lead" aria-hidden />
        <span className="composer-footer-label">{t("chat.workspaceMenu.newWorktree")}</span>
      </Button>
      <p className="composer-footer-hint">{t("chat.workspaceMenu.worktreeHint")}</p>
    </>}
    {loading && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.loading")}</p>}
    {(busy || pending) && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.busy")}</p>}
    {!loading && !git && <p className="composer-footer-hint">{t("chat.workspaceMenu.noGit")}</p>}
    {git && !git.head && <p className="composer-footer-hint">{t("chat.workspaceMenu.worktreeUnavailable")}</p>}
    {diagnostic && <p role="alert" className="composer-footer-error">{diagnostic}</p>}
  </>;
}

export function ComposerLocationMenu({ git, loading, busy, error, disabled, locked = false, remote = false, onReload, onLocal, onWorktree, onCreateWorktree }: ComposerLocationMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<LocationMenuView>("root");
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const blocked = disabled || busy || loading || pending || remote;
  const canCreate = canCreateWorktree(git, blocked);
  const isWorktree = !remote && Boolean(git?.isWorktree);
  const label = t(remote ? "chat.workspaceRemote" : isWorktree ? "chat.workspaceMenu.worktreeMode" : "chat.workspaceMenu.localMode");
  const diagnostic = actionError || error;
  const reason = locked ? t("chat.workspaceMenu.runLocked") : null;

  const run = async (action: () => Promise<void>) => {
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setActionError(null);
    try {
      await action();
      setOpen(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("chat.workspaceMenu.actionFailed", { message: String(cause) }));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return <AnchoredMenu
    className="composer-footer-anchor"
    open={open}
    onClose={() => setOpen(false)}
    menuClassName={`composer-footer-menu composer-footer-location-menu${view !== "root" ? " composer-footer-worktree-menu" : ""}`}
    label={label}
    role={view === "create" ? "dialog" : "menu"}
    side="top"
    initialFocus={view === "create" ? "input" : "selected"}
    onMenuKeyDown={composerFooterMenuKeyDown}
    trigger={(ref) => <TooltipButton
      ref={ref}
      type="button"
      className={cx("composer-workspace-item composer-footer-trigger", open && "active")}
      tooltip={reason ? `${label} · ${reason}` : label}
      ariaLabel={label}
      aria-haspopup={view === "create" ? "dialog" : "menu"}
      aria-expanded={open}
      onClick={() => {
        if (!open) {
          setView("root");
          setName("");
          setActionError(null);
          onReload();
        }
        setOpen(!open);
      }}
    >{isWorktree ? <IconBranch size={14} /> : <IconMonitor size={14} />}<span>{label}</span><StripTriggerTail locked={locked} /></TooltipButton>}
  >
    <ComposerLocationMenuBody
      view={view}
      git={git}
      isWorktree={isWorktree}
      remote={remote}
      blocked={blocked}
      locked={locked}
      canCreate={canCreate}
      pending={pending}
      loading={loading}
      busy={busy}
      name={name}
      diagnostic={diagnostic}
      onName={setName}
      onBack={() => setView(view === "create" ? "worktrees" : "root")}
      onChooseLocal={() => {
        if (isWorktree) void run(onLocal);
        else setOpen(false);
      }}
      onOpenWorktrees={() => setView("worktrees")}
      onPickWorktree={(path, current) => {
        if (current) setOpen(false);
        else void run(() => onWorktree(path));
      }}
      onNewWorktree={() => { setName(""); setView("create"); }}
      onSubmit={() => {
        if (canCreate && name.trim()) void run(() => onCreateWorktree(name.trim()));
      }}
    />
  </AnchoredMenu>;
}
