import type { GitWorkspaceSnapshot } from "@pi-desktop/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconBranch, IconCheck, IconChevronLeft, IconMonitor, IconPlus } from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, Field, Input, Tooltip, TooltipButton } from "../../../components/ui";
import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";
import { canCreateWorktree, composerFooterMenuKeyDown, managedWorktrees } from "./composer-git-menu";

export type ComposerLocationMenuProps = {
  git: GitWorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  disabled: boolean;
  remote?: boolean;
  onReload: () => void;
  onLocal: () => Promise<void>;
  onWorktree: (path: string) => Promise<void>;
  onCreateWorktree: (branch: string) => Promise<void>;
};

export function ComposerLocationMenu({ git, loading, busy, error, disabled, remote = false, onReload, onLocal, onWorktree, onCreateWorktree }: ComposerLocationMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "worktrees" | "create">("root");
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const blocked = disabled || busy || loading || pending || remote;
  const canCreate = canCreateWorktree(git, blocked);
  const worktrees = managedWorktrees(git);
  const isWorktree = !remote && Boolean(git?.isWorktree);
  const label = t(remote ? "chat.workspaceRemote" : isWorktree ? "chat.workspaceMenu.worktreeMode" : "chat.workspaceMenu.localMode");
  const diagnostic = actionError || error;

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
      className={`composer-workspace-item composer-footer-trigger ${open ? "active" : ""}`}
      tooltip={label}
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
    >{isWorktree ? <IconBranch size={14} /> : <IconMonitor size={14} />}<span>{label}</span></TooltipButton>}
  >
    {view === "root" ? <>
      <Button type="button" variant="ghost" role="menuitemradio" aria-checked={!isWorktree && !remote} aria-selected={!isWorktree && !remote} className="composer-footer-item" disabled={blocked} onClick={() => {
        if (isWorktree) void run(onLocal);
        else setOpen(false);
      }}><IconMonitor size={16} /><span className="composer-footer-label">{t("chat.workspaceMenu.localMode")}</span>{!isWorktree && !remote && <IconCheck size={15} />}</Button>
      <Button type="button" variant="ghost" role="menuitemradio" aria-checked={isWorktree} aria-selected={isWorktree} className="composer-footer-item" disabled={blocked || !git} onClick={() => setView("worktrees")}>
        <IconBranch size={16} /><span className="composer-footer-label">{t("chat.workspaceMenu.worktreeMode")}</span>{isWorktree && <IconCheck size={15} />}
      </Button>
    </> : <>
      <Button type="button" variant="ghost" className="composer-footer-back" onClick={() => setView(view === "create" ? "worktrees" : "root")} disabled={pending}>
        <IconChevronLeft size={14} />{t("chat.workspaceMenu.back")}
      </Button>
      {view === "create" ? <form className="composer-footer-form" onSubmit={(event) => {
        event.preventDefault();
        if (canCreate && name.trim()) void run(() => onCreateWorktree(name.trim()));
      }}>
        <Field label={t("chat.workspaceMenu.worktreeName")} hint={t("chat.workspaceMenu.worktreeHint")}>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={blocked} aria-label={t("chat.workspaceMenu.worktreeName")} />
        </Field>
        <Button type="submit" className="composer-footer-submit" disabled={!canCreate || !name.trim()}>{t("chat.workspaceMenu.createWorktree")}</Button>
      </form> : <>
        <div className="composer-footer-list" role="menu" aria-label={t("chat.workspaceMenu.worktreeMode")}>
          {worktrees.map((worktree) => {
            const current = normalizeProjectPath(worktree.path) === normalizeProjectPath(git?.rootPath);
            return <Tooltip key={worktree.path} label={worktree.path} className="composer-footer-row-tooltip">
              <Button type="button" variant="ghost" role="menuitemradio" aria-checked={current} className="composer-footer-item" disabled={blocked} onClick={() => {
                if (current) setOpen(false);
                else void run(() => onWorktree(worktree.path));
              }}><IconBranch size={15} /><span className="composer-footer-label">{worktree.branch || worktree.path}</span>{current && <IconCheck size={15} />}</Button>
            </Tooltip>;
          })}
        </div>
        <div className="composer-footer-divider" />
        <Button type="button" variant="ghost" className="composer-footer-item" disabled={!canCreate} onClick={() => { setName(""); setView("create"); }}><IconPlus size={17} /><span>{t("chat.workspaceMenu.newWorktree")}</span></Button>
        <p className="composer-footer-hint">{t("chat.workspaceMenu.worktreeHint")}</p>
      </>}
    </>}
    {loading && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.loading")}</p>}
    {(busy || pending) && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.busy")}</p>}
    {!loading && !git && <p className="composer-footer-hint">{t("chat.workspaceMenu.noGit")}</p>}
    {git && !git.head && <p className="composer-footer-hint">{t("chat.workspaceMenu.worktreeUnavailable")}</p>}
    {diagnostic && <p role="alert" className="composer-footer-error">{diagnostic}</p>}
  </AnchoredMenu>;
}
