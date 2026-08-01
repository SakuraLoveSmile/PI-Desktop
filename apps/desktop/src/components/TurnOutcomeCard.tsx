import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import type { AgentTurnResult } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { IconCheck, IconCircleAlert } from "./icons";

type TurnOutcomeCardProps = {
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
  messages,
  result,
}: TurnOutcomeCardProps) {
  const { t } = useTranslation();
  const retryLastPrompt = useAppStore((state) => state.retryLastPrompt);

  if (!result) return null;

  const tail = latestTurnMessages(messages);
  const toolCount = tail.filter((message) => message.role === "tool").length;
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
      {toolCount > 0 ? (
        <div className="turn-outcome-stats">
          <span>{t("chat.resultSteps", { count: toolCount })}</span>
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
        <button type="button" className="copy-btn" onClick={focusComposer}>
          {t("chat.resultContinue")}
        </button>
      </div>
    </section>
  );
}
