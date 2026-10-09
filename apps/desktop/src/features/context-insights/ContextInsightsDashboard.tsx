import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextInsightsRequest, ContextInsightsSnapshot } from "@pi-desktop/shared";
import { Button, Panel, Select } from "../../components/ui";
import { useAppStore } from "../../stores/app-store";
import { ContextBrowser } from "./ContextBrowser";
import { TranscriptActivity } from "./TranscriptActivity";
import { ContextComposition, ContextTrend } from "./ContextTrend";
import { ContextInsightsPreferencesPanel } from "./ContextInsightsPreferencesPanel";
import {
  capturedContentSignature,
  count,
  duration,
  hydrateCapturedRequest,
  money,
  relatedSessions,
  selectAgentRequests,
  usageTotals,
} from "./model";
import { useContextInsightsPreferences } from "./preferences";
import { observeContextInsights, readSelectedRequest } from "./service";

export function ContextInsightsDashboard({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  compact?: boolean;
}) {
  // A key owns all request selection/content state; switching sessions cannot
  // briefly render or navigate the previous session's captured file paths.
  return <SessionDashboard key={sessionId} sessionId={sessionId} compact={compact} />;
}

function SessionDashboard({ sessionId, compact }: { sessionId: string; compact: boolean }) {
  const { t } = useTranslation();
  const sessions = useAppStore((state) => state.sessions);
  const selectSession = useAppStore((state) => state.selectSession);
  const running = useAppStore((state) => state.runningSessions[sessionId]);
  const [compacting, setCompacting] = useState(false);
  const [snapshot, setSnapshot] = useState<ContextInsightsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, ContextInsightsRequest>>({});
  const [contentLoading, setContentLoading] = useState(false);
  const [missingContentKey, setMissingContentKey] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("main");
  const [selectedAgentName, setSelectedAgentName] = useState("");
  const [preferences, updatePreferences] = useContextInsightsPreferences();
  const dashboardRef = useRef<HTMLElement>(null);
  const observer = useRef<ReturnType<typeof observeContextInsights> | null>(null);
  useEffect(() => {
    observer.current = observeContextInsights(
      sessionId,
      (data) => {
        setSnapshot(data);
        setError(false);
      },
      () => setError(true),
    );
    return () => {
      observer.current?.dispose();
      observer.current = null;
    };
  }, [sessionId]);
  useEffect(() => {
    const retained = new Set(snapshot?.requests.map((request) => request.id) ?? []);
    setContent((previous) => {
      const entries = Object.entries(previous).filter(([id]) => retained.has(id));
      return entries.length === Object.keys(previous).length
        ? previous
        : Object.fromEntries(entries);
    });
  }, [snapshot]);
  const requests = selectAgentRequests(snapshot?.requests ?? [], agentFilter);
  const inspectAgent = (scope: string, name = "") => {
    setAgentFilter(scope);
    setSelectedAgentName(name);
    setPinnedId(null);
    setPreviewId(null);
    dashboardRef.current?.scrollTo({ top: 0 });
  };
  const capturedAgents = new Map(
    (snapshot?.requests ?? [])
      .filter((request) => request.parentToolCallId)
      .map((request) => [
        request.parentToolCallId!,
        request.agentName ?? t("contextInsights.member"),
      ]),
  );
  const selectedMetadata =
    requests.find((request) => request.id === (previewId ?? pinnedId)) ??
    requests
      .filter((request) => request.purpose !== "subagent" && request.purpose !== "compaction")
      .at(-1) ??
    requests.at(-1);
  const requestId = selectedMetadata?.id;
  const contentSignature = selectedMetadata ? capturedContentSignature(selectedMetadata) : "";
  const contentKey = `${requestId ?? ""}:${contentSignature}`;
  const selectedIndex = requests.findIndex((request) => request.id === requestId);
  const priorRequests = requests.slice(0, Math.max(0, selectedIndex));
  const baselineRequest =
    preferences.granularity === "turn"
      ? priorRequests
          .filter(
            (request) => !selectedMetadata?.turnId || request.turnId !== selectedMetadata.turnId,
          )
          .at(-1)
      : priorRequests.at(-1);
  useEffect(() => {
    const cached = selectedMetadata
      ? hydrateCapturedRequest(selectedMetadata, content[selectedMetadata.id])
      : undefined;
    if (!selectedMetadata || cached || contentKey === missingContentKey) {
      setContentLoading(false);
      return;
    }
    const controller = new AbortController();
    setContentLoading(true);
    void readSelectedRequest(sessionId, selectedMetadata, controller.signal)
      .then((request) => {
        if (controller.signal.aborted) return;
        if (request) setContent((previous) => ({ ...previous, [request.id]: request }));
        else setMissingContentKey(contentKey);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setMissingContentKey(contentKey);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setContentLoading(false);
      });
    return () => controller.abort();
  }, [content, contentKey, contentSignature, missingContentKey, requestId, sessionId]);
  const selectedContent = selectedMetadata
    ? hydrateCapturedRequest(selectedMetadata, content[selectedMetadata.id])
    : undefined;
  const totals = usageTotals(requests);
  const family = relatedSessions(sessions, sessionId);
  const session = sessions.find((item) => item.id === sessionId);
  const events =
    snapshot?.events.filter((event) => eventFilter === "all" || event.type === eventFilter) ?? [];
  return (
    <section
      ref={dashboardRef}
      className={`context-insights ci-dashboard ${compact ? "ci-compact" : ""}`}
      aria-label={t("contextInsights.title")}
    >
      <div className="ci-heading">
        <div>
          <h2>{t("contextInsights.title")}</h2>
          <span className="ci-muted">{session?.title}</span>
        </div>
        <div className="ci-controls">
          <Button
            size="sm"
            disabled={running || compacting}
            onClick={() => {
              const state = useAppStore.getState();
              if (state.activeSessionId !== sessionId || state.runningSessions[sessionId]) return;
              setCompacting(true);
              void state
                .compactContext()
                .then(() => observer.current?.refresh())
                .catch(() => setError(true))
                .finally(() => setCompacting(false));
            }}
          >
            {t("contextInsights.compactNow")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setContent({});
              setMissingContentKey(null);
              void observer.current?.refresh();
            }}
          >
            {t("contextInsights.refresh")}
          </Button>
        </div>
      </div>
      {error && (
        <p className="ci-note" role="alert">
          {t("contextInsights.error")}
        </p>
      )}
      {!snapshot ? (
        error ? null : (
          <p role="status">{t("contextInsights.loading")}</p>
        )
      ) : (
        <>
          <p className="ci-muted">{t("contextInsights.historical")}</p>
          <Select
            aria-label={t("contextInsights.agentScope")}
            value={agentFilter}
            onChange={(event) => inspectAgent(event.target.value)}
          >
            <option value="main">{t("contextInsights.mainAgent")}</option>
            <option value="all">{t("contextInsights.allAgents")}</option>
            {[...capturedAgents].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {agentFilter !== "main" &&
              agentFilter !== "all" &&
              !capturedAgents.has(agentFilter) && (
                <option value={agentFilter}>
                  {selectedAgentName || t("contextInsights.member")}
                </option>
              )}
          </Select>
          {!requests.length ? (
            <Panel className="ci-card ci-empty">{t("contextInsights.empty")}</Panel>
          ) : (
            <>
              <div className="ci-stats-grid">
                <Panel className="ci-card">
                  <h3>{t("contextInsights.sessionStats")}</h3>
                  <span className="ci-muted">{t("contextInsights.retained")}</span>
                  <dl className="ci-values">
                    <div>
                      <dt>{t("contextInsights.requests")}</dt>
                      <dd>{requests.length}</dd>
                    </div>
                    <div>
                      <dt>{t("contextInsights.turns")}</dt>
                      <dd>
                        {new Set(requests.map((request) => request.turnId).filter(Boolean)).size}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("contextInsights.estimatedCost")}</dt>
                      <dd>{money(totals.costReports ? totals.cost : undefined)}</dd>
                    </div>
                  </dl>
                </Panel>
                <Panel className="ci-card">
                  <h3>{t("contextInsights.tokenStats")}</h3>
                  <dl className="ci-values">
                    {(["input", "output", "read", "write", "reasoning"] as const).map((key) => (
                      <div key={key}>
                        <dt>
                          {t(
                            `contextInsights.${key === "read" ? "cacheRead" : key === "write" ? "cacheWrite" : key}`,
                          )}
                        </dt>
                        <dd>{totals.reports ? count(totals[key]) : "—"}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>{t("contextInsights.cacheRate")}</dt>
                      <dd>
                        {totals.input + totals.read > 0
                          ? `${((100 * totals.read) / (totals.input + totals.read)).toFixed(1)}%`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </Panel>
                <Panel className="ci-card">
                  <h3>{t("contextInsights.timingStats")}</h3>
                  <dl className="ci-values">
                    <div>
                      <dt>{t("contextInsights.requestDuration")}</dt>
                      <dd>{duration(totals.timed ? totals.ms : undefined)}</dd>
                    </div>
                    <div>
                      <dt>{t("contextInsights.throughput")}</dt>
                      <dd>
                        {totals.ms > 0 && totals.reports
                          ? count(totals.output / (totals.ms / 1000))
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  <p className="ci-muted">{t("contextInsights.timingNote")}</p>
                </Panel>
              </div>
              {selectedMetadata && <ContextComposition request={selectedMetadata} />}
              <p className="ci-note">{t("contextInsights.estimateNote")}</p>
              <ContextTrend
                requests={requests}
                events={snapshot.events}
                preferences={preferences}
                onPreferences={updatePreferences}
                pinnedId={pinnedId}
                onPin={setPinnedId}
                onPreview={setPreviewId}
              />
              <Select
                aria-label={t("contextInsights.selected")}
                value={selectedMetadata?.id ?? ""}
                onChange={(event) => {
                  setPinnedId(event.target.value);
                  setPreviewId(null);
                }}
              >
                {requests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {t("contextInsights.requestLabel", {
                      step: request.step,
                      model: request.modelId,
                    })}
                  </option>
                ))}
              </Select>
              <ContextBrowser
                request={selectedContent}
                baselineRequest={baselineRequest}
                loading={
                  contentLoading ||
                  Boolean(requestId && !selectedContent && contentKey !== missingContentKey)
                }
                toolSort={preferences.toolSort}
                onToolSort={(toolSort) => updatePreferences({ toolSort })}
              />
            </>
          )}
          <Panel className="ci-card">
            <div className="ci-heading">
              <h3>{t("contextInsights.events")}</h3>
              <Select
                aria-label={t("contextInsights.eventFilter")}
                value={eventFilter}
                onChange={(event) => setEventFilter(event.target.value)}
              >
                {["all", "compaction", "prune", "model", "mode", "injection"].map((value) => (
                  <option key={value} value={value}>
                    {t(`contextInsights.${value}`)}
                  </option>
                ))}
              </Select>
            </div>
            {events.length ? (
              <ul className="ci-event-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <time>{new Date(event.at).toLocaleTimeString()}</time>
                    <strong>{t(`contextInsights.${event.type}`)}</strong>
                    <span>{event.label}</span>
                    {event.tokensBefore !== undefined && (
                      <span>
                        {count(event.tokensBefore)} →{" "}
                        {event.tokensAfter === undefined ? "—" : count(event.tokensAfter)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ci-muted">{t("contextInsights.noEvents")}</p>
            )}
          </Panel>
          <TranscriptActivity
            sessionId={sessionId}
            preferences={preferences}
            onPreferences={updatePreferences}
            onInspectAgent={inspectAgent}
          />
          <Panel className="ci-card">
            <h3>{t("contextInsights.agentNetwork")}</h3>
            {family.length ? (
              <div className="ci-agent-family">
                {family.map((agent) => (
                  <Button
                    key={agent.id}
                    size="sm"
                    aria-label={t("contextInsights.openSession", { title: agent.title })}
                    onClick={() => {
                      void selectSession(agent.id);
                    }}
                  >
                    <span>{agent.title}</span>
                    <small>{t(`contextInsights.${agent.team?.role ?? "session"}`)}</small>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="ci-muted">{t("contextInsights.noAgents")}</p>
            )}
          </Panel>
          <p className="ci-muted">
            {t("contextInsights.retention", {
              requests: snapshot.retention.maxRequests,
              events: snapshot.retention.maxEvents,
              droppedRequests: snapshot.retention.droppedRequests,
              droppedEvents: snapshot.retention.droppedEvents,
            })}
          </p>
        </>
      )}
      <ContextInsightsPreferencesPanel preferences={preferences} onChange={updatePreferences} />
    </section>
  );
}
