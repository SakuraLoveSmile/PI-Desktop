import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { Markdown } from "../../Markdown";
import { GoalReportGallery, type GoalReportGalleryProps } from "./GoalReportGallery";
import { GoalReportHeader, GoalReportMetadata } from "./GoalReportHeader";
import { GoalReportConclusion, GoalReportFiles, GoalReportTimeline } from "./GoalReportSections";
import { GoalReportVerification } from "./GoalReportVerification";
import { ReportSection } from "./report-primitives";

type Props = Omit<GoalReportGalleryProps, "screenshots"> & { report: GoalReport };

/** Stateless document presentation; the tab owns reads, assets and preview lifetime. */
export function GoalReportDocument({ report, ...galleryProps }: Props) {
  const { t } = useTranslation();
  return <article className="goal-report-body-cap">
    <GoalReportHeader report={report} />
    <ReportSection title={t("goalReport.view.summary")} testId="goal-report-summary">
      <div className="goal-report-prose"><Markdown source={report.summary || ""} /></div>
    </ReportSection>
    <GoalReportTimeline steps={report.steps ?? []} />
    <GoalReportFiles files={report.files ?? []} />
    <GoalReportVerification report={report} />
    <GoalReportGallery screenshots={report.screenshots ?? []} {...galleryProps} />
    <GoalReportConclusion report={report} />
    <GoalReportMetadata report={report} />
  </article>;
}
