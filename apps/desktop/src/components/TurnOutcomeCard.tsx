import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { summarizeSessionWorkspaceChanges } from "../lib/workspace-review";
import { toolWorkPanelTab } from "../lib/work-panel-tabs";
import type { AgentTurnResult } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { IconCheck, IconCircleAlert, IconDiff } from "./icons";

type TurnOutcomeCardProps = {
  sessionId?: string;
  messages: UiMessage[];
  result?: AgentTurnResult;
};

function focusComposer() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
  });
}

function latestTurnMessages(messages: UiMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex < 0 ? messages : messages.slice(lastUserIndex + 1);
}

export function TurnOutcomeCard({
  sessionId,
  messages,
  result,
}: TurnOutcomeCardProps) {
  const { t } = useTranslation();
  const workspacePath = useAppStore((state) => state.workspace?.path);
  const diffPath = useAppStore((state) => state.workspaceDiffPath);
  const diff = useAppStore((state) => state.workspaceDiff);
  const reviewSessions = useAppStore((state) => state.workspaceReviewSessions);
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);
  const retryLastPrompt = useAppStore((state) => state.retryLastPrompt);

  if (!result) return null;

  const tail = latestTurnMessages(messages);
  const toolCount = tail.filter((message) => message.role === "tool").length;
  const reviewSummary = summarizeSessionWorkspaceChanges({
    diff,
    diffPath,
    workspacePath,
    sessionId,
    reviewSessions,
  });
  const hasVisibleTurn = tail.some(
    (message) =>
      Boolean(message.content.trim()) ||
      message.role === "tool" ||
      Boolean(message.error),
  );

  if (!hasVisibleTurn) return null;

  const completed = result.status === "completed";
  return (
    <section
      className={`turn-outcome-card ${completed ? "completed" : "failed"}`}
      data-testid="turn-outcome-card"
      data-outcome={result.status}
      role="status"
      aria-live="polite"
    >
      <div className="turn-outcome-heading">
        <span className="turn-outcome-icon" aria-hidden>
          {completed ? <IconCheck size={16} /> : <IconCircleAlert size={16} />}
        </span>
        <div className="turn-outcome-copy">
          <strong>
            {t(completed ? "chat.resultComplete" : "chat.resultNeedsAttention")}
          </strong>
          <span>
            {t(completed ? "chat.resultCompleteBody" : "chat.resultFailedBody")}
          </span>
        </div>
      </div>
      {toolCount > 0 || reviewSummary ? (
        <div className="turn-outcome-stats">
          {toolCount > 0 ? (
            <span>{t("chat.resultSteps", { count: toolCount })}</span>
          ) : null}
          {reviewSummary ? (
            <span>
              {t("chat.resultFilesChanged", { count: reviewSummary.fileCount })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="turn-outcome-actions">
        {!completed ? (
          <button
            type="button"
            className="copy-btn primary"
            onClick={() => void retryLastPrompt()}
          >
            {t("chat.retry")}
          </button>
        ) : null}
        {completed && reviewSummary ? (
          <button
            type="button"
            className="copy-btn"
            onClick={() => openWorkPanelTab(toolWorkPanelTab("review"))}
          >
            <IconDiff size={13} />
            {t("chat.reviewChanges")}
          </button>
        ) : null}
        <button type="button" className="copy-btn" onClick={focusComposer}>
          {t("chat.resultContinue")}
        </button>
      </div>
    </section>
  );
}
