import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PlanApprovalPermissionMode,
  PlanProposal,
} from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { Button, Textarea } from "./ui";
import { IconListChecks } from "./icons";

const APPROVAL_PERMISSION_MODES: readonly PlanApprovalPermissionMode[] = [
  "ask",
  "accept-edits",
  "auto",
];

const PERMISSION_MODE_I18N_KEYS: Record<PlanApprovalPermissionMode, string> = {
  ask: "chat.permissionAsk",
  "accept-edits": "chat.permissionAcceptEdits",
  auto: "chat.permissionAuto",
};

export function PlanApprovalCard({ proposal }: { proposal: PlanProposal }) {
  const { t } = useTranslation();
  const resolvePlan = useAppStore((state) => state.resolvePlan);
  const showToast = useAppStore((state) => state.showToast);
  const session = useAppStore((state) =>
    state.sessions.find((candidate) => candidate.id === proposal.sessionId),
  );
  const explicitPermissionMode =
    session?.permissionMode && session.permissionMode !== "inherit"
      ? session.permissionMode
      : undefined;
  const [targetPermissionMode, setTargetPermissionMode] =
    useState<PlanApprovalPermissionMode>(explicitPermissionMode ?? "ask");
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const [resolving, setResolving] = useState(false);

  const submit = async (
    action: "approve" | "request_changes" | "reject",
  ) => {
    if (resolving) return;
    const trimmedFeedback = feedback.trim();
    if (action === "request_changes" && !trimmedFeedback) {
      setFeedbackError(true);
      return;
    }
    setFeedbackError(false);
    setResolving(true);
    try {
      await resolvePlan({
        proposalId: proposal.id,
        sessionId: proposal.sessionId,
        turnId: proposal.turnId,
        toolCallId: proposal.toolCallId,
        action,
        ...(action === "approve" ? { targetPermissionMode } : {}),
        ...(action === "request_changes" ? { feedback: trimmedFeedback } : {}),
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
      setResolving(false);
    }
  };

  return (
    <section
      className="plan-approval-card"
      role="region"
      aria-label={t("plan.approvalTitle")}
      data-testid="plan-approval-card"
    >
      <div className="plan-approval-header">
        <div className="plan-approval-heading">
          <IconListChecks size={15} aria-hidden />
          <span className="plan-approval-title">{t("plan.approvalTitle")}</span>
        </div>
        <span className="plan-approval-state">{t("settings.modePlan")}</span>
      </div>
      <div className="plan-approval-prompt">{t("plan.approvalPrompt")}</div>
      <div className="plan-approval-label">{t("plan.submittedPlan")}</div>
      <pre className="plan-approval-plan">{proposal.plan}</pre>

      <div className="plan-approval-label">{t("plan.permissionMode")}</div>
      <div
        className="plan-permission-options"
        role="radiogroup"
        aria-label={t("chat.permissionMode")}
      >
        {APPROVAL_PERMISSION_MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`plan-permission-option ${
              targetPermissionMode === candidate ? "active" : ""
            }`}
            role="radio"
            aria-checked={targetPermissionMode === candidate}
            disabled={resolving}
            onClick={() => setTargetPermissionMode(candidate)}
          >
            {t(PERMISSION_MODE_I18N_KEYS[candidate])}
          </button>
        ))}
      </div>
      {targetPermissionMode === "auto" ? (
        <div className="plan-approval-warning" role="note">
          {t("plan.autoWarning")}
        </div>
      ) : null}

      <label className="plan-approval-feedback-label" htmlFor={`plan-feedback-${proposal.id}`}>
        {t("plan.feedbackLabel")}
      </label>
      <Textarea
        id={`plan-feedback-${proposal.id}`}
        className="plan-approval-feedback"
        value={feedback}
        placeholder={t("plan.feedbackPlaceholder")}
        disabled={resolving}
        aria-invalid={feedbackError}
        onChange={(event) => {
          setFeedback(event.target.value);
          if (event.target.value.trim()) setFeedbackError(false);
        }}
      />
      {feedbackError ? (
        <div className="plan-approval-error" role="alert">
          {t("plan.feedbackRequired")}
        </div>
      ) : null}

      <div className="plan-approval-actions">
        <Button
          variant="ghost"
          disabled={resolving}
          onClick={() => void submit("reject")}
        >
          {t("plan.reject")}
        </Button>
        <Button
          variant="secondary"
          disabled={resolving}
          onClick={() => void submit("request_changes")}
        >
          {t("plan.requestChanges")}
        </Button>
        <Button
          variant="primary"
          disabled={resolving}
          onClick={() => void submit("approve")}
        >
          {resolving ? t("plan.submitting") : t("plan.approve")}
        </Button>
      </div>
    </section>
  );
}
