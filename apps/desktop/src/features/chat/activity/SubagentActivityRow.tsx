import { useTranslation } from "react-i18next";
import type { SubagentTiming } from "../../../lib/subagent-topology";
import { Badge, Tooltip, TooltipButton } from "../../../components/ui";
import { subagentAvatarVariant, subagentElapsed, subagentRowText } from "./subagent-row-presentation";
import { ActivityStatus } from "./ActivityStatus";
import { activityStatusTone } from "./activity-rail-presentation";

export function SubagentActivityRow({ id, name, task, status, statusLabel, timing, now, className = "", onOpen, presentation = "inline", roleLabel }: {
  id: string; name: string; task?: string; status?: string; statusLabel?: string;
  timing?: SubagentTiming; now: number; className?: string; onOpen?: () => void;
  presentation?: "inline" | "overview"; roleLabel?: string;
}) {
  const { t } = useTranslation();
  const elapsed = subagentElapsed(status, timing, now);
  const statusText = statusLabel ? presentation === "overview" ? statusLabel : `${t("chat.subagentAgent")} ${statusLabel}` : undefined;
  const title = subagentRowText(name, task, statusText, elapsed);
  const content = <>
    {presentation === "overview" ? <span className="session-activity-agent-glyph" aria-hidden><ActivityStatus status={status ?? "unknown"} label="" compact /></span>
      : <span className="subagent-activity-avatar" data-variant={subagentAvatarVariant(id)} aria-hidden />}
    {presentation === "overview" ? <span className="subagent-activity-overview-copy">
      <span className="subagent-activity-overview-main">
        <span className="subagent-activity-name">{name}</span>
        {roleLabel && <Badge className="subagent-activity-role">{roleLabel}</Badge>}
        {status && statusText && <Badge tone={activityStatusTone(status)} className="subagent-activity-status">
          <ActivityStatus status={status} label={statusText} />
        </Badge>}
      </span>
      {(task || elapsed) && <span className="subagent-activity-overview-detail">
        <span className="subagent-activity-task">{task}</span>
        {elapsed && <span className="subagent-activity-elapsed">{elapsed}</span>}
      </span>}
    </span> : <span className="subagent-activity-text">
      <span className="subagent-activity-name">{name}</span>
      {task && <> · <span className="subagent-activity-task">{task}</span></>}
      {statusText && <> · <span className="subagent-activity-status">{statusText}</span></>}
      {elapsed && <> <span className="subagent-activity-elapsed">{elapsed}</span></>}
    </span>}
  </>;
  const classes = `subagent-activity-row ${className} status-${status ?? "unknown"}`;
  return onOpen ? <TooltipButton type="button" className={classes} tooltip={title} onClick={onOpen}
    data-delegation-id={id} data-activity-id={id} data-status={status}>{content}</TooltipButton>
    : <Tooltip label={title} className={`${classes} session-activity-readonly`}>{content}</Tooltip>;
}
