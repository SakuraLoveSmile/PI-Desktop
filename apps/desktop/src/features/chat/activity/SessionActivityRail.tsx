import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BackgroundProcessSummary } from "@pi-desktop/shared";
import { IconCheck, IconChevronDown, IconCircleAlert, IconClock, IconFileText, IconLink, IconListChecks, IconRefresh, IconTerminal, IconX } from "../../../components/icons";
import { Button, Tooltip, TooltipButton } from "../../../components/ui";
import type { SubagentTiming } from "../../../lib/subagent-topology";
import { SubagentActivityRow } from "./SubagentActivityRow";
import { subagentTimingIsLive } from "./subagent-row-presentation";
import { useSubagentClock } from "./use-subagent-clock";
import "./session-activity-rail.css";

export type ActivityRailItem = {
  id: string;
  label: string;
  path?: string;
  detail?: string;
  status?: string;
  statusLabel?: string;
  timing?: SubagentTiming;
  onOpen?: () => void;
};

export type SessionActivityRailProps = {
  sessionId: string;
  visible: boolean;
  plans: ActivityRailItem[];
  agents: ActivityRailItem[];
  outputs: ActivityRailItem[];
  sources: ActivityRailItem[];
  processes: BackgroundProcessSummary[];
  processesLoading: boolean;
  agentsNotice?: ReactNode;
  processesError?: string | null;
  onRefreshProcesses: () => void;
  onOpenProcess: (id: string) => void;
  suggestions?: ReactNode;
  processDetails?: ReactNode;
  rangeLimited?: boolean;
  supported?: boolean;
};

function ActivityGroup({ label, initialOpen = true, children, action }: {
  label: string; initialOpen?: boolean; children: ReactNode; action?: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  return <section className="session-activity-group">
    <div className="session-activity-heading">
      <Button variant="ghost" className="session-activity-disclosure" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {label}<IconChevronDown size={13} aria-hidden />
      </Button>
      {action}
    </div>
    <div id={id} hidden={!open} className="session-activity-group-body">{open && children}</div>
  </section>;
}

export function ActivityStatus({ status, label, compact = false }: {
  status: string; label: string; compact?: boolean;
}) {
  const error = ["failed", "error", "denied", "timed_out", "interrupted", "blocked"].includes(status);
  const stopped = ["stopped", "aborted", "cancelled"].includes(status);
  const completed = ["completed", "complete", "success", "done"].includes(status);
  const active = ["running", "starting", "stopping", "working"].includes(status);
  return <span className="session-activity-status" data-tone={error ? "error" : stopped ? "muted" : completed || active ? "success" : "muted"}
    data-active={active} aria-label={label}>
    {error ? <IconCircleAlert size={12} aria-hidden /> : stopped ? <IconX size={12} aria-hidden />
      : completed ? <IconCheck size={12} aria-hidden /> : active ? <span className="session-activity-status-dot" aria-hidden />
      : <IconClock size={12} aria-hidden />}
    {!compact && <span>{label}</span>}
  </span>;
}

function ActivityRow({ item, kind, now }: { item: ActivityRailItem; kind: "plan" | "agent" | "output" | "source"; now: number }) {
  if (kind === "agent") return <SubagentActivityRow id={item.id} name={item.label} task={item.detail}
    status={item.status} statusLabel={item.statusLabel} timing={item.timing} now={now} onOpen={item.onOpen}
    className="session-activity-row session-activity-agent" />;
  const outputPath = item.path ?? item.label;
  const outputName = kind === "output" ? outputPath.split(/[\\/]/).filter(Boolean).at(-1) ?? item.label : item.label;
  const fileKind = outputName.toLowerCase().endsWith(".md") || outputName.toLowerCase().endsWith(".mdx") ? "markdown"
    : outputName.toLowerCase().endsWith(".txt") ? "text" : "file";
  const title = [kind === "output" ? outputPath : item.label, item.detail, item.statusLabel].filter(Boolean).join(" · ");
  const content = <>
    <span className={`session-activity-icon${kind === "output" ? " session-activity-file-icon" : ""}`}
      data-file-kind={kind === "output" ? fileKind : undefined} aria-hidden>{kind === "plan" ? <IconListChecks size={15} />
      : kind === "source" ? <IconLink size={15} /> : kind === "output" && fileKind === "markdown" ? <svg className="session-activity-markdown-mark" viewBox="0 0 20 20" aria-hidden><rect x="2" y="2" width="16" height="16" rx="2" fill="currentColor" /><path d="M5 12V7l2.5 3L10 7v5M14 7v6m-2-2 2 2 2-2" fill="none" stroke="var(--ds-bg-primary)" strokeWidth="1.5" strokeLinejoin="round" /></svg> : <IconFileText size={15} />}</span>
    <span className="session-activity-label">{outputName}{kind !== "output" && item.detail ? ` · ${item.detail}` : ""}</span>
    {kind !== "output" && item.status && item.statusLabel && <ActivityStatus status={item.status} label={item.statusLabel} compact />}
  </>;
  return item.onOpen
    ? <TooltipButton type="button" className={`session-activity-row${kind === "output" ? " session-activity-output" : ""}`} tooltip={title} onClick={item.onOpen} data-activity-id={item.id}>{content}</TooltipButton>
    : <Tooltip label={title} className={`session-activity-row session-activity-readonly${kind === "output" ? " session-activity-output" : ""}`}>{content}</Tooltip>;
}

export function SessionActivityRail(props: SessionActivityRailProps) {
  // A new session owns its own disclosure choices; hiding retains the shell's data ownership.
  return <SessionActivityRailContent key={props.sessionId} {...props} />;
}

function SessionActivityRailContent({ sessionId, visible, agentsNotice, plans, agents, outputs, sources, processes,
  processesLoading, processesError, onRefreshProcesses, onOpenProcess, suggestions, processDetails,
  rangeLimited = false, supported = true }: SessionActivityRailProps) {
  const { t } = useTranslation();
  const now = useSubagentClock(visible && agents.some((item) => subagentTimingIsLive(item.status, item.timing)));
  const rows = (items: ActivityRailItem[], kind: Parameters<typeof ActivityRow>[0]["kind"]) => items.length
    ? items.map((item) => <ActivityRow key={item.id} item={item} kind={kind} now={now} />)
    : <p className="session-activity-empty">{t("panel.activity.empty")}</p>;
  const sessionProcesses = processes.filter((process) => process.sessionId === sessionId);
  return <aside hidden={!visible} inert={!visible} className="session-activity-rail" data-session-id={sessionId} aria-label={t("panel.activity.title")}>
    {rangeLimited && <p className="session-activity-notice">{t("panel.activity.rangeLimited")}</p>}
    <ActivityGroup label={t("panel.activity.plans")}>{rows(plans, "plan")}</ActivityGroup>
    <ActivityGroup label={t("panel.activity.subagents")}>
      {agentsNotice}{rows(agents, "agent")}</ActivityGroup>
    <ActivityGroup label={t("panel.activity.processes")} action={supported &&
      <TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.refresh")}
        disabled={processesLoading} onClick={onRefreshProcesses}><IconRefresh size={13} aria-hidden /></TooltipButton>}>
      {!supported ? <p className="session-activity-empty">{t("panel.activity.unsupported")}</p> : <>
        {processesLoading && <p className="session-activity-empty" role="status">{t("panel.activity.loading")}</p>}
        {processesError && <div className="session-activity-error" role="alert"><p>{processesError}</p>
          <Button variant="ghost" size="sm" onClick={onRefreshProcesses}>{t("panel.activity.retry")}</Button></div>}
        {sessionProcesses.map((process) => <TooltipButton key={process.id} type="button" className="session-activity-row session-activity-process"
          data-process-id={process.id} tooltip={`${process.command}\n${process.cwd}`} ariaLabel={`${t("panel.activity.openProcess")} · ${process.command} · ${t(`panel.activity.status.${process.status}`)}`}
          onClick={() => onOpenProcess(process.id)}>
          <span className="session-activity-icon" aria-hidden><IconTerminal size={15} /></span>
          <span className="session-activity-label session-activity-command">{process.command}</span>
          <ActivityStatus status={process.status} label={t(`panel.activity.status.${process.status}`)} />
        </TooltipButton>)}
        {!processesLoading && !processesError && sessionProcesses.length === 0 && <p className="session-activity-empty">{t("panel.activity.empty")}</p>}
        {processDetails}
      </>}
    </ActivityGroup>
    {suggestions}
    <ActivityGroup label={t("panel.activity.outputs")} initialOpen={false}>{rows(outputs, "output")}</ActivityGroup>
    <ActivityGroup label={t("panel.activity.sources")} initialOpen={false}>{rows(sources, "source")}</ActivityGroup>
  </aside>;
}
