import { toolWorkPanelTab, type WorkPanelTab } from "../../lib/work-panel-tabs";
import { readContextInsightsPreferences } from "../context-insights/preferences";
import { openContextInsightsDialog } from "./dialog-state";

/** The context dashboard opens where the person chose: a dialog, or a tab beside the conversation. */
export function openContextInsights(sessionId: string, openTab: (sessionId: string, tab: WorkPanelTab) => void): void {
  if (readContextInsightsPreferences().placement === "modal") openContextInsightsDialog(sessionId);
  else openTab(sessionId, toolWorkPanelTab("context"));
}
