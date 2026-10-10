import { IconCheck, IconCircleAlert, IconClock, IconX } from "../../../components/icons";
import { activityStatusTone } from "./activity-rail-presentation";

export function ActivityStatus({ status, label, compact = false }: {
  status: string; label: string; compact?: boolean;
}) {
  const tone = activityStatusTone(status);
  const stopped = ["stopped", "aborted", "cancelled"].includes(status);
  const completed = ["completed", "complete", "success", "done"].includes(status);
  const active = ["running", "starting", "stopping", "working", "in_progress", "queued"].includes(status);
  return <span className="session-activity-status" data-tone={tone === "neutral" ? "muted" : tone}
    data-active={active} aria-label={label}>
    {tone === "warning" ? <IconClock size={12} aria-hidden /> : tone === "error" ? <IconCircleAlert size={12} aria-hidden />
      : stopped ? <IconX size={12} aria-hidden /> : completed ? <IconCheck size={12} aria-hidden />
      : active ? <span className="session-activity-status-dot" aria-hidden /> : <IconClock size={12} aria-hidden />}
    {!compact && <span>{label}</span>}
  </span>;
}
