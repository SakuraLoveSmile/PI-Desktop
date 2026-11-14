import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import type { GoalReportGalleryProps } from "./GoalReportGallery";
import { GoalReportFullReport } from "./GoalReportFullReport";
import { GoalReportHeader } from "./GoalReportHeader";
import { GoalReportNextSteps } from "./GoalReportNextSteps";
import { GoalReportResult } from "./GoalReportResult";

type Props = Omit<GoalReportGalleryProps, "screenshots"> & { report: GoalReport };

/**
 * Stateless document presentation; the tab owns reads, assets and preview lifetime.
 * The first screen is the title, the result and the next steps; the rest is one fold.
 * The keyed blocks keep their own open/expanded state from leaking across reports.
 */
export function GoalReportDocument({ report, ...galleryProps }: Props) {
  const { t } = useTranslation();
  return <article className="goal-report-body-cap" aria-label={t("goalReport.view.deliveryTitle")}>
    <GoalReportHeader report={report} />
    <GoalReportResult report={report} />
    <GoalReportNextSteps key={`next:${report.reportId}`} report={report} />
    <GoalReportFullReport key={`full:${report.reportId}`} report={report} {...galleryProps} />
  </article>;
}
