import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { formatDuration } from "../../../features/scheduled/scheduled-format";
import { FIRST_SCREEN_METRICS, hostLine, metricTone, type HostLineItem } from "../../../lib/goal-report-digest";
import { VerdictIcon, verdictLabels } from "./report-primitives";

/** First block of the report: what the model delivered, in numbers, and what the Host can vouch for. */
export function GoalReportResult({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  const headingId = useId();
  const metrics = (report.metrics ?? []).slice(0, FIRST_SCREEN_METRICS);
  const items = hostLine(report);
  // A structured report's verdict is the model's own assessment; the notice
  // box already says so for fallback and user-accepted reports.
  const selfReported = report.integrity.kind === "structured" && report.closure !== "user_accepted";
  const itemText = (item: HostLineItem): string => {
    switch (item.kind) {
      case "active": return t("goalReport.view.result.line.active", { duration: formatDuration(item.ms) });
      case "blocks": return t(item.resumed ? "goalReport.view.result.line.blocks" : "goalReport.view.result.line.blocksStopped", { n: item.n });
      case "limitations": return t("goalReport.view.next.limitationsHint", { count: item.n });
      case "hostNotObserved": return t("goalReport.view.result.line.hostNotObserved");
      case "checks": return t("goalReport.view.result.line.checks", { passed: item.passed, total: item.total });
      case "hostVerified": return t("goalReport.view.result.line.hostVerified", { passed: item.passed, total: item.total });
      case "criteria": return t("goalReport.view.result.line.criteria", { met: item.met, total: item.total });
      case "notRun": return t("goalReport.view.result.line.notRun", { n: item.n });
      case "hostConflict": return t("goalReport.view.result.line.hostConflict", { n: item.n });
    }
  };
  return <section className="goal-report-block goal-report-result" data-testid="goal-report-result" aria-labelledby={headingId}>
    <div className="goal-report-block-head">
      <h2 id={headingId} className="goal-report-block-title">{t("goalReport.view.result.title")}</h2>
      <span className="goal-report-verdict-meta">
        <span className={`goal-report-pill verdict-${report.verdict}`}>
          <VerdictIcon verdict={report.verdict} size={14} />{t(verdictLabels[report.verdict])}
        </span>
        {report.execution.status === "interrupted" && <span className="goal-report-pill status-interrupted">
          {t("goalReport.view.statusInterrupted")}
        </span>}
        {selfReported && <span className="goal-report-self-note">{t("goalReport.view.result.selfReported")}</span>}
      </span>
    </div>
    {report.conclusion && <p className="goal-report-conclusion-line">{report.conclusion}</p>}
    {metrics.length > 0 && <dl className="goal-report-key-metrics" data-testid="goal-report-key-metrics">
      {metrics.map((metric, index) => <div key={index} className="goal-report-key-metric" data-tone={metricTone(metric, report)}>
        <dt>{metric.label}</dt>
        <dd title={metric.value}>{metric.value}</dd>
      </div>)}
    </dl>}
    {items.length > 0 && <ul className="goal-report-host-line" data-testid="goal-report-host-line">
      {items.map((item) => <li key={item.kind} data-kind={item.kind} data-tone={item.tone}>{itemText(item)}</li>)}
    </ul>}
  </section>;
}
