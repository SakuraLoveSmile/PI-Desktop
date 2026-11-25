import { type MessageUsage, type UiMessage } from "@pi-desktop/shared";
import { ContextUsageInspector } from "../../../components/ContextUsageInspector";
import { useAppStore } from "../../../stores/app-store";
import { useSessionUsageTotals } from "./use-session-usage-totals";

export type ComposerUsageFooterProps = {
  usage: MessageUsage;
  turnUsage: MessageUsage;
  contextWindow: number;
  tools: UiMessage[];
  responseDurationMs?: number;
  responseOutputTokens?: number;
  responseOutputEstimated?: boolean;
};

/**
 * The context entry at the right end of the workspace strip (the file kept its
 * old footer name): the meter, the percentage and the session token total, with
 * every other figure one click away in the popover.
 */
export function ComposerUsageFooter(props: ComposerUsageFooterProps) {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const totals = useSessionUsageTotals(sessionId ?? undefined);
  return <ContextUsageInspector {...props} variant="footer" sessionTotals={totals} />;
}
