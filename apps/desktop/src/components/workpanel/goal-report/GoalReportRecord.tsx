import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { formatDuration } from "../../../features/scheduled/scheduled-format";
import { goalReportTiming } from "../../../lib/goal-report-digest";
import { Badge } from "../../ui";
import { VerdictIcon, verdictLabels } from "./report-primitives";

/** When work started, was blocked and resumed, and how much of the span was waiting. */
export function GoalReportExecutionRecord({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  const timing = goalReportTiming(report);
  const events = [
    ...(report.segments ?? []).map((segment, index) => ({ at: segment.startedAt, label: t(index ? "goal.blocked.timelineResumed" : "goal.blocked.timelineStarted"), key: `segment:${segment.turnId}` })),
    ...(report.blocks ?? []).map((block, index) => ({ at: block.at, label: t("goal.blocked.timelineBlocked"), key: `block:${index}` })),
  ].sort((left, right) => left.at - right.at);
  if (events.length === 0) return null;
  return <section className="goal-report-sub-block" aria-label={t("goal.blocked.timeline")} data-testid="goal-report-execution-timeline">
    <h3 className="goal-report-subtitle-heading">{t("goal.blocked.timeline")}</h3>
    {timing && timing.waitMs > 0 && <p className="goal-report-timing-line">
      {t("goalReport.view.fold.timing", { span: formatDuration(timing.spanMs), active: formatDuration(timing.activeMs), wait: formatDuration(timing.waitMs) })}
    </p>}
    <ol className="goal-report-steps-list">{events.map((event) => <li className="goal-report-step-item" key={event.key}>
      <span className="goal-report-step-track" aria-hidden><span className="goal-report-step-dot" /></span>
      <div className="goal-report-step-content"><strong>{event.label}</strong>{" · "}
        <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time></div>
    </li>)}</ol>
  </section>;
}

/** Report state, integrity and the contract the run was held to. */
export function GoalReportMetadata({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  return <div className="goal-report-metadata">
    <div className="goal-report-badges">
      <Badge className={`goal-report-badge verdict-${report.verdict}`}>
        <VerdictIcon verdict={report.verdict} />{t(verdictLabels[report.verdict])}
      </Badge>
      <Badge className={`goal-report-badge status-${report.execution.status}`}>
        {t(report.execution.status === "completed" ? "goalReport.view.statusCompleted" : "goalReport.view.statusInterrupted")}
      </Badge>
      <Badge className={`goal-report-badge integrity-${report.integrity.kind}`}>
        {t(report.closure === "user_accepted" ? "goal.blocked.userAccepted" : report.integrity.kind === "fallback" ? "goalReport.view.fallback" : "goalReport.view.structured")}
      </Badge>
    </div>
    {report.goal.contractPath && <div className="goal-report-contract-link">
      <span>{t("goalReport.view.contract")}</span><code>{report.goal.contractPath}</code>
    </div>}
  </div>;
}
