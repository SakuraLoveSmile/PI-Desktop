import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  GoalReport,
  GoalReportCheck,
  GoalReportCheckObservation,
  GoalReportCriterion,
  GoalReportEvidence,
  GoalReportEvidenceResolution,
  GoalReportFile,
  GoalReportMetric,
  GoalReportScreenshot,
  GoalReportStep,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Markdown } from "../Markdown";
import {
  IconCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconClose,
  IconEye,
  IconImage,
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
  const [status, setStatus] = useState<
    "loading" | "saving" | "ready" | "failed" | "error" | "not_found" | "disconnected"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Asset Blob URLs state and preview state
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [assetLoading, setAssetLoading] = useState<Record<string, boolean>>({});
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const [previewImageUrl, setPreviewImageUrl] = useState<{ url: string; title: string } | null>(null);

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
      const readState = res?.state || (res as any)?.status;

      if (readState === "draft" || readState === "pending") {
        setStatus("saving");
        setReport(null);
        return;
      }

      if (readState === "failed") {
        setStatus("failed");
        setErrorMessage(res?.detail || t("goalReport.view.loadFailed"));
        setErrorCode(safeErrorCode(res));
        setReport(null);
        return;
      }

      if (readState === "not_found") {
        setStatus("not_found");
        setErrorMessage(res?.detail || t("goalReport.view.loadFailed"));
        setErrorCode(safeErrorCode(res));
        setReport(null);
        return;
      }

      if (readState === "corrupt" || readState === "truncated") {
        setStatus("error");
        setErrorMessage(res?.detail || t("goalReport.view.loadFailed"));
        setErrorCode(safeErrorCode(res));
        setReport(null);
        return;
      }

      const body = res?.report;
      if (!body || typeof body !== "object" || !("goal" in body) || !("execution" in body)) {
        setStatus("error");
        setErrorMessage(res?.detail || t("goalReport.view.loadFailed"));
        setReport(null);
        return;
      }

      setReport(body as GoalReport);
      setStatus("ready");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || t("goalReport.view.loadFailed"));
      setErrorCode(safeErrorCode(err));
      if (msg.includes("network") || msg.includes("remote") || msg.includes("disconnected")) {
        setStatus("disconnected");
      } else if (msg.includes("missing") || msg.includes("corrupted") || msg.includes("not found")) {
        setStatus("error");
      } else {
        setStatus("failed");
      }
      setReport(null);
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

  // Load screenshot assets in chunks and generate Blob URLs
  useEffect(() => {
    if (!sessionId || !executionId || !report) {
      setAssetUrls({});
      setAssetLoading({});
      setAssetErrors({});
      return;
    }

    const screenshots = report.screenshots ?? [];
    const manifestAssets = report.assets ?? [];
    if (screenshots.length === 0 && manifestAssets.length === 0) {
      setAssetUrls({});
      return;
    }

    let isCancelled = false;
    const urlsToRevoke: string[] = [];

    const targetScreenshots = screenshots.length > 0
      ? screenshots.map((sc) => sc.id)
      : manifestAssets.map((ast) => ast.screenshotId);

    const loadAllAssets = async () => {
      for (const scId of targetScreenshots) {
        if (!scId || isCancelled) continue;
        setAssetLoading((prev) => ({ ...prev, [scId]: true }));
        try {
          let offset = 0;
          const chunks: Uint8Array[] = [];
          let mime = "image/png";
          let totalBytes = 0;

          while (!isCancelled) {
            const res = await api.getGoalReportAsset({
              sessionId,
              executionId,
              screenshotId: scId,
              offset,
              length: 256 * 1024,
            });

            if (res.state !== "ready" || !res.dataBase64) {
              throw new Error(res.detail || `Asset in state ${res.state}`);
            }

            if (res.mimeType) mime = res.mimeType;
            if (typeof res.totalBytes === "number") totalBytes = res.totalBytes;

            const binaryStr = atob(res.dataBase64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            chunks.push(bytes);

            offset += res.length ?? bytes.length;
            if (res.eof || (totalBytes > 0 && offset >= totalBytes)) {
              break;
            }
          }

          if (isCancelled) return;

          const blob = new Blob(chunks as BlobPart[], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          urlsToRevoke.push(blobUrl);

          setAssetUrls((prev) => ({ ...prev, [scId]: blobUrl }));
          setAssetLoading((prev) => ({ ...prev, [scId]: false }));
        } catch (err: unknown) {
          if (isCancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setAssetErrors((prev) => ({ ...prev, [scId]: msg }));
          setAssetLoading((prev) => ({ ...prev, [scId]: false }));
        }
      }
    };

    void loadAllAssets();

    return () => {
      isCancelled = true;
      for (const url of urlsToRevoke) {
        URL.revokeObjectURL(url);
      }
    };
  }, [sessionId, executionId, report]);

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

  if (status === "failed" || status === "error" || status === "not_found" || status === "disconnected" || !report) {
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

  const timingSource = report.execution.timingSource;
  const isFallback = report.integrity.kind === "fallback";
  const primaryMetrics = report.metrics ? report.metrics.slice(0, 4) : [];
  const secondaryMetrics = report.metrics && report.metrics.length > 4 ? report.metrics.slice(4) : [];

  // Map check observations by checkId for truthful comparison
  const observationsByCheckId: Record<string, GoalReportCheckObservation> = {};
  for (const obs of report.checkObservations ?? []) {
    if (obs.checkId) observationsByCheckId[obs.checkId] = obs;
  }

  // Map evidence resolutions by evidenceId
  const resolutionsByEvId: Record<string, GoalReportEvidenceResolution> = {};
  for (const res of report.evidenceResolution ?? (report as any).evidenceResolutions ?? []) {
    if (res.evidenceId) resolutionsByEvId[res.evidenceId] = res;
  }

  const screenshots: GoalReportScreenshot[] = report.screenshots ?? [];

  return (
    <div className="goal-report-tab" data-testid="goal-report-tab">
      <div className="goal-report-scroll">
        <div className="goal-report-body-cap">
          {/* 1. Header Section */}
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
                  {isFallback ? t("goalReport.view.fallback") : t("goalReport.view.structured")}
                </span>

                {durationSec !== null && timingSource === "turn" && (
                  <span className="goal-report-badge time">
                    {durationSec >= 60
                      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
                      : `${durationSec}s`}
                  </span>
                )}
              </div>
            </div>

            {report.goal.contractPath && (
              <div className="goal-report-contract-link">
                <span className="goal-report-contract-label">Contract:</span>
                <code>{report.goal.contractPath}</code>
              </div>
            )}

            {isFallback && (
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

          {/* 2. Metrics Section */}
          {primaryMetrics.length > 0 && (
            <section className="goal-report-section" data-testid="goal-report-metrics">
              <h3 className="goal-report-section-title">{t("goalReport.view.metrics")}</h3>
              <div className="goal-report-metrics-grid">
                {primaryMetrics.map((metric: GoalReportMetric, index: number) => (
                  <div key={metric.label || index} className="goal-report-metric-card">
                    <span className="goal-report-metric-label">{metric.label}</span>
                    <span className="goal-report-metric-value">{metric.value}</span>
                    {metric.source && (
                      <span className="goal-report-metric-source">{metric.source}</span>
                    )}
                  </div>
                ))}
              </div>

              {secondaryMetrics.length > 0 && (
                <details className="goal-report-more-metrics">
                  <summary className="goal-report-more-metrics-summary">
                    {secondaryMetrics.length} more metric{secondaryMetrics.length > 1 ? "s" : ""}
                  </summary>
                  <div className="goal-report-metrics-grid goal-report-secondary-metrics">
                    {secondaryMetrics.map((metric: GoalReportMetric, index: number) => (
                      <div key={metric.label || index} className="goal-report-metric-card">
                        <span className="goal-report-metric-label">{metric.label}</span>
                        <span className="goal-report-metric-value">{metric.value}</span>
                        {metric.source && (
                          <span className="goal-report-metric-source">{metric.source}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
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
              <div className="goal-report-table-wrap">
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
                  {report.checks.map((check: GoalReportCheck, index: number) => {
                    const obs = observationsByCheckId[check.id];
                    const isContradiction = obs && check.result === "passed" && obs.result === "failed";

                    return (
                      <div
                        key={check.id || index}
                        className={`goal-report-check-row result-${obs ? obs.result : check.result} ${isContradiction ? "is-contradiction" : ""}`}
                      >
                        <div className="goal-report-check-command-wrap">
                          <IconTerminal size={14} className="goal-report-check-icon" />
                          <code className="goal-report-check-command">{check.command}</code>
                        </div>

                        <div className="goal-report-check-status-wrap">
                          {check.exitCode !== undefined && check.exitCode !== null && (
                            <span className="goal-report-check-exit">exit: {check.exitCode}</span>
                          )}
                          <span className={`goal-report-check-badge result-${check.result}`}>
                            Agent: {check.result}
                          </span>
                          {obs && (
                            <span className={`goal-report-check-badge host-obs result-${obs.result}`}>
                              Host: {obs.result}
                            </span>
                          )}
                          {isContradiction && (
                            <span className="goal-report-contradiction-badge">
                              <IconTriangleAlert size={12} />
                              <span>Contradiction</span>
                            </span>
                          )}
                        </div>

                        {check.detail && (
                          <p className="goal-report-check-detail">{check.detail}</p>
                        )}
                        {obs?.detail && (
                          <p className="goal-report-check-obs-detail">Host fact: {obs.detail}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {report.evidences && report.evidences.length > 0 && (
                <div className="goal-report-evidences-list">
                  {report.evidences.map((ev: GoalReportEvidence, index: number) => {
                    const resolution = resolutionsByEvId[ev.id];
                    const resState = resolution?.state ?? "recorded";

                    return (
                      <div key={ev.id || index} className={`goal-report-evidence-card res-${resState}`}>
                        <div className="goal-report-evidence-head">
                          <span className="goal-report-ref-chip">#{ev.id}</span>
                          <span className="goal-report-evidence-kind">{ev.kind}</span>
                          <span className="goal-report-evidence-ref-id">{ev.refId}</span>
                          <span className={`goal-report-evidence-res-badge res-${resState}`}>
                            {resState}
                          </span>
                        </div>
                        <p className="goal-report-evidence-summary">{ev.summary}</p>
                        {ev.detail && <p className="goal-report-evidence-detail">{ev.detail}</p>}
                        {resolution?.detail && (
                          <p className="goal-report-evidence-res-detail">{resolution.detail}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 8. Screenshot Evidence Gallery */}
          {screenshots.length > 0 && (
            <section className="goal-report-section" data-testid="goal-report-gallery">
              <h3 className="goal-report-section-title">Evidence Gallery</h3>
              <div className="goal-report-gallery-grid">
                {screenshots.map((sc: GoalReportScreenshot, index: number) => {
                  const blobUrl = assetUrls[sc.id];
                  const isLoading = assetLoading[sc.id];
                  const error = assetErrors[sc.id];

                  return (
                    <div key={sc.id || index} className="goal-report-gallery-card">
                      <div className="goal-report-gallery-preview">
                        {blobUrl ? (
                          <img
                            src={blobUrl}
                            alt={sc.caption || sc.id}
                            className="goal-report-gallery-img"
                            onClick={() => setPreviewImageUrl({ url: blobUrl, title: sc.caption || sc.id })}
                          />
                        ) : isLoading ? (
                          <div className="goal-report-gallery-loading">
                            <IconRefresh size={18} className="is-spinning" />
                            <span>Loading asset…</span>
                          </div>
                        ) : (
                          <div className="goal-report-gallery-unavailable">
                            <IconImage size={20} />
                            <span>{error ? "Unavailable" : "Not captured"}</span>
                          </div>
                        )}
                        {blobUrl && (
                          <button
                            type="button"
                            className="goal-report-gallery-zoom-btn"
                            onClick={() => setPreviewImageUrl({ url: blobUrl, title: sc.caption || sc.id })}
                            aria-label="View full image"
                          >
                            <IconEye size={14} />
                          </button>
                        )}
                      </div>
                      <div className="goal-report-gallery-info">
                        <div className="goal-report-gallery-head">
                          <strong className="goal-report-gallery-id">#{sc.id}</strong>
                          {sc.evidenceRef && (
                            <span className="goal-report-ref-chip">ref: #{sc.evidenceRef}</span>
                          )}
                        </div>
                        {sc.caption && (
                          <p className="goal-report-gallery-caption">{sc.caption}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 9. Boundaries & Next Steps */}
          {((report.limitations && report.limitations.length > 0) ||
            (report.nextSteps && report.nextSteps.length > 0)) && (
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

          {/* 10. Conclusion */}
          <section className="goal-report-section goal-report-conclusion" data-testid="goal-report-conclusion">
            <h3 className="goal-report-section-title">{t("goalReport.view.conclusion")}</h3>
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
                  {report.conclusion ||
                    (report.execution.status === "completed"
                      ? t("chat.resultSteps", { count: report.steps?.length ?? 0 })
                      : t("chat.resultFailedBody"))}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Modal image preview */}
      {previewImageUrl && (
        <div
          className="goal-report-image-modal-overlay"
          onClick={() => setPreviewImageUrl(null)}
          data-testid="goal-report-image-modal"
        >
          <div className="goal-report-image-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="goal-report-image-modal-head">
              <span className="goal-report-image-modal-title">{previewImageUrl.title}</span>
              <button
                type="button"
                className="goal-report-image-modal-close"
                onClick={() => setPreviewImageUrl(null)}
                aria-label="Close image preview"
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="goal-report-image-modal-body">
              <img src={previewImageUrl.url} alt={previewImageUrl.title} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
