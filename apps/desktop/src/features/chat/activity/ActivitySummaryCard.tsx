import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconRefresh, IconSparkles } from "../../../components/icons";
import { Button, TooltipButton } from "../../../components/ui";
import type { ActivitySummary } from "./activity-rail-types";
import { summaryTimestamp } from "./activity-summary-view";
import "./session-activity-summary.css";

/**
 * The pinned session summary: when it was written, a control to write it again, and the paragraph clamped to four lines.
 * The text is model output and is only ever a text node. The control that opens the rest appears only when something is
 * cut off, so a short note shows no dead button.
 */
export function ActivitySummaryCard({ summary }: { summary: ActivitySummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const bodyId = useId();
  // Overflow is measured only while the paragraph is clamped: open, it fits by definition and the last answer stands.
  useLayoutEffect(() => {
    const node = body.current;
    if (!node || open) return;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [summary.text, open]);
  const refresh = t("panel.activity.summary.refresh");
  return <section className="session-activity-summary" aria-label={t("panel.activity.summary.title")} aria-busy={summary.refreshing}>
    <div className="session-activity-summary-head">
      <IconSparkles size={16} aria-hidden />
      <time className="session-activity-summary-time" dateTime={summary.updatedAt}>
        {t("panel.activity.summary.updated", { time: summaryTimestamp(summary.updatedAt) })}
      </time>
      <TooltipButton type="button" className="session-activity-summary-refresh" tooltip={refresh} aria-disabled={summary.refreshing}
        data-refreshing={summary.refreshing} onClick={summary.refreshing ? undefined : summary.onRefresh}>
        {summary.refreshing ? <span className="session-activity-spinner" aria-hidden /> : <IconRefresh size={14} aria-hidden />}
      </TooltipButton>
    </div>
    <p ref={body} id={bodyId} className="session-activity-summary-body" data-open={open}>{summary.text}</p>
    {(overflowing || open) && <Button variant="ghost" className="session-activity-summary-more" aria-expanded={open} aria-controls={bodyId}
      onClick={() => setOpen((value) => !value)}>
      {open ? t("panel.activity.summary.collapse") : t("panel.activity.summary.expand")}
    </Button>}
  </section>;
}
