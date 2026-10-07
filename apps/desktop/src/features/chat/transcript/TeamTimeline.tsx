import { Fragment, memo } from "react";
import { useTranslation } from "react-i18next";
import type { TeamTimelineSegment } from "../../../lib/team-timeline";
import { AssistantTurnParts, type PartContext } from "./AssistantTurnParts";
import { runActivityLabel } from "./ActivityGroup";
import { TeamDispatchCardsGroup } from "./TeamDispatchCard";

/** Preserve the existing part/card surfaces at their chronological anchors. */
export const TeamTimeline = memo(function TeamTimeline({ segments, tail, ...context }: PartContext & {
  segments: readonly TeamTimelineSegment[];
  tail: boolean;
}) {
  const { t } = useTranslation();
  const last = segments.at(-1);
  const runtimeTail = context.isActive && tail && last?.kind === "cards" &&
    !last.joining && context.runtimeActivity;
  return <>
    {segments.map(segment => <Fragment key={segment.key}>
      {segment.kind === "parts"
        ? <AssistantTurnParts parts={segment.parts} {...context} />
        : <TeamDispatchCardsGroup cards={segment.cards} joining={segment.joining} />}
    </Fragment>)}
    {runtimeTail ? <div className="team-timeline-runtime" role="status">
      {runActivityLabel(runtimeTail, t)}
    </div> : null}
  </>;
});
