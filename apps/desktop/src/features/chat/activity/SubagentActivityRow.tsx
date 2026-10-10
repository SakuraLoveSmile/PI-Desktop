import { useTranslation } from "react-i18next";
import type { SubagentTiming } from "../../../lib/subagent-topology";
import { Tooltip, TooltipButton } from "../../../components/ui";
import { subagentAvatarVariant, subagentElapsed, subagentRowText } from "./subagent-row-presentation";

export function SubagentActivityRow({ id, name, task, status, statusLabel, timing, now, className = "", onOpen }: {
  id: string; name: string; task?: string; status?: string; statusLabel?: string;
  timing?: SubagentTiming; now: number; className?: string; onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const elapsed = subagentElapsed(status, timing, now);
  const statusText = statusLabel ? `${t("chat.subagentAgent")} ${statusLabel}` : undefined;
  const title = subagentRowText(name, task, statusText, elapsed);
  const content = <>
    <span className="subagent-activity-avatar" data-variant={subagentAvatarVariant(id)} aria-hidden />
    <span className="subagent-activity-text">
      <span className="subagent-activity-name">{name}</span>
      {task && <> · <span className="subagent-activity-task">{task}</span></>}
      {statusText && <> · <span className="subagent-activity-status">{statusText}</span></>}
      {elapsed && <> <span className="subagent-activity-elapsed">{elapsed}</span></>}
    </span>
  </>;
  const classes = `subagent-activity-row ${className} status-${status ?? "unknown"}`;
  return onOpen ? <TooltipButton type="button" className={classes} tooltip={title} onClick={onOpen}
    data-delegation-id={id} data-activity-id={id} data-status={status}>{content}</TooltipButton>
    : <Tooltip label={title} className={`${classes} session-activity-readonly`}>{content}</Tooltip>;
}
