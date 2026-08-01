import { memo, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewRollbackStatus, UiMessage } from "@pi-desktop/shared";
import { reviewChangeFromMessage } from "../lib/workspace-review";
import { useAppStore } from "../stores/app-store";
import { cx } from "./ui";
import { IconCheck, IconChevronRight, IconDiff, IconSnapshot } from "./icons";

function DiffBody({ message, compact }: { message: UiMessage; compact: boolean }) {
  const { t } = useTranslation();
  const change = reviewChangeFromMessage(message);
  const rollback = useAppStore((state) => state.rollbackWorkspaceChange);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<ReviewRollbackStatus | null>(
    null,
  );

  if (!change) return null;

  const runRollback = async () => {
    if (!change.reversible || change.state === "rolledBack" || rollingBack) return;
    setRollingBack(true);
    setRollbackStatus(null);
    const result = await rollback(message.id, change.snapshotId);
    setRollingBack(false);
    if (result) setRollbackStatus(result.status);
  };

  return (
    <div className="review-change-card-body-content">
      {change.binary ? (
        <div className="review-change-note">{t("panel.review.binary")}</div>
      ) : change.truncated ? (
        <div className="review-change-note">{t("panel.review.tooLarge")}</div>
      ) : change.hunks.length > 0 ? (
        <div className="review-change-diff">
          {change.hunks.map((hunk, hunkIndex) => (
            <div className="diff-hunk" key={`${hunk.header}-${hunkIndex}`}>
              <div className="diff-line hunk">
                <span className="diff-line-text">{hunk.header}</span>
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <div className={cx("diff-line", line.type)} key={lineIndex}>
                  <span className="diff-line-sign" aria-hidden>
                    {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                  </span>
                  <span className="diff-line-text">{line.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="review-change-note">{t("panel.review.noLineDetails")}</div>
      )}

      <div className={cx("review-change-card-actions", compact && "is-compact")}>
        {rollbackStatus === "conflict" ? (
          <div className="review-change-rollback-note is-warning">
            {t("panel.review.rollbackConflict")}
          </div>
        ) : rollbackStatus === "unavailable" ? (
          <div className="review-change-rollback-note">
            {t("panel.review.rollbackUnavailable")}
          </div>
        ) : null}
        {change.state === "rolledBack" ? (
          <span className="review-change-state is-rolled-back">
            <IconCheck size={13} />
            {t("panel.review.rolledBack")}
          </span>
        ) : change.reversible ? (
          <button
            type="button"
            className="review-change-rollback"
            onClick={() => void runRollback()}
            disabled={rollingBack}
          >
            <IconSnapshot size={13} />
            {rollingBack
              ? t("panel.review.rollingBack")
              : t("panel.review.rollback")}
          </button>
        ) : (
          <span className="review-change-rollback-note">
            {t("panel.review.rollbackUnavailable")}
          </span>
        )}
      </div>
    </div>
  );
}

export const ReviewChangeCard = memo(function ReviewChangeCard({
  message,
  compact = false,
}: {
  message: UiMessage;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const change = reviewChangeFromMessage(message);
  const detailsId = useId();
  const [open, setOpen] = useState(compact);

  if (!change) return null;

  const statusLabel = t(`panel.review.status.${change.status}`);
  const accessibleLabel = t(
    open ? "chat.reviewChangeHide" : "chat.reviewChangeShow",
    {
      status: statusLabel,
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
    },
  );

  return (
    <section
      className={cx("review-change-card", compact && "is-compact", open && "open")}
      data-state={change.state}
      data-status={change.status}
    >
      <button
        type="button"
        className="review-change-card-header"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={cx("review-change-card-icon", `is-${change.status}`)} aria-hidden>
          <IconDiff size={15} />
        </span>
        <span className="review-change-card-main">
          <span className="review-change-card-path" title={change.path}>
            {change.path}
          </span>
          <span className="review-change-card-meta">
            <span className={cx("review-change-card-status", `is-${change.status}`)}>
              {statusLabel}
            </span>
            <span
              className="review-change-card-counts diff-file-counts"
              aria-label={t("chat.reviewChangeCounts", change)}
            >
              {change.additions > 0 && (
                <span className="diff-count-add">+{change.additions}</span>
              )}
              {change.deletions > 0 && (
                <span className="diff-count-del">−{change.deletions}</span>
              )}
            </span>
            {change.state === "rolledBack" ? (
              <span className="review-change-card-state">
                {t("panel.review.rolledBack")}
              </span>
            ) : null}
          </span>
        </span>
        <span className="review-change-card-caret" aria-hidden>
          <IconChevronRight size={12} />
        </span>
      </button>
      {open ? (
        <div className="review-change-card-body" id={detailsId}>
          <DiffBody message={message} compact={compact} />
        </div>
      ) : null}
    </section>
  );
});
