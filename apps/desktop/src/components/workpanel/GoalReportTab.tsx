import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  GoalReport,
  GoalReportCheck,
  GoalReportCriterion,
  GoalReportEvidence,
  GoalReportFile,
  GoalReportMetric,
  GoalReportStep,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Markdown } from "../Markdown";
import {
  IconCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconClose,
  IconInfo,
  IconRefresh,
  IconTerminal,
  IconTriangleAlert,
} from "../icons";
import { Button } from "../ui";
import { WorkTabEmpty } from "./WorkTabEmpty";

export type GoalReportTabProps = {
  executionId: string;
  sessionId?: string;
};

type ErrorCodeCarrier = {
  code?: unknown;
  errorCode?: unknown;
  data?: { errorCode?: unknown };
};

function safeErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as ErrorCodeCarrier;
  const code = candidate.data?.errorCode ?? candidate.errorCode ?? candidate.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : null;
}

export function GoalReportTab({ executionId, sessionId }: GoalReportTabProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<GoalReport | null>(null);
  const [status, setStatus] = useState<"loading" | "saving" | "ready" | "failed" | "error" | "disconnected">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const loadReport = useCallback(async () => {
    if (!sessionId || !executionId) {
      setStatus("error");
      setErrorMessage(t("goalReport.view.loadFailed"));
      setErrorCode(null);
      return;
    }
    setStatus("loading");
    setErrorMessage(null);
    setErrorCode(null);
    try {
      const res = await api.getGoalReport({ sessionId, executionId });
      const raw = res?.report;
      if (!raw) {
        setStatus("failed");
        setErrorMessage(t("goalReport.view.loadFailed"));
        return;
      }
      if (raw.status === "draft" || raw.status === "pending") {
        setStatus("saving");
        return;
      }
      if (raw.status === "failed") {
        setStatus("failed");
        setErrorMessage(t("goalReport.view.loadFailed"));
        setErrorCode(safeErrorCode(raw));
        return;
      }
      setReport(raw as GoalReport);
      setStatus("ready");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(t("goalReport.view.loadFailed"));
      setErrorCode(safeErrorCode(err));
      if (msg.includes("network") || msg.includes("remote") || msg.includes("disconnected")) {
        setStatus("disconnected");
      } else if (msg.includes("missing") || msg.includes("corrupted") || msg.includes("not found")) {
        setStatus("error");
      } else {
        setStatus("failed");
      }
    }
  }, [sessionId, executionId, t]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    const unsub = api.onGoalReportChanged((event) => {
      if (event?.executionId === executionId) {
        void loadReport();
      }
    });
    return () => {
      unsub();
    };
  }, [executionId, loadReport]);

  const handleRetry = useCallback(async () => {
    if (!sessionId || !executionId || retrying) return;
    setRetrying(true);
    try {
      await api.retryGoalReport({ sessionId, executionId });
      await loadReport();
    } catch (err: unknown) {
      setErrorMessage(t("goalReport.view.loadFailed"));
      setErrorCode(safeErrorCode(err));
      setStatus("failed");
    } finally {
      setRetrying(false);
    }
  }, [sessionId, executionId, retrying, loadReport]);

  if (status === "loading" || status === "saving") {
    return (
      <div className="goal-report-state-wrap">
        <WorkTabEmpty
          icon={IconRefresh}
          title={status === "saving" ? t("chat.running") : t("goalReport.view.loading")}
          body={status === "saving" ? t("goalReport.view.loading") : undefined}
        />
      </div>
    );
  }

  if (status === "failed" || status === "error" || status === "disconnected" || !report) {
    return (
      <div className="goal-report-state-wrap">
        <div className="goal-report-error-card">
          <span className="goal-report-error-icon" aria-hidden>
            {status === "disconnected" ? <IconTriangleAlert size={24} /> : <IconCircleAlert size={24} />}
          </span>
          <h3 className="goal-report-error-title">
            {status === "disconnected"
              ? t("goalReport.view.remoteDisconnected")
              : t("goalReport.view.loadFailed")}
          </h3>
          <p className="goal-report-error-detail">
            {errorMessage || t("goalReport.view.loadFailed")}
            {errorCode && <span className="goal-report-error-code"> ({errorCode})</span>}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="goal-report-retry-button"
            onClick={handleRetry}
            disabled={retrying}
            data-testid="goal-report-retry-btn"
          >
            <IconRefresh size={14} className={retrying ? "is-spinning" : undefined} />
            <span>{t("goalReport.view.retryLoad")}</span>
          </Button>
        </div>
      </div>
    );
  }

  const durationSec = report.execution.completedAt && report.execution.startedAt
    ? Math.max(0, Math.round((report.execution.completedAt - report.execution.startedAt) / 1000))
    : null;

  return (
    <div className="goal-report-tab" data-testid="goal-report-tab">
      <div className="goal-report-scroll">
        {/* 1. Title & Execution Status */}
        <section className="goal-report-section goal-report-header-section" data-testid="goal-report-header">
          <div className="goal-report-header-main">
            <h2 className="goal-report-title">
              {report.goal.title || t("goalReport.view.title")}
            </h2>
            <div className="goal-report-badges">
              <span className={`goal-report-badge verdict-${report.verdict}`}>
                {report.verdict === "met" && <IconCircleCheck size={13} />}
                {report.verdict === "partial" && <IconTriangleAlert size={13} />}
                {report.verdict === "blocked" && <IconCircleAlert size={13} />}
                {report.verdict === "unknown" && <IconInfo size={13} />}
                <span>
                  {report.verdict === "met" && t("goalReport.view.verdictMet")}
                  {report.verdict === "partial" && t("goalReport.view.verdictPartial")}
                  {report.verdict === "blocked" && t("goalReport.view.verdictBlocked")}
                  {report.verdict === "unknown" && t("goalReport.view.verdictUnknown")}
                </span>
              </span>

              <span className={`goal-report-badge status-${report.execution.status}`}>
                {report.execution.status === "completed"
                  ? t("goalReport.view.statusCompleted")
                  : t("goalReport.view.statusInterrupted")}
              </span>

              <span className={`goal-report-badge integrity-${report.integrity.kind}`}>
                {report.integrity.kind === "structured"
                  ? t("goalReport.view.structured")
                  : t("goalReport.view.fallback")}
              </span>

              {durationSec !== null && (
                <span className="goal-report-badge time">
                  {durationSec >= 60
                    ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
                    : `${durationSec}s`}
                </span>
              )}
            </div>
          </div>

          {report.integrity.kind === "fallback" && (
            <div className="goal-report-notice-box fallback" data-testid="goal-report-fallback-notice">
              <span className="goal-report-notice-icon">
                <IconInfo size={16} />
              </span>
              <div className="goal-report-notice-text">
                <strong>{t("goalReport.view.fallbackNotice")}</strong>
                {report.integrity.truncationNotice && (
                  <p>{report.integrity.truncationNotice}</p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 2. Metrics */}
        {report.metrics && report.metrics.length > 0 && (
          <section className="goal-report-section" data-testid="goal-report-metrics">
            <h3 className="goal-report-section-title">{t("goalReport.view.metrics")}</h3>
            <div className="goal-report-metrics-grid">
              {report.metrics.map((metric: GoalReportMetric, index: number) => (
                <div key={metric.label || index} className="goal-report-metric-card">
                  <span className="goal-report-metric-label">{metric.label}</span>
                  <span className="goal-report-metric-value">{metric.value}</span>
                  {metric.source && (
                    <span className="goal-report-metric-source">{metric.source}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3. Outcome Summary */}
        <section className="goal-report-section" data-testid="goal-report-summary">
          <h3 className="goal-report-section-title">{t("goalReport.view.summary")}</h3>
          <div className="goal-report-prose">
            <Markdown source={report.summary || ""} />
          </div>
        </section>

        {/* 4. Acceptance Criteria */}
        {report.criteria && report.criteria.length > 0 && (
          <section className="goal-report-section" data-testid="goal-report-criteria">
            <h3 className="goal-report-section-title">{t("goalReport.view.criteria")}</h3>
            <div className="goal-report-criteria-list">
              {report.criteria.map((item: GoalReportCriterion, index: number) => (
                <div key={item.id || index} className={`goal-report-criterion-row verdict-${item.verdict}`}>
                  <div className="goal-report-criterion-head">
                    <span className={`goal-report-criterion-verdict verdict-${item.verdict}`}>
                      {item.verdict === "met" && <IconCheck size={12} />}
                      {item.verdict === "unmet" && <IconClose size={12} />}
                      {item.verdict === "partial" && <IconTriangleAlert size={12} />}
                      {item.verdict === "unknown" && <IconInfo size={12} />}
                      <span>{item.verdict}</span>
                    </span>
                    <span className="goal-report-criterion-text">{item.text}</span>
                  </div>
                  {item.explanation && (
                    <p className="goal-report-criterion-explanation">{item.explanation}</p>
                  )}
                  {item.evidenceRefs && item.evidenceRefs.length > 0 && (
                    <div className="goal-report-evidence-refs">
                      {item.evidenceRefs.map((ref: string) => (
                        <span key={ref} className="goal-report-ref-chip">
                          #{ref}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 5. Key Steps */}
        {report.steps && report.steps.length > 0 && (
          <section className="goal-report-section" data-testid="goal-report-steps">
            <h3 className="goal-report-section-title">{t("goalReport.view.steps")}</h3>
            <div className="goal-report-steps-list">
              {report.steps.map((step: GoalReportStep, index: number) => (
                <div key={step.id || index} className={`goal-report-step-item status-${step.status}`}>
                  <span className="goal-report-step-number">{index + 1}</span>
                  <div className="goal-report-step-content">
                    <div className="goal-report-step-head">
                      <strong className="goal-report-step-title">{step.title}</strong>
                      <span className={`goal-report-step-status status-${step.status}`}>
                        {step.status}
                      </span>
                    </div>
                    {step.detail && (
                      <p className="goal-report-step-detail">{step.detail}</p>
                    )}
                    {step.evidenceRefs && step.evidenceRefs.length > 0 && (
                      <div className="goal-report-evidence-refs">
                        {step.evidenceRefs.map((ref: string) => (
                          <span key={ref} className="goal-report-ref-chip">
                            #{ref}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 6. Changed Files */}
        {report.files && report.files.length > 0 && (
          <section className="goal-report-section" data-testid="goal-report-files">
            <h3 className="goal-report-section-title">{t("goalReport.view.files")}</h3>
            <div className="goal-report-files-list">
              {report.files.map((file: GoalReportFile, index: number) => (
                <div key={file.path || index} className="goal-report-file-row">
                  <span className={`goal-report-file-type type-${file.changeType}`}>
                    {file.changeType === "created" && "+"}
                    {file.changeType === "modified" && "~"}
                    {file.changeType === "deleted" && "-"}
                    {file.changeType === "referenced" && "•"}
                    <span>{file.changeType}</span>
                  </span>
                  <span className="goal-report-file-attribution">{file.attribution}</span>
                  <code className="goal-report-file-path">{file.path}</code>
                  {file.detail && <span className="goal-report-file-detail">{file.detail}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 7. Verification Evidence & Checks */}
        {((report.checks && report.checks.length > 0) || (report.evidences && report.evidences.length > 0)) && (
          <section className="goal-report-section" data-testid="goal-report-evidence">
            <h3 className="goal-report-section-title">
              {t("goalReport.view.checks")} / {t("goalReport.view.evidences")}
            </h3>

            {report.checks && report.checks.length > 0 && (
              <div className="goal-report-checks-list">
                {report.checks.map((check: GoalReportCheck, index: number) => (
                  <div key={check.id || index} className={`goal-report-check-row result-${check.result}`}>
                    <div className="goal-report-check-command-wrap">
                      <IconTerminal size={14} className="goal-report-check-icon" />
                      <code className="goal-report-check-command">{check.command}</code>
                    </div>
                    <div className="goal-report-check-status-wrap">
                      {check.exitCode !== undefined && check.exitCode !== null && (
                        <span className="goal-report-check-exit">exit: {check.exitCode}</span>
                      )}
                      <span className={`goal-report-check-badge result-${check.result}`}>
                        {check.result}
                      </span>
                    </div>
                    {check.detail && (
                      <p className="goal-report-check-detail">{check.detail}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {report.evidences && report.evidences.length > 0 && (
              <div className="goal-report-evidences-list">
                {report.evidences.map((ev: GoalReportEvidence, index: number) => (
                  <div key={ev.id || index} className="goal-report-evidence-card">
                    <div className="goal-report-evidence-head">
                      <span className="goal-report-ref-chip">#{ev.id}</span>
                      <span className="goal-report-evidence-kind">{ev.kind}</span>
                      <span className="goal-report-evidence-ref-id">{ev.refId}</span>
                    </div>
                    <p className="goal-report-evidence-summary">{ev.summary}</p>
                    {ev.detail && <p className="goal-report-evidence-detail">{ev.detail}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 8. Boundaries & Next Steps */}
        {((report.limitations && report.limitations.length > 0) || (report.nextSteps && report.nextSteps.length > 0)) && (
          <section className="goal-report-section" data-testid="goal-report-limitations">
            {report.limitations && report.limitations.length > 0 && (
              <div className="goal-report-sub-block">
                <h3 className="goal-report-section-title">{t("goalReport.view.limitations")}</h3>
                <ul className="goal-report-bullet-list">
                  {report.limitations.map((item: string, index: number) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {report.nextSteps && report.nextSteps.length > 0 && (
              <div className="goal-report-sub-block">
                <h3 className="goal-report-section-title">{t("goalReport.view.nextSteps")}</h3>
                <ul className="goal-report-bullet-list">
                  {report.nextSteps.map((item: string, index: number) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* 9. Conclusion */}
        <section className="goal-report-section goal-report-conclusion" data-testid="goal-report-conclusion">
          <h3 className="goal-report-section-title">
            {t("goalReport.view.conclusion")}
          </h3>
          <div className={`goal-report-conclusion-card verdict-${report.verdict}`}>
            <span className="goal-report-conclusion-icon">
              {report.verdict === "met" && <IconCircleCheck size={20} />}
              {report.verdict === "partial" && <IconTriangleAlert size={20} />}
              {report.verdict === "blocked" && <IconCircleAlert size={20} />}
              {report.verdict === "unknown" && <IconInfo size={20} />}
            </span>
            <div className="goal-report-conclusion-body">
              <strong>
                {report.verdict === "met" && t("goalReport.view.verdictMet")}
                {report.verdict === "partial" && t("goalReport.view.verdictPartial")}
                {report.verdict === "blocked" && t("goalReport.view.verdictBlocked")}
                {report.verdict === "unknown" && t("goalReport.view.verdictUnknown")}
              </strong>
              <p>
                {report.execution.status === "completed"
                  ? t("chat.resultSteps", { count: report.steps?.length ?? 0 })
                  : t("chat.resultFailedBody")}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
