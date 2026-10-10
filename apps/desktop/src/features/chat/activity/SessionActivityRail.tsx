import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BackgroundProcessSummary } from "@pi-desktop/shared";
import { IconCircleAlert, IconInfo, IconRefresh, IconTerminal } from "../../../components/icons";
import { Button, TooltipButton } from "../../../components/ui";
import { subagentTimingIsLive } from "./subagent-row-presentation";
import { useSubagentClock } from "./use-subagent-clock";
import { ActivityStatus } from "./ActivityStatus";
import { activityFailures, backgroundProcessTitle, processActivityGroups } from "./activity-rail-presentation";
import { ActivityRailGroup, type ActivityReveal } from "./ActivityRailGroup";
import { ActivityLimitedList, ActivityOutputRows, ActivityRailRow } from "./ActivityRailRows";
import type { ActivityAttentionItem, ActivityRailItem } from "./activity-rail-types";
import "./session-activity-rail.css";

export { ActivityStatus } from "./ActivityStatus";
export type { ActivityAttentionItem, ActivityRailItem } from "./activity-rail-types";

export type SessionActivityRailProps = {
  sessionId: string; visible: boolean; plans: ActivityRailItem[]; agents: ActivityRailItem[];
  outputs: ActivityRailItem[]; sources: ActivityRailItem[]; teamMembers?: ActivityRailItem[];
  attentionItems?: ActivityAttentionItem[]; processes: BackgroundProcessSummary[]; processesLoading: boolean;
  plansAttentionReady?: boolean; agentsNotice?: ReactNode; teamNotice?: ReactNode; showTeamMembers?: boolean; processesError?: string | null;
  onRefreshProcesses: () => void; onOpenProcess: (id: string) => void;
  suggestions?: ReactNode; processDetails?: ReactNode; rangeLimited?: boolean; groupsRangeLimited?: boolean;
  supported?: boolean; onLoadEarlier?: () => void; onReturnToLatest?: () => void;
  historyLoading?: boolean; hasMoreBefore?: boolean;
};

export function SessionActivityRail(props: SessionActivityRailProps) {
  return <SessionActivityRailContent key={props.sessionId} {...props} />;
}

// Dismissal is a renderer-lifetime view preference, never a Host mutation.
const hiddenEndedProcesses = new Map<string, Set<string>>();

function SessionActivityRailContent({ sessionId, visible, agentsNotice, teamNotice, showTeamMembers = false, plans, agents, outputs, sources, processes,
  processesLoading, processesError, onRefreshProcesses, onOpenProcess, suggestions, processDetails,
  rangeLimited = false, groupsRangeLimited = rangeLimited, supported = true, plansAttentionReady = true,
  attentionItems = [], teamMembers = [], onLoadEarlier, onReturnToLatest, historyLoading = false, hasMoreBefore = false }: SessionActivityRailProps) {
  const { t } = useTranslation();
  const rail = useRef<HTMLElement>(null);
  const [reveal, setReveal] = useState<ActivityReveal>();
  const [hiddenProcessIds, setHiddenProcessIds] = useState(() => hiddenEndedProcesses.get(sessionId) ?? new Set<string>());
  const now = useSubagentClock(visible && [...agents, ...teamMembers].some((item) => subagentTimingIsLive(item.status, item.timing)));
  const { active: activeProcesses, ended: endedProcesses } = processActivityGroups(processes, sessionId, hiddenProcessIds);
  const sessionProcesses = [...activeProcesses, ...endedProcesses];
  const failures = (items: ActivityRailItem[], group: ActivityAttentionItem["group"]) => activityFailures(items).map((item) => ({
    id: `${group}:${item.id}`, itemId: item.id, group,
    label: item.attentionStatus ? t(item.attentionStatus === "timed_out" ? "panel.activity.attentionTimeout" : "panel.activity.attentionFailure", { label: item.label })
      : `${item.label} · ${item.statusLabel ?? t("panel.activity.status.failed")}`,
  }));
  const issues: ActivityAttentionItem[] = [...attentionItems];
  for (const item of [...failures(plans, "plans"), ...failures(agents, "agents"), ...failures(teamMembers, "team-members"),
    ...activityFailures(sessionProcesses).map((process) => ({ id: `processes:${process.id}`, itemId: process.id, group: "processes" as const,
      label: `${backgroundProcessTitle(process.command)} · ${t(`panel.activity.status.${process.status}`)}` }))]) {
    if (!issues.some((issue) => issue.group === item.group && issue.itemId === item.itemId)) issues.push(item);
  }
  useEffect(() => {
    if (!reveal || !visible || reveal.focus === false) return;
    let frame = 0;
    const focusTarget = () => {
      const group = [...(rail.current?.querySelectorAll<HTMLElement>("[data-activity-group]") ?? [])]
        .find((node) => node.dataset.activityGroup === reveal.group);
      const row = reveal.itemId ? [...(group?.querySelectorAll<HTMLElement>("[data-activity-item-id]") ?? [])]
        .find((node) => node.dataset.activityItemId === reveal.itemId) : undefined;
      if ((reveal.itemId && !row) || (row ?? group)?.closest("[hidden]")) return;
      const target = row?.querySelector<HTMLElement>("button, [tabindex='0']") ?? row ?? group;
      if (!target) return;
      observer.disconnect();
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
    };
    // Revealing an ended row may require several nested disclosures to commit.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(focusTarget);
    });
    if (rail.current) observer.observe(rail.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    frame = requestAnimationFrame(focusTarget);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [reveal, visible]);
  const openAttention = (item: ActivityAttentionItem) => {
    setReveal((current) => ({ group: item.group, itemId: item.itemId, sequence: (current?.sequence ?? 0) + 1, focus: !item.onOpen }));
    item.onOpen?.();
  };
  const rangeNotice = groupsRangeLimited && <div className="session-activity-range-notice">
    <span>{t("panel.activity.loadedMessagesOnly")}</span>
    <Button variant="ghost" size="sm" disabled={historyLoading || !hasMoreBefore || !onLoadEarlier} onClick={onLoadEarlier}>{t("panel.activity.loadEarlier")}</Button>
    {onReturnToLatest && <Button variant="ghost" size="sm" onClick={onReturnToLatest} disabled={historyLoading}>{t("panel.activity.returnToLatest")}</Button>}
  </div>;
  const rows = (items: ActivityRailItem[], kind: "plan" | "agent" | "output" | "source", group: string, emptyKey: string) => items.length
    ? <ActivityLimitedList sessionId={sessionId} group={group} items={items} reveal={reveal} keepMounted={kind === "plan"}
      renderItem={(item) => <ActivityRailRow item={item} kind={kind} now={now} />}
      renderItems={kind === "output" ? (visibleItems) => <ActivityOutputRows items={visibleItems} now={now} /> : undefined} />
    : <p className="session-activity-empty">{t(`panel.activity.${emptyKey}`)}</p>;
  const processRow = (process: BackgroundProcessSummary) => {
    const title = backgroundProcessTitle(process.command);
    const open = () => onOpenProcess(process.id);
    return <div className="session-activity-row-shell">
      <TooltipButton type="button" className="session-activity-row session-activity-process" data-process-id={process.id}
        tooltip={`${process.command}\n${process.cwd}`} ariaLabel={`${t("panel.activity.openProcess")} · ${title} · ${t(`panel.activity.status.${process.status}`)}`} onClick={open}>
        <span className="session-activity-icon" aria-hidden><IconTerminal size={15} /></span>
        <span className="session-activity-label session-activity-command">{title}</span>
        <ActivityStatus status={process.status} label={t(`panel.activity.status.${process.status}`)} />
      </TooltipButton>
      <span className="session-activity-tail-actions"><TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.details")} onClick={open}><IconInfo size={14} aria-hidden /></TooltipButton></span>
    </div>;
  };
  const clearEnded = () => {
    const next = new Set([...hiddenProcessIds, ...endedProcesses.map((process) => process.id)]);
    hiddenEndedProcesses.set(sessionId, next); setHiddenProcessIds(next);
  };
  return <aside ref={rail} hidden={!visible} inert={!visible} className="session-activity-rail" data-session-id={sessionId} aria-label={t("panel.activity.title")}>
    {issues.length > 0 && <section className="session-activity-attention" aria-label={t("panel.activity.needsAttention")}>
      <div className="session-activity-attention-title"><IconCircleAlert size={14} aria-hidden /><span>{t("panel.activity.needsAttention")}</span><span>{issues.length}</span></div>
      <ActivityLimitedList sessionId={sessionId} group="attention" items={issues} renderItem={(item) =>
        <Button variant="ghost" className="session-activity-attention-link" onClick={() => openAttention(item)}>{item.label}</Button>} />
    </section>}
    <p className="session-activity-section-label">{t("panel.activity.liveStatus")}</p>
    <ActivityRailGroup sessionId={sessionId} group="plans" reveal={reveal} keepMounted trackAttention={visible} preserveAttention={!plansAttentionReady} label={t("panel.activity.plans")} items={plans}>{rows(plans, "plan", "plans", "emptyPlans")}</ActivityRailGroup>
    <ActivityRailGroup sessionId={sessionId} group="agents" reveal={reveal} trackAttention={visible} label={t("panel.activity.subagents")} items={agents}>
      {rangeNotice}{agentsNotice}{rows(agents, "agent", "agents", "emptyAgents")}</ActivityRailGroup>
    {(showTeamMembers || teamMembers.length > 0) && <ActivityRailGroup sessionId={sessionId} group="team-members" reveal={reveal} trackAttention={visible && !teamNotice} label={t("panel.activity.teamMembers")} items={teamMembers}>
      {teamNotice}{rows(teamMembers, "agent", "team-members", "emptyTeamMembers")}</ActivityRailGroup>}
    <ActivityRailGroup sessionId={sessionId} group="processes" reveal={reveal} trackAttention={visible && !processesLoading && !processesError} label={t("panel.activity.processes")} items={sessionProcesses} action={supported &&
      <TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.refresh")} disabled={processesLoading} onClick={onRefreshProcesses}><IconRefresh size={13} aria-hidden /></TooltipButton>}>
      {!supported ? <p className="session-activity-empty">{t("panel.activity.unsupported")}</p> : <>
        {processesLoading && <p className="session-activity-empty" role="status">{t("panel.activity.loading")}</p>}
        {processesError && <div className="session-activity-error" role="alert"><p>{processesError}</p><Button variant="ghost" size="sm" onClick={onRefreshProcesses}>{t("panel.activity.retry")}</Button></div>}
        <ActivityLimitedList sessionId={sessionId} group="processes" items={activeProcesses} reveal={reveal} renderItem={processRow} />
        {endedProcesses.length > 0 && <ActivityRailGroup sessionId={sessionId} group="ended-processes" reveal={reveal} trackAttention={visible && !processesLoading && !processesError} initialOpen={false}
          label={t("panel.activity.endedProcesses", { count: endedProcesses.length })} items={endedProcesses} showSummary={false}
          action={<Button variant="ghost" size="sm" className="session-activity-clear-ended" aria-label={t("panel.activity.clearEndedProcesses")} onClick={clearEnded}>{t("panel.activity.clearEndedProcesses")}</Button>}>
          <ActivityLimitedList sessionId={sessionId} group="ended-processes" items={endedProcesses} reveal={reveal} renderItem={processRow} />
        </ActivityRailGroup>}
        {!processesLoading && !processesError && sessionProcesses.length === 0 && <p className="session-activity-empty">{t("panel.activity.emptyProcesses")}</p>}{processDetails}
      </>}
    </ActivityRailGroup>
    {suggestions}
    <p className="session-activity-section-label session-activity-artifacts-label">{t("panel.activity.artifacts")}</p>
    <ActivityRailGroup sessionId={sessionId} group="outputs" trackAttention={visible} label={t("panel.activity.outputs")} items={outputs} initialOpen={false}>{rangeNotice}{rows(outputs, "output", "outputs", "emptyOutputs")}</ActivityRailGroup>
    <ActivityRailGroup sessionId={sessionId} group="sources" trackAttention={visible} label={t("panel.activity.sources")} items={sources} initialOpen={false}>{rangeNotice}{rows(sources, "source", "sources", "emptySources")}</ActivityRailGroup>
  </aside>;
}
