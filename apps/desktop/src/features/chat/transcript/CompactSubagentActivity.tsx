import { useContext, useMemo } from "react";
import type { AssistantActivityItem } from "../../../lib/assistant-turns";
import {
  isDelegationActivityItem,
  type DelegationActivityItem,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import { TranscriptSearchContext } from "../../../lib/transcript-search-context";
import { ActivityItems } from "./ActivityItems";
import { disclosureKey, useAutomaticDisclosure } from "./disclosure";
import { ProcessActivityGroup } from "./ProcessActivityGroup";
import { SubagentTopology } from "./SubagentDetail";

type Props = {
  items: readonly AssistantActivityItem[];
  delegateItems: DelegationActivityItem[];
  delegationStatuses: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings: ReadonlyMap<string, SubagentTiming>;
  isLast: boolean;
  isActive: boolean;
  activeStatusLabel: string;
};

/** A delegate card stays visible while ordinary tool details remain compact. */
export function CompactSubagentActivity(props: Props) {
  const { items, delegateItems, delegationStatuses, delegationTimings } = props;
  const segments = useMemo(() => {
    const firstTask = items.findIndex(isDelegationActivityItem);
    return {
      before: items.slice(0, firstTask),
      after: items.slice(firstTask).filter((item) => !isDelegationActivityItem(item)),
    };
  }, [items]);
  return <div className="compact-subagent-activity">
    <CompactToolSegment {...props} items={segments.before} isLast={false} isActive={false} />
    <SubagentTopology items={delegateItems} delegationStatuses={delegationStatuses} delegationTimings={delegationTimings} />
    <CompactToolSegment {...props} items={segments.after} />
  </div>;
}

function CompactToolSegment({ items, delegateItems, delegationStatuses, delegationTimings, isLast, isActive, activeStatusLabel }: Props) {
  const search = useContext(TranscriptSearchContext);
  const reveal = search && items.some((item) => item.message.id === search.messageId)
    ? search.requestId : undefined;
  const disclosure = useAutomaticDisclosure(false, reveal,
    disclosureKey("compact-delegate-tools", items[0]?.message.id ?? ""));
  if (!items.length) return null;
  return <ProcessActivityGroup items={items} compact active={isActive} activeStatusLabel={activeStatusLabel} disclosure={disclosure}>
    <ActivityItems items={items} compact isLast={isLast} isActive={isActive} live={isActive}
      delegateItems={delegateItems} delegationStatuses={delegationStatuses} delegationTimings={delegationTimings}
      onUserInteraction={disclosure.claim} />
  </ProcessActivityGroup>;
}
