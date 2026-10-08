import { useTranslation } from "react-i18next";
import type { GoalReportScreenshot } from "@pi-desktop/shared";
import { IconEye, IconImage, IconRefresh } from "../../icons";
import { Button } from "../../ui";
import { EvidenceRefs, ReportSection } from "./report-primitives";

export type ReportImage = { url: string; title: string };
export type GoalReportGalleryProps = {
  screenshots: GoalReportScreenshot[];
  assetUrls: Record<string, string>;
  assetLoading: Record<string, boolean>;
  assetErrors: Record<string, string>;
  onPreview: (image: ReportImage) => void;
};

export function GoalReportGallery({ screenshots, assetUrls, assetLoading, assetErrors, onPreview }: GoalReportGalleryProps) {
  const { t } = useTranslation();
  if (!screenshots.length) return null;
  return <ReportSection title={t("goalReport.view.gallery")} testId="goal-report-gallery">
    <div className="goal-report-gallery-grid">{screenshots.map((screenshot, index) => {
      const url = assetUrls[screenshot.id];
      const loading = assetLoading[screenshot.id];
      const error = assetErrors[screenshot.id];
      const title = screenshot.caption || screenshot.id;
      return <figure key={screenshot.id || index} className="goal-report-gallery-card">
        <div className="goal-report-gallery-preview">
          {url ? <>
            <Button variant="ghost" className="goal-report-gallery-image-button" onClick={() => onPreview({ url, title })}
              aria-label={t("goalReport.view.viewImage")}>
              <img src={url} alt={title} className="goal-report-gallery-img" />
            </Button>
            <Button variant="ghost" size="sm" className="goal-report-gallery-zoom-btn" onClick={() => onPreview({ url, title })}
              aria-label={t("goalReport.view.viewImage")}><IconEye size={14} /></Button>
          </> : loading ? <div className="goal-report-gallery-loading" role="status">
            <IconRefresh size={18} className="is-spinning" /><span>{t("goalReport.view.loadingAsset")}</span>
          </div> : <div className="goal-report-gallery-unavailable">
            <IconImage size={20} /><span>{t(error ? "goalReport.view.assetUnavailable" : "goalReport.view.assetNotCaptured")}</span>
          </div>}
        </div>
        <figcaption className="goal-report-gallery-info">
          <div className="goal-report-gallery-head"><span className="goal-report-gallery-id">#{screenshot.id}</span>
            <EvidenceRefs refs={screenshot.evidenceRef ? [screenshot.evidenceRef] : []} />
          </div>
          {screenshot.caption && <p className="goal-report-gallery-caption">{screenshot.caption}</p>}
        </figcaption>
      </figure>;
    })}</div>
  </ReportSection>;
}
