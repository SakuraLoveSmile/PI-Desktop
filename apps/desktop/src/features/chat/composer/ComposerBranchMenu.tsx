import type { GitWorkspaceSnapshot } from "@pi-desktop/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconBranch, IconPlus } from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, cx, Tooltip, TooltipButton } from "../../../components/ui";
import { branchOccupiedElsewhere, canChangeBranch, composerFooterMenuKeyDown, detachedHeadShortSha, visibleLocalBranches } from "./composer-git-menu";
import {
  StripMenuBanner,
  StripMenuField,
  StripMenuHeader,
  StripMenuSearch,
  StripMenuSubmit,
  StripRowBody,
  StripTriggerTail,
} from "./strip-menu-parts";

export type ComposerBranchMenuProps = {
  git: GitWorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  disabled: boolean;
  /** A task is running in this project: the rows are inert and the menu says why. */
  locked?: boolean;
  onReload: () => void;
  onSwitch: (branch: string) => Promise<void>;
  onCreate: (branch: string) => Promise<void>;
};

export type ComposerBranchMenuBodyProps = {
  git: GitWorkspaceSnapshot | null;
  creating: boolean;
  query: string;
  name: string;
  loading: boolean;
  busy: boolean;
  pending: boolean;
  /** Rows are inert: read-only session, loading, a request in flight, or a running task. */
  blocked: boolean;
  canMutate: boolean;
  locked: boolean;
  diagnostic: string | null;
  onQuery: (value: string) => void;
  onName: (value: string) => void;
  onBack: () => void;
  onPickBranch: (name: string, current: boolean, occupied: boolean) => void;
  onNewBranch: () => void;
  onSubmit: () => void;
};

/** The branch menu's contents: reason banner, search, local branches, or the create form. */
export function ComposerBranchMenuBody({
  git, creating, query, name, loading, busy, pending, blocked, canMutate, locked, diagnostic,
  onQuery, onName, onBack, onPickBranch, onNewBranch, onSubmit,
}: ComposerBranchMenuBodyProps) {
  const { t } = useTranslation();
  const branches = visibleLocalBranches(git, query);
  // A list that cannot change anyway needs no per-row reason.
  const tagOccupied = !locked && !git?.dirty;
  return <>
    {locked ? <StripMenuBanner>{t("chat.workspaceMenu.runLocked")}</StripMenuBanner>
      : git?.dirty ? <StripMenuBanner>{t("chat.workspaceMenu.dirty")}</StripMenuBanner> : null}
    {creating ? (
      <form className="composer-footer-form" onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}>
        <StripMenuHeader title={t("chat.workspaceMenu.newBranch")} backLabel={t("chat.workspaceMenu.back")} disabled={pending} onBack={onBack} />
        <StripMenuField label={t("chat.workspaceMenu.branchName")} value={name} disabled={blocked} onChange={onName} />
        <StripMenuSubmit label={t("chat.workspaceMenu.createSwitch")} disabled={!canMutate || !name.trim()} />
      </form>
    ) : <>
      <StripMenuSearch
        data-menu-search
        aria-label={t("chat.workspaceMenu.branchSearch")}
        placeholder={t("chat.workspaceMenu.branchSearch")}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
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
              onClick={() => onPickBranch(branch.name, branch.current, occupied)}
            >
              <StripRowBody
                icon={<IconBranch size={15} className="composer-footer-lead" aria-hidden />}
                name={branch.name}
                current={branch.current}
                tag={occupied && tagOccupied ? t("chat.workspaceMenu.branchOccupied") : undefined}
              />
            </Button>
          </Tooltip>;
        })}
      </div>
      {!loading && !branches.length && <p className="composer-footer-hint">{t(git ? "chat.workspaceMenu.noBranches" : "chat.workspaceMenu.noGit")}</p>}
      <div className="composer-footer-divider" />
      <Button type="button" variant="ghost" className="composer-footer-item is-action" disabled={!canMutate} onClick={onNewBranch}>
        <IconPlus size={15} className="composer-footer-lead" aria-hidden />
        <span className="composer-footer-label">{t("chat.workspaceMenu.newBranch")}</span>
      </Button>
    </>}
    {loading && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.loading")}</p>}
    {(busy || pending) && <p role="status" className="composer-footer-hint">{t("chat.workspaceMenu.busy")}</p>}
    {git && !git.head && <p className="composer-footer-hint">{t("chat.workspaceMenu.worktreeUnavailable")}</p>}
    {diagnostic && <p role="alert" className="composer-footer-error">{diagnostic}</p>}
  </>;
}

export function ComposerBranchMenu({ git, loading, busy, error, disabled, locked = false, onReload, onSwitch, onCreate }: ComposerBranchMenuProps) {
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
  const detachedSha = detachedHeadShortSha(git);
  const label = git?.branch || (detachedSha ? t("chat.workspaceMenu.detachedHead", { sha: detachedSha }) : t("chat.workspaceMenu.noBranch"));
  const diagnostic = actionError || error;
  const reason = locked ? t("chat.workspaceMenu.runLocked") : null;

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
      className={cx("composer-workspace-item composer-footer-trigger", open && "active")}
      tooltip={reason ? `${label} · ${reason}` : label}
      ariaLabel={label}
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
    ><IconBranch size={14} /><span>{label}</span><StripTriggerTail locked={locked} /></TooltipButton>}
  >
    <ComposerBranchMenuBody
      git={git}
      creating={creating}
      query={query}
      name={name}
      loading={loading}
      busy={busy}
      pending={pending}
      blocked={blocked}
      canMutate={canMutate}
      locked={locked}
      diagnostic={diagnostic}
      onQuery={setQuery}
      onName={setName}
      onBack={() => setCreating(false)}
      onPickBranch={(branchName, current, occupied) => {
        if (current) setOpen(false);
        else if (!occupied) void run(() => onSwitch(branchName));
      }}
      onNewBranch={() => { setCreating(true); setName(""); }}
      onSubmit={() => {
        if (name.trim()) void run(() => onCreate(name.trim()));
      }}
    />
  </AnchoredMenu>;
}
