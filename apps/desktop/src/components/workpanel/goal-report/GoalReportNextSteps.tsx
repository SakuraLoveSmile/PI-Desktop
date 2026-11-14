import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { FIRST_SCREEN_NEXT_STEPS } from "../../../lib/goal-report-digest";

type ListProps = {
  steps: string[];
  /** Known limitations only point at the full report; they are not listed here. */
  limitations: number;
  showAll: boolean;
  openRows: ReadonlySet<number>;
  onToggleAll: () => void;
  onToggleRow: (index: number) => void;
};

/** Presentation only, so both states render without a DOM. */
export function GoalReportNextStepsList({ steps, limitations, showAll, openRows, onToggleAll, onToggleRow }: ListProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const hidden = Math.max(0, steps.length - FIRST_SCREEN_NEXT_STEPS);
  const visible = showAll ? steps : steps.slice(0, FIRST_SCREEN_NEXT_STEPS);
  return <section className="goal-report-block goal-report-next" data-testid="goal-report-next-steps" aria-labelledby={headingId}>
    <div className="goal-report-block-head">
      <h2 id={headingId} className="goal-report-block-title">{t("goalReport.view.next.title")}</h2>
      <span className="goal-report-block-count">{t("goalReport.view.next.count", { count: steps.length })}</span>
    </div>
    <ol className="goal-report-next-list">
      {visible.map((step, index) => <li key={index}>
        <button type="button" className="goal-report-next-row" aria-expanded={openRows.has(index)} onClick={() => onToggleRow(index)}>
          <span className={openRows.has(index) ? undefined : "is-clamped"}>{step}</span>
        </button>
      </li>)}
    </ol>
    {hidden > 0 && <button type="button" className="goal-report-link-btn" aria-expanded={showAll} onClick={onToggleAll}>
      {showAll ? t("goalReport.view.next.fewer") : t("goalReport.view.next.more", { n: hidden })}
    </button>}
    {limitations > 0 && <p className="goal-report-next-note">{t("goalReport.view.next.limitationsHint", { count: limitations })}</p>}
  </section>;
}

/** Second block: what a person has to do. Omitted when the model suggested nothing. */
export function GoalReportNextSteps({ report }: { report: GoalReport }) {
  const [showAll, setShowAll] = useState(false);
  const [openRows, setOpenRows] = useState<ReadonlySet<number>>(() => new Set());
  const steps = report.nextSteps ?? [];
  if (steps.length === 0) return null;
  const toggleRow = (index: number) => setOpenRows((current) => {
    const next = new Set(current);
    if (!next.delete(index)) next.add(index);
    return next;
  });
  return <GoalReportNextStepsList steps={steps} limitations={report.limitations?.length ?? 0}
    showAll={showAll} openRows={openRows} onToggleAll={() => setShowAll((value) => !value)} onToggleRow={toggleRow} />;
}
