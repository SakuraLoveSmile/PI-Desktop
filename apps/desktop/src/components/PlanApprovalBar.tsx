import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  GlobalPermissionMode,
  PlanProposal,
} from "@pi-desktop/shared";
import { ErrorCodes as SharedErrorCodes } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { fileWorkPanelTab } from "../lib/work-panel-tabs";
import {
  PLAN_APPROVAL_DEFAULT_MODE,
  planCheckpointStatus,
  type PlanCheckpointStatus,
} from "../lib/plan-mode-state";
import {
  IconCheck,
  IconChevronDown,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconFileText,
  IconSparkles,
  IconTriangleAlert,
} from "./icons";

const ErrorCodes = {
  ...SharedErrorCodes,
  PLAN_APPROVAL_TIMEOUT: "PLAN_APPROVAL_TIMEOUT",
} as const;

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

const PLAN_APPROVAL_RECONCILE_RETRY_MS = 5_000;

function isApprovalMode(value: string | undefined): value is GlobalPermissionMode {
  return value === "ask" || value === "accept-edits" || value === "auto";
}

const PLAN_STATUS_LABEL_KEYS: Record<PlanCheckpointStatus, string> = {
  pending: "plan.statusPending",
  resolving: "plan.statusResolving",
  approved: "plan.statusApproved",
  queued: "plan.statusQueued",
  running: "plan.statusRunning",
  completed: "plan.statusCompleted",
  rejected: "plan.statusRejected",
  expired: "plan.statusExpired",
  interrupted: "plan.statusInterrupted",
};

function formatPlanTimestamp(value: string | undefined, locale: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return null;
  }
}

export function PlanApprovalBar({ proposal }: { proposal: PlanProposal }) {
  const { t, i18n } = useTranslation();
  const resolvePlan = useAppStore((state) => state.resolvePlan);
  const restorePendingPlan = useAppStore((state) => state.restorePendingPlan);
  const showToast = useAppStore((state) => state.showToast);
  const openWorkPanelTabForSession = useAppStore(
    (state) => state.openWorkPanelTabForSession,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [approvalMode, setApprovalMode] = useState<GlobalPermissionMode>(
    PLAN_APPROVAL_DEFAULT_MODE,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const artifactPath = proposal.artifact?.relativePath?.trim() || null;
  const isPending = proposal.status === "pending";
  const expiryTime = formatPlanTimestamp(
    proposal.expiresAt,
    i18n.resolvedLanguage || i18n.language,
  );
  const busy = resolving || reconciling;
  const status = planCheckpointStatus(proposal, resolving);
  const statusText = t(PLAN_STATUS_LABEL_KEYS[status]);

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

  useEffect(() => {
    if (!isPending || !proposal.expiresAt) return;
    const expiresAt = Date.parse(proposal.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    let cancelled = false;
    let reconcileTimer: number | undefined;

    const scheduleReconcile = (delay: number) => {
      if (cancelled) return;
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = undefined;
        if (cancelled) return;
        setReconciling(true);
        void restorePendingPlan(proposal.sessionId).then(
          (result) => {
            if (cancelled) return;
            if (result === "pending" || result === "unavailable") {
              scheduleReconcile(PLAN_APPROVAL_RECONCILE_RETRY_MS);
            }
          },
          () => {
            if (cancelled) return;
            scheduleReconcile(PLAN_APPROVAL_RECONCILE_RETRY_MS);
          },
        );
      }, delay);
    };

    scheduleReconcile(Math.max(0, expiresAt - Date.now()));
    return () => {
      cancelled = true;
      if (reconcileTimer !== undefined) {
        window.clearTimeout(reconcileTimer);
        reconcileTimer = undefined;
      }
    };
  }, [isPending, proposal.expiresAt, proposal.sessionId, restorePendingPlan]);

  useEffect(() => {
    setApprovalMode(PLAN_APPROVAL_DEFAULT_MODE);
    setMenuOpen(false);
  }, [proposal.id]);

  useEffect(() => {
    setResolving(false);
    setReconciling(false);
  }, [proposal.id, proposal.status, proposal.executionState]);

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
    if (busy || !isPending) return;
    setMenuOpen(false);
    setResolving(true);
    try {
      const identity = {
        proposalId: proposal.id,
        sessionId: proposal.sessionId,
        turnId: proposal.turnId,
        toolCallId: proposal.toolCallId,
        version: proposal.version,
      };
      await resolvePlan(
        action === "approve"
          ? {
              ...identity,
              action,
              targetPermissionMode:
                targetPermissionMode ?? PLAN_APPROVAL_DEFAULT_MODE,
            }
          : { ...identity, action },
      );
      focusComposer();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
      if (
        (error as { code?: unknown })?.code !==
        ErrorCodes.PLAN_APPROVAL_TIMEOUT
      ) {
        setResolving(false);
      }
    }
  };

  const openArtifact = () => {
    if (!artifactPath) return;
    openWorkPanelTabForSession(
      proposal.sessionId,
      fileWorkPanelTab(artifactPath),
    );
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
        setApprovalMode(mode);
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
      aria-busy={busy}
      data-status={proposal.status}
      data-execution-state={proposal.executionState || ""}
      data-testid="plan-approval-bar"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {isPending ? t("plan.readyAnnouncement") : statusText}
      </span>
      <div className="plan-approval-copy">
        <div className="plan-approval-label">{t("plan.approvalRegion")}</div>
        <h2 className="plan-approval-title">
          {proposal.title.trim() || t("plan.untitled")}
        </h2>
        <p className="plan-approval-question">{proposal.question}</p>
        <div className="plan-approval-details">
          {artifactPath ? (
            <button
              type="button"
              className="plan-approval-artifact"
              data-testid="plan-open-artifact"
              aria-label={t("plan.openArtifactLabel", { path: artifactPath })}
              title={artifactPath}
              onClick={openArtifact}
            >
              <IconFileText size={14} aria-hidden />
              <span className="plan-approval-artifact-label">
                {t("plan.openArtifact")}
              </span>
              <span className="plan-approval-artifact-path">
                {artifactPath}
              </span>
            </button>
          ) : null}
          {expiryTime ? (
            <span className="plan-approval-expiry">
              {t("plan.expiresAt", { time: expiryTime })}
            </span>
          ) : null}
          <span
            className={`plan-approval-status plan-approval-status-${status}`}
            role="status"
          >
            {status === "approved" || status === "completed" ? (
              <IconCircleCheck size={13} aria-hidden />
            ) : status === "rejected" || status === "expired" || status === "interrupted" ? (
              <IconCircleAlert size={13} aria-hidden />
            ) : status === "running" ? (
              <IconSparkles size={13} aria-hidden />
            ) : (
              <IconClock size={13} aria-hidden />
            )}
            <span>{statusText}</span>
          </span>
        </div>
      </div>
      {isPending ? (
        <div className="plan-approval-actions">
          <button
            type="button"
            className="plan-approval-reject"
            disabled={busy}
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
              disabled={busy}
              aria-label={t(APPROVE_LABEL_KEYS[approvalMode])}
              onClick={() => void resolve("approve", approvalMode)}
            >
              {resolving
                ? t("plan.approving")
                : t(APPROVE_LABEL_KEYS[approvalMode])}
            </button>
            <button
              ref={chevronRef}
              type="button"
              className="plan-approval-approve-menu"
              disabled={busy}
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
                    aria-checked={approvalMode === candidate}
                    data-approval-mode={candidate}
                    disabled={busy}
                    onClick={() => {
                      setApprovalMode(candidate);
                      void resolve("approve", candidate);
                    }}
                  >
                    <span>{t(APPROVAL_MODE_LABEL_KEYS[candidate])}</span>
                    {approvalMode === candidate ? (
                      <IconCheck size={13} aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {isPending && approvalMode === "auto" ? (
        <div className="plan-approval-warning" role="note">
          <IconTriangleAlert size={13} aria-hidden />
          <span>{t("plan.autoWarning")}</span>
        </div>
      ) : null}
    </section>
  );
}
