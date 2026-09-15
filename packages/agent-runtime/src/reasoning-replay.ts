/**
 * Preserve DeepSeek-compatible reasoning across context compaction (#296).
 *
 * Codex-shaped checkpoints drop assistant turns (and their thinking) from the
 * retained tail so tool calls cannot strand. Strict relays still require a
 * non-empty reasoning field on later assistant messages. Stashing the last few
 * thinking turns in opaque checkpoint `details.retainedReasoning` and replaying
 * them as text-only assistants after the summary keeps usable reasoning without
 * reintroducing tool-call pairs or multiple user prompts (ADR 0136 / D275).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Cap how many pre-compaction thinking turns ride inside the checkpoint. */
export const MAX_RETAINED_REASONING_TURNS = 3;

/** Per-field character budget so a checkpoint cannot balloon on one long think. */
export const MAX_RETAINED_REASONING_FIELD_CHARS = 4_000;

export type RetainedReasoningTurn = {
  thinking: string;
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateField(value: string): string {
  if (value.length <= MAX_RETAINED_REASONING_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_RETAINED_REASONING_FIELD_CHARS)}…`;
}

function assistantThinkingText(message: AssistantMessage): {
  thinking: string;
  text: string;
} {
  const thinking: string[] = [];
  const text: string[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === "thinking" && typeof block.thinking === "string") {
      const value = block.thinking.trim();
      if (value) thinking.push(value);
    } else if (block.type === "text" && typeof block.text === "string") {
      const value = block.text.trim();
      if (value) text.push(value);
    }
  }
  return { thinking: thinking.join("\n"), text: text.join("\n") };
}

/**
 * Collect the newest assistant turns that still carry thinking, newest-last,
 * for storage in checkpoint details. Tool-call blocks are dropped on purpose.
 */
export function harvestRetainedReasoning(
  messages: readonly AgentMessage[],
  limit = MAX_RETAINED_REASONING_TURNS,
): RetainedReasoningTurn[] {
  const selected: RetainedReasoningTurn[] = [];
  for (let index = messages.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const parts = assistantThinkingText(message as AssistantMessage);
    if (!parts.thinking) continue;
    selected.push({
      thinking: truncateField(parts.thinking),
      text: truncateField(parts.text),
    });
  }
  return selected.reverse();
}

/** Read `details.retainedReasoning` from a checkpoint without trusting shape. */
export function retainedReasoningFromDetails(
  details: unknown,
): RetainedReasoningTurn[] {
  if (!isRecord(details) || !Array.isArray(details.retainedReasoning)) return [];
  const turns: RetainedReasoningTurn[] = [];
  for (const entry of details.retainedReasoning) {
    if (!isRecord(entry)) continue;
    if (typeof entry.thinking !== "string" || !entry.thinking.trim()) continue;
    turns.push({
      thinking: truncateField(entry.thinking.trim()),
      text:
        typeof entry.text === "string" && entry.text.trim()
          ? truncateField(entry.text.trim())
          : "",
    });
    if (turns.length >= MAX_RETAINED_REASONING_TURNS) break;
  }
  return turns;
}

/**
 * Rebuild text-only assistant messages that convertMessages can map back to
 * `reasoning_content`. Uses the Completions field name as thinkingSignature so
 * restored turns survive without the live stream metadata.
 */
export function retainedReasoningToMessages(
  turns: readonly RetainedReasoningTurn[],
  timestamp: number,
): AssistantMessage[] {
  return turns.map((turn, index) => {
    const content: AssistantMessage["content"] = [
      {
        type: "thinking",
        thinking: turn.thinking,
        thinkingSignature: "reasoning_content",
      },
    ];
    if (turn.text) {
      content.push({ type: "text", text: turn.text });
    }
    return {
      role: "assistant",
      content,
      api: "openai-completions",
      provider: "compaction-reasoning-replay",
      model: "compaction-reasoning-replay",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: timestamp + index,
    } as AssistantMessage;
  });
}
