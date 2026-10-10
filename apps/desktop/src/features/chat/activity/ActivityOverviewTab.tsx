import { useTranslation } from "react-i18next";
import { IconChevronLeft } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { useTranscriptView } from "../../../hooks/use-transcript-view";
import { overviewWorkPanelTab } from "../../../lib/work-panel-tabs";
import { useAppStore } from "../../../stores/app-store";
import { SessionActivity } from "./SessionActivity";

/** The same controls remain reachable when the chat cannot fit the inline rail. */
export function ActivityOverviewTab({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const transcript = useTranscriptView(sessionId);
  const open = useAppStore((state) => state.openWorkPanelTabForSession);
  return <div className="activity-overview-tab">
    <Button variant="ghost" size="sm" onClick={() => open(sessionId, overviewWorkPanelTab())}>
      <IconChevronLeft size={14} aria-hidden />{t("panel.tabs.overview")}
    </Button>
    <SessionActivity sessionId={sessionId} messages={transcript.messages} visible
      rangeLimited={transcript.hasMoreBefore || transcript.hasMoreAfter || transcript.historical} />
  </div>;
}
