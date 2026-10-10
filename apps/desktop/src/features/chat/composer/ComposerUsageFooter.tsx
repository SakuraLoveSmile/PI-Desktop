import { type MessageUsage, type UiMessage } from "@pi-desktop/shared";
import { ContextUsageInspector } from "../../../components/ContextUsageInspector";

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
  return <div className="composer-usage-footer">
    <ContextUsageInspector {...props} variant="footer" />
  </div>;
}
