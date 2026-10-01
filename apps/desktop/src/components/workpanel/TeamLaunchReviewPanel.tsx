import { useCallback, useEffect, useMemo, useState } from "react";
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

  const [members, setMembers] = useState<TeamLaunchReviewMember[]>(review.members);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when incoming review changes
  useEffect(() => {
    setMembers(review.members);
    setError(null);
  }, [review]);

  const isPending = review.status === "pending";

  const handleSelectionChange = useCallback(
    async (name: string, updates: Partial<TeamLaunchReviewMember["selection"]>) => {
      if (!isPending || saving) return;

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
        await api.updateTeamLaunchReview(
          teamSessionId,
          review.reviewId,
          review.revision,
          selectionsPayload,
        );
        onReviewChanged?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("TEAM_REVIEW_REVISION_CONFLICT") || msg.includes("conflict")) {
          setError(t("team.review.conflict"));
          onReviewChanged?.();
        } else if (msg.includes("TEAM_MODEL_SELECTION_INVALID")) {
          setError(t("team.review.invalidRoute"));
        } else {
          setError(msg);
        }
      } finally {
        setSaving(false);
      }
    },
    [isPending, saving, members, teamSessionId, review.reviewId, review.revision, onReviewChanged, t],
  );

  const handleConfirm = async () => {
    if (!isPending || confirming || saving || cancelling) return;
    setConfirming(true);
    setError(null);
    try {
      await api.confirmTeamLaunchReview(teamSessionId, review.reviewId, review.revision);
      onReviewChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("TEAM_REVIEW_REVISION_CONFLICT") || msg.includes("conflict")) {
        setError(t("team.review.conflict"));
        onReviewChanged?.();
      } else {
        setError(msg);
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (!isPending || cancelling || saving || confirming) return;
    setCancelling(true);
    setError(null);
    try {
      await api.cancelTeamLaunchReview(teamSessionId, review.reviewId, review.revision);
      onReviewChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setCancelling(false);
    }
  };

  const strategyReason = decision?.reason || null;

  return (
    <section className="team-launch-review" data-testid="team-launch-review">
      <div className="team-launch-review-header">
        <div className="team-launch-review-title">
          <span>{t("team.review.sectionTitle")}</span>
          <span className={`team-review-status-badge status-${review.status}`}>
            {review.status}
          </span>
          {saving && <span className="team-review-saving-tag">{t("team.review.saving")}</span>}
        </div>
        {isPending && (
          <div className="team-launch-review-actions">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving || confirming || cancelling}
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
              disabled={saving || confirming || cancelling}
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

      {decision?.coordinationError && (
        <div className="team-launch-review-error" role="alert">
          <IconCircleAlert size={14} />
          <span>
            {t("team.review.coordinationError", {
              stage: decision.coordinationError.stage,
              message: decision.coordinationError.message,
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
            const currentProvider =
              providers.find((p) => p.id === member.selection.providerId) || providers[0];
            const currentModelList = currentProvider?.models || [];
            const isReused = Boolean(member.memberSessionId);

            return (
              <div
                key={member.name}
                className="team-launch-review-member-card"
                data-testid={`launch-review-member-${member.name}`}
              >
                <div className="team-launch-review-member-info">
                  <span className="team-launch-review-member-name">{member.name}</span>
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
                      disabled={!isPending || saving || confirming || cancelling}
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
                    >
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
                      disabled={!isPending || saving || confirming || cancelling}
                      value={member.selection.modelId}
                      onChange={(e) => {
                        void handleSelectionChange(member.name, {
                          modelId: e.target.value,
                        });
                      }}
                      className="team-review-select"
                    >
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
                      disabled={!isPending || saving || confirming || cancelling}
                      value={member.selection.thinkingLevel}
                      onChange={(e) => {
                        void handleSelectionChange(member.name, {
                          thinkingLevel: e.target.value as SessionThinkingLevel,
                        });
                      }}
                      className="team-review-select"
                    >
                      {ALL_THINKING_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl}
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
