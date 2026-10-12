import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../stores/app-store";
import { subagentWorkPanelTab } from "../../../lib/work-panel-tabs";
import {
  collectDelegationTimings,
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
import { useSlotSessionId } from "../../../plugins/renderer-slots/use-slots";
import { SubagentActivityRow } from "../activity/SubagentActivityRow";
import { subagentItemTiming, subagentTimingIsLive } from "../activity/subagent-row-presentation";
import { useSubagentClock } from "../activity/use-subagent-clock";

export type SubagentTopologyProps = {
  items: DelegationActivityItem[];
  delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings?: ReadonlyMap<string, SubagentTiming>;
  onUserInteraction?: () => void;
};

/** Delegation activity stays in the conversation; its detailed transcript is read-only. */
export function SubagentTopology({ items, delegationStatuses, delegationTimings, onUserInteraction }: SubagentTopologyProps) {
  const { t } = useTranslation();
  const ownerSessionId = useSlotSessionId();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const openWorkPanelTabForSession = useAppStore((state) => state.openWorkPanelTabForSession);
  const openSubagentTab = useAppStore((state) => state.openSubagentTab);
  const actualItems = useMemo(() => items.filter(isDelegationActivityItem), [items]);
  const summary = useMemo(() => summarizeSubagentActivity(actualItems, delegationStatuses), [actualItems, delegationStatuses]);
  const timings = useMemo(() => delegationTimings ?? collectDelegationTimings(items), [items, delegationTimings]);
  const rows = useMemo(() => actualItems.map((item) => ({
    id: item.message.id,
    delegationId: delegationIdForMessage(item.message),
    agentName: item.delegate?.agentName || delegateAgentName(item.message) || t("chat.subagentUnnamed"),
    task: delegateTaskDescription(item.message) || item.message.toolName,
    status: subagentOutcome(item.message, delegationStatuses),
    timing: subagentItemTiming(item, timings),
  })), [actualItems, delegationStatuses, timings, t]);
  const now = useSubagentClock((!ownerSessionId || ownerSessionId === activeSessionId)
    && rows.some((row) => subagentTimingIsLive(row.status, row.timing)));

  if (actualItems.length === 0) return null;

  return <section className="subagent-tasks-card" aria-label={t("chat.taskProgress")} data-running={summary.running}>
    <div className="subagent-tasks-list" role="list">
      {rows.map((row) => <div key={row.id} role="listitem">
        <SubagentActivityRow id={row.delegationId} name={row.agentName} task={row.task} status={row.status}
          statusLabel={t(`panel.activity.status.${row.status}`)} timing={row.timing} now={now}
          className="subagent-tasks-row" onOpen={() => {
            onUserInteraction?.();
            if (ownerSessionId) {
              openWorkPanelTabForSession(ownerSessionId, subagentWorkPanelTab(row.delegationId, row.agentName));
            } else {
              openSubagentTab(row.delegationId, row.agentName);
            }
          }} />
      </div>)}
    </div>
  </section>;
}
