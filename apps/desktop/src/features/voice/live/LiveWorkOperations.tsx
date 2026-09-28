import type { TFunction } from "i18next";
import type { LiveWorkOperationView } from "@pi-desktop/shared";
import { Button } from "../../../components/ui";
import { api } from "../../../lib/api";

export function LiveWorkOperations({
  sessionId,
  operations,
  t,
  busyOperationId,
  setBusyOperationId,
  setMessage,
}: {
  sessionId: string;
  operations: LiveWorkOperationView[];
  t: TFunction;
  busyOperationId: string | null;
  setBusyOperationId: (operationId: string | null) => void;
  setMessage: (message: string | null) => void;
}) {
  return (
    <div className="live-voice-work-operations" aria-live="polite" aria-relevant="additions text">
      {operations.map((operation) => {
        const statusKey = operation.execution !== "not-started" ? operation.execution : operation.admission;
        const status = t(`liveVoice.workStatus.${statusKey}`);
        return (
          <div className="live-voice-work-operation" key={operation.operationId}>
            <div className="live-voice-work-operation-content">
              <span>{status}</span>
              {operation.summary ? <span className="live-voice-work-summary">{operation.summary}</span> : null}
            </div>
            {operation.execution === "running" && operation.turnId ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyOperationId === operation.operationId}
                onClick={() => void (async () => {
                  setBusyOperationId(operation.operationId);
                  setMessage(null);
                  try {
                    const result = await api.stop(sessionId, operation.turnId!);
                    setMessage(t(result.requested ? "liveVoice.stopRequested" : "liveVoice.staleStop"));
                  } catch {
                    setMessage(t("liveVoice.workActionFailed"));
                  } finally {
                    setBusyOperationId(null);
                  }
                })()}
              >
                {t("liveVoice.stopWork")}
              </Button>
            ) : null}
            {operation.execution === "queued" && operation.queueEntryId ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyOperationId === operation.operationId}
                onClick={() => void (async () => {
                  setBusyOperationId(operation.operationId);
                  setMessage(null);
                  try {
                    await api.removeQueuedPrompt(operation.queueEntryId!);
                    setMessage(t("liveVoice.queueCanceled"));
                  } catch {
                    setMessage(t("liveVoice.queueCancelStale"));
                  } finally {
                    setBusyOperationId(null);
                  }
                })()}
              >
                {t("liveVoice.cancelQueued")}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
