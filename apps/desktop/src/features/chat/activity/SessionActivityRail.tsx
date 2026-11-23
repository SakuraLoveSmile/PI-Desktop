import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BackgroundProcessSummary } from "@pi-desktop/shared";
import { IconCircleAlert, IconInfo, IconRefresh, IconTerminal } from "../../../components/icons";
import { Button, TooltipButton } from "../../../components/ui";
import { subagentTimingIsLive } from "./subagent-row-presentation";
import { useSubagentClock } from "./use-subagent-clock";
import { ActivityRowStatus } from "./ActivityRowStatus";
import { ActivityServersSection } from "./ActivityServersSection";
import { splitServerProcesses } from "./activity-server-rows";
import { activityFailures, backgroundProcessTitle, processActivityGroups } from "./activity-rail-presentation";
import { ActivityRailGroup, type ActivityReveal } from "./ActivityRailGroup";
import { ActivityLimitedList, ActivityOutputRows, ActivityRailRow } from "./ActivityRailRows";
import { ActivityRailSections, type ActivityRailSectionSpec } from "./ActivityRailSections";
import { ActivityChangesSection } from "./ActivityChangesSection";
import { ActivityContextSection } from "./ActivityContextSection";
import { ActivityEnvironmentSection } from "./ActivityEnvironmentSection";
import { activityRailVisibility } from "./activity-rail-visibility";
import type { LatestTurnContextInspector } from "../../../lib/latest-turn-context";
import type { ActivityAttentionItem, ActivityChanges, ActivityEnvironment, ActivityRailItem } from "./activity-rail-types";
import "./session-activity-rail.css";

export { ActivityStatus } from "./ActivityStatus";
export type { ActivityAttentionItem, ActivityRailItem } from "./activity-rail-types";

export type SessionActivityRailProps = {
  sessionId: string; visible: boolean; plans: ActivityRailItem[]; goals?: ActivityRailItem[]; agents: ActivityRailItem[];
  outputs: ActivityRailItem[]; sources: ActivityRailItem[]; teamMembers?: ActivityRailItem[];
  attentionItems?: ActivityAttentionItem[]; processes: BackgroundProcessSummary[]; processesLoading: boolean;
  goalsAttentionReady?: boolean; agentsNotice?: ReactNode; resourcesNotice?: ReactNode; teamNotice?: ReactNode; showTeamMembers?: boolean; processesError?: string | null;
  onRefreshProcesses: () => void; onOpenProcess: (id: string) => void;
  suggestions?: ReactNode; processDetails?: ReactNode; rangeLimited?: boolean; groupsRangeLimited?: boolean;
  /** The process whose details are open: a server's show under its row in Servers, any other process's under Background processes. */
  selectedProcessId?: string | null;
  supported?: boolean; onLoadEarlier?: () => void; onReturnToLatest?: () => void;
  historyLoading?: boolean; hasMoreBefore?: boolean;
  /** Notices that only say data is still loading: they show inside a group that has rows, but never open an empty one. */
  pendingNotices?: { activity?: boolean; team?: boolean };
  /** False when the skills section has nothing to list yet and only offers to propose some. */
  suggestionsHaveRows?: boolean;
  /** What the rail mirrors of the workspace; each section shows only when its data is given. */
  environment?: ActivityEnvironment; contextUsage?: LatestTurnContextInspector; changes?: ActivityChanges;
  onOpenContext?: () => void; onOpenReview?: () => void;
  /** Servers have their own section: what an address click opens, how a stop is asked for and which stops are under way. */
  onOpenServerAddress?: (url: string) => void; onStopServer?: (id: string) => void; stoppingServers?: ReadonlySet<string>;
};

// Sections that hold several groups: revealing a group nested inside one opens the section too.
const LIVE_GROUPS = ["agents", "team-members", "processes", "ended-processes"] as const;
const ARTIFACT_GROUPS = ["outputs", "sources"] as const;
const groupItem = (group: string) => (item: { id: string; status?: string; attentionStatus?: string }) =>
  ({ id: `${group}:${item.id}`, status: item.status, attentionStatus: item.attentionStatus });
/** A section that holds exactly one item says that item's own word once it is folded; with several it keeps its counts. */
const onlyItem = (items: readonly ActivityRailItem[]) => items.length === 1 ? items[0] : undefined;

export function SessionActivityRail(props: SessionActivityRailProps) {
  return <SessionActivityRailContent key={props.sessionId} {...props} />;
}

// Dismissal is a renderer-lifetime view preference, never a Host mutation.
const hiddenEndedProcesses = new Map<string, Set<string>>();
const NO_STOPS: ReadonlySet<string> = new Set();

function SessionActivityRailContent({ sessionId, visible, agentsNotice, resourcesNotice, teamNotice, showTeamMembers = false, plans, goals = [], agents, outputs, sources, processes,
  processesLoading, processesError, onRefreshProcesses, onOpenProcess, suggestions, processDetails, selectedProcessId = null,
  rangeLimited = false, groupsRangeLimited = rangeLimited, supported = true, goalsAttentionReady = true,
  attentionItems = [], teamMembers = [], onLoadEarlier, onReturnToLatest, historyLoading = false, hasMoreBefore = false,
  pendingNotices = {}, suggestionsHaveRows = true, environment, contextUsage, changes, onOpenContext, onOpenReview,
  onOpenServerAddress, onStopServer, stoppingServers = NO_STOPS }: SessionActivityRailProps) {
  const { t } = useTranslation();
  const rail = useRef<HTMLElement>(null);
  const [reveal, setReveal] = useState<ActivityReveal>();
  const [hiddenProcessIds, setHiddenProcessIds] = useState(() => hiddenEndedProcesses.get(sessionId) ?? new Set<string>());
  const now = useSubagentClock(visible && [...agents, ...teamMembers].some((item) => subagentTimingIsLive(item.status, item.timing)));
  const { servers, rest: otherProcesses } = splitServerProcesses(processes, sessionId);
  // A server's details open under its own row, so opening them never adds an empty Live status section for it.
  const detailsInServers = Boolean(processDetails) && selectedProcessId !== null && servers.some((server) => server.id === selectedProcessId);
  const liveProcessDetails = detailsInServers ? null : processDetails;
  const { active: activeProcesses, ended: endedProcesses } = processActivityGroups(otherProcesses, sessionId, hiddenProcessIds);
  const sessionProcesses = [...activeProcesses, ...endedProcesses];
  const failures = (items: ActivityRailItem[], group: ActivityAttentionItem["group"]) => activityFailures(items).map((item) => ({
    id: `${group}:${item.id}`, itemId: item.id, group,
    label: item.attentionStatus ? t(item.attentionStatus === "timed_out" ? "panel.activity.attentionTimeout" : "panel.activity.attentionFailure", { label: item.label })
      : `${item.label} · ${item.statusLabel ?? t("panel.activity.status.failed")}`,
  }));
  const issues: ActivityAttentionItem[] = [...attentionItems];
  for (const item of [...failures(goals, "goals"), ...failures(plans, "plans"), ...failures(agents, "agents"), ...failures(teamMembers, "team-members"),
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
  const rows = (items: ActivityRailItem[], kind: "plan" | "agent" | "output" | "source", group: string) =>
    <ActivityLimitedList sessionId={sessionId} group={group} items={items} reveal={reveal} keepMounted={kind === "plan"}
      renderItem={(item) => <ActivityRailRow item={item} kind={kind} now={now} />}
      renderItems={kind === "output" ? (visibleItems) => <ActivityOutputRows items={visibleItems} now={now} /> : undefined} />;
  const processRow = (process: BackgroundProcessSummary) => {
    const commandTitle = backgroundProcessTitle(process.command);
    const title = process.backgroundKind === "service"
      ? `${t("panel.activity.service.label")} · ${commandTitle}` : commandTitle;
    const open = () => onOpenProcess(process.id);
    return <div className="session-activity-row-shell">
      <TooltipButton type="button" className="session-activity-row session-activity-process" data-process-id={process.id}
        tooltip={`${process.command}\n${process.cwd}`} ariaLabel={`${t("panel.activity.openProcess")} · ${title} · ${t(`panel.activity.status.${process.status}`)}`} onClick={open}>
        <span className="session-activity-icon" aria-hidden><IconTerminal size={16} /></span>
        <span className="session-activity-label session-activity-command">{title}</span>
        <ActivityRowStatus status={process.status} label={t(`panel.activity.status.${process.status}`)} />
      </TooltipButton>
      <span className="session-activity-tail-actions"><TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.details")} onClick={open}><IconInfo size={14} aria-hidden /></TooltipButton></span>
    </div>;
  };
  const clearEnded = () => {
    const next = new Set([...hiddenProcessIds, ...endedProcesses.map((process) => process.id)]);
    hiddenEndedProcesses.set(sessionId, next); setHiddenProcessIds(next);
  };
  // An empty group or section is left out; a notice that only says "still loading" never opens one.
  const shown = (notice: ReactNode, pending?: boolean) => Boolean(notice) && !pending;
  const show = activityRailVisibility({
    goals: goals.length, plans: plans.length, agents: agents.length, teamMembers: teamMembers.length, processes: sessionProcesses.length, servers: servers.length,
    outputs: outputs.length, sources: sources.length,
    processesNotice: !supported || Boolean(processesError) || Boolean(liveProcessDetails), teamNotice: shown(teamNotice, pendingNotices.team),
    agentsNotice: shown(agentsNotice, pendingNotices.activity), resourcesNotice: shown(resourcesNotice, pendingNotices.activity),
    rangeNotice: Boolean(rangeNotice), suggestions: Boolean(suggestions), suggestionsHaveRows,
  });
  const sections: ActivityRailSectionSpec[] = [];
  if (show.goals) sections.push({ id: "goals", node: <ActivityRailGroup sessionId={sessionId} group="goals" reveal={reveal} keepMounted sectionHeading
    trackAttention={visible} preserveAttention={!goalsAttentionReady} label={t("panel.activity.goals")} items={goals}
    collapsedSummary={onlyItem(goals)?.foldedSummary}>{rows(goals, "plan", "goals")}</ActivityRailGroup> });
  if (show.plans) sections.push({ id: "plans", node: <ActivityRailGroup sessionId={sessionId} group="plans" reveal={reveal} keepMounted sectionHeading
    trackAttention={visible} label={t("panel.activity.plans")} items={plans}
    collapsedSummary={onlyItem(plans)?.statusLabel}>{rows(plans, "plan", "plans")}</ActivityRailGroup> });
  if (show.live) sections.push({ id: "live", node: <ActivityRailGroup sessionId={sessionId} group="live" reveal={reveal} revealAlso={LIVE_GROUPS} sectionHeading
    trackAttention={visible && !processesLoading && !processesError} label={t("panel.activity.liveStatus")}
    items={[...agents.map(groupItem("agents")), ...teamMembers.map(groupItem("team-members")), ...sessionProcesses.map(groupItem("processes"))]}>
    {show.emptyHint ? <p className="session-activity-empty">{t("panel.activity.emptyLive")}</p> : <>
      {rangeNotice}{agentsNotice}
      {agents.length > 0 && <ActivityRailGroup sessionId={sessionId} group="agents" reveal={reveal} trackAttention={visible} label={t("panel.activity.subagents")} items={agents}>
        {rows(agents, "agent", "agents")}</ActivityRailGroup>}
      {show.team && <ActivityRailGroup sessionId={sessionId} group="team-members" reveal={reveal} trackAttention={visible && !teamNotice} label={t("panel.activity.teamMembers")} items={teamMembers}>
        {teamNotice}{teamMembers.length > 0 && rows(teamMembers, "agent", "team-members")}</ActivityRailGroup>}
      {show.processes && <ActivityRailGroup sessionId={sessionId} group="processes" reveal={reveal} trackAttention={visible && !processesLoading && !processesError} label={t("panel.activity.processes")} items={sessionProcesses} action={supported &&
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
          {liveProcessDetails}
        </>}
      </ActivityRailGroup>}
    </>}
  </ActivityRailGroup> });
  if (servers.length > 0) sections.push({ id: "server", node: <ActivityServersSection sessionId={sessionId} servers={servers} stopping={stoppingServers}
    onOpenDetails={onOpenProcess} onOpenAddress={onOpenServerAddress} onStop={onStopServer}
    details={detailsInServers ? processDetails : undefined} /> });
  if (environment) sections.push({ id: "environment", node: <ActivityEnvironmentSection sessionId={sessionId} environment={environment} /> });
  if (contextUsage) sections.push({ id: "context", node: <ActivityContextSection sessionId={sessionId} visible={visible} inspector={contextUsage} onOpenDetails={onOpenContext} /> });
  if (show.artifacts) sections.push({ id: "artifacts", node: <ActivityRailGroup sessionId={sessionId} group="artifacts" reveal={reveal} revealAlso={ARTIFACT_GROUPS} sectionHeading
    trackAttention={false} label={t("panel.activity.artifacts")} collapsedSummary={String(outputs.length || sources.length || "")}>
    {rangeNotice}{resourcesNotice}
    {outputs.length > 0 && <div className="session-activity-outputs" data-activity-group="outputs">{rows(outputs, "output", "outputs")}</div>}
    {sources.length > 0 && <ActivityRailGroup sessionId={sessionId} group="sources" reveal={reveal} trackAttention={false} initialOpen={false} label={t("panel.activity.sources")} items={sources}>
      {rows(sources, "source", "sources")}</ActivityRailGroup>}
  </ActivityRailGroup> });
  if (show.skills) sections.push({ id: "skills", node: suggestions });
  if (changes) sections.push({ id: "changes", node: <ActivityChangesSection changes={changes} onReview={onOpenReview} /> });
  return <aside ref={rail} hidden={!visible} inert={!visible} className="session-activity-rail" data-session-id={sessionId} aria-label={t("panel.activity.title")}>
    {issues.length > 0 && <section className="session-activity-attention" aria-label={t("panel.activity.needsAttention")}>
      <div className="session-activity-attention-title"><IconCircleAlert size={14} aria-hidden /><span>{t("panel.activity.needsAttention")}</span><span>{issues.length}</span></div>
      <ActivityLimitedList sessionId={sessionId} group="attention" items={issues} renderItem={(item) =>
        <Button variant="ghost" className="session-activity-attention-link" onClick={() => openAttention(item)}>{item.label}</Button>} />
    </section>}
    <ActivityRailSections sections={sections} />
  </aside>;
}
