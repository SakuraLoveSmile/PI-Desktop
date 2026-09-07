import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { TokenUsageHistoryResult, TokenUsageBucket } from "@pi-desktop/shared";
import { Button, Badge } from "../ui";
import { IconActivity, IconRefreshCw } from "../icons";

export function TokenUsagePage() {
  const { t } = useTranslation();
  const [bucket, setBucket] = useState<TokenUsageBucket>("day");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TokenUsageHistoryResult | null>(null);
  const [hoveredItem, setHoveredItem] = useState<{
    date: string;
    total: number;
    input: number;
    output: number;
    turns: number;
  } | null>(null);

  const fetchHistory = async (b: TokenUsageBucket) => {
    setLoading(true);
    try {
      const res = await api.getTokenUsageHistory({ bucket: b });
      setData(res);
    } catch (e) {
      console.error("Failed to load token usage history", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(bucket);
  }, [bucket]);

  const maxTokens = useMemo(() => {
    if (!data || !data.items.length) return 1;
    return Math.max(...data.items.map((i) => i.totalTokens), 1);
  }, [data]);

  // Color gradient for heat map
  const getCellColor = (val: number, max: number) => {
    if (val <= 0) return "var(--color-bg-subtle, rgba(125, 125, 125, 0.1))";
    const ratio = Math.min(val / max, 1);
    if (ratio < 0.25) return "rgba(16, 185, 129, 0.3)";
    if (ratio < 0.5) return "rgba(16, 185, 129, 0.55)";
    if (ratio < 0.75) return "rgba(16, 185, 129, 0.8)";
    return "rgba(16, 185, 129, 1)";
  };

  const totals = data?.totals ?? {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    turnCount: 0,
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header with KPI cards */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-[var(--color-fg-default)]">
            {t("settings.usage", "Token Usage & Heatmap")}
          </h2>
          <p className="text-xs text-[var(--color-fg-muted)] mt-1">
            {t("settings.usageSubtitle", "View cumulative tokens consumed by main turns and subagents over time.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--color-border-subtle)] p-0.5 bg-[var(--color-bg-subtle)]">
            {(["day", "week", "month"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  bucket === b
                    ? "bg-[var(--color-bg-default)] text-[var(--color-fg-default)] shadow-xs"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]"
                }`}
              >
                {b === "day" ? "Day" : b === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchHistory(bucket)}
            disabled={loading}
          >
            <IconRefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="text-[11px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wider">
            Total Tokens
          </div>
          <div className="text-xl font-semibold mt-1 text-[var(--color-fg-default)]">
            {totals.totalTokens.toLocaleString()}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
            Main & Subagents
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="text-[11px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wider">
            Prompt / In
          </div>
          <div className="text-xl font-semibold mt-1 text-[var(--color-fg-default)]">
            {totals.inputTokens.toLocaleString()}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
            Input Tokens
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="text-[11px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wider">
            Completion / Out
          </div>
          <div className="text-xl font-semibold mt-1 text-[var(--color-fg-default)]">
            {totals.outputTokens.toLocaleString()}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
            Output Tokens
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="text-[11px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wider">
            Total Turns
          </div>
          <div className="text-xl font-semibold mt-1 text-[var(--color-fg-default)]">
            {totals.turnCount.toLocaleString()}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
            Interaction Rounds
          </div>
        </div>
      </div>

      {/* Heatmap Container */}
      <div className="p-5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-default)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <IconActivity className="text-emerald-500" />
            <span className="text-sm font-medium text-[var(--color-fg-default)]">
              Activity Heatmap ({bucket})
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
            <span>Less</span>
            <div className="w-3 h-3 rounded-xs bg-[var(--color-bg-subtle)]" />
            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: "rgba(16, 185, 129, 0.3)" }} />
            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: "rgba(16, 185, 129, 0.55)" }} />
            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: "rgba(16, 185, 129, 0.8)" }} />
            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: "rgba(16, 185, 129, 1)" }} />
            <span>More</span>
          </div>
        </div>

        {data && data.items.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-[var(--color-bg-subtle)]/30 border border-[var(--color-border-subtle)]">
              {data.items.map((item) => {
                const color = getCellColor(item.totalTokens, maxTokens);
                return (
                  <div
                    key={item.date}
                    className="w-5 h-5 rounded-xs cursor-pointer transition-transform hover:scale-125 relative group"
                    style={{ backgroundColor: color }}
                    onMouseEnter={() =>
                      setHoveredItem({
                        date: item.date,
                        total: item.totalTokens,
                        input: item.inputTokens,
                        output: item.outputTokens,
                        turns: item.turnCount,
                      })
                    }
                    onMouseLeave={() => setHoveredItem(null)}
                  />
                );
              })}
            </div>

            {hoveredItem ? (
              <div className="p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] text-xs flex items-center justify-between">
                <div>
                  <span className="font-semibold text-[var(--color-fg-default)] mr-2">
                    {hoveredItem.date}
                  </span>
                  <span className="text-[var(--color-fg-muted)]">
                    Turns: {hoveredItem.turns}
                  </span>
                </div>
                <div className="flex gap-4">
                  <span>Input: <b>{hoveredItem.input.toLocaleString()}</b></span>
                  <span>Output: <b>{hoveredItem.output.toLocaleString()}</b></span>
                  <span className="text-emerald-500 font-medium">
                    Total: {hoveredItem.total.toLocaleString()} tokens
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--color-fg-muted)] italic">
                Hover over a cell to view detail breakdown.
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-[var(--color-fg-muted)]">
            No token usage records found for this period.
          </div>
        )}
      </div>
    </div>
  );
}
