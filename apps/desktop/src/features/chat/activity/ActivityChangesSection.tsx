import { useTranslation } from "react-i18next";
import { IconChevronRight } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { ActivitySectionGrip } from "./ActivitySectionGrip";
import type { ActivityChanges } from "./activity-rail-types";
import "./session-activity-workspace.css";

/** The recorded changes as one heading: a summary that cannot fold, and a link to the Review tab that lists them. */
export function ActivityChangesSection({ changes, onReview }: { changes: ActivityChanges; onReview?: () => void }) {
  const { t } = useTranslation();
  const detail = `${t("panel.review.changes", { count: changes.count })} · +${changes.additions} −${changes.deletions}`;
  return <section className="session-activity-group" data-activity-group="changes" data-variant="section">
    <div className="session-activity-heading">
      <span className="session-activity-static-title">
        <span className="session-activity-group-title">{t("panel.activity.changes")}</span>
        <span className="session-activity-heading-summary session-activity-changes-summary" title={detail}>
          <span className="session-activity-lines-added">+{changes.additions}</span>{" "}
          <span className="session-activity-lines-removed">−{changes.deletions}</span>
        </span>
      </span>
      {onReview && <TooltipButton type="button" className="btn btn-ghost session-activity-heading-link" tooltip={detail}
        ariaLabel={`${t("panel.activity.reviewLink")} · ${detail}`} onClick={onReview}>
        {t("panel.activity.reviewLink")}<IconChevronRight size={14} aria-hidden />
      </TooltipButton>}
      <ActivitySectionGrip />
    </div>
  </section>;
}
