import { type MessageUsage, type UiMessage } from "@pi-desktop/shared";
import { ContextUsageInspector } from "../../../components/ContextUsageInspector";
import { calculateTokenRate } from "../../../lib/context-usage";
import { useAppStore } from "../../../stores/app-store";
import { ComposerUsageStats } from "./ComposerUsageStats";
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

export function ComposerUsageFooter(props: ComposerUsageFooterProps) {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const totals = useSessionUsageTotals(sessionId ?? undefined);
  const throughput = calculateTokenRate(
    props.responseOutputTokens ?? props.turnUsage.outputTokens,
    props.responseDurationMs,
  );
  return <div className="composer-usage-footer">
    <ComposerUsageStats
      totals={totals}
      throughput={throughput}
      throughputEstimated={props.responseOutputEstimated}
    />
    <ContextUsageInspector {...props} variant="footer" />
  </div>;
}