import type { TFunction } from "i18next";
import { useEffect, useReducer, useState } from "react";
import { TooltipButton } from "../../../components/ui";
import {
  isQueuedPromptToolAbortDue,
  QUEUED_PROMPT_TOOL_ABORT_DELAY_MS,
  queuedPromptToolAbortTarget,
} from "../../../lib/queued-prompt-tool-abort";
import type { QueuedPrompt } from "../../../lib/queued-prompts";
import { useAppStore } from "../../../stores/app-store";

/**
 * Whether a promoted row has waited out the abort delay. Renders read the clock
 * directly, so a row that is already due shows at once; a timer re-renders the
 * moment it becomes due.
 */
function useQueuedPromptToolAbortDue(promotedAt: number | undefined): boolean {
  const [ticks, tick] = useReducer((count: number) => count + 1, 0);
  const due = isQueuedPromptToolAbortDue(promotedAt, Date.now());
  useEffect(() => {
    if (promotedAt === undefined || due) return;
    // A timer that fires a little early bumps `ticks`, which schedules it again.
    const timer = setTimeout(tick, promotedAt + QUEUED_PROMPT_TOOL_ABORT_DELAY_MS - Date.now());
    return () => clearTimeout(timer);
  }, [promotedAt, due, ticks]);
  return due;
}

/**
 * Offers to abort the running top-level Bash call that holds the head promoted
 * queue row. Nothing aborts on its own: the user must press it.
 */
export function QueuedPromptToolAbortButton({ t, prompt }: { t: TFunction; prompt: QueuedPrompt }) {
  const due = useQueuedPromptToolAbortDue(prompt.promotedAt);
  const toolCallId = useAppStore((state) =>
    queuedPromptToolAbortTarget(state, prompt.sessionId, due),
  );
  const abortQueuedPromptTool = useAppStore((state) => state.abortQueuedPromptTool);
  const [requesting, setRequesting] = useState(false);
  if (!toolCallId) return null;
  const hint = t("chat.queuedPromptToolAbortHint");
  return (
    <TooltipButton
      type="button"
      className="composer-queued-prompt-abort-tool"
      tooltip={hint}
      ariaLabel={hint}
      disabled={requesting}
      aria-disabled={requesting}
      onClick={() => {
        setRequesting(true);
        void abortQueuedPromptTool(prompt.sessionId, toolCallId).finally(() => setRequesting(false));
      }}
    >
      {t("chat.queuedPromptToolAbort")}
    </TooltipButton>
  );
}
