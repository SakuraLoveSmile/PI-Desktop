import { useTranslation } from "react-i18next";
import {
  formatCompactTokenCount,
  type MessageUsage,
  type UiMessage,
} from "@pi-desktop/shared";
import { useAppStore } from "../../../stores/app-store";
import { resolveComposerUsageFooterMetrics } from "../../../lib/context-usage";
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

export function ComposerUsageFooter({
  usage,
  turnUsage,
  contextWindow,
  tools,
  responseDurationMs,
  responseOutputTokens,
  responseOutputEstimated = false,
}: ComposerUsageFooterProps) {
  const { t } = useTranslation();
  const contextUsageDisplay = useAppStore((state) =>
    state.settings?.contextUsageDisplay,
  );

  const metrics = resolveComposerUsageFooterMetrics({
    usage,
    turnUsage,
    contextWindow,
    responseDurationMs,
    responseOutputTokens,
    responseOutputEstimated,
    contextUsageDisplay,
  });

  const speedText =
    metrics.outputSpeed !== undefined
      ? `${metrics.outputSpeed.estimated ? "~" : ""}${metrics.outputSpeed.rate} tok/s`
      : t("chat.usageThroughputUnavailable");

  const speedAria =
    metrics.outputSpeed !== undefined
      ? metrics.outputSpeed.estimated
        ? t("chat.usageThroughputEstimated", {
            count: formatCompactTokenCount(metrics.outputSpeed.rate),
          })
        : t("chat.usageThroughput", {
            count: formatCompactTokenCount(metrics.outputSpeed.rate),
          })
      : t("chat.usageThroughputUnavailableLabel");

  const turnTotalText =
    metrics.turnTotal !== undefined
      ? formatCompactTokenCount(metrics.turnTotal)
      : t("chat.usageThroughputUnavailable");

  const turnTotalAria =
    metrics.turnTotal !== undefined
      ? `${t("chat.usageTurnTotal")}: ${formatCompactTokenCount(metrics.turnTotal)}`
      : t("chat.usageTurnTotalUnavailableLabel");

  const cacheRateText =
    metrics.cacheHitRate !== undefined
      ? `${metrics.cacheHitRate}%`
      : t("chat.usageThroughputUnavailable");

  const cacheRateAria =
    metrics.cacheHitRate !== undefined
      ? `${t("chat.usageCacheRate")}: ${metrics.cacheHitRate}%`
      : t("chat.usageCacheRateUnavailableLabel");

  return (
    <div
      className="composer-usage-footer"
      role="status"
      aria-label={t("chat.usageFooterLabel")}
    >
      <div className="composer-usage-item composer-usage-speed">
        <span className="composer-usage-label">
          {t("chat.usageThroughputLabel")}
        </span>
        <span className="composer-usage-value" aria-label={speedAria}>
          {speedText}
        </span>
      </div>

      <div className="composer-usage-item composer-usage-total">
        <span className="composer-usage-label">
          {t("chat.usageTurnTotal")}
        </span>
        <span className="composer-usage-value" aria-label={turnTotalAria}>
          {turnTotalText}
        </span>
      </div>

      <div className="composer-usage-item composer-usage-cache">
        <span className="composer-usage-label">
          {t("chat.usageCacheRate")}
        </span>
        <span className="composer-usage-value" aria-label={cacheRateAria}>
          {cacheRateText}
        </span>
      </div>

      <ContextUsageInspector
        usage={usage}
        turnUsage={turnUsage}
        contextWindow={contextWindow}
        tools={tools}
        responseDurationMs={responseDurationMs}
        responseOutputTokens={responseOutputTokens}
        responseOutputEstimated={responseOutputEstimated}
        variant="footer"
      />
    </div>
  );
}
