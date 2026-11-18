import { useTranslation } from "react-i18next";
import { formatCompactTokenCount } from "@pi-desktop/shared";
import type { ContextBucket, ContextComposition } from "../../context-insights/composition";

const LABEL_KEY: Record<ContextBucket, string> = {
  system: "chat.usageBucketSystem",
  tools: "chat.usageBucketTools",
  messages: "chat.usageBucketMessages",
};

const ROWS: ContextBucket[] = ["system", "tools", "messages"];

/**
 * Composition of the newest request: one bar whose filled length is the
 * provider-reported occupancy, and a fixed three-row legend so the panel does
 * not resize as categories appear and disappear between requests.
 */
export function ContextCompositionSection({
  composition,
  usedPercent,
  meterLabel,
}: {
  composition: ContextComposition;
  usedPercent: number;
  meterLabel: string;
}) {
  const { t } = useTranslation();
  const tokensOf = new Map(composition.segments.map((segment) => [segment.bucket, segment.tokens]));

  return (
    <div className="context-inspector-composition">
      <span
        className="context-inspector-composition-track"
        role="progressbar"
        aria-label={meterLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usedPercent}
      >
        {composition.segments.map((segment) => (
          <span
            key={segment.bucket}
            className="context-inspector-composition-segment"
            data-bucket={segment.bucket}
            style={{ width: `${segment.percent}%` }}
          />
        ))}
      </span>
      <ul className="context-inspector-legend">
        {ROWS.map((bucket) => (
          <li key={bucket} className="context-inspector-legend-row">
            <i className="context-inspector-legend-swatch" data-bucket={bucket} aria-hidden="true" />
            <span className="context-inspector-legend-label">{t(LABEL_KEY[bucket])}</span>
            <strong className="context-inspector-legend-value">
              ~{formatCompactTokenCount(tokensOf.get(bucket) ?? 0)}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}