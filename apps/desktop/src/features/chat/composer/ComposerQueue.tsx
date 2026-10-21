import type { TFunction } from "i18next";
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconMore,
  IconPencil,
  IconX,
} from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, TooltipButton } from "../../../components/ui";
import {
  isPendingQueuedPrompt,
  isPromotedQueuedPrompt,
  type QueuedPrompt,
  type QueuedPromptDirection,
} from "../../../lib/queued-prompts";
import { composerFooterMenuKeyDown } from "./composer-git-menu";
import { QueuedPromptToolAbortButton } from "./QueuedPromptToolAbortButton";
import {
  type QueueDisclosureChoices,
  queueDisclosureExpanded,
  resetEmptyQueueDisclosure,
  toggleQueueDisclosure,
} from "./queue-disclosure-state";
import {
  type QueueMenuActionId,
  queueRowMenuActions,
  runQueueRowAction,
} from "./queue-row-actions";

export type ComposerQueueProps = {
  t: TFunction;
  queueScopeKey: string;
  queuedPrompts: readonly QueuedPrompt[];
  removeQueuedPrompt: (id: string) => void;
  moveQueuedPrompt: (id: string, direction: QueuedPromptDirection) => Promise<void>;
  editQueuedPrompt: (id: string) => void;
  sendQueuedNow: (id: string) => Promise<void>;
  approvalPending: boolean;
};

const MENU_ICONS: Record<QueueMenuActionId, ReactNode> = {
  edit: <IconPencil size={13} aria-hidden />,
  moveUp: <IconArrowUp size={13} aria-hidden />,
  moveDown: <IconArrowDown size={13} aria-hidden />,
  remove: <IconX size={13} aria-hidden />,
};

/**
 * Queued follow-ups above the composer. Two or more rows fold into a summary
 * strip that carries the head's abort; a single row is always listed. Edit,
 * move and remove live in each row's ⋯ menu, and Send now shows on hover or
 * focus.
 *
 * The ⋯ menu is anchored to its own button, as the composer's other menus are.
 * A transcript reflow behind it (a running turn grows or shrinks the content)
 * repositions it instead of dismissing it, which a pointer-anchored menu cannot do.
 * A row the list scrolls fully out of view takes its menu with it.
 */
export function ComposerQueue({
  t,
  queueScopeKey,
  queuedPrompts,
  removeQueuedPrompt,
  moveQueuedPrompt,
  editQueuedPrompt,
  sendQueuedNow,
  approvalPending,
}: ComposerQueueProps) {
  const panelId = `composer-queue-${useId()}`;
  const [disclosure, setDisclosure] = useState<QueueDisclosureChoices>(() => new Map());
  // At most one row's ⋯ menu is open; the id is the prompt's, so a removed row takes its menu with it.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Focus is not moved back when the list closes a menu: the trigger is out of view, and focusing it would scroll the list back.
  const [restoreMenuFocus, setRestoreMenuFocus] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpenMenuId(null), []);
  const closeMenuOutOfView = useCallback(() => {
    setRestoreMenuFocus(false);
    setOpenMenuId(null);
  }, []);
  const queueCount = queuedPrompts.length;

  useEffect(() => {
    if (queueCount === 0) setDisclosure((current) => resetEmptyQueueDisclosure(current, queueScopeKey));
  }, [queueCount, queueScopeKey]);

  // The list is the trigger's clipping box. Once the list scrolls the trigger fully out of
  // view, or folds the list away, the menu has nothing to point at, so it closes.
  useEffect(() => {
    const list = listRef.current;
    if (!openMenuId || !list || typeof IntersectionObserver === "undefined") return;
    const row = Array.from(list.querySelectorAll<HTMLElement>("[data-queued-id]")).find(
      (element) => element.dataset.queuedId === openMenuId,
    );
    const trigger = row?.querySelector<HTMLElement>(".composer-queued-prompt-more");
    if (!trigger) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => !entry.isIntersecting)) closeMenuOutOfView();
      },
      { root: list },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [closeMenuOutOfView, openMenuId]);

  if (queueCount === 0) return null;

  // Promoted rows form the queue head, so this is the one that starts next.
  const headPrompt = queuedPrompts.find(isPromotedQueuedPrompt);
  const summarized = queueCount >= 2;
  const expanded = queueDisclosureExpanded(disclosure, queueScopeKey, queueCount);
  const listOpen = !summarized || expanded;
  // A folded summary carries the head's abort, so the hidden row must not repeat it.
  const abortOnSummary = summarized && !expanded;
  const moreLabel = t("chat.queueMoreActions");
  const queuedPromptLabel = (item: QueuedPrompt) =>
    item.content.trim() ||
    item.draft.fileReferences.map((reference) => reference.name).join(", ") ||
    t("chat.queuedPromptEmpty");
  const menuLabels: Record<QueueMenuActionId, string> = {
    edit: t("chat.editQueuedPrompt"),
    moveUp: t("chat.moveQueuedPromptUp"),
    moveDown: t("chat.moveQueuedPromptDown"),
    remove: t("chat.removeQueuedPrompt"),
  };

  const runMenuAction = (id: QueueMenuActionId, promptId: string) =>
    runQueueRowAction(id, promptId, {
      edit: editQueuedPrompt,
      remove: removeQueuedPrompt,
      move: moveQueuedPrompt,
    });
  // Tab leaves the menu rather than walking its items, as the pointer menus do.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") closeMenu();
    else composerFooterMenuKeyDown(event);
  };

  return (
    <section className="composer-queue-disclosure" data-count={queueCount}>
      {summarized ? (
        <div className="composer-queue-summary">
          <Button
            type="button"
            variant="ghost"
            className="composer-queue-heading"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() =>
              setDisclosure((current) => toggleQueueDisclosure(current, queueScopeKey, queueCount))
            }
          >
            <span className="composer-queue-count">{t("chat.queueCount", { count: queueCount })}</span>
            {abortOnSummary ? (
              <span className="composer-queue-next">
                {t("chat.queueNext", { message: queuedPromptLabel(queuedPrompts[0]) })}
              </span>
            ) : null}
            {expanded ? <IconChevronDown size={14} aria-hidden /> : <IconChevronUp size={14} aria-hidden />}
          </Button>
          {abortOnSummary && headPrompt && !approvalPending ? (
            <QueuedPromptToolAbortButton t={t} prompt={headPrompt} />
          ) : null}
        </div>
      ) : null}
      <div
        id={panelId}
        ref={listRef}
        className="composer-queue-body"
        hidden={!listOpen}
        role="list"
        aria-label={t("chat.queuedPrompts")}
      >
        {queuedPrompts.map((item) => {
          const promoted = isPromotedQueuedPrompt(item);
          const pending = isPendingQueuedPrompt(item);
          const flags = { promoted, pending };
          const label = queuedPromptLabel(item);
          const moreAria = flags.pending ? `${moreLabel} · ${t("common.saving")}` : moreLabel;
          const menuOpen = openMenuId === item.id;
          return (
            <div
              key={item.id}
              className="composer-queued-prompt"
              role="listitem"
              data-testid="queued-prompt"
              data-queued-id={item.id}
              data-priority={promoted ? "true" : "false"}
            >
              <span className="composer-queued-prompt-text" title={label}>
                {label}
              </span>
              {promoted ? (
                <span className="composer-queued-prompt-status">{t("chat.sendNowPending")}</span>
              ) : null}
              {pending ? (
                <span className="composer-queued-prompt-status">{t("common.saving")}</span>
              ) : null}
              {!promoted && !pending ? (
                <TooltipButton
                  type="button"
                  className="composer-queued-prompt-send-now"
                  tooltip={t("chat.sendNow")}
                  ariaLabel={t("chat.sendNow")}
                  disabled={approvalPending}
                  aria-disabled={approvalPending}
                  onClick={() => void sendQueuedNow(item.id)}
                >
                  {t("chat.sendNow")}
                </TooltipButton>
              ) : null}
              {!abortOnSummary && !approvalPending && item.id === headPrompt?.id ? (
                <QueuedPromptToolAbortButton t={t} prompt={item} />
              ) : null}
              <AnchoredMenu
                className="composer-queued-prompt-menu"
                open={menuOpen}
                onClose={closeMenu}
                menuClassName="context-menu"
                label={moreLabel}
                role="menu"
                align="end"
                side="top"
                onMenuKeyDown={onMenuKeyDown}
                restoreFocus={restoreMenuFocus}
                trigger={(ref) => (
                  <TooltipButton
                    ref={ref}
                    type="button"
                    className="composer-queued-prompt-action composer-queued-prompt-more"
                    tooltip={moreAria}
                    ariaLabel={moreAria}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    disabled={flags.pending}
                    aria-disabled={flags.pending}
                    onClick={() => {
                      setRestoreMenuFocus(true);
                      setOpenMenuId((current) => (current === item.id ? null : item.id));
                    }}
                  >
                    <IconMore size={14} aria-hidden />
                  </TooltipButton>
                )}
              >
                {queueRowMenuActions(flags).map((action) => (
                  <Fragment key={action.id}>
                    {action.separatorBefore ? <div className="context-menu-separator" role="separator" /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      className={`context-menu-item${action.danger ? " danger" : ""}`}
                      data-context-menu-item={action.id}
                      disabled={action.disabled}
                      onClick={() => {
                        // Close first: an action that opens an editor must not leave the menu layered over it.
                        closeMenu();
                        runMenuAction(action.id, item.id);
                      }}
                    >
                      <span className="context-menu-icon" aria-hidden>
                        {MENU_ICONS[action.id]}
                      </span>
                      <span className="context-menu-label">{menuLabels[action.id]}</span>
                    </button>
                  </Fragment>
                ))}
              </AnchoredMenu>
            </div>
          );
        })}
      </div>
    </section>
  );
}
