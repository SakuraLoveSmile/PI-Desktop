import { useTranslation } from "react-i18next";
import type { GoalReport, GoalReportFile, GoalReportStep } from "@pi-desktop/shared";
import { metricTone } from "../../../lib/goal-report-digest";
import { Badge } from "../../ui";
import { EvidenceRefs } from "./report-primitives";

export function GoalReportTimeline({ steps }: { steps: GoalReportStep[] }) {
  const { t } = useTranslation();
  if (!steps.length) return null;
  return <div className="goal-report-sub-block" data-testid="goal-report-steps">
    <h3 className="goal-report-subtitle-heading">{t("goalReport.view.steps")}</h3>
    <ol className="goal-report-steps-list">
      {steps.map((step, index) => <li key={step.id || index} className={`goal-report-step-item status-${step.status}`}>
        <span className="goal-report-step-track" aria-hidden><span className="goal-report-step-dot" /></span>
        <div className="goal-report-step-content">
          <div className="goal-report-step-head">
            <span className="goal-report-step-stage">{t("goalReport.view.stage", { number: index + 1 })}</span>
            <span className="goal-report-step-status">{t(`goalReport.view.stepStatus.${step.status}`)}</span>
          </div>
          <h4 className="goal-report-step-title">{step.title}</h4>
          {step.detail && <p className="goal-report-step-detail">{step.detail}</p>}
          <EvidenceRefs refs={step.evidenceRefs} />
        </div>
      </li>)}
    </ol>
  </div>;
}

export function GoalReportFiles({ files }: { files: GoalReportFile[] }) {
  const { t } = useTranslation();
  if (!files.length) return null;
  const hasGroups = files.some((file) => file.group);
  return <div className="goal-report-sub-block" data-testid="goal-report-files">
    <h3 className="goal-report-subtitle-heading">{t("goalReport.view.files")}</h3>
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
  </div>;
}

/** Every metric the model reported, including the ones the first screen already shows. */
export function GoalReportMetrics({ report }: { report: GoalReport }) {
  return <div className="goal-report-metrics-list">
    {(report.metrics ?? []).map((metric, index) => <div key={index} className="goal-report-metric" data-tone={metricTone(metric, report)}>
      <span className="goal-report-metric-label">{metric.label}</span>
      <span className="goal-report-metric-value">{metric.value}</span>
      {metric.source && <span className="goal-report-metric-source">{metric.source}</span>}
    </div>)}
  </div>;
}

/** The complete limitation and next-step lists; the first screen only previews the latter. */
export function GoalReportBoundaries({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  const limitations = report.limitations ?? [];
  const nextSteps = report.nextSteps ?? [];
  if (!limitations.length && !nextSteps.length) return null;
  return <div className="goal-report-boundaries" data-testid="goal-report-limitations">
    {limitations.length > 0 && <div className="goal-report-sub-block">
      <h3 className="goal-report-subtitle-heading">{t("goalReport.view.limitations")}</h3>
      <ol className="goal-report-bullet-list">{limitations.map((item, index) => <li key={index}>{item}</li>)}</ol>
    </div>}
    {nextSteps.length > 0 && <div className="goal-report-sub-block">
      <h3 className="goal-report-subtitle-heading">{t("goalReport.view.nextSteps")}</h3>
      <ol className="goal-report-bullet-list">{nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ol>
    </div>}
  </div>;
}
