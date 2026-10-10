import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { Button, Panel, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { duration } from "./model";
import { readableValue, transcriptAgents, transcriptFileOperations } from "./transcript-model";
import type { ContextInsightsPreferences } from "./preferences";

/** Transcript actions use stable recorded call ids, never repeated context copies. */
export function TranscriptActivity({
  sessionId,
  preferences,
  onPreferences,
  onInspectAgent,
}: {
  sessionId: string;
  preferences: ContextInsightsPreferences;
  onPreferences: (patch: Partial<ContextInsightsPreferences>) => void;
  onInspectAgent: (callId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("all");
  const [pageBefore, setPageBefore] = useState<number | undefined>();
  const openFile = useAppStore((state) => state.openFileInWorkPanel);
  const openSubagent = useAppStore((state) => state.openSubagentTab);
  const liveMessages = useAppStore((state) =>
    state.activeSessionId === sessionId ? state.messages : null,
  );
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void api
      .getSession(sessionId, {
        messageLimit: 200,
        ...(pageBefore === undefined ? {} : { messageBefore: pageBefore }),
      })
      .then(({ session }) => {
        if (disposed || !session || session.id !== sessionId) return;
        setMessages((previous) =>
          pageBefore === undefined ? session.messages : [...session.messages, ...previous],
        );
        setBefore(session.hasMoreBefore ? (session.messageStart ?? null) : null);
        setError(false);
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
  }, [pageBefore, revision, sessionId]);
  const merged = [
    ...new Map(
      [...messages, ...(liveMessages ?? [])].map((message) => [message.id, message]),
    ).values(),
  ];
  const allOperations = transcriptFileOperations(merged);
  const fileCalls = new Map<string, number>();
  for (const operation of allOperations)
    fileCalls.set(operation.path, (fileCalls.get(operation.path) ?? 0) + 1);
  const operations = allOperations
    .filter((row) => filter === "all" || row.kind === filter)
    .sort((a, b) =>
      preferences.fileSort === "name"
        ? a.path.localeCompare(b.path)
        : preferences.fileSort === "calls"
          ? (fileCalls.get(b.path) ?? 0) - (fileCalls.get(a.path) ?? 0)
          : new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  const agents = transcriptAgents(merged);
  const tools = merged.filter((message) => message.role === "tool");
  const timed = tools.filter((message) => message.toolDurationMs !== undefined);
  const toolMs = timed.reduce((sum, message) => sum + (message.toolDurationMs ?? 0), 0);
  return (
    <>
      <Panel className="ci-card">
        <div className="ci-heading">
          <h3>{t("contextInsights.files")}</h3>
          <Button
            size="sm"
            onClick={() => {
              setPageBefore(undefined);
              setRevision((value) => value + 1);
            }}
          >
            {t("contextInsights.refresh")}
          </Button>
        </div>
        <p className="ci-muted">
          {t("contextInsights.transcriptSample", { count: merged.length })}
        </p>
        <dl className="ci-values">
          <div>
            <dt>{t("contextInsights.toolCalls")}</dt>
            <dd>{tools.length}</dd>
          </div>
          <div>
            <dt>{t("contextInsights.toolDuration")}</dt>
            <dd>{duration(timed.length ? toolMs : undefined)}</dd>
          </div>
          <div>
            <dt>{t("contextInsights.humanInputs")}</dt>
            <dd>
              {
                merged.filter((message) => message.role === "user" && !message.parentToolCallId)
                  .length
              }
            </dd>
          </div>
        </dl>
        <div className="ci-controls">
          <Select
            value={filter}
            aria-label={t("contextInsights.fileFilter")}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["all", "read", "write", "edit", "search"].map((value) => (
              <option key={value} value={value}>
                {t(`contextInsights.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            value={preferences.fileSort}
            aria-label={t("contextInsights.fileSort")}
            onChange={(event) =>
              onPreferences({
                fileSort:
                  event.target.value === "name"
                    ? "name"
                    : event.target.value === "calls"
                      ? "calls"
                      : "recent",
              })
            }
          >
            <option value="recent">{t("contextInsights.recent")}</option>
            <option value="name">{t("contextInsights.name")}</option>
            <option value="calls">{t("contextInsights.callCount")}</option>
          </Select>
        </div>
        {error && (
          <p className="ci-note" role="alert">
            {t("contextInsights.error")}
          </p>
        )}
        {loading && <p role="status">{t("contextInsights.loading")}</p>}
        {!operations.length && !loading && (
          <p className="ci-muted">{t("contextInsights.noFiles")}</p>
        )}
        <div className="ci-operation-list">
          {operations.map((operation) => (
            <details key={operation.id} className="ci-entry">
              <summary>
                <span>
                  {t(`contextInsights.${operation.kind}`)} · {operation.path}
                </span>
                <span>
                  {duration(operation.durationMs)}
                  {operation.lineDelta === undefined
                    ? ""
                    : ` · ≈${operation.lineDelta >= 0 ? "+" : ""}${operation.lineDelta} ${t("contextInsights.lines")}`}
                </span>
              </summary>
              <Button
                size="sm"
                aria-label={t("contextInsights.openFile", { path: operation.path })}
                onClick={() => {
                  if (useAppStore.getState().activeSessionId === sessionId)
                    openFile(operation.path);
                }}
              >
                {t("contextInsights.openFile", { path: operation.path })}
              </Button>
              <pre className="ci-content">{readableValue(operation.args)}</pre>
              <pre className="ci-content">{readableValue(operation.result)}</pre>
            </details>
          ))}
        </div>
        {before !== null && (
          <Button size="sm" disabled={loading} onClick={() => setPageBefore(before)}>
            {t("contextInsights.loadEarlier")}
          </Button>
        )}
      </Panel>
      <Panel className="ci-card">
        <h3>{t("contextInsights.agentNetwork")}</h3>
        <div className="ci-agent-family">
          {agents.map((agent) => (
            <div key={agent.id} className="ci-agent-actions">
              <Button
                size="sm"
                aria-label={t("contextInsights.inspectAgent", { name: agent.name })}
                onClick={() => onInspectAgent(agent.callId, agent.name)}
              >
                {agent.parent ? `↳ ${agent.name}` : agent.name}
              </Button>
              <Button
                size="sm"
                aria-label={t("contextInsights.openAgent", { name: agent.name })}
                onClick={() => {
                  if (useAppStore.getState().activeSessionId === sessionId)
                    openSubagent(agent.id, agent.name);
                }}
              >
                <span>{agent.parent ? `↳ ${agent.name}` : agent.name}</span>
                <small>{agent.status}</small>
              </Button>
            </div>
          ))}
        </div>
        {!agents.length && <p className="ci-muted">{t("contextInsights.noAgents")}</p>}
      </Panel>
    </>
  );
}
