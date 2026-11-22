import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconCopy, IconExternal, IconFileText, IconGlobe, IconListChecks, IconSearch, IconInfo } from "../../../components/icons";
import { Button, Tooltip, TooltipButton } from "../../../components/ui";
import { ActivityRowStatus } from "./ActivityRowStatus";
import { SubagentActivityRow } from "./SubagentActivityRow";
import { activityVisibleItems, activityOutputGroups } from "./activity-rail-presentation";
import type { ActivityRailItem } from "./activity-rail-types";
import type { ActivityReveal } from "./ActivityRailGroup";

const expandedLists = new Map<string, boolean>();
const handledReveals = new Map<string, ActivityReveal>();

export function ActivityLimitedList<T extends { id: string }>({ sessionId, group, items, reveal, renderItem, renderItems, keepMounted = false }: {
  sessionId: string; group: string; items: readonly T[]; reveal?: ActivityReveal;
  renderItem?: (item: T) => ReactNode; renderItems?: (items: readonly T[]) => ReactNode; keepMounted?: boolean;
}) {
  const { t } = useTranslation();
  const key = `${sessionId}:${group}`;
  const [expanded, setExpanded] = useState(() => expandedLists.get(key) ?? false);
  useEffect(() => { expandedLists.set(key, expanded); }, [key, expanded]);
  useEffect(() => {
    if (!reveal || handledReveals.get(key) === reveal) return;
    handledReveals.set(key, reveal);
    if ((reveal?.group === group || (group === "ended-processes" && reveal?.group === "processes"))
      && reveal.itemId && items.findIndex((item) => item.id === reveal.itemId) >= 5) setExpanded(true);
  }, [reveal, group, items, key]);
  const visible = activityVisibleItems(items, expanded);
  const visibleIds = new Set(visible.map((item) => item.id));
  return <>
    {renderItems ? renderItems(visible) : (keepMounted ? items : visible).map((item) => <div key={item.id} hidden={!visibleIds.has(item.id)} className="session-activity-item"
      data-activity-item-id={item.id} tabIndex={-1}>{renderItem?.(item)}</div>)}
    {items.length > 5 && <Button variant="ghost" size="sm" className="session-activity-show-all" onClick={() => setExpanded(!expanded)}
      aria-expanded={expanded}>{t(expanded ? "panel.activity.showLess" : "panel.activity.showAll", { count: items.length })}</Button>}
  </>;
}

function ActivityTailActions({ item, kind }: { item: ActivityRailItem; kind: "plan" | "agent" | "output" | "source" }) {
  const { t } = useTranslation();
  return <span className="session-activity-tail-actions">
    {item.onOpen && <TooltipButton type="button" className="session-activity-action" tooltip={t(kind === "agent" ? "panel.activity.details" : "panel.activity.open")}
      ariaLabel={`${t(kind === "agent" ? "panel.activity.details" : "panel.activity.open")} · ${item.label}`} onClick={item.onOpen}>{kind === "agent" ? <IconInfo size={14} aria-hidden /> : <IconExternal size={14} aria-hidden />}</TooltipButton>}
    {item.onLocate && <TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.locate")}
      ariaLabel={`${t("panel.activity.locate")} · ${item.label}`} onClick={item.onLocate}><IconSearch size={14} aria-hidden /></TooltipButton>}
    {item.onCopyPath && <TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.copyPath")}
      ariaLabel={`${t("panel.activity.copyPath")} · ${item.path ?? item.label}`} onClick={item.onCopyPath}><IconCopy size={14} aria-hidden /></TooltipButton>}
  </span>;
}

export function ActivityRailRow({ item, kind, now }: { item: ActivityRailItem; kind: "plan" | "agent" | "output" | "source"; now: number }) {
  const { t, i18n } = useTranslation();
  if (kind === "plan" && item.content !== undefined) return item.content;
  if (kind === "agent") return <div className="session-activity-row-shell">
    <SubagentActivityRow id={item.id} name={item.label} task={item.detail} status={item.status} statusLabel={item.statusLabel}
      timing={item.timing} now={now} onOpen={item.onOpen} roleLabel={item.roleLabel} presentation="overview" className="session-activity-row session-activity-agent" />
    <ActivityTailActions item={item} kind={kind} />
  </div>;
  const outputPath = item.path ?? item.label;
  const outputName = kind === "output" ? outputPath.split(/[\\/]/).filter(Boolean).at(-1) ?? item.label : item.label;
  const isMarkdown = /\.mdx?$/i.test(outputName);
  const changedDate = item.lastChangedAt ? new Date(item.lastChangedAt) : undefined;
  const changedTime = changedDate && Number.isFinite(changedDate.getTime()) ? changedDate.toLocaleString(i18n.language) : undefined;
  const metadata = [item.changeCount !== undefined && t("panel.activity.writeCount", { count: item.changeCount }),
    item.sourceCount !== undefined && t("panel.activity.sourceCount", { count: item.sourceCount }),
    changedTime && t("panel.activity.lastChanged", { time: changedTime })].filter(Boolean).join(" · ");
  // The write count and last-change time stay in the row's tooltip and accessible name; the row itself is one line.
  const title = [kind === "output" ? outputPath : item.label, item.detail, item.statusLabel, metadata].filter(Boolean).join(" · ");
  const content = <>
    <span className="session-activity-icon" aria-hidden>
      {kind === "plan" ? <IconListChecks size={16} /> : kind === "source" ? <IconGlobe size={16} />
        : isMarkdown ? <svg className="session-activity-markdown-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M6.5 15V9l2.5 3 2.5-3v6M16 9v6m-2.5-2.5 2.5 2.5 2.5-2.5" /></svg> : <IconFileText size={16} />}
    </span>
    <span className="session-activity-label">{outputName}{kind === "plan" && item.detail ? ` · ${item.detail}` : ""}</span>
    {(item.addedLines || item.removedLines) ? <span className="session-activity-line-changes">
      {item.addedLines ? <span className="session-activity-lines-added">+{item.addedLines}</span> : null}
      {item.removedLines ? <span className="session-activity-lines-removed">−{item.removedLines}</span> : null}
    </span> : null}
    {kind !== "output" && item.status && item.statusLabel && <ActivityRowStatus status={item.status} label={item.statusLabel} />}
  </>;
  const classes = `session-activity-row${kind === "output" ? " session-activity-output" : kind === "source" ? " session-activity-source" : ""}`;
  return <div className="session-activity-row-shell">
    {item.onOpen ? <TooltipButton type="button" className={classes} tooltip={title} onClick={item.onOpen} data-activity-id={item.id}>{content}</TooltipButton>
      : <Tooltip label={title} className={`${classes} session-activity-readonly`}>{content}</Tooltip>}
    <ActivityTailActions item={item} kind={kind} />
  </div>;
}

export function ActivityOutputRows({ items, now }: { items: readonly ActivityRailItem[]; now: number }) {
  return activityOutputGroups(items).map(({ label, items: groupItems }) => <div key={label} className="session-activity-output-directory">
    {label && <p className="session-activity-directory" title={label}>{label}</p>}
    {groupItems.map((item) => <div key={item.id} className="session-activity-item" data-activity-item-id={item.id} tabIndex={-1}>
      <ActivityRailRow item={item} kind="output" now={now} />
    </div>)}
  </div>);
}
