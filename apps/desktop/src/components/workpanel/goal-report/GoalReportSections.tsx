import { useTranslation } from "react-i18next";
import type { GoalReport, GoalReportFile, GoalReportStep } from "@pi-desktop/shared";
import { Badge } from "../../ui";
import { EvidenceRefs, ReportSection, VerdictIcon, verdictLabels } from "./report-primitives";

export function GoalReportTimeline({ steps }: { steps: GoalReportStep[] }) {
  const { t } = useTranslation();
  if (!steps.length) return null;
  return <ReportSection title={t("goalReport.view.steps")} testId="goal-report-steps">
    <ol className="goal-report-steps-list">
      {steps.map((step, index) => <li key={step.id || index} className={`goal-report-step-item status-${step.status}`}>
        <span className="goal-report-step-track" aria-hidden><span className="goal-report-step-dot" /></span>
        <div className="goal-report-step-content">
          <div className="goal-report-step-head">
            <span className="goal-report-step-stage">{t("goalReport.view.stage", { number: index + 1 })}</span>
            <span className="goal-report-step-status">{t(`goalReport.view.stepStatus.${step.status}`)}</span>
          </div>
          <h3 className="goal-report-step-title">{step.title}</h3>
          {step.detail && <p className="goal-report-step-detail">{step.detail}</p>}
          <EvidenceRefs refs={step.evidenceRefs} />
        </div>
      </li>)}
    </ol>
  </ReportSection>;
}

export function GoalReportFiles({ files }: { files: GoalReportFile[] }) {
  const { t } = useTranslation();
  if (!files.length) return null;
  const hasGroups = files.some((file) => file.group);
  return <ReportSection title={t("goalReport.view.files")} testId="goal-report-files">
    <div className="goal-report-table-wrap" tabIndex={0} role="region" aria-label={t("goalReport.view.files")}>
      <table className="goal-report-table goal-report-files-table">
        <thead><tr>
          {hasGroups && <th scope="col">{t("goalReport.view.filesGroup")}</th>}
          <th scope="col">{t("goalReport.view.filesPath")}</th>
          <th scope="col">{t("goalReport.view.filesChange")}</th>
          <th scope="col">{t("goalReport.view.filesAttribution")}</th>
          <th scope="col">{t("goalReport.view.filesDetail")}</th>
        </tr></thead>
        <tbody>{files.map((file, index) => <tr key={index} className="goal-report-file-row">
          {hasGroups && <td>{file.group}</td>}
          <td><code className="goal-report-file-path">{file.path}</code></td>
          <td><Badge className={`goal-report-file-type type-${file.changeType}`}>
            {t(`goalReport.view.fileChange.${file.changeType}`)}
          </Badge></td>
          <td>{t(`goalReport.view.fileAttribution.${file.attribution}`)}</td>
          <td>{file.detail}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </ReportSection>;
}

export function GoalReportConclusion({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  return <ReportSection title={t("goalReport.view.conclusion")} testId="goal-report-conclusion">
    <div className={`goal-report-conclusion-card verdict-${report.verdict}`}>
      <span className="goal-report-conclusion-icon"><VerdictIcon verdict={report.verdict} /></span>
      <div className="goal-report-conclusion-body">
        <strong>{t(verdictLabels[report.verdict])}</strong>
        <p>{report.conclusion || (report.execution.status === "completed"
          ? t("chat.resultSteps", { count: report.steps?.length ?? 0 }) : t("chat.resultFailedBody"))}</p>
      </div>
    </div>
    {((report.limitations?.length ?? 0) > 0 || (report.nextSteps?.length ?? 0) > 0) &&
      <div className="goal-report-boundaries" data-testid="goal-report-limitations">
        {report.limitations?.length > 0 && <div className="goal-report-risk-callout">
          <h3>{t("goalReport.view.limitations")}</h3>
          <ul className="goal-report-bullet-list">{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>}
        {report.nextSteps?.length > 0 && <div className="goal-report-risk-callout next-steps">
          <h3>{t("goalReport.view.nextSteps")}</h3>
          <ul className="goal-report-bullet-list">{report.nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>}
      </div>}
  </ReportSection>;
}
