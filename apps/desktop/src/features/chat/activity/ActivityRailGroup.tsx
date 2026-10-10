import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronDown } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { activityAttention, activityGroupSummary } from "./activity-rail-presentation";
import { useActivityDisclosure } from "./use-activity-disclosure";

export type ActivityReveal = { group: string; itemId?: string; sequence: number; focus?: boolean };

export function ActivityRailGroup({ sessionId, group, label, items = [], initialOpen = true, children, action,
  showSummary = true, trackAttention = true, keepMounted = false, preserveAttention = false, reveal }: {
  sessionId: string; group: string; label: string; items?: readonly { id: string; status?: string; attentionStatus?: string }[];
  initialOpen?: boolean; children: ReactNode; action?: ReactNode; showSummary?: boolean; trackAttention?: boolean;
  keepMounted?: boolean; preserveAttention?: boolean; reveal?: ActivityReveal;
}) {
  const { t } = useTranslation();
  const { open, toggle, expand } = useActivityDisclosure(sessionId, group, initialOpen, activityAttention(items), trackAttention, preserveAttention);
  const handledReveal = useRef<ActivityReveal | undefined>(undefined);
  useEffect(() => {
    if (!reveal || handledReveal.current === reveal) return;
    handledReveal.current = reveal;
    if (reveal?.group === group || (group === "ended-processes" && reveal?.group === "processes" && items.some((item) => item.id === reveal.itemId))) expand();
  }, [reveal, group, expand, items]);
  const summary = activityGroupSummary(items);
  const summaryText = [summary.running && t("panel.activity.groupRunning", { count: summary.running }),
    summary.failed && t("panel.activity.groupFailed", { count: summary.failed }),
    summary.timedOut && t("panel.activity.groupTimedOut", { count: summary.timedOut })].filter(Boolean).join(" · ");
  const id = useId();
  return <section className="session-activity-group" data-activity-group={group} tabIndex={-1}>
    <div className="session-activity-heading">
      <Button variant="ghost" className="session-activity-disclosure" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span className="session-activity-group-title">{label}</span>
        {showSummary && <span className="session-activity-group-count">{summary.total}</span>}
        <IconChevronDown size={13} aria-hidden />
      </Button>{action}
    </div>
    {showSummary && summaryText && <p className="session-activity-group-summary">{summaryText}</p>}
    <div id={id} hidden={!open} className="session-activity-group-body">{(open || keepMounted) && children}</div>
  </section>;
}
