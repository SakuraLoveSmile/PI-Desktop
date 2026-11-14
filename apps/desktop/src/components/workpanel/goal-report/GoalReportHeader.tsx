import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { IconInfo } from "../../icons";
import { EvidenceRefs } from "./report-primitives";

/** Title, delivery context and the notice that a report was not agent-verified. */
export function GoalReportHeader({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  const context = report.deliveryContext;
  const subtitle = [context?.sourceLabel, context?.targetVersion, context?.revisionLabel].filter(Boolean).join(" · ");
  const userAccepted = report.closure === "user_accepted";
  return <header className="goal-report-header-section" data-testid="goal-report-header">
    <h1 className="goal-report-title">{report.goal.title || t("goalReport.view.deliveryTitle")}</h1>
    {subtitle && <p className="goal-report-subtitle">{subtitle}</p>}
    <EvidenceRefs refs={context?.evidenceRefs} />
    {(report.integrity.kind === "fallback" || userAccepted) && <div className="goal-report-notice-box fallback" data-testid={userAccepted ? "goal-report-user-accepted-notice" : "goal-report-fallback-notice"}>
      <IconInfo size={16} />
      <div><strong>{t(userAccepted ? "goal.blocked.userAccepted" : "goalReport.view.fallbackNotice")}</strong>
        {report.integrity.truncationNotice && <p>{report.integrity.truncationNotice}</p>}
      </div>
    </div>}
  </header>;
}
