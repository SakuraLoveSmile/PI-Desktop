import { useTranslation } from "react-i18next";
import type { GoalReportSummary } from "@pi-desktop/shared";
import {
  IconCheckCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconPanelOpen,
  IconTriangleAlert,
} from "./icons";

export type GoalReportCardProps = {
  report: GoalReportSummary;
  onOpenReport: () => void;
};

export function GoalReportCard({ report, onOpenReport }: GoalReportCardProps) {
  const { t } = useTranslation();

  const executionStatus = report.executionStatus;
  const isFallback = report.integrity === "fallback";

  return (
    <section
      className={`goal-report-card verdict-${report.verdict} status-${executionStatus ?? report.status}`}
      data-testid="goal-report-card"
      data-execution-id={report.executionId}
      role="region"
      aria-label={t("goalReport.view.title")}
    >
      <div className="goal-report-card-head">
        <span className="goal-report-card-icon" aria-hidden>
          {report.verdict === "met" && <IconCircleCheck size={18} />}
          {report.verdict === "partial" && <IconTriangleAlert size={18} />}
          {report.verdict === "blocked" && <IconCircleAlert size={18} />}
          {report.verdict === "unknown" && <IconCheckCheck size={18} />}
        </span>

        <div className="goal-report-card-titles">
          <div className="goal-report-card-title-row">
            <strong className="goal-report-card-title">
              {report.goalTitle || t("goalReport.view.title")}
            </strong>
            <span className={`goal-report-card-verdict-badge verdict-${report.verdict}`}>
              {report.verdict === "met" && t("goalReport.view.verdictMet")}
              {report.verdict === "partial" && t("goalReport.view.verdictPartial")}
              {report.verdict === "blocked" && t("goalReport.view.verdictBlocked")}
              {report.verdict === "unknown" && t("goalReport.view.verdictUnknown")}
            </span>
          </div>

          <div className="goal-report-card-meta">
            {executionStatus ? (
              <span className={`goal-report-card-status-badge status-${executionStatus}`}>
                {executionStatus === "completed"
                  ? t("goalReport.view.statusCompleted")
                  : t("goalReport.view.statusInterrupted")}
              </span>
            ) : null}
            {isFallback && (
              <span className="goal-report-card-fallback-badge">
                {t("goalReport.view.fallback")}
              </span>
            )}
            {report.completedAt ? (
              <span className="goal-report-card-time">
                {new Date(report.completedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {report.summary ? (
        <p className="goal-report-card-summary">{report.summary}</p>
      ) : null}

      <div className="goal-report-card-actions">
        <button
          type="button"
          className="goal-report-card-open-btn"
          onClick={onOpenReport}
          data-testid="goal-report-card-open-btn"
        >
          <IconPanelOpen size={14} />
          <span>{t("goalReport.view.openInWorkPanel")}</span>
        </button>
      </div>
    </section>
  );
}
