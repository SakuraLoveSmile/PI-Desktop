import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextInsightsRequest, ContextInsightsEvent } from "@pi-desktop/shared";
import { Button, Panel, SegmentedControl } from "../../components/ui";
import { categories, count, duration, money, requestActual, trendRequests } from "./model";
import type { ContextInsightsPreferences } from "./preferences";

export function ContextComposition({ request }: { request: ContextInsightsRequest }) {
  const { t } = useTranslation();
  const total = request.entries.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  const actual = requestActual(request.usage);
  const occupancy = actual === undefined ? request.estimatedTokens : actual;
  return (
    <Panel className="ci-card">
      <h3>{t("contextInsights.currentContext")}</h3>
      <div className="ci-big-number">
        {count(occupancy)}{" "}
        <span>
          {t(actual === undefined ? "contextInsights.estimated" : "contextInsights.actual")}
        </span>
      </div>
      <div className="ci-muted">
        {request.contextWindow > 0
          ? `${Math.min(999, (100 * occupancy) / request.contextWindow).toFixed(1)}% · ${t("contextInsights.window")} ${count(request.contextWindow)}`
          : t("contextInsights.noWindow")}
      </div>
      <div className="ci-composition" role="img" aria-label={t("contextInsights.composition")}>
        {categories.map((category) => {
          const tokens = request.entries
            .filter((entry) => entry.category === category)
            .reduce((sum, entry) => sum + entry.estimatedTokens, 0);
          return tokens > 0 ? (
            <span
              key={category}
              data-category={category}
              style={{ flexGrow: tokens / Math.max(1, total) }}
              title={`${t(`contextInsights.${category}`)} ≈${count(tokens)}`}
            />
          ) : null;
        })}
      </div>
      <div className="ci-legend">
        {categories.map((category) => {
          const tokens = request.entries
            .filter((entry) => entry.category === category)
            .reduce((sum, entry) => sum + entry.estimatedTokens, 0);
          return (
            <span key={category}>
              <i data-category={category} />
              {t(`contextInsights.${category}`)} <strong>≈{count(tokens)}</strong>
            </span>
          );
        })}
      </div>
      {request.contextWindow > 0 && (
        <div className="ci-muted">
          {t("contextInsights.free")}: {count(Math.max(0, request.contextWindow - occupancy))}
        </div>
      )}
    </Panel>
  );
}

export function ContextTrend({
  requests,
  events,
  preferences,
  onPreferences,
  pinnedId,
  onPin,
  onPreview,
}: {
  requests: ContextInsightsRequest[];
  events: ContextInsightsEvent[];
  preferences: ContextInsightsPreferences;
  onPreferences: (patch: Partial<ContextInsightsPreferences>) => void;
  pinnedId: string | null;
  onPin: (id: string | null) => void;
  onPreview: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const visible = trendRequests(requests, preferences.granularity);
  const heights = visible.map((request, index) =>
    preferences.measure === "delta"
      ? request.estimatedTokens - (visible[index - 1]?.estimatedTokens ?? 0)
      : request.estimatedTokens,
  );
  const max = Math.max(1, ...heights.map(Math.abs));
  const selected =
    requests.find((request) => request.id === (hoveredId ?? pinnedId)) ?? requests.at(-1);
  const preview = (id: string | null) => {
    setHoveredId(id);
    onPreview(id);
  };
  return (
    <Panel className="ci-card ci-trend">
      <div className="ci-heading">
        <h3>{t("contextInsights.trend")}</h3>
        <Button size="sm" variant="ghost" onClick={() => onPin(null)}>
          {t("contextInsights.unpin")}
        </Button>
      </div>
      <div className="ci-controls">
        <SegmentedControl
          label={t("contextInsights.granularity")}
          value={preferences.granularity}
          onChange={(granularity) => onPreferences({ granularity })}
          options={[
            { value: "step", label: t("contextInsights.step") },
            { value: "turn", label: t("contextInsights.turn") },
          ]}
        />
        <SegmentedControl
          label={t("contextInsights.measure")}
          value={preferences.measure}
          onChange={(measure) => onPreferences({ measure })}
          options={[
            { value: "total", label: t("contextInsights.total") },
            { value: "delta", label: t("contextInsights.delta") },
          ]}
        />
      </div>
      <div className="ci-chart-scroll" onPointerLeave={() => preview(null)}>
        <div className={`ci-trend-bars ${preferences.measure === "delta" ? "ci-delta" : ""}`}>
          {visible.map((request, index) => {
            const value = heights[index];
            const hasEvent = events.some(
              (event) =>
                event.requestId === request.id ||
                (event.at >= (visible[index - 1]?.startedAt ?? 0) && event.at <= request.startedAt),
            );
            return (
              <div key={request.id} className="ci-trend-column">
                <Button
                  className={`ci-trend-bar ${value < 0 ? "ci-negative" : ""}`}
                  variant="ghost"
                  aria-label={t("contextInsights.pin", { step: request.step })}
                  aria-pressed={pinnedId === request.id}
                  onPointerEnter={() => preview(request.id)}
                  onFocus={() => preview(request.id)}
                  onBlur={() => preview(null)}
                  onClick={() => onPin(pinnedId === request.id ? null : request.id)}
                  style={{ height: `${Math.max(4, (96 * Math.abs(value)) / max)}px` }}
                  title={`${t("contextInsights.step")} ${request.step}: ${value >= 0 ? "+" : ""}${count(value)}`}
                >
                  {preferences.measure === "total" && (
                    <span className="ci-trend-stack" aria-hidden="true">
                      {categories.map((category) => {
                        const tokens = request.entries
                          .filter((entry) => entry.category === category)
                          .reduce((sum, entry) => sum + entry.estimatedTokens, 0);
                        return tokens > 0 ? (
                          <span
                            key={category}
                            data-category={category}
                            style={{ flexGrow: tokens }}
                          />
                        ) : null;
                      })}
                    </span>
                  )}
                  {hasEvent ? (
                    <span className="ci-event-mark" aria-hidden="true">
                      •
                    </span>
                  ) : null}
                </Button>
                <span>{request.step}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="ci-muted">{t("contextInsights.trendProjection")}</p>
      {selected && (
        <div className="ci-request-brief" aria-live="polite">
          <strong>
            {t(hoveredId ? "contextInsights.hover" : "contextInsights.selected")} ·{" "}
            {t("contextInsights.requestLabel", { step: selected.step, model: selected.modelId })}
            {selected.agentName ? ` · ${selected.agentName}` : ""}
          </strong>
          <dl className="ci-values">
            <div>
              <dt>{t("contextInsights.estimated")}</dt>
              <dd>≈{count(selected.estimatedTokens)}</dd>
            </div>
            <div>
              <dt>{t("contextInsights.actual")}</dt>
              <dd>{selected.usage ? count(requestActual(selected.usage) ?? 0) : "—"}</dd>
            </div>
            <div>
              <dt>{t("contextInsights.output")}</dt>
              <dd>{selected.usage ? count(selected.usage.outputTokens) : "—"}</dd>
            </div>
            <div>
              <dt>{t("contextInsights.cacheRead")}</dt>
              <dd>{selected.usage ? count(selected.usage.cacheReadTokens ?? 0) : "—"}</dd>
            </div>
            <div>
              <dt>{t("contextInsights.requestDuration")}</dt>
              <dd>{duration(selected.durationMs)}</dd>
            </div>
            <div>
              <dt>{t("contextInsights.cost")}</dt>
              <dd>
                {money(
                  selected.usage?.costStatus !== "unknown"
                    ? selected.usage?.cost?.total
                    : undefined,
                )}
              </dd>
            </div>
          </dl>
          {!selected.usage && <p className="ci-muted">{t("contextInsights.noActual")}</p>}
          <dl className="ci-values">
            <div>
              <dt>{t("contextInsights.httpStatus")}</dt>
              <dd>{selected.providerStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("contextInsights.requestBytes")}</dt>
              <dd>{selected.requestBytes === undefined ? "—" : count(selected.requestBytes)}</dd>
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}
