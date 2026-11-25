import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatCompactTokenCount, type SessionUsageTotals } from "@pi-desktop/shared";
import { calculateCacheRate } from "../../../lib/context-usage";

/** The spoken sentence for the session token total, shared by the strip trigger and its popover row. */
export function sessionTokensAria(t: TFunction, totals: SessionUsageTotals): string {
  const cache = calculateCacheRate(totals.inputTokens, totals.cacheReadTokens);
  return t("chat.usageSessionTokensAria", {
    tokens: formatCompactTokenCount(totals.totalTokens),
    cache: cache === undefined ? t("chat.usageThroughputUnavailable") : `${cache}%`,
  });
}

function RoundsGlyph() {
  return (
    <svg className="context-inspector-session-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.4 11.8a6 6 0 1 1 11.2 0" />
      <path d="M8 11.6 10.9 6.9" />
    </svg>
  );
}

function LedgerGlyph() {
  return (
    <svg className="context-inspector-session-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </svg>
  );
}

/**
 * Session-cumulative read-outs inside the usage popover. The figures describe
 * the whole session, while the meter and breakdown above them describe the
 * newest request, so each row carries its own spoken sentence rather than one
 * shared label. Generation speed is not repeated here: it already has a cell in
 * the turn summary.
 */
export function ComposerUsageStats({
  totals,
}: {
  totals: SessionUsageTotals | undefined;
}) {
  const { t } = useTranslation();
  const unavailable = t("chat.usageThroughputUnavailable");
  const cacheHitRate = totals
    ? calculateCacheRate(totals.inputTokens, totals.cacheReadTokens)
    : undefined;
  const unavailableLabel = t("chat.usageSessionStatsUnavailable");

  return (
    <div className="context-inspector-session">
      <span className="context-inspector-label">{t("chat.usageSessionLabel")}</span>
      <div
        className="context-inspector-session-row"
        role="group"
        data-unavailable={totals ? "false" : "true"}
        aria-label={totals
          ? t("chat.usageSessionRoundsAria", { rounds: totals.rounds, steps: totals.steps })
          : unavailableLabel}
      >
        <RoundsGlyph />
        <b>{totals ? t("chat.usageSessionRounds", { count: totals.rounds }) : unavailable}</b>
        {totals ? (
          <>
            <span aria-hidden="true">·</span>
            <b>{t("chat.usageSessionSteps", { count: totals.steps })}</b>
          </>
        ) : null}
      </div>
      <div
        className="context-inspector-session-row"
        role="group"
        data-unavailable={totals ? "false" : "true"}
        aria-label={totals ? sessionTokensAria(t, totals) : unavailableLabel}
      >
        <LedgerGlyph />
        <b>
          {totals
            ? t("chat.usageSessionTokens", { count: formatCompactTokenCount(totals.totalTokens) })
            : unavailable}
        </b>
        <span aria-hidden="true">·</span>
        {cacheHitRate === undefined ? (
          <span>{t("chat.usageCacheRateUnavailableLabel")}</span>
        ) : (
          <>
            <span>{t("chat.usageCacheHitLabel")}</span>
            <b>{cacheHitRate}%</b>
          </>
        )}
      </div>
    </div>
  );
}
