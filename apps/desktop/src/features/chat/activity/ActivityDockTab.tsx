import { useTranscriptView } from "../../../hooks/use-transcript-view";
import { SessionActivity } from "./SessionActivity";

/**
 * The session summary as a work panel tab, for the chat widths where the rail cannot sit beside the transcript.
 * It renders the same rail the inline pane does, so the two placements cannot drift apart.
 */
export function ActivityDockTab({ sessionId }: { sessionId: string }) {
  const transcript = useTranscriptView(sessionId);
  return <div className="activity-dock-tab">
    <SessionActivity sessionId={sessionId} messages={transcript.messages} visible
      rangeLimited={transcript.hasMoreBefore || transcript.hasMoreAfter || transcript.historical} />
  </div>;
}
