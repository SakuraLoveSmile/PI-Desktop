import type { AgentMessage, AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@pi-desktop/shared";
import { contextBudgetLimitsFor } from "./context-budget.js";
import { reduceSummaryInput } from "./compaction-summary-input.js";
import { estimateContextTokens } from "./pi-runtime-estimates.js";
import { convertToLlm, serializeConversation } from "./pi-runtime-messages.js";
import { completeOneShot, type OneShotCompleteStream } from "./one-shot-complete.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";
import type { UsageObserver } from "./request-usage.js";

/**
 * The Advisor tool: the executor asks a stronger model for guidance.
 *
 * The advisor reads the conversation the executor's next request carries,
 * serialized as one plain-text transcript. Plain text needs no tool-call
 * pairing, carries no provider-signed thinking, and needs no vision input, so
 * the advisor can be any configured provider. The advisor has no tools, so its
 * reply cannot act on the host.
 */

export const ADVISOR_TOOL_NAME = "Advisor";
/** Calls allowed inside one user turn; the count resets when the next turn starts. */
export const ADVISOR_MAX_CALLS_PER_TURN = 5;
export const ADVISOR_MAX_OUTPUT_TOKENS = 8_192;
const ADVISOR_THINKING_LEVEL: ThinkingLevel = "medium";
/** Room kept free for the advisor's own instructions and the transcript wrapper. */
const ADVISOR_PROMPT_RESERVE_TOKENS = 1_024;

export const ADVISOR_TOOL_DESCRIPTION =
  "Ask a stronger reviewer model for advice on the task so far. The reviewer reads the conversation " +
  "(your private reasoning is omitted and long tool results are shortened), replies with guidance, and " +
  "cannot run tools or change files. Call it before substantive work when the approach is unclear, when " +
  "you think the task is complete (before your final answer), and when you are stuck or about to change " +
  "approach. Its reply is advisory: check it against the task and the evidence before acting on it. " +
  `At most ${ADVISOR_MAX_CALLS_PER_TURN} calls are allowed per turn.`;

export const ADVISOR_SYSTEM_PROMPT =
  "You are a senior engineer reviewing an AI coding agent's work in progress. The user message is a " +
  "transcript of the agent's conversation so far, ending with the agent's request for advice. You have no " +
  "tools, so judge only from the transcript and say when something cannot be verified from it. Reply with " +
  "concise, prioritized guidance: the most important next step, any mistake, unsupported claim, or missed " +
  "requirement you can see, and what to check before the work is called finished. Do not restate the " +
  "transcript. Keep the reply under 400 words.";

const ADVISOR_RESULT_PREFIX =
  "Advisor guidance (advisory output from another model; verify it before acting):";

export type AdvisorRequest = {
  systemPrompt: string;
  userText: string;
  signal?: AbortSignal;
};

export type AdvisorToolOptions = {
  /** Advisor model; its input window bounds the transcript. */
  model: Model<Api>;
  /** The conversation as the executor's next request carries it. */
  conversation: () => AgentMessage[];
  /** One advisor completion; resolves with the reply text. */
  advise: (request: AdvisorRequest) => Promise<string>;
  /** Changes when a user turn starts, which resets the per-turn call count. */
  turnKey: () => number;
};

/** Plain-text transcript for the advisor: no private reasoning and no unanswered tool calls. */
export function advisorTranscript(messages: AgentMessage[]): string {
  return serializeConversation(convertToLlm(withoutUnansweredToolCalls(withoutThinking(messages))));
}

export function createAdvisorTool(options: AdvisorToolOptions): AgentTool {
  let callTurn: number | undefined;
  let callsThisTurn = 0;
  return {
    name: ADVISOR_TOOL_NAME,
    label: "Advisor",
    description: ADVISOR_TOOL_DESCRIPTION,
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async (_id: string, _params: unknown, signal?: AbortSignal): Promise<AgentToolResult<unknown>> => {
      const turn = options.turnKey();
      if (turn !== callTurn) {
        callTurn = turn;
        callsThisTurn = 0;
      }
      if (callsThisTurn >= ADVISOR_MAX_CALLS_PER_TURN) {
        return failed(`the limit of ${ADVISOR_MAX_CALLS_PER_TURN} advisor calls for this turn was reached`);
      }
      callsThisTurn += 1;
      const transcript = transcriptForAdvisor(options.conversation(), options.model);
      if (transcript === undefined) {
        return failed("the conversation is larger than the advisor model's input window");
      }
      try {
        const advice = await options.advise({
          systemPrompt: ADVISOR_SYSTEM_PROMPT,
          userText: advisorRequestText(transcript),
          signal,
        });
        return { content: [{ type: "text", text: `${ADVISOR_RESULT_PREFIX}\n\n${advice}` }], details: { ok: true } };
      } catch (error) {
        // Stop must reach the agent loop; only a failure of the advisor becomes a tool result.
        if (signal?.aborted) throw error;
        return failed(error instanceof Error ? error.message : "the advisor request failed");
      }
    },
  };
}

/**
 * One advisor completion on the configured provider. The reply is text only:
 * no tools are offered, so the advisor cannot call back into the host.
 */
export async function completeAdvisor(
  provider: RuntimeProviderConfig,
  request: AdvisorRequest,
  options: { sessionId: string; onUsage?: UsageObserver; stream?: OneShotCompleteStream },
): Promise<string> {
  const context: Context = {
    systemPrompt: request.systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text: request.userText }], timestamp: Date.now() }],
  };
  const result = await completeOneShot(provider, context, ADVISOR_THINKING_LEVEL, {
    signal: request.signal,
    maxOutputTokens: ADVISOR_MAX_OUTPUT_TOKENS,
    sessionId: options.sessionId,
    stream: options.stream,
    emptyErrorCode: "ADVISOR_EMPTY_REPLY",
    emptyErrorMessage: "The advisor returned no advice.",
  });
  if (result.usage) options.onUsage?.(result.usage);
  return result.text;
}

function failed(message: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: `Advisor failed: ${message}` }], details: { ok: false, error: message } };
}

function advisorRequestText(transcript: string): string {
  return `<transcript>\n${transcript}\n</transcript>\n\nGive your advice on where the agent stands now.`;
}

/**
 * The full transcript when it fits the advisor's window; otherwise the same
 * transcript with long tool results shortened. Undefined when even that does
 * not fit, so the call fails before any provider request is made.
 */
function transcriptForAdvisor(messages: AgentMessage[], model: Model<Api>): string | undefined {
  const limit = advisorInputLimit(model);
  const full = advisorTranscript(messages);
  if (fitsAdvisorInput(full, model, limit)) return full;
  const reduced = reduceSummaryInput({
    messagesToSummarize: messages,
    turnPrefixMessages: [],
    isSplitTurn: false,
    previousSummary: undefined,
  });
  if (!reduced) return undefined;
  const shortened = advisorTranscript(reduced.messagesToSummarize);
  return fitsAdvisorInput(shortened, model, limit) ? shortened : undefined;
}

function advisorInputLimit(model: Model<Api>): number {
  return Math.max(1, contextBudgetLimitsFor(model).hardLimit - ADVISOR_PROMPT_RESERVE_TOKENS);
}

function fitsAdvisorInput(transcript: string, model: Model<Api>, limit: number): boolean {
  const userMessage: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: transcript }],
    timestamp: 0,
  };
  return estimateContextTokens([userMessage], model).tokens <= limit;
}

/** Drops the private reasoning of assistant messages, which the advisor never needs. */
function withoutThinking(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.content.some((block) => block.type === "thinking")) return message;
    return { ...message, content: message.content.filter((block) => block.type !== "thinking") };
  });
}

/**
 * Removes tool calls that have no result yet. The advisor call that is asking
 * for this review is always one of them, so the transcript ends with the agent's
 * last completed step instead of a dangling request.
 */
function withoutUnansweredToolCalls(messages: AgentMessage[]): AgentMessage[] {
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.role === "toolResult") answered.add(message.toolCallId);
  }
  return messages.map((message) => {
    if (
      message.role !== "assistant" ||
      !message.content.some((block) => block.type === "toolCall" && !answered.has(block.id))
    ) {
      return message;
    }
    return {
      ...message,
      content: message.content.filter((block) => block.type !== "toolCall" || answered.has(block.id)),
    };
  });
}
