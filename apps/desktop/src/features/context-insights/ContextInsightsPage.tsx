import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ContextInsightsSnapshot,
  SessionSummary,
  TokenUsageHistoryResult,
} from "@pi-desktop/shared";
import { Button, Input, Panel, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { toolWorkPanelTab } from "../../lib/work-panel-tabs";
import { count, money, usageTotals } from "./model";
import { readOverviewSnapshots } from "./service";
import {
  contextDay as isoDay,
  contextDayRange,
  recentContextDays,
  filterOverviewSessions,
} from "./overview-model";

const PAGE_SIZE = 40;
const DAY = 86_400_000;

export function ContextInsightsPage() {
  const { t } = useTranslation();
  const selectSession = useAppStore((state) => state.selectSession);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [snapshots, setSnapshots] = useState<ContextInsightsSnapshot[]>([]);
  const [daySnapshots, setDaySnapshots] = useState<ContextInsightsSnapshot[]>([]);
  const [dayScanning, setDayScanning] = useState(false);
  const [history, setHistory] = useState<TokenUsageHistoryResult | null>(null);
  const [rangeHistory, setRangeHistory] = useState<TokenUsageHistoryResult | null>(null);
  const [range, setRange] = useState("7");
  const [day, setDay] = useState(isoDay(Date.now()));
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(false);
    void Promise.all([
      api.listSessions(),
      api.getTokenUsageHistory({
        startDate: Date.now() - 56 * DAY,
        endDate: Date.now(),
        bucket: "day",
      }),
    ])
      .then(([catalog, usage]) => {
        if (disposed) return;
        setSessions(catalog.sessions);
        setHistory(usage);
      })
      .catch(() => {
        if (!disposed) setError(true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    setRangeHistory(null);
    const selectedDay = contextDayRange(day);
    const startDate =
      range === "all"
        ? 0
        : range === "day"
          ? (selectedDay?.startDate ?? Number.NaN)
          : Date.now() - Number(range) * DAY;
    if (!Number.isFinite(startDate)) return;
    const endDate = range === "day" ? selectedDay?.endDate : Date.now();
    void api
      .getTokenUsageHistory({ startDate, endDate, bucket: "day" })
      .then((data) => {
        if (!disposed) setRangeHistory(data);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
    };
  }, [day, range, refresh]);
  const filtered = useMemo(
    () =>
      filterOverviewSessions(
        sessions,
        { project, query, range, day, now: Date.now() },
        daySnapshots,
      ).sort((a, b) =>
        sort === "name"
          ? a.title.localeCompare(b.title)
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [day, daySnapshots, project, query, range, sessions, sort],
  );
  useEffect(() => {
    if (range !== "day") return;
    const controller = new AbortController();
    setDayScanning(true);
    setDaySnapshots([]);
    void readOverviewSnapshots(sessions, controller.signal, setDaySnapshots)
      .catch(() => {
        if (!controller.signal.aborted) setMetadataError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDayScanning(false);
      });
    return () => controller.abort();
  }, [sessions, range, refresh]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageSessions = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filtered, safePage],
  );
  useEffect(() => {
    const controller = new AbortController();
    setSnapshots([]);
    setMetadataError(false);
    if (range === "day") {
      setSnapshots(
        daySnapshots.filter((snapshot) =>
          pageSessions.some((session) => session.id === snapshot.sessionId),
        ),
      );
      return () => controller.abort();
    }
    void readOverviewSnapshots(pageSessions, controller.signal, setSnapshots).catch(() => {
      if (!controller.signal.aborted) setMetadataError(true);
    });
    return () => controller.abort();
  }, [daySnapshots, pageSessions, range, refresh]);
  const projects = [
    ...new Set(
      sessions
        .map((session) => session.projectPath)
        .filter((path): path is string => Boolean(path)),
    ),
  ].sort();
  const days = recentContextDays(Date.now(), 56);
  const usageByDay = new Map(history?.items.map((item) => [item.date.slice(0, 10), item]) ?? []);
  const maxTokens = Math.max(1, ...[...usageByDay.values()].map((item) => item.totalTokens));
  const costByDay = new Map<string, number>();
  for (const snapshot of snapshots)
    for (const request of snapshot.requests) {
      const cost = request.usage?.cost?.total;
      if (cost !== undefined && request.usage?.costStatus !== "unknown")
        costByDay.set(
          isoDay(request.startedAt),
          (costByDay.get(isoDay(request.startedAt)) ?? 0) + cost,
        );
    }
  const costMax = Math.max(0.000001, ...costByDay.values());
  const captures = new Map(snapshots.map((snapshot) => [snapshot.sessionId, snapshot]));
  const displayedSessions = [...pageSessions]
    .filter((session) => {
      const captured = captures.get(session.id)?.requests;
      if (!captured?.length || range === "all") return true;
      return captured.some((request) =>
        range === "day"
          ? isoDay(request.startedAt) === day
          : request.startedAt >= Date.now() - Number(range) * DAY,
      );
    })
    .sort((a, b) =>
      sort === "tokens"
        ? usageTotals(captures.get(b.id)?.requests ?? []).tokens -
          usageTotals(captures.get(a.id)?.requests ?? []).tokens
        : sort === "context"
          ? (captures.get(b.id)?.requests.at(-1)?.estimatedTokens ?? 0) -
            (captures.get(a.id)?.requests.at(-1)?.estimatedTokens ?? 0)
          : 0,
    );
  const open = (session: SessionSummary) => {
    void selectSession(session.id).then(() => {
      if (useAppStore.getState().activeSessionId === session.id)
        useAppStore.getState().openWorkPanelTabForSession(session.id, toolWorkPanelTab("context"));
    });
  };
  return (
    <div className="route-scroll">
      <main
        className="page-frame context-insights ci-overview"
        aria-label={t("contextInsights.title")}
      >
        <div className="ci-heading">
          <div>
            <h1>{t("contextInsights.title")}</h1>
            <p className="ci-muted">{t("contextInsights.overview")}</p>
          </div>
          <Button onClick={() => setRefresh((value) => value + 1)}>
            {t("contextInsights.refresh")}
          </Button>
        </div>
        <div className="ci-controls">
          <Input
            aria-label={t("contextInsights.searchSessions")}
            placeholder={t("contextInsights.searchSessions")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          <Select
            aria-label={t("contextInsights.range")}
            value={range}
            onChange={(event) => {
              setRange(event.target.value);
              setPage(0);
            }}
          >
            {[
              ["7", "sevenDays"],
              ["30", "thirtyDays"],
              ["all", "allTime"],
              ["day", "day"],
            ].map(([value, key]) => (
              <option key={value} value={value}>
                {t(`contextInsights.${key}`)}
              </option>
            ))}
          </Select>
          {range === "day" && (
            <Input
              aria-label={t("contextInsights.day")}
              type="date"
              value={day}
              onChange={(event) => {
                setDay(event.target.value);
                setPage(0);
              }}
            />
          )}
          <Select
            aria-label={t("contextInsights.project")}
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("contextInsights.allProjects")}</option>
            {projects.map((path) => (
              <option key={path} value={path}>
                {sessions.find((session) => session.projectPath === path)?.projectName || path}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("contextInsights.sessionSort")}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="updated">{t("contextInsights.updated")}</option>
            <option value="name">{t("contextInsights.name")}</option>
            <option value="tokens">{t("contextInsights.sampleTokens")}</option>
            <option value="context">{t("contextInsights.sampleContext")}</option>
          </Select>
        </div>
        {error && (
          <p role="alert" className="ci-note">
            {t("contextInsights.error")}
          </p>
        )}
        {loading ? (
          <p role="status">{t("contextInsights.loading")}</p>
        ) : (
          <>
            <p className="ci-note">{t("contextInsights.overviewNote")}</p>
            <p className="ci-muted">{t("contextInsights.globalUsage")}</p>
            <div className="ci-stats-grid">
              {[
                ["tokens", rangeHistory?.totals.totalTokens],
                ["input", rangeHistory?.totals.inputTokens],
                ["output", rangeHistory?.totals.outputTokens],
                ["turns", rangeHistory?.totals.turnCount],
              ].map(([key, value]) => (
                <Panel key={key} className="ci-card">
                  <span className="ci-muted">{t(`contextInsights.${key}`)}</span>
                  <div className="ci-big-number">
                    {typeof value === "number" ? count(value) : "—"}
                  </div>
                </Panel>
              ))}
            </div>
            <div className="ci-overview-charts">
              <Panel className="ci-card">
                <h3>{t("contextInsights.daily")}</h3>
                <div className="ci-daily-chart">
                  {days.slice(-7).map((date) => (
                    <div key={date} className="ci-daily-column">
                      <div className="ci-daily-bars">
                        <span
                          role="img"
                          aria-label={t("contextInsights.dailyTokens", {
                            date,
                            tokens: count(usageByDay.get(date)?.totalTokens ?? 0),
                          })}
                          title={t("contextInsights.dailyTokens", {
                            date,
                            tokens: count(usageByDay.get(date)?.totalTokens ?? 0),
                          })}
                          style={{
                            height: `${Math.max(2, (100 * (usageByDay.get(date)?.totalTokens ?? 0)) / maxTokens)}px`,
                          }}
                        />
                        <span
                          className="ci-cost-bar"
                          role="img"
                          aria-label={t("contextInsights.dailyCost", {
                            date,
                            cost: money(costByDay.get(date)),
                          })}
                          title={t("contextInsights.dailyCost", {
                            date,
                            cost: money(costByDay.get(date)),
                          })}
                          style={{
                            height: `${costByDay.has(date) ? Math.max(2, (100 * (costByDay.get(date) ?? 0)) / costMax) : 0}px`,
                          }}
                        />
                      </div>
                      <small>{date.slice(5)}</small>
                    </div>
                  ))}
                </div>
                <div className="ci-legend">
                  <span>
                    <i data-category="user" />
                    {t("contextInsights.tokens")}
                  </span>
                  <span>
                    <i data-category="skill" />
                    {t("contextInsights.estimatedCost")} ·{" "}
                    {t("contextInsights.showing", { count: pageSessions.length })}
                  </span>
                </div>
              </Panel>
              <Panel className="ci-card">
                <h3>{t("contextInsights.activity")}</h3>
                <div className="ci-heatmap">
                  {days.map((date) => {
                    const tokens = usageByDay.get(date)?.totalTokens ?? 0;
                    return (
                      <Button
                        key={date}
                        variant="ghost"
                        data-level={
                          tokens === 0
                            ? 0
                            : Math.min(4, Math.max(1, Math.ceil((4 * tokens) / maxTokens)))
                        }
                        title={t("contextInsights.dailyTokens", { date, tokens: count(tokens) })}
                        aria-label={t("contextInsights.dailyTokens", {
                          date,
                          tokens: count(tokens),
                        })}
                        onClick={() => {
                          setDay(date);
                          setRange("day");
                          setPage(0);
                        }}
                      />
                    );
                  })}
                </div>
              </Panel>
            </div>
            {metadataError && (
              <p className="ci-note" role="alert">
                {t("contextInsights.metadataError")}
              </p>
            )}
            {range === "day" && <p className="ci-muted">{t("contextInsights.daySampleNote")}</p>}
            {dayScanning && range === "day" ? (
              <p role="status">{t("contextInsights.loading")}</p>
            ) : (
              !filtered.length && <p>{t("contextInsights.noSessions")}</p>
            )}
            <div className="ci-session-grid">
              {displayedSessions.map((session) => {
                const snapshot = captures.get(session.id);
                const totals = usageTotals(snapshot?.requests ?? []);
                const latest = snapshot?.requests.at(-1);
                return (
                  <Panel key={session.id} className="ci-card ci-session-card">
                    <Button
                      variant="ghost"
                      className="ci-session-title"
                      aria-label={t("contextInsights.openSession", { title: session.title })}
                      onClick={() => open(session)}
                    >
                      {session.title}
                    </Button>
                    <span className="ci-muted ci-path">
                      {session.projectName || session.projectPath || "—"}
                    </span>
                    <div className="ci-card-meta">
                      <span>{t("contextInsights.messages", { count: session.messageCount })}</span>
                      <span>
                        {snapshot
                          ? t("contextInsights.recordedRequests", {
                              count: snapshot.requests.length,
                            })
                          : "—"}
                      </span>
                      <span>
                        {totals.costReports
                          ? money(totals.cost)
                          : t("contextInsights.costUnavailable")}
                      </span>
                    </div>
                    {latest && (
                      <>
                        <div className="ci-muted">
                          {t("contextInsights.estimated")}: ≈{count(latest.estimatedTokens)} /{" "}
                          {latest.contextWindow > 0 ? count(latest.contextWindow) : "—"}
                        </div>
                        <div
                          className="ci-composition"
                          role="img"
                          aria-label={t("contextInsights.composition")}
                        >
                          {latest.entries.map((entry) => (
                            <span
                              key={entry.id}
                              data-category={entry.category}
                              style={{ flexGrow: Math.max(1, entry.estimatedTokens) }}
                              title={`${entry.label}: ≈${count(entry.estimatedTokens)}`}
                            />
                          ))}
                        </div>
                        <span className="ci-muted">{t("contextInsights.retained")}</span>
                      </>
                    )}
                    <time className="ci-muted">{new Date(session.updatedAt).toLocaleString()}</time>
                  </Panel>
                );
              })}
            </div>
            <div className="ci-pagination">
              <Button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                {t("contextInsights.previous")}
              </Button>
              <span>{t("contextInsights.page", { page: safePage + 1, pages })}</span>
              <Button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>
                {t("contextInsights.next")}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
