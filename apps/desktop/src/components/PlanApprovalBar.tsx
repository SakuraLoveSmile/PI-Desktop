import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  GlobalPermissionMode,
  PlanProposal,
} from "@pi-desktop/shared";
import { normalizeGlobalPermissionMode } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { IconCheck, IconChevronDown } from "./icons";

const APPROVAL_MODES: readonly GlobalPermissionMode[] = [
  "ask",
  "accept-edits",
  "auto",
];

const APPROVAL_MODE_LABEL_KEYS: Record<GlobalPermissionMode, string> = {
  ask: "plan.ask",
  "accept-edits": "plan.acceptEdits",
  auto: "plan.auto",
};

const APPROVE_LABEL_KEYS: Record<GlobalPermissionMode, string> = {
  ask: "plan.approveAsk",
  "accept-edits": "plan.approveAcceptEdits",
  auto: "plan.approveAuto",
};

function isApprovalMode(value: string | undefined): value is GlobalPermissionMode {
  return value === "ask" || value === "accept-edits" || value === "auto";
}

export function PlanApprovalBar({ proposal }: { proposal: PlanProposal }) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const resolvePlan = useAppStore((state) => state.resolvePlan);
  const showToast = useAppStore((state) => state.showToast);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const rememberedMode = normalizeGlobalPermissionMode(
    settings?.planApprovalPermissionMode,
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      requestAnimationFrame(() => chevronRef.current?.focus());
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const focusFrame = requestAnimationFrame(() => {
      const selected = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      );
      (selected ??
        menuRef.current?.querySelector<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ))?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const focusComposer = () => {
    if (useAppStore.getState().activeSessionId !== proposal.sessionId) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
    });
  };

  const resolve = async (
    action: "approve" | "reject",
    targetPermissionMode?: GlobalPermissionMode,
  ) => {
    if (resolving) return;
    setMenuOpen(false);
    setResolving(true);
    try {
      await resolvePlan({
        proposalId: proposal.id,
        sessionId: proposal.sessionId,
        turnId: proposal.turnId,
        toolCallId: proposal.toolCallId,
        version: proposal.version,
        action,
        ...(action === "approve" && targetPermissionMode
          ? { targetPermissionMode }
          : {}),
      });
      focusComposer();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
      setResolving(false);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      requestAnimationFrame(() => chevronRef.current?.focus());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const target = event.target as HTMLElement;
      const mode = target.closest<HTMLButtonElement>(
        '[data-approval-mode]',
      )?.dataset.approvalMode;
      if (isApprovalMode(mode)) {
        event.preventDefault();
        void resolve("approve", mode);
      }
      return;
    }
    if (!(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(event.key)) {
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ) ?? [],
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowDown") {
      next = current < 0 ? 0 : (current + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    }
    items[next]?.focus();
  };

  return (
    <section
      className="plan-approval-bar"
      role="region"
      aria-label={t("plan.approvalRegion")}
      aria-busy={resolving}
      data-testid="plan-approval-bar"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {t("plan.readyAnnouncement")}
      </span>
      <div className="plan-approval-question">{proposal.question}</div>
      <div className="plan-approval-actions">
        <button
          type="button"
          className="plan-approval-reject"
          disabled={resolving}
          onClick={() => void resolve("reject")}
        >
          {t("plan.reject")}
        </button>
        <div
          ref={menuRef}
          className="plan-approval-split"
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            className="plan-approval-approve-main"
            disabled={resolving}
            aria-label={t(APPROVE_LABEL_KEYS[rememberedMode])}
            onClick={() => void resolve("approve", rememberedMode)}
          >
            {resolving
              ? t("plan.approving")
              : t(APPROVE_LABEL_KEYS[rememberedMode])}
          </button>
          <button
            ref={chevronRef}
            type="button"
            className="plan-approval-approve-menu"
            disabled={resolving}
            aria-label={t("plan.chooseApprovalMode")}
            title={t("plan.chooseApprovalMode")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconChevronDown size={13} aria-hidden />
          </button>
          {menuOpen ? (
            <div
              className="plan-approval-menu"
              role="menu"
              aria-label={t("plan.chooseApprovalMode")}
            >
              {APPROVAL_MODES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="plan-approval-menu-item"
                  role="menuitemradio"
                  aria-checked={rememberedMode === candidate}
                  data-approval-mode={candidate}
                  onClick={() => void resolve("approve", candidate)}
                >
                  <span>{t(APPROVAL_MODE_LABEL_KEYS[candidate])}</span>
                  {rememberedMode === candidate ? (
                    <IconCheck size={13} aria-hidden />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
