import type { ReactNode } from "react";
import type { GoalReportVerdict } from "@pi-desktop/shared";
import { Badge } from "../../ui";
import { IconCircleAlert, IconCircleCheck, IconInfo, IconTriangleAlert } from "../../icons";

/**
 * A native disclosure: keyboard and assistive-technology behavior come from the
 * platform, and the folded content stays in the DOM for find-in-page.
 */
export function ReportFold({ title, meta, testId, main, children }: {
  title: string;
  meta?: string;
  testId?: string;
  main?: boolean;
  children: ReactNode;
}) {
  return <details className={`goal-report-fold${main ? " is-main" : ""}`} data-testid={testId}>
    <summary className="goal-report-fold-summary">
      <span className="goal-report-fold-title">{title}</span>
      {meta && <span className="goal-report-fold-meta">{meta}</span>}
    </summary>
    <div className="goal-report-fold-body">{children}</div>
  </details>;
}

export function EvidenceRefs({ refs }: { refs?: string[] }) {
  if (!refs?.length) return null;
  return <div className="goal-report-evidence-refs">{refs.map((ref) =>
    <Badge key={ref} className="goal-report-ref-chip">#{ref}</Badge>)}</div>;
}

export function VerdictIcon({ verdict, size = 16 }: { verdict: GoalReportVerdict; size?: number }) {
  if (verdict === "met") return <IconCircleCheck size={size} />;
  if (verdict === "partial") return <IconTriangleAlert size={size} />;
  if (verdict === "blocked") return <IconCircleAlert size={size} />;
  return <IconInfo size={size} />;
}

export const verdictLabels = {
  met: "goalReport.view.verdictMet", partial: "goalReport.view.verdictPartial",
  blocked: "goalReport.view.verdictBlocked", unknown: "goalReport.view.verdictUnknown",
} as const;
