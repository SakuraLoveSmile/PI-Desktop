import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronDown } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { ActivitySectionGrip } from "./ActivitySectionGrip";
import { activityAttention, activityGroupSummary } from "./activity-rail-presentation";
import { useActivityDisclosure } from "./use-activity-disclosure";

export type ActivityReveal = { group: string; itemId?: string; sequence: number; focus?: boolean };

export function ActivityRailGroup({ sessionId, group, label, items = [], initialOpen = true, children, action,
  showSummary = true, trackAttention = true, keepMounted = false, preserveAttention = false, reveal, revealAlso = [],
  collapsedSummary, sectionHeading = false }: {
  sessionId: string; group: string; label: string; items?: readonly { id: string; status?: string; attentionStatus?: string }[];
  initialOpen?: boolean; children: ReactNode; action?: ReactNode; showSummary?: boolean; trackAttention?: boolean;
  keepMounted?: boolean; preserveAttention?: boolean; reveal?: ActivityReveal;
  /** Groups nested inside this one: revealing any of them opens this one too. */
  revealAlso?: readonly string[];
  /** What a collapsed section heading says after its chevron; defaults to the running / failed / timed-out counts. */
  collapsedSummary?: ReactNode;
  /** The group is a whole section: its heading carries the section's drag handle and is the larger heading. */
  sectionHeading?: boolean;
}) {
  const { t } = useTranslation();
  const { open, toggle, expand } = useActivityDisclosure(sessionId, group, initialOpen, activityAttention(items), trackAttention, preserveAttention);
  const handledReveal = useRef<ActivityReveal | undefined>(undefined);
  useEffect(() => {
    if (!reveal || handledReveal.current === reveal) return;
    handledReveal.current = reveal;
    if (reveal.group === group || revealAlso.includes(reveal.group)
      || (group === "ended-processes" && reveal.group === "processes" && items.some((item) => item.id === reveal.itemId))) expand();
  }, [reveal, group, revealAlso, expand, items]);
  const summary = activityGroupSummary(items);
  const summaryText = collapsedSummary ?? [summary.running && t("panel.activity.groupRunning", { count: summary.running }),
    summary.failed && t("panel.activity.groupFailed", { count: summary.failed }),
    summary.timedOut && t("panel.activity.groupTimedOut", { count: summary.timedOut })].filter(Boolean).join(" · ");
  const id = useId();
  return <section className="session-activity-group" data-activity-group={group} data-variant={sectionHeading ? "section" : "sub"} tabIndex={-1}>
    <div className="session-activity-heading">
      <Button variant="ghost" className="session-activity-disclosure" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span className="session-activity-group-title">{label}</span>
        {sectionHeading ? <>
          <IconChevronDown size={14} aria-hidden />
          {!open && showSummary && summaryText && <span className="session-activity-heading-summary">{summaryText}</span>}
        </> : <>
          {showSummary && <span className="session-activity-group-count">{summary.total}</span>}
          <IconChevronDown size={13} aria-hidden />
        </>}
      </Button>{action}{sectionHeading && <ActivitySectionGrip />}
    </div>
    <div id={id} hidden={!open} className="session-activity-group-body">{(open || keepMounted) && children}</div>
  </section>;
}
