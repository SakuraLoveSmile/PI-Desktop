import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  GlobalPermissionMode,
  PlanProposal,
  ProposalKind,
} from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { fileWorkPanelTab } from "../lib/work-panel-tabs";
import {
  PlanArtifactResolutionError,
  resolvePlanArtifactPath,
} from "../lib/plan-artifact";
import { PLAN_APPROVAL_DEFAULT_MODE } from "../lib/plan-mode-state";
import {
  readPlanApprovalMode,
  rememberPlanApprovalMode,
} from "../lib/plan-approval-preferences";
import {
  IconCheck,
  IconChevronDown,
  IconFileText,
} from "./icons";
import { Button, Input, Select, SettingsToggle, TooltipButton } from "./ui";
import { PlanMarkdownActions } from "./PlanMarkdownActions";
import { ApprovalSummary } from "./ApprovalSummary";
import { AnchoredMenu } from "./settings/AnchoredMenu";

const APPROVAL_MODES: readonly GlobalPermissionMode[] = [
  "ask",
  "accept-edits",
  "auto",
];

/**
 * Plan and Goal share this one approval bar; only the copy differs, so every
 * label is looked up under the proposal kind's i18n namespace (D198).
 */
const APPROVAL_MODE_LABELS: Record<GlobalPermissionMode, string> = {
  ask: "ask",
  "accept-edits": "acceptEdits",
  auto: "auto",
};

const APPROVE_LABELS: Record<GlobalPermissionMode, string> = {
  ask: "approveAsk",
  "accept-edits": "approveAcceptEdits",
  auto: "approveAuto",
};

function isApprovalMode(value: string | undefined): value is GlobalPermissionMode {
  return value === "ask" || value === "accept-edits" || value === "auto";
}

/** `plan.reject` or `goal.reject`, chosen by the approved contract kind. */
function copyKey(kind: ProposalKind, name: string): string {
  return `${kind}.${name}`;
}

export function PlanApprovalBar({ proposal }: { proposal: PlanProposal }) {
  const { t } = useTranslation();
  const resolvePlan = useAppStore((state) => state.resolvePlan);
  const convertPlanToGoal = useAppStore((state) => state.convertPlanToGoal);
  const runMissedPlan = useAppStore((state) => state.runMissedPlan);
  const cancelScheduledPlan = useAppStore((state) => state.cancelScheduledPlan);
  const retryPlanRevision = useAppStore((state) => state.retryPlanRevision);
  const cancelPlanConversion = useAppStore((state) => state.cancelPlanConversion);
  const draftDirty = useAppStore((state) => state.planDraftsDirty[proposal.sessionId] === true);
  const providers = useAppStore((state) => state.providers);
  const providerModels = useAppStore((state) => state.providerModels);
  const session = useAppStore((state) => state.sessions.find((item) => item.id === proposal.sessionId));
  const showToast = useAppStore((state) => state.showToast);
  const openWorkPanelTabForSession = useAppStore(
    (state) => state.openWorkPanelTabForSession,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [approvalMode, setApprovalMode] = useState<GlobalPermissionMode>(
    readPlanApprovalMode(),
  );
  const [goalRequested, setGoalRequested] = useState(
    proposal.executionKind === "goal" || proposal.kind === "goal",
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [executionProviderId, setExecutionProviderId] = useState(
    proposal.executionProviderId ?? proposal.planningProviderId ?? session?.providerId ?? "",
  );
  const [executionModelId, setExecutionModelId] = useState(
    proposal.executionModelId ?? proposal.planningModelId ?? session?.modelId ?? "",
  );
  const isPending = proposal.status === "pending";
  const kind: ProposalKind = proposal.kind === "goal" ? "goal" : "plan";
  const effectiveKind: ProposalKind =
    proposal.executionKind === "goal"
      ? "goal"
      : isPending && goalRequested
        ? "goal"
        : kind;
  const copy = (name: string) => t(copyKey(effectiveKind, name));
  const artifactPath = proposal.artifact?.relativePath?.trim() || null;
  const markdown = proposal.markdown || proposal.plan || "";
  const busy = resolving;
  const blockedByDraft = isPending && draftDirty;
  const scheduleInstant = scheduledFor ? new Date(scheduledFor).getTime() : NaN;
  const scheduleValid = Number.isFinite(scheduleInstant) && scheduleInstant > Date.now();
  const selectedProvider = providers.find((item) => item.id === executionProviderId);
  const configuredModels = selectedProvider?.models.map((item) => ({ id: item.id, label: item.id })) ?? [];
  const discoveredModels = providerModels[executionProviderId]?.map((item) => ({
    id: item.modelId,
    label: item.displayName || item.modelId,
  })) ?? [];
  const modelOptions = discoveredModels.length > 0 ? discoveredModels : configuredModels;
  const scheduleLabel = proposal.scheduledFor
    ? (() => {
        try {
          return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: proposal.scheduleTimezone || undefined,
          }).format(new Date(proposal.scheduledFor));
        } catch {
          return proposal.scheduledFor;
        }
      })()
    : "";
  const statusLabel = proposal.executionState
    ? t(`chat.scheduleExecutionState.${proposal.executionState}`)
    : proposal.scheduleState
      ? t(`chat.scheduleState.${proposal.scheduleState}`)
      : proposal.revisionIntent
        ? t(`chat.revisionState.${proposal.revisionIntent.state}`)
      : !isPending
        ? t(`chat.planStatus.${proposal.status}`)
        : null;

  useEffect(() => {
    setApprovalMode(readPlanApprovalMode());
    setMenuOpen(false);
    setGoalRequested(proposal.executionKind === "goal" || proposal.kind === "goal");
    setScheduleOpen(false);
    setScheduledFor("");
    setExecutionProviderId(proposal.executionProviderId ?? proposal.planningProviderId ?? session?.providerId ?? "");
    setExecutionModelId(proposal.executionModelId ?? proposal.planningModelId ?? session?.modelId ?? "");
  }, [proposal.id, proposal.executionKind, proposal.kind]);

  useEffect(() => {
    setResolving(false);
  }, [proposal.id]);

  const focusComposer = () => {
    if (useAppStore.getState().activeSessionId !== proposal.sessionId) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
    });
  };

  const resolve = async (
    action: "approve" | "reject" | "request_changes" | "schedule",
    targetPermissionMode?: GlobalPermissionMode,
  ) => {
    if (busy || !isPending || (blockedByDraft && action !== "reject")) return;
    if (action === "schedule" && (!scheduleValid || !executionProviderId || !executionModelId)) return;
    setMenuOpen(false);
    if (action === "approve" || action === "schedule") {
      const selectedMode = targetPermissionMode ?? PLAN_APPROVAL_DEFAULT_MODE;
      setApprovalMode(selectedMode);
      rememberPlanApprovalMode(selectedMode);
    }
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
              executionProviderId,
              executionModelId,
              executionKind: kind === "goal" || goalRequested ? "goal" : "plan",
            }
          : action === "schedule"
            ? {
                ...identity,
                action,
                targetPermissionMode: targetPermissionMode ?? PLAN_APPROVAL_DEFAULT_MODE,
                executionProviderId,
                executionModelId,
                scheduledFor: new Date(scheduleInstant).toISOString(),
                scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                executionKind: kind === "goal" || goalRequested ? "goal" : "plan",
              }
            : { ...identity, action },
      );
      focusComposer();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
      setResolving(false);
    }
  };

  const openArtifact = async () => {
    if (!artifactPath) return;
    try {
      const resolved = await resolvePlanArtifactPath(proposal);
      if (!resolved) return;
      openWorkPanelTabForSession(
        proposal.sessionId,
        fileWorkPanelTab(resolved.path),
      );
    } catch (error) {
      const key = error instanceof PlanArtifactResolutionError
        ? error.code === "session-unavailable"
          ? "artifactSessionUnavailable"
          : "artifactScratchUnavailable"
        : null;
      showToast(key ? t(copyKey(kind, key)) : error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLSelectElement) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
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
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
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
      aria-label={copy("approvalRegion")}
      aria-busy={busy}
      data-kind={effectiveKind}
      data-status={proposal.status}
      data-execution-state={proposal.executionState || ""}
      data-testid="plan-approval-bar"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {copy("readyAnnouncement")}
      </span>
      <div className="plan-approval-copy">
        <h2 className="plan-approval-title">
          <IconFileText size={15} aria-hidden />
          {proposal.title.trim() || copy("untitled")}
        </h2>
        <div className="plan-approval-summary">
          <ApprovalSummary text={proposal.question.trim() || proposal.title.trim()} />
        </div>
        {statusLabel ? (
          <p className="plan-approval-schedule-status" role="status">
            {statusLabel}
            {scheduleLabel ? ` · ${scheduleLabel} ${proposal.scheduleTimezone ?? ""}` : ""}
          </p>
        ) : null}
      </div>
      {blockedByDraft ? <p className="plan-approval-draft-warning">{t("chat.planDraftPending")}</p> : null}
      <div className="plan-approval-footer">
        <div className="plan-approval-details">
          {artifactPath ? (
            <button
              type="button"
              className="plan-approval-artifact"
              data-testid="plan-open-artifact"
              aria-label={t(copyKey(kind, "openArtifactLabel"), {
                path: artifactPath,
              })}
              title={artifactPath}
              onClick={() => void openArtifact()}
            >
              <IconFileText size={14} aria-hidden />
              <span className="plan-approval-artifact-label">
                {t("chat.viewDetails")}
              </span>
              <span className="plan-approval-artifact-path">
                {artifactPath}
              </span>
            </button>
          ) : null}
          {markdown ? <PlanMarkdownActions markdown={markdown} artifactPath={artifactPath} title={proposal.title} /> : null}
        </div>
        {isPending ? (
        <div className="plan-approval-actions">
          <span className="plan-approval-goal-toggle">
            <span>{t("chat.goalMode", "Goal")}</span>
            <SettingsToggle
              checked={goalRequested}
              disabled={blockedByDraft || kind === "goal"}
              label={t("chat.goalMode")}
              onChange={() => {
                if (blockedByDraft || kind !== "plan") return;
                setGoalRequested((prev) => !prev);
              }}
            />
          </span>
          <Button
            type="button"
            className="plan-approval-schedule"
            disabled={busy || blockedByDraft}
            onClick={() => setScheduleOpen((open) => !open)}
          >
            {t("chat.schedule", "Schedule")}
          </Button>
          <button
            type="button"
            className="plan-approval-reject"
            disabled={busy}
            onClick={() => void resolve("reject")}
          >
            {copy("reject")}
          </button>
          <AnchoredMenu
            className="plan-approval-split"
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            menuClassName="plan-approval-menu"
            label={copy("chooseApprovalMode")}
            role="menu"
            align="end"
            onMenuKeyDown={onMenuKeyDown}
            trigger={(ref) => (
              <>
                <button
                  type="button"
                  className="plan-approval-approve-main"
                  disabled={busy || blockedByDraft || !executionProviderId || !executionModelId}
                  aria-label={copy(APPROVE_LABELS[approvalMode])}
                  onClick={() => void resolve("approve", approvalMode)}
                >
                  {resolving
                    ? copy("approving")
                    : copy(APPROVE_LABELS[approvalMode])}
                </button>
                <TooltipButton
                  ref={ref}
                  type="button"
                  className="plan-approval-approve-menu"
                  disabled={busy || blockedByDraft}
                  ariaLabel={copy("chooseApprovalMode")}
                  tooltip={copy("chooseApprovalMode")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <IconChevronDown size={13} aria-hidden />
                </TooltipButton>
              </>
            )}
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
                <span>{copy(APPROVAL_MODE_LABELS[candidate])}</span>
                {approvalMode === candidate ? (
                  <IconCheck size={13} aria-hidden />
                ) : null}
              </button>
            ))}
            <div className="plan-approval-execution-binding">
              <label>
                <span>{t("chat.executionProvider")}</span>
                <Select
                  value={executionProviderId}
                  onChange={(event) => {
                    const nextProvider = event.target.value;
                    setExecutionProviderId(nextProvider);
                    setExecutionModelId(providers.find((item) => item.id === nextProvider)?.models[0]?.id ?? "");
                  }}
                >
                  {providers.filter((item) => item.enabled).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </Select>
              </label>
              <label>
                <span>{t("chat.executionModel")}</span>
                <Select value={executionModelId} onChange={(event) => setExecutionModelId(event.target.value)}>
                  {executionModelId && !modelOptions.some((item) => item.id === executionModelId)
                    ? <option value={executionModelId}>{executionModelId}</option>
                    : null}
                  {modelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </Select>
              </label>
            </div>
          </AnchoredMenu>
          {scheduleOpen ? (
            <div className="plan-approval-schedule-popover">
              <label>
                <span>{t("chat.scheduleTime", "Run at")}</span>
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(event) => setScheduledFor(event.target.value)}
                />
              </label>
              <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
              <span>{selectedProvider?.name ?? executionProviderId} / {executionModelId} · {copy(APPROVAL_MODE_LABELS[approvalMode])}</span>
              <Button
                type="button"
                disabled={!scheduleValid || busy || blockedByDraft || !executionProviderId || !executionModelId}
                onClick={() => void resolve("schedule", approvalMode)}
              >
                {t("chat.confirmSchedule", "Confirm schedule")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : proposal.scheduleState === "missed" || proposal.scheduleState === "scheduled" ? (
        <div className="plan-approval-actions">
          {proposal.scheduleState === "missed" ? (
            <Button type="button" disabled={busy} onClick={() => {
              setResolving(true);
              void runMissedPlan(proposal).catch((error) => showToast(String(error), { variant: "error" })).finally(() => setResolving(false));
            }}>{t("chat.runMissed")}</Button>
          ) : null}
          <Button type="button" disabled={busy} onClick={() => {
            setResolving(true);
            void cancelScheduledPlan(proposal).catch((error) => showToast(String(error), { variant: "error" })).finally(() => setResolving(false));
          }}>{t("chat.cancelSchedule")}</Button>
        </div>
      ) : proposal.revisionIntent?.targetKind === "goal" &&
          (proposal.revisionIntent.state === "ready" || proposal.revisionIntent.state === "started") ? (
        <div className="plan-approval-actions">
          <span className="plan-approval-goal-toggle">
            <span>{t("chat.goalMode")}</span>
            <SettingsToggle checked label={t("chat.goalMode")} onChange={() => {
              void cancelPlanConversion(proposal).catch((error) => showToast(String(error), { variant: "error" }));
            }} />
          </span>
          {proposal.revisionIntent.state === "ready" ? (
            <Button type="button" disabled={busy} onClick={() => {
              setResolving(true);
              void retryPlanRevision(proposal).catch((error) => showToast(String(error), { variant: "error" })).finally(() => setResolving(false));
            }}>{t("chat.retryRevision")}</Button>
          ) : null}
        </div>
      ) : proposal.revisionIntent?.state === "ready" || proposal.revisionIntent?.state === "failed" ? (
        <div className="plan-approval-actions">
          <Button type="button" disabled={busy} onClick={() => {
            setResolving(true);
            void retryPlanRevision(proposal).catch((error) => showToast(String(error), { variant: "error" })).finally(() => setResolving(false));
          }}>{t("chat.retryRevision")}</Button>
        </div>
      ) : null}
      </div>
    </section>
  );
}
