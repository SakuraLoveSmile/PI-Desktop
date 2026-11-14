import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { summarizeCriteria } from "../../../lib/goal-report-digest";
import { Markdown } from "../../Markdown";
import { GoalReportGallery, type GoalReportGalleryProps } from "./GoalReportGallery";
import { GoalReportExecutionRecord, GoalReportMetadata } from "./GoalReportRecord";
import { GoalReportBoundaries, GoalReportFiles, GoalReportMetrics, GoalReportTimeline } from "./GoalReportSections";
import { GoalReportChecks, GoalReportCriteria, GoalReportEvidences } from "./GoalReportVerification";
import { ReportFold } from "./report-primitives";

type Props = Omit<GoalReportGalleryProps, "screenshots"> & { report: GoalReport };

/** Everything the first screen leaves out, behind one fold with a fold per topic. */
export function GoalReportFullReport({ report, ...galleryProps }: Props) {
  const { t } = useTranslation();
  const files = report.files ?? [];
  const checks = report.checks ?? [];
  const metrics = report.metrics ?? [];
  const limitations = report.limitations ?? [];
  const nextSteps = report.nextSteps ?? [];
  const screenshots = report.screenshots ?? [];
  const criteria = summarizeCriteria(report);
  const hasSummary = Boolean(report.summary?.trim());
  const hasChanges = files.length > 0 || checks.length > 0;
  const hasBoundaries = limitations.length > 0 || nextSteps.length > 0;
  // The details fold always exists: it holds the report state and contract link.
  const sectionCount = [hasSummary, hasChanges, criteria.total > 0, metrics.length > 0, hasBoundaries, true, screenshots.length > 0]
    .filter(Boolean).length;
  return <div className="goal-report-folds">
    <ReportFold main title={t("goalReport.view.fold.full")} meta={t("goalReport.view.fold.sectionCount", { count: sectionCount })} testId="goal-report-full">
      <div className="goal-report-fold-stack">
        {hasSummary && <ReportFold title={t("goalReport.view.summary")} testId="goal-report-fold-summary">
          <div className="goal-report-prose"><Markdown source={report.summary} /></div>
        </ReportFold>}
        {hasChanges && <ReportFold title={t("goalReport.view.fold.changes")} testId="goal-report-fold-changes"
          meta={t("goalReport.view.fold.metaChanges", { checks: checks.length, files: files.length })}>
          <GoalReportFiles files={files} />
          <GoalReportChecks report={report} />
        </ReportFold>}
        {criteria.total > 0 && <ReportFold title={t("goalReport.view.criteria")} testId="goal-report-fold-criteria"
          meta={t("goalReport.view.fold.metaCriteria", { met: criteria.met, total: criteria.total })}>
          <GoalReportCriteria report={report} />
        </ReportFold>}
        {metrics.length > 0 && <ReportFold title={t("goalReport.view.metrics")} testId="goal-report-fold-metrics" meta={String(metrics.length)}>
          <GoalReportMetrics report={report} />
        </ReportFold>}
        {hasBoundaries && <ReportFold title={t("goalReport.view.fold.limitsAndNext")} testId="goal-report-fold-boundaries"
          meta={`${limitations.length} · ${nextSteps.length}`}>
          <GoalReportBoundaries report={report} />
        </ReportFold>}
        <ReportFold title={t("goalReport.view.fold.details")} testId="goal-report-fold-details"
          meta={t("goalReport.view.fold.metaDetails", { steps: report.steps?.length ?? 0, evidence: report.evidences?.length ?? 0 })}>
          <GoalReportExecutionRecord report={report} />
          <GoalReportTimeline steps={report.steps ?? []} />
          <GoalReportEvidences report={report} />
          <GoalReportMetadata report={report} />
        </ReportFold>
        {screenshots.length > 0 && <ReportFold title={t("goalReport.view.gallery")} testId="goal-report-fold-gallery" meta={String(screenshots.length)}>
          <GoalReportGallery screenshots={screenshots} {...galleryProps} />
        </ReportFold>}
      </div>
    </ReportFold>
  </div>;
}
