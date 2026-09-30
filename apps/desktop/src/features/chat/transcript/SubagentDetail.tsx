import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  IconCheck,
  IconCircleAlert,
  IconRefresh,
  IconStop,
  IconTarget,
  IconWorkflow,
} from "../../../components/icons";
import { useAppStore } from "../../../stores/app-store";
import { overviewWorkPanelTab } from "../../../lib/work-panel-tabs";
import { formatToolDuration } from "../../../lib/tool-display";
import {
  delegationTimingBounds,
  isDelegationActivityItem,
  subagentOutcome,
  summarizeSubagentActivity,
  type DelegationActivityItem,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import { delegateAgentName } from "./model";
import { delegateTaskDescription } from "../../../lib/subagent-transcript";
import { delegationIdForMessage } from "../../../lib/subagent-panel";

export type SubagentTopologyProps = {
  items: DelegationActivityItem[];
  delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings?: ReadonlyMap<string, SubagentTiming>;
  onUserInteraction?: () => void;
};

/**
 * Compact Task progress card (ADR 0062 / 2026-09-30 plan image 7).
 * Replaces large inline graph with a dense status list and "View panorama" action.
 */
export function SubagentTopology({
  items,
  delegationStatuses,
  delegationTimings,
  onUserInteraction,
}: SubagentTopologyProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const openWorkPanelTabForSession = useAppStore((state) => state.openWorkPanelTabForSession);
  const openSubagentTab = useAppStore((state) => state.openSubagentTab);

  // Filter only actual Task* delegations, not TaskWait/TaskList/TaskStop
  const actualItems = useMemo(
    () => items.filter(isDelegationActivityItem),
    [items],
  );

  const summary = useMemo(
    () => summarizeSubagentActivity(actualItems, delegationStatuses),
    [actualItems, delegationStatuses],
  );

  const timing = useMemo(() => {
    if (!delegationTimings || actualItems.length === 0) return null;
    const bounds = delegationTimingBounds(actualItems, delegationTimings);
    if (!bounds.startedAt) return null;
    const end = bounds.completedAt ?? Date.now();
    const seconds = Math.max(0, Math.floor((end - bounds.startedAt) / 1000));
    return formatToolDuration(seconds);
  }, [actualItems, delegationTimings]);

  const handleOpenPanorama = () => {
    onUserInteraction?.();
    if (activeSessionId) {
      openWorkPanelTabForSession(activeSessionId, overviewWorkPanelTab("panorama"));
    }
  };

  const renderStatusIcon = (outcome: SubagentOutcome) => {
    switch (outcome) {
      case "running":
        return <IconRefresh size={14} className="subagent-tasks-status-icon is-running animate-spin" aria-hidden />;
      case "completed":
        return <IconCheck size={14} className="subagent-tasks-status-icon is-completed" aria-hidden />;
      case "failed":
      case "denied":
        return <IconCircleAlert size={14} className="subagent-tasks-status-icon is-failed" aria-hidden />;
      case "aborted":
      case "stopped":
      case "timed_out":
        return <IconStop size={14} className="subagent-tasks-status-icon is-stopped" aria-hidden />;
      default:
        return <IconTarget size={14} className="subagent-tasks-status-icon is-idle" aria-hidden />;
    }
  };

  if (actualItems.length === 0) {
    return null;
  }

  return (
    <section className="subagent-tasks-card" aria-labelledby={labelId}>
      <header className="subagent-tasks-header">
        <div className="subagent-tasks-title-group">
          <span className="subagent-tasks-title-icon" aria-hidden>
            <IconWorkflow size={15} />
          </span>
          <strong id={labelId} className="subagent-tasks-title">
            {t("chat.taskProgress", { defaultValue: "Task progress" })}
          </strong>
          <span className="subagent-tasks-metrics">
            {summary.finished}/{summary.total} {t("chat.subagentProgressFinished", {
              finished: summary.finished,
              total: summary.total,
              defaultValue: "finished",
            })}
            {timing ? <span className="subagent-tasks-elapsed"> · {timing}</span> : null}
          </span>
        </div>
        <button
          type="button"
          className="subagent-tasks-action-btn"
          onClick={handleOpenPanorama}
          title={t("chat.viewPanorama", { defaultValue: "View panorama" })}
          aria-label={t("chat.viewPanorama", { defaultValue: "View panorama" })}
        >
          <IconWorkflow size={13} aria-hidden />
          <span>{t("chat.viewPanorama", { defaultValue: "View panorama" })}</span>
        </button>
      </header>

      <div className="subagent-tasks-list" role="list">
        {actualItems.map((item) => {
          const delegationId = delegationIdForMessage(item.message);
          const agentName = item.delegate?.agentName || delegateAgentName(item.message) || t("chat.subagentUnnamed");
          const taskDescription = delegateTaskDescription(item.message) || item.message.toolName;
          const outcome = subagentOutcome(item.message, delegationStatuses);

          return (
            <div
              key={item.message.id}
              className={`subagent-tasks-row status-${outcome}`}
              role="listitem"
              tabIndex={0}
              onClick={() => {
                onUserInteraction?.();
                if (delegationId) {
                  openSubagentTab(delegationId, agentName);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onUserInteraction?.();
                  if (delegationId) {
                    openSubagentTab(delegationId, agentName);
                  }
                }
              }}
              title={taskDescription}
            >
              <span className="subagent-tasks-row-status" aria-label={outcome}>
                {renderStatusIcon(outcome)}
              </span>
              <span className="subagent-tasks-row-task">
                {taskDescription}
              </span>
              <span className="subagent-tasks-row-agent">
                {agentName}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
