import type { GitWorkspaceSnapshot } from "@pi-desktop/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconBranch, IconCheck, IconChevronLeft, IconPlus, IconSearch } from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, Field, Input, Tooltip, TooltipButton } from "../../../components/ui";
import { branchOccupiedElsewhere, canChangeBranch, composerFooterMenuKeyDown, detachedHeadShortSha, visibleLocalBranches } from "./composer-git-menu";

export type ComposerBranchMenuProps = {
  git: GitWorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  disabled: boolean;
  onReload: () => void;
  onSwitch: (branch: string) => Promise<void>;
  onCreate: (branch: string) => Promise<void>;
};

export function ComposerBranchMenu({ git, loading, busy, error, disabled, onReload, onSwitch, onCreate }: ComposerBranchMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const blocked = disabled || busy || loading || pending;
  const canMutate = canChangeBranch(git, blocked);
  const branches = visibleLocalBranches(git, query);
  const detachedSha = detachedHeadShortSha(git);
  const label = git?.branch || (detachedSha ? t("chat.workspaceMenu.detachedHead", { sha: detachedSha }) : t("chat.workspaceMenu.noBranch"));
  const diagnostic = actionError || error;

  const run = async (action: () => Promise<void>) => {
    if (!canMutate || inFlight.current) return;
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
    menuClassName="composer-footer-menu composer-footer-branch-menu"
    label={label}
    role="dialog"
    side="top"
    initialFocus="input"
    onMenuKeyDown={composerFooterMenuKeyDown}
    trigger={(ref) => <TooltipButton
      ref={ref}
      type="button"
      className={`composer-workspace-item composer-footer-trigger ${open ? "active" : ""}`}
      tooltip={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => {
        if (!open) {
          setCreating(false);
          setQuery("");
          setName("");
          setActionError(null);
          onReload();
        }
        setOpen(!open);
      }}
    ><IconBranch size={14} /><span>{label}</span></TooltipButton>}
  >
    {creating ? <form className="composer-footer-form" onSubmit={(event) => {
      event.preventDefault();
      if (name.trim()) void run(() => onCreate(name.trim()));
    }}>
      <Button type="button" variant="ghost" className="composer-footer-back" onClick={() => setCreating(false)} disabled={pending}>
        <IconChevronLeft size={14} />{t("chat.workspaceMenu.back")}
      </Button>
      <Field label={t("chat.workspaceMenu.branchName")}>
        <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={blocked} aria-label={t("chat.workspaceMenu.branchName")} />
      </Field>
      <Button type="submit" className="composer-footer-submit" disabled={!canMutate || !name.trim()}>{t("chat.workspaceMenu.createSwitch")}</Button>
    </form> : <>
      <div className="composer-footer-search"><IconSearch size={16} /><Input
        data-menu-search
        aria-label={t("chat.workspaceMenu.branchSearch")}
        placeholder={t("chat.workspaceMenu.branchSearch")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      /></div>
      <div className="composer-footer-heading">{t("chat.workspaceMenu.localBranches")}</div>
      <div className="composer-footer-list" role="menu" aria-label={t("chat.workspaceMenu.localBranches")}>
        {branches.map((branch) => {
          const occupied = git ? branchOccupiedElsewhere(branch, git) : false;
          return <Tooltip key={branch.name} label={branch.checkedOutPath || branch.name} className="composer-footer-row-tooltip">
            <Button
              type="button"
              variant="ghost"
              role="menuitemradio"
              aria-checked={branch.current}
              className="composer-footer-item"
              disabled={blocked || (!branch.current && (!canMutate || occupied))}
              onClick={() => {
                if (branch.current) setOpen(false);
                else if (!occupied) void run(() => onSwitch(branch.name));
              }}
            ><IconBranch size={15} /><span className="composer-footer-label">{branch.name}</span>{branch.current && <IconCheck size={15} />}</Button>
          </Tooltip>;
        })}
      </div>
      {!loading && !branches.length && <p className="composer-footer-hint">{t(git ? "chat.workspaceMenu.noBranches" : "chat.workspaceMenu.noGit")}</p>}
      <div className="composer-footer-divider" />
      <Button type="button" variant="ghost" className="composer-footer-item" disabled={!canMutate} onClick={() => { setCreating(true); setName(""); }}>
        <IconPlus size={17} /><span>{t("chat.workspaceMenu.newBranch")}</span>
      </Button>
    </>}
    {loading && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.loading")}</p>}
    {(busy || pending) && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.busy")}</p>}
    {git?.dirty && <p className="composer-footer-hint">{t("chat.workspaceMenu.dirty")}</p>}
    {git && !git.head && <p className="composer-footer-hint">{t("chat.workspaceMenu.worktreeUnavailable")}</p>}
    {diagnostic && <p role="alert" className="composer-footer-error">{diagnostic}</p>}
  </AnchoredMenu>;
}
