import { useTranslation } from "react-i18next";
import type { GoalReport, GoalReportMetric } from "@pi-desktop/shared";
import { Badge } from "../../ui";
import { IconInfo } from "../../icons";
import { EvidenceRefs, VerdictIcon, verdictLabels } from "./report-primitives";

function metricTone(metric: GoalReportMetric, report: GoalReport): "neutral" | "success" | "error" {
  const refs = new Set(metric.evidenceRefs ?? []);
  const observations = (report.checkObservations ?? []).filter((observation) =>
    observation.evidenceIds.some((id) => refs.has(id)));
  if (observations.some((observation) => observation.result === "failed")) return "error";
  const recordedRefs = new Set((report.evidenceResolution ?? [])
    .filter((resolution) => resolution.state === "recorded")
    .map((resolution) => resolution.evidenceId));
  if ([...refs].some((ref) => !recordedRefs.has(ref))) return "neutral";
  return observations.length > 0 && observations.every((observation) => observation.result === "passed")
    ? "success" : "neutral";
}

export function GoalReportHeader({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  const context = report.deliveryContext;
  const subtitle = [report.goal.title, context?.sourceLabel, context?.targetVersion, context?.revisionLabel]
    .filter(Boolean).join(" · ");
  return <header className="goal-report-header-section" data-testid="goal-report-header">
    <h1 className="goal-report-title">{t("goalReport.view.deliveryTitle")}</h1>
    {subtitle && <p className="goal-report-subtitle">{subtitle}</p>}
    <EvidenceRefs refs={context?.evidenceRefs} />
    {(report.metrics?.length ?? 0) > 0 && <div className="goal-report-metrics-grid" data-testid="goal-report-metrics">
      {report.metrics.map((metric, index) => <div key={index} className="goal-report-metric" data-tone={metricTone(metric, report)}>
        <span className="goal-report-metric-label">{metric.label}</span>
        <span className="goal-report-metric-value">{metric.value}</span>
        {metric.source && <span className="goal-report-metric-source">{metric.source}</span>}
      </div>)}
    </div>}
    {report.integrity.kind === "fallback" && <div className="goal-report-notice-box fallback" data-testid="goal-report-fallback-notice">
      <IconInfo size={16} />
      <div><strong>{t("goalReport.view.fallbackNotice")}</strong>
        {report.integrity.truncationNotice && <p>{report.integrity.truncationNotice}</p>}
      </div>
    </div>}
  </header>;
}

export function GoalReportMetadata({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  const durationSec = report.execution.completedAt && report.execution.startedAt
    ? Math.max(0, Math.round((report.execution.completedAt - report.execution.startedAt) / 1000)) : null;
  return <footer className="goal-report-metadata">
    <div className="goal-report-badges">
      <Badge className={`goal-report-badge verdict-${report.verdict}`}>
        <VerdictIcon verdict={report.verdict} />{t(verdictLabels[report.verdict])}
      </Badge>
      <Badge className={`goal-report-badge status-${report.execution.status}`}>
        {t(report.execution.status === "completed" ? "goalReport.view.statusCompleted" : "goalReport.view.statusInterrupted")}
      </Badge>
      <Badge className={`goal-report-badge integrity-${report.integrity.kind}`}>
        {t(report.integrity.kind === "fallback" ? "goalReport.view.fallback" : "goalReport.view.structured")}
      </Badge>
      {durationSec !== null && report.execution.timingSource === "turn" && <Badge className="goal-report-badge time">
        {durationSec >= 60 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : `${durationSec}s`}
      </Badge>}
    </div>
    {report.goal.contractPath && <div className="goal-report-contract-link">
      <span>{t("goalReport.view.contract")}</span><code>{report.goal.contractPath}</code>
    </div>}
  </footer>;
}
