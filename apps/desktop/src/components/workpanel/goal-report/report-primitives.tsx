import type { ReactNode } from "react";
import type { GoalReportVerdict } from "@pi-desktop/shared";
import { Badge } from "../../ui";
import { IconCircleAlert, IconCircleCheck, IconInfo, IconTriangleAlert } from "../../icons";

export function ReportSection({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return <section className="goal-report-section" data-testid={testId}>
    <h2 className="goal-report-section-title">{title}</h2>
    <div className="goal-report-section-content">{children}</div>
  </section>;
}

export function EvidenceRefs({ refs }: { refs?: string[] }) {
  if (!refs?.length) return null;
  return <div className="goal-report-evidence-refs">{refs.map((ref) =>
    <Badge key={ref} className="goal-report-ref-chip">#{ref}</Badge>)}</div>;
}

export function VerdictIcon({ verdict }: { verdict: GoalReportVerdict }) {
  if (verdict === "met") return <IconCircleCheck size={16} />;
  if (verdict === "partial") return <IconTriangleAlert size={16} />;
  if (verdict === "blocked") return <IconCircleAlert size={16} />;
  return <IconInfo size={16} />;
}

export const verdictLabels = {
  met: "goalReport.view.verdictMet", partial: "goalReport.view.verdictPartial",
  blocked: "goalReport.view.verdictBlocked", unknown: "goalReport.view.verdictUnknown",
} as const;
