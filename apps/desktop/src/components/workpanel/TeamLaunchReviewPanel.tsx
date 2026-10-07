import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  SessionThinkingLevel,
  TeamExecutionDecision,
  TeamLaunchReview,
  TeamLaunchReviewMember,
  TeamLaunchReviewSelectionUpdate,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Button, Select } from "../ui";
import { IconCheck, IconCircleAlert, IconTriangleAlert, IconX } from "../icons";

export type TeamLaunchReviewPanelProps = {
  teamSessionId: string;
  review: TeamLaunchReview;
  decision?: TeamExecutionDecision | null;
  onReviewChanged?: () => void;
};

const ALL_THINKING_LEVELS: SessionThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function TeamLaunchReviewPanel({
  teamSessionId,
  review,
  decision,
  onReviewChanged,
}: TeamLaunchReviewPanelProps) {
  const { t } = useTranslation();
  const providers = useAppStore((s) => s.providers);

  const identity = `${teamSessionId}:${review.reviewId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const generationRef = useRef(0);
  const latestReviewRef = useRef(review);
  const [activeReview, setActiveReview] = useState(review);
  const [members, setMembers] = useState<TeamLaunchReviewMember[]>(review.members);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictedRevision, setConflictedRevision] = useState<number | null>(null);

  useEffect(() => {
    const identityChanged = latestReviewRef.current.reviewId !== review.reviewId ||
      latestReviewRef.current.teamSessionId !== teamSessionId;
    if (identityChanged) {
      generationRef.current += 1;
      latestReviewRef.current = review;
      setActiveReview(review);
      setMembers(review.members);
      setSaving(false);
      setConfirming(false);
      setCancelling(false);
      setError(null);
      setConflictedRevision(null);
      return;
    }
    if (review.revision > latestReviewRef.current.revision) {
      latestReviewRef.current = review;
      setActiveReview(review);
      setMembers(review.members);
      setError(null);
      setConflictedRevision(null);
    }
  }, [identity, review, teamSessionId]);

  const isPending = activeReview.status === "pending";
  const awaitingConflictRefresh = conflictedRevision !== null &&
    activeReview.revision <= conflictedRevision;

  const isCurrentRequest = useCallback(
    (requestIdentity: string, generation: number) =>
      identityRef.current === requestIdentity && generationRef.current === generation,
    [],
  );

  const applyReview = useCallback((nextReview: TeamLaunchReview) => {
    latestReviewRef.current = nextReview;
    setActiveReview(nextReview);
    setMembers(nextReview.members);
  }, []);

  const handleSelectionChange = useCallback(
    async (name: string, updates: Partial<TeamLaunchReviewMember["selection"]>) => {
      if (!isPending || saving || awaitingConflictRefresh) return;

      const requestIdentity = identity;
      const requestGeneration = generationRef.current;
      const baseReview = latestReviewRef.current;

      const nextMembers = members.map((m) => {
        if (m.name !== name) return m;
        return {
          ...m,
          selection: {
            ...m.selection,
            ...updates,
          },
        };
      });

      setMembers(nextMembers);
      setSaving(true);
      setError(null);

      const selectionsPayload: TeamLaunchReviewSelectionUpdate[] = nextMembers.map((m) => ({
        name: m.name,
        providerId: m.selection.providerId,
        modelId: m.selection.modelId,
        thinkingLevel: m.selection.thinkingLevel,
      }));

      try {
        const response = await api.updateTeamLaunchReview(
          teamSessionId,
          baseReview.reviewId,
          baseReview.revision,
          selectionsPayload,
        );
        if (!isCurrentRequest(requestIdentity, requestGeneration)) return;
        applyReview(response.review);
        onReviewChanged?.();
      } catch (err) {
        if (!isCurrentRequest(requestIdentity, requestGeneration)) return;
        setMembers(latestReviewRef.current.members);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("TEAM_REVIEW_REVISION_CONFLICT") || msg.includes("conflict")) {
          setConflictedRevision(baseReview.revision);
          setError(t("team.review.conflict"));
          onReviewChanged?.();
        } else if (msg.includes("TEAM_MODEL_SELECTION_INVALID")) {
          setError(t("team.review.invalidRoute"));
        } else {
          setError(msg);
        }
      } finally {
        if (isCurrentRequest(requestIdentity, requestGeneration)) setSaving(false);
      }
    },
    [isPending, saving, awaitingConflictRefresh, members, teamSessionId, identity, onReviewChanged, t, isCurrentRequest, applyReview],
  );

  const handleConfirm = async () => {
    if (!isPending || confirming || saving || cancelling || awaitingConflictRefresh) return;
    const requestIdentity = identity;
    const requestGeneration = generationRef.current;
    const baseReview = latestReviewRef.current;
    setConfirming(true);
    setError(null);
    try {
      const response = await api.confirmTeamLaunchReview(
        teamSessionId,
        baseReview.reviewId,
        baseReview.revision,
      );
      if (!isCurrentRequest(requestIdentity, requestGeneration)) return;
      applyReview(response.review);
      onReviewChanged?.();
    } catch (err) {
      if (!isCurrentRequest(requestIdentity, requestGeneration)) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("TEAM_REVIEW_REVISION_CONFLICT") || msg.includes("conflict")) {
        setConflictedRevision(baseReview.revision);
        setError(t("team.review.conflict"));
        onReviewChanged?.();
      } else {
        setError(msg);
      }
    } finally {
      if (isCurrentRequest(requestIdentity, requestGeneration)) setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (!isPending || cancelling || saving || confirming || awaitingConflictRefresh) return;
    const requestIdentity = identity;
    const requestGeneration = generationRef.current;
    const baseReview = latestReviewRef.current;
    setCancelling(true);
    setError(null);
    try {
      const response = await api.cancelTeamLaunchReview(
        teamSessionId,
        baseReview.reviewId,
        baseReview.revision,
      );
      if (!isCurrentRequest(requestIdentity, requestGeneration)) return;
      applyReview(response.review);
      onReviewChanged?.();
    } catch (err) {
      if (!isCurrentRequest(requestIdentity, requestGeneration)) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("TEAM_REVIEW_REVISION_CONFLICT") || msg.includes("conflict")) {
        setConflictedRevision(baseReview.revision);
        setError(t("team.review.conflict"));
        onReviewChanged?.();
      } else {
        setError(msg);
      }
    } finally {
      if (isCurrentRequest(requestIdentity, requestGeneration)) setCancelling(false);
    }
  };

  const reviewDecision = decision?.leadTurnId === activeReview.leadTurnId ? decision : null;
  const strategyReason = reviewDecision?.reason || null;

  return (
    <section className="team-launch-review" data-testid="team-launch-review">
      <div className="team-launch-review-header">
        <div className="team-launch-review-title">
          <span>{t("team.review.sectionTitle")}</span>
          <span className={`team-review-status-badge status-${activeReview.status}`}>
            {t(`team.review.status.${activeReview.status}`)}
          </span>
          {saving && <span className="team-review-saving-tag">{t("team.review.saving")}</span>}
        </div>
        {isPending && (
          <div className="team-launch-review-actions">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving || confirming || cancelling || awaitingConflictRefresh}
              onClick={() => void handleCancel()}
              data-testid="team-launch-review-cancel-btn"
            >
              <IconX size={14} />
              <span>{cancelling ? t("team.review.cancelling") : t("team.review.cancel")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={saving || confirming || cancelling || awaitingConflictRefresh}
              onClick={() => void handleConfirm()}
              data-testid="team-launch-review-confirm-btn"
            >
              <IconCheck size={14} />
              <span>{confirming ? t("team.review.confirming") : t("team.review.confirm")}</span>
            </Button>
          </div>
        )}
      </div>

      {strategyReason && (
        <div className="team-launch-review-reason">
          <span className="team-launch-review-reason-label">{t("team.review.reason")}:</span>
          <p className="team-launch-review-reason-text">{strategyReason}</p>
        </div>
      )}

      {error && (
        <div className="team-launch-review-error" role="alert">
          <IconTriangleAlert size={14} />
          <span>{error}</span>
        </div>
      )}

      {reviewDecision?.coordinationError && (
        <div className="team-launch-review-error" role="alert">
          <IconCircleAlert size={14} />
          <span>
            {t("team.review.coordinationError", {
              stage: t(`team.review.coordinationStage.${reviewDecision.coordinationError.stage}`),
              message: reviewDecision.coordinationError.message,
            })}
          </span>
        </div>
      )}

      <div className="team-launch-review-members">
        <div className="team-launch-review-members-header">
          <span>{t("team.review.proposedExperts")}</span>
          <span className="team-section-count">{members.length}</span>
        </div>

        <div className="team-launch-review-member-list">
          {members.map((member) => {
            const currentProvider = providers.find((p) => p.id === member.selection.providerId);
            const currentModelList = currentProvider?.models || [];
            const isReused = Boolean(member.memberSessionId);

            return (
              <div
                key={member.name}
                className="team-launch-review-member-card"
                data-testid={`launch-review-member-${member.name}`}
              >
                <div className="team-launch-review-member-info">
                  <span className="team-launch-review-member-name">
                    {member.presentation
                      ? `${t(`team.roles.${member.presentation.role}`)} ${member.presentation.displayName}`
                      : member.name}
                  </span>
                  <div className="team-launch-review-member-tags">
                    <span className="team-badge team-badge-context">
                      {t(`team.context.${member.contextKind}`)}
                    </span>
                    {isReused ? (
                      <span className="team-badge team-badge-reused">
                        {t("team.review.reusedMember")}
                      </span>
                    ) : (
                      <span className="team-badge team-badge-new">
                        {t("team.review.newMember")}
                      </span>
                    )}
                  </div>
                  {member.description && (
                    <p className="team-launch-review-member-desc">{member.description}</p>
                  )}
                </div>

                <div className="team-launch-review-member-controls">
                  <label className="team-review-field">
                    <span className="team-review-field-label">{t("team.review.provider")}</span>
                    <Select
                      disabled={!isPending || saving || confirming || cancelling || awaitingConflictRefresh}
                      value={member.selection.providerId}
                      onChange={(e) => {
                        const newProviderId = e.target.value;
                        const newProvider = providers.find((p) => p.id === newProviderId);
                        const firstModel = newProvider?.models[0]?.id || member.selection.modelId;
                        void handleSelectionChange(member.name, {
                          providerId: newProviderId,
                          modelId: firstModel,
                        });
                      }}
                      className="team-review-select"
                      data-testid={`review-provider-${member.name}`}
                    >
                      {!currentProvider && (
                        <option value={member.selection.providerId}>
                          {t("team.review.missingProvider", { id: member.selection.providerId })}
                        </option>
                      )}
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label className="team-review-field">
                    <span className="team-review-field-label">{t("team.review.model")}</span>
                    <Select
                      disabled={!isPending || saving || confirming || cancelling || awaitingConflictRefresh}
                      value={member.selection.modelId}
                      onChange={(e) => {
                        void handleSelectionChange(member.name, {
                          modelId: e.target.value,
                        });
                      }}
                      className="team-review-select"
                      data-testid={`review-model-${member.name}`}
                    >
                      {!currentModelList.some((model) => model.id === member.selection.modelId) && (
                        <option value={member.selection.modelId}>
                          {t("team.review.missingModel", { id: member.selection.modelId })}
                        </option>
                      )}
                      {currentModelList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.alias || m.id}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label className="team-review-field">
                    <span className="team-review-field-label">{t("team.review.thinking")}</span>
                    <Select
                      disabled={!isPending || saving || confirming || cancelling || awaitingConflictRefresh}
                      value={member.selection.thinkingLevel}
                      onChange={(e) => {
                        void handleSelectionChange(member.name, {
                          thinkingLevel: e.target.value as SessionThinkingLevel,
                        });
                      }}
                      className="team-review-select"
                      data-testid={`review-thinking-${member.name}`}
                    >
                      {ALL_THINKING_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {t(`team.review.thinkingLevel.${lvl}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
