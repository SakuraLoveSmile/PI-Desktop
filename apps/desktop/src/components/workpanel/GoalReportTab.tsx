import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  GoalReport,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { GoalReportDocument } from "./goal-report/GoalReportDocument";
import {
  IconCircleAlert,
  IconClose,
  IconRefresh,
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

  return (
    <div className="goal-report-tab" data-testid="goal-report-tab">
      <div className="goal-report-scroll">
        <GoalReportDocument
          report={report}
          assetUrls={assetUrls}
          assetLoading={assetLoading}
          assetErrors={assetErrors}
          onPreview={setPreviewImageUrl}
        />
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
              <Button
                variant="ghost"
                type="button"
                className="goal-report-image-modal-close"
                onClick={() => setPreviewImageUrl(null)}
                aria-label={t("goalReport.view.closeImage")}
              >
                <IconClose size={16} />
              </Button>
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
