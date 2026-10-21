import type { UiMessage } from "@pi-desktop/shared";

/**
 * How long a promoted row waits behind a running command before the queue
 * offers to abort that command. Send now already requested a graceful stop;
 * the offer only appears once that stop has clearly been held up.
 */
export const QUEUED_PROMPT_TOOL_ABORT_DELAY_MS = 30_000;

export function isQueuedPromptToolAbortDue(promotedAt: number | undefined, now: number): boolean {
  return promotedAt !== undefined && now - promotedAt >= QUEUED_PROMPT_TOOL_ABORT_DELAY_MS;
}

/**
 * The newest top-level Bash call that is still running. Subagent calls are
 * skipped: their parent turn waits for the subagent, so aborting one does not
 * let the queued row start.
 */
export function runningTopLevelBashToolCallId(messages: readonly UiMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool" || message.toolName !== "Bash" || message.toolStatus !== "running") {
      continue;
    }
    if (message.parentToolCallId || message.nestedParentToolCallId) continue;
    return message.toolCallId;
  }
  return undefined;
}

type QueueAbortState = {
  activeSessionId?: string;
  runningSessions: Record<string, boolean>;
  messages: readonly UiMessage[];
  sessions: readonly { id: string; source?: string }[];
};

/**
 * The Bash call a promoted row may abort right now, or undefined when no abort
 * is offered. Remote turns run on another host, so the local abort cannot reach them.
 */
export function queuedPromptToolAbortTarget(
  state: QueueAbortState,
  sessionId: string,
  due: boolean,
): string | undefined {
  if (!due || state.activeSessionId !== sessionId || !state.runningSessions[sessionId]) {
    return undefined;
  }
  if (state.sessions.find((session) => session.id === sessionId)?.source === "remote") {
    return undefined;
  }
  return runningTopLevelBashToolCallId(state.messages);
}
