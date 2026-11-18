import { useTranslation } from "react-i18next";
import { formatCompactTokenCount, type SessionUsageTotals } from "@pi-desktop/shared";

function RoundsGlyph() {
  return (
    <svg className="composer-usage-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.4 11.8a6 6 0 1 1 11.2 0" />
      <path d="M8 11.6 10.9 6.9" />
    </svg>
  );
}

function LedgerGlyph() {
  return (
    <svg className="composer-usage-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </svg>
  );
}

/**
 * Session-cumulative read-outs beside the context meter. The figures describe
 * the whole session, while the meter beside them describes the newest request,
 * so each group carries its own spoken sentence rather than one shared label.
 */
export function ComposerUsageStats({
  totals,
  throughput,
  throughputEstimated = false,
}: {
  totals: SessionUsageTotals | undefined;
  throughput: number | undefined;
  throughputEstimated?: boolean;
}) {
  const { t } = useTranslation();
  const unavailable = t("chat.usageThroughputUnavailable");
  const cacheHitRate = totals && totals.inputTokens + totals.cacheReadTokens > 0
    ? Math.round((totals.cacheReadTokens / (totals.inputTokens + totals.cacheReadTokens)) * 100)
    : undefined;
  const speed = throughput === undefined
    ? unavailable
    : t(
        throughputEstimated ? "chat.usageThroughputShortEstimated" : "chat.usageThroughputShort",
        { count: formatCompactTokenCount(throughput) },
      );

  return (
    <>
      <div
        className="composer-usage-item composer-usage-stat"
        role="group"
        data-unavailable={totals ? "false" : "true"}
        aria-label={totals
          ? t("chat.usageSessionActivityAria", {
              rounds: totals.rounds,
              steps: totals.steps,
              speed,
            })
          : t("chat.usageSessionStatsUnavailable")}
      >
        <RoundsGlyph />
        <span className="composer-usage-value">
          {totals ? t("chat.usageSessionRounds", { count: totals.rounds }) : unavailable}
        </span>
        {totals ? (
          <span className="composer-usage-value composer-usage-stat-detail">
            {t("chat.usageSessionSteps", { count: totals.steps })}
          </span>
        ) : null}
        <span className="composer-usage-sep" aria-hidden="true">·</span>
        <span className="composer-usage-value">{speed}</span>
      </div>
      <div
        className="composer-usage-item composer-usage-stat"
        role="group"
        data-unavailable={totals ? "false" : "true"}
        aria-label={totals
          ? t("chat.usageSessionTokensAria", {
              tokens: formatCompactTokenCount(totals.totalTokens),
              cache: cacheHitRate === undefined ? unavailable : `${cacheHitRate}%`,
            })
          : t("chat.usageSessionStatsUnavailable")}
      >
        <LedgerGlyph />
        <span className="composer-usage-value">
          {totals ? t("chat.usageSessionTokens", { count: formatCompactTokenCount(totals.totalTokens) }) : unavailable}
        </span>
        <span className="composer-usage-sep" aria-hidden="true">·</span>
        {cacheHitRate === undefined ? (
          <span className="composer-usage-label">{t("chat.usageCacheRateUnavailableLabel")}</span>
        ) : (
          <>
            <span className="composer-usage-label">{t("chat.usageCacheHitLabel")}</span>
            <span className="composer-usage-value">{cacheHitRate}%</span>
          </>
        )}
      </div>
    </>
  );
}