import { useTranslation } from "react-i18next";
import type { AskToolQuestion, UiMessage } from "@pi-desktop/shared";

type AskToolDetails = {
  questions?: unknown;
  answers?: unknown;
  resolvedAt?: unknown;
};

type AskToolCompletedSummaryProps = {
  message: Pick<UiMessage, "toolName" | "toolStatus" | "toolResult" | "isError">;
};

function isQuestion(value: unknown): value is AskToolQuestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const question = value as Partial<AskToolQuestion>;
  return (
    typeof question.question === "string" &&
    Array.isArray(question.options) &&
    question.options.every((option) => typeof option === "string")
  );
}

function detailsOf(message: AskToolCompletedSummaryProps["message"]): AskToolDetails | null {
  if (message.toolName !== "asktool" || message.toolStatus !== "success" || message.isError) {
    return null;
  }
  const result = message.toolResult;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return details as AskToolDetails;
}

function questionsAndAnswers(details: AskToolDetails):
  | { questions: AskToolQuestion[]; answers: Array<string[] | null> }
  | null {
  if (!Array.isArray(details.questions) || !details.questions.every(isQuestion)) return null;
  const questions = details.questions as AskToolQuestion[];
  if (!Array.isArray(details.answers) || details.answers.length !== questions.length) return null;
  const answers = details.answers.map((answer) => {
    if (answer === null) return null;
    if (!Array.isArray(answer) || !answer.every((value) => typeof value === "string")) return null;
    return answer as string[];
  });
  return { questions, answers };
}

/**
 * Durable, quiet presentation for a resolved asktool row. The tool result is
 * the source of truth, so this remains available after transcript reload.
 */
export function AskToolCompletedSummary({ message }: AskToolCompletedSummaryProps) {
  const { t, i18n } = useTranslation();
  const details = detailsOf(message);
  const resolved = details ? questionsAndAnswers(details) : null;
  if (!resolved) return null;
  const answerFormatter = new Intl.ListFormat(i18n.resolvedLanguage || i18n.language, {
    style: "short",
    type: "conjunction",
  });

  return (
    <section className="asktool-completed-summary" aria-label={t("askTool.completedTitle")}>
      <div className="asktool-completed-summary-title">{t("askTool.completedTitle")}</div>
      <dl className="asktool-completed-summary-list">
        {resolved.questions.map((question, index) => {
          const answer = resolved.answers[index];
          return (
            <div className="asktool-completed-summary-item" key={`${question.question}-${index}`}>
              <dt>{question.question}</dt>
              <dd>{answer && answer.length > 0 ? answerFormatter.format(answer) : t("askTool.completedSkipped")}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
