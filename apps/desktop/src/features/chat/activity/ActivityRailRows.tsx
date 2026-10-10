import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconCopy, IconExternal, IconFileText, IconLink, IconListChecks, IconSearch, IconInfo } from "../../../components/icons";
import { Button, Tooltip, TooltipButton } from "../../../components/ui";
import { ActivityStatus } from "./ActivityStatus";
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
  const fileKind = /\.mdx?$/i.test(outputName) ? "markdown" : /\.txt$/i.test(outputName) ? "text" : "file";
  const changedDate = item.lastChangedAt ? new Date(item.lastChangedAt) : undefined;
  const changedTime = changedDate && Number.isFinite(changedDate.getTime()) ? changedDate.toLocaleString(i18n.language) : undefined;
  const metadata = [item.changeCount !== undefined && t("panel.activity.writeCount", { count: item.changeCount }),
    item.sourceCount !== undefined && t("panel.activity.sourceCount", { count: item.sourceCount }),
    changedTime && t("panel.activity.lastChanged", { time: changedTime })].filter(Boolean).join(" · ");
  const title = [kind === "output" ? outputPath : item.label, item.detail, item.statusLabel, metadata].filter(Boolean).join(" · ");
  const content = <>
    <span className={`session-activity-icon${kind === "output" ? " session-activity-file-icon" : ""}`} data-file-kind={kind === "output" ? fileKind : undefined} aria-hidden>
      {kind === "plan" ? <IconListChecks size={15} /> : kind === "source" ? <IconLink size={15} />
        : fileKind === "markdown" ? <svg className="session-activity-markdown-mark" viewBox="0 0 20 20" aria-hidden><rect x="2" y="2" width="16" height="16" rx="2" fill="currentColor" /><path d="M5 12V7l2.5 3L10 7v5M14 7v6m-2-2 2 2 2-2" fill="none" stroke="var(--ds-bg-primary)" strokeWidth="1.5" strokeLinejoin="round" /></svg> : <IconFileText size={15} />}
    </span>
    <span className="session-activity-row-copy">
      <span className="session-activity-label">{outputName}{kind === "plan" && item.detail ? ` · ${item.detail}` : ""}</span>
      {metadata && <span className="session-activity-row-metadata">{metadata}</span>}
      {(item.addedLines !== undefined || item.removedLines !== undefined) && <span className="session-activity-line-changes">
        {item.addedLines !== undefined && <span className="session-activity-lines-added">+{item.addedLines}</span>}
        {item.removedLines !== undefined && <span className="session-activity-lines-removed">−{item.removedLines}</span>}
      </span>}
    </span>
    {kind !== "output" && item.status && item.statusLabel && <ActivityStatus status={item.status} label={item.statusLabel} compact />}
  </>;
  const classes = `session-activity-row${kind === "output" ? " session-activity-output" : ""}`;
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
