import { useTranslation } from "react-i18next";
import type { SubagentTiming } from "../../../lib/subagent-topology";
import { Tooltip, TooltipButton } from "../../../components/ui";
import { IconBot } from "../../../components/icons";
import { subagentAvatarVariant, subagentElapsed, subagentRowText } from "./subagent-row-presentation";
import { ActivityRowStatus } from "./ActivityRowStatus";

export function SubagentActivityRow({ id, name, task, status, statusLabel, timing, now, className = "", onOpen, presentation = "inline", roleLabel }: {
  id: string; name: string; task?: string; status?: string; statusLabel?: string;
  timing?: SubagentTiming; now: number; className?: string; onOpen?: () => void;
  presentation?: "inline" | "overview"; roleLabel?: string;
}) {
  const { t } = useTranslation();
  const elapsed = subagentElapsed(status, timing, now);
  // The rail's overview row prints the compact clock; the tooltip and accessible name keep the spoken duration.
  const clock = presentation === "overview" ? subagentElapsed(status, timing, now, "clock") : undefined;
  const statusText = statusLabel ? presentation === "overview" ? statusLabel : `${t("chat.subagentAgent")} ${statusLabel}` : undefined;
  const title = subagentRowText(name, task, statusText, elapsed);
  // The rail's overview row reads: icon, name over task, then the status (a spinner while it runs) and the elapsed time.
  const content = presentation === "overview" ? <>
    <span className="session-activity-agent-glyph" aria-hidden><IconBot size={16} /></span>
    <span className="subagent-activity-overview-copy">
      <span className="subagent-activity-overview-main">
        <span className="subagent-activity-name">{name}</span>
        {roleLabel && <span className="subagent-activity-role">{roleLabel}</span>}
      </span>
      {task && <span className="subagent-activity-overview-detail">
        <span className="subagent-activity-task">{task}</span>
      </span>}
    </span>
    {status && statusText && <ActivityRowStatus status={status} label={statusText} className="subagent-activity-status" />}
    {clock && <span className="subagent-activity-elapsed">{clock}</span>}
  </> : <>
    <span className="subagent-activity-avatar" data-variant={subagentAvatarVariant(id)} aria-hidden />
    <span className="subagent-activity-text">
      <span className="subagent-activity-name">{name}</span>
      {task && <> · <span className="subagent-activity-task">{task}</span></>}
      {statusText && <> · <span className="subagent-activity-status">{statusText}</span></>}
      {elapsed && <> <span className="subagent-activity-elapsed">{elapsed}</span></>}
    </span>
  </>;
  const classes = `subagent-activity-row ${className} status-${status ?? "unknown"}`;
  // The title reads as a sentence, so its tooltip wraps inside the viewport instead of running past it.
  return onOpen ? <TooltipButton type="button" className={classes} tooltipClassName="ui-tooltip-help" tooltip={title} onClick={onOpen}
    data-delegation-id={id} data-activity-id={id} data-status={status}>{content}</TooltipButton>
    : <Tooltip label={title} tooltipClassName="ui-tooltip-help" className={`${classes} session-activity-readonly`}>{content}</Tooltip>;
}
