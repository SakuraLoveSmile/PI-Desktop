/**
 * Subagents: bounded delegate agent loops spawned by the `Task` tool (ADR 0062).
 *
 * A delegate is a second pi `Agent` inside the same sidecar process, with its
 * own system prompt, its own (possibly pinned) provider/model, and only the
 * tools its definition declares. It shares the session's host connection, so
 * every tool call it makes goes through the same host-core permission and
 * containment path as the parent's.
 *
 * Two boundaries define the design:
 * - The parent's model context only ever gains the delegate's final report.
 *   Child messages and tool rows are emitted for the transcript and persisted
 *   for review, but the session runtime filters them out when it rebuilds
 *   model context.
 * - A delegate's lifecycle never reaches Electron main's turn handling. It
 *   runs in the background under the session runtime (ADR 0089): `Task`
 *   starts it and returns, `TaskWait` converges on it, and its termination —
 *   success, failure, cap, abort — collapses into the `TaskWait` result, so
 *   the parent turn stays the only thing that can end a turn.
 */

import { randomUUID } from "node:crypto";
import {
  Agent,
  convertToLlm,
  type AfterToolCallContext,
  type AfterToolCallResult,
  type AgentEvent,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  subagentCanMutate,
  type SubagentDefinition,
} from "@pi-desktop/shared";
import type {
  AgentEventEnvelope,
  MessageUsage,
  ThinkingLevel,
  UiMessage,
} from "@pi-desktop/shared";
import { classifyAgentError } from "./agent-errors.js";
import {
  assistantContent,
  nowIso,
  usageFromPi,
} from "./agent-messages.js";
import {
  buildProviderModel,
  createProviderModels,
  providerRequestKey,
  type RuntimeProviderConfig,
} from "./provider-binding.js";

export const SUBAGENT_TOOL_NAME = "Task";
/** Converge on running delegations and read their reports (ADR 0089). */
export const SUBAGENT_WAIT_TOOL_NAME = "TaskWait";
/** Report on the session's delegations without waiting (ADR 0089). */
export const SUBAGENT_LIST_TOOL_NAME = "TaskList";
/** Stop running delegations (ADR 0089). */
export const SUBAGENT_STOP_TOOL_NAME = "TaskStop";

const PROVIDER_REQUEST_MAX_RETRIES = 1;
const PROVIDER_MAX_RETRY_DELAY_MS = 8_000;
/** The report is the only thing that enters the parent's context; keep it
 * from becoming the context problem delegation was supposed to avoid. */
export const MAX_SUBAGENT_REPORT_CHARS = 12_000;

export type SubagentRunStatus =
  | "completed"
  | "truncated"
  | "failed"
  | "aborted";

export type SubagentRunResult = {
  agentName: string;
  status: SubagentRunStatus;
  /** Text handed back to the parent model. */
  report: string;
  /** Provider requests the delegate spent. */
  turns: number;
  toolCalls: number;
  usage?: MessageUsage;
  error?: { code: string; message: string };
};

export type SubagentToolOutcome = {
  isError?: boolean;
  terminate?: boolean;
};

export type SubagentRunOptions = {
  definition: SubagentDefinition;
  sessionId: string;
  /** Parent durable turn; child rows are attributed to the same turn. */
  turnId?: string;
  /** `Task` call that owns this delegate. */
  parentToolCallId: string;
  /** The delegated instruction, written by the parent model. */
  task: string;
  /** Provider resolved by Electron main (the definition's pin, or the
   * session's provider when the definition pins nothing). */
  provider: RuntimeProviderConfig;
  thinkingLevel: ThinkingLevel;
  /** Fully composed child system prompt (see `composeSubagentSystemPrompt`). */
  systemPrompt: string;
  /** Host-backed tools, built by the session runtime so a delegate's calls
   * take the exact same path as the parent's. */
  tools: AgentTool[];
  onEvent: (envelope: AgentEventEnvelope) => void;
  /**
   * Result of the parent's own `afterToolCall` bookkeeping for one call, so a
   * host failure reaches the delegate's tool-error channel the same way it
   * reaches the parent's.
   */
  resolveToolOutcome?: (
    context: AfterToolCallContext,
  ) => SubagentToolOutcome | undefined;
  signal?: AbortSignal;
};

/**
 * Compose the delegate's system prompt.
 *
 * The session runtime owns the shared parts (shell dialect, scratch
 * directory, project instruction chain) because it is the only place that
 * knows them; this function only decides the framing and the ordering, with
 * the definition body ahead of the workspace guidance so a project's own
 * instructions still have the last word.
 */
export function composeSubagentSystemPrompt(options: {
  definition: SubagentDefinition;
  /** Guidance blocks inherited from the session (shell, scratch, rules). */
  guidance?: string[];
}): string {
  const { definition } = options;
  const toolList = definition.tools.join(", ") || "none";
  const framing = [
    `You are the "${definition.name}" subagent inside PI-Desktop, working on one task delegated by the main agent.`,
    `You cannot see the user, ask questions, or delegate further. Finish the task with the tools you have: ${toolList}.`,
    subagentCanMutate(definition)
      ? "You may change files, but only the ones the task is about; leave everything else untouched."
      : "You have no tools that change files or run commands, so never report an edit you could not have made.",
    "Your final message is the only thing the main agent receives — nothing else you write reaches it. Make it self-contained: what you did, what you found with exact paths and line numbers, and anything you could not finish.",
    "Keep the report tight. Report findings, not narration, and never pad it with a summary of your own process.",
  ].join("\n");
  return [framing, definition.prompt, ...(options.guidance ?? [])]
    .filter((block) => block.trim().length > 0)
    .join("\n\n");
}

function boundedReport(value: string): string {
  const text = value.trim();
  if (text.length <= MAX_SUBAGENT_REPORT_CHARS) return text;
  const marker = "\n\n[subagent report truncated]\n\n";
  const available = MAX_SUBAGENT_REPORT_CHARS - marker.length;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`;
}

function addUsage(
  total: MessageUsage | undefined,
  next: MessageUsage | undefined,
): MessageUsage | undefined {
  if (!next) return total;
  if (!total) return next;
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    ...(total.cacheReadTokens !== undefined || next.cacheReadTokens !== undefined
      ? {
          cacheReadTokens:
            (total.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
        }
      : {}),
    ...(total.cacheWriteTokens !== undefined ||
    next.cacheWriteTokens !== undefined
      ? {
          cacheWriteTokens:
            (total.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
        }
      : {}),
    ...(total.reasoningTokens !== undefined || next.reasoningTokens !== undefined
      ? {
          reasoningTokens:
            (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
        }
      : {}),
    totalTokens: total.totalTokens + next.totalTokens,
  };
}

/** One delegate execution. Instances are single-use. */
export class SubagentRun {
  private readonly agent: Agent;
  private readonly opts: SubagentRunOptions;
  private currentAssistant?: UiMessage;
  private lastReportText = "";
  private turns = 0;
  private toolCalls = 0;
  private usage?: MessageUsage;
  private cappedTurns = false;
  private streamError?: { code: string; message: string };

  constructor(opts: SubagentRunOptions) {
    this.opts = opts;
    const model = buildProviderModel(opts.provider);
    const models = createProviderModels(opts.provider, model);
    const requestKey = providerRequestKey(opts.provider);
    this.agent = new Agent({
      streamFn: (m, context, options) =>
        models.streamSimple(m, context, {
          ...options,
          maxRetries: PROVIDER_REQUEST_MAX_RETRIES,
          maxRetryDelayMs: PROVIDER_MAX_RETRY_DELAY_MS,
          sessionId: opts.sessionId,
        }),
      getApiKey: async () => requestKey,
      convertToLlm,
      afterToolCall: async (context) => this.afterToolCall(context),
      initialState: {
        systemPrompt: opts.systemPrompt,
        model,
        tools: opts.tools,
        thinkingLevel: opts.thinkingLevel,
        messages: [],
      },
      // A delegate is a worker, not a fan-out point: its own tool calls run
      // one at a time, and it has no `Task` tool to nest further.
      toolExecution: "sequential",
    });
    this.agent.subscribe((event) => this.handleEvent(event));
  }

  async run(): Promise<SubagentRunResult> {
    const { signal } = this.opts;
    if (signal?.aborted) {
      return this.result("aborted", "The delegated task was aborted before it started.");
    }
    const onAbort = () => this.agent.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await this.agent.prompt(this.opts.task);
      await this.agent.waitForIdle();
    } catch (error) {
      const classified = classifyAgentError(error);
      if (classified.code === "TURN_ABORTED" || signal?.aborted) {
        return this.result("aborted", "The delegated task was aborted.");
      }
      return this.result("failed", "", {
        code: classified.code,
        message: classified.message,
      });
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.finalizeCurrentAssistant();
    }

    if (signal?.aborted) {
      return this.result("aborted", "The delegated task was aborted.");
    }
    if (this.streamError) {
      return this.result("failed", "", this.streamError);
    }
    if (this.cappedTurns) {
      return this.result("truncated", this.lastReportText);
    }
    if (!this.lastReportText.trim()) {
      return this.result("failed", "", {
        code: "SUBAGENT_NO_REPORT",
        message: "The subagent finished without writing a report.",
      });
    }
    return this.result("completed", this.lastReportText);
  }

  private result(
    status: SubagentRunStatus,
    report: string,
    error?: { code: string; message: string },
  ): SubagentRunResult {
    const name = this.opts.definition.name;
    const body = report.trim();
    const text =
      status === "completed"
        ? body
        : status === "truncated"
          ? [
              `The ${name} subagent hit its ${this.opts.definition.maxTurns}-turn limit before finishing.`,
              ...(body ? ["Its last report was:", body] : []),
            ].join("\n\n")
          : status === "aborted"
            ? `The ${name} subagent was aborted after ${this.turns} turn(s).`
            : [
                `The ${name} subagent failed after ${this.turns} turn(s): ${error?.message ?? "unknown error"}.`,
                ...(body ? ["Its last output was:", body] : []),
              ].join("\n\n");
    return {
      agentName: name,
      status,
      report: boundedReport(text),
      turns: this.turns,
      toolCalls: this.toolCalls,
      ...(this.usage ? { usage: this.usage } : {}),
      ...(error ? { error } : {}),
    };
  }

  /** Parent bookkeeping first (host failures, mutation-failure terminate),
   * then the delegate's own turn cap. */
  private async afterToolCall(
    context: AfterToolCallContext,
  ): Promise<AfterToolCallResult | undefined> {
    const parent = this.opts.resolveToolOutcome?.(context);
    const capped = this.turns >= this.opts.definition.maxTurns;
    if (capped) this.cappedTurns = true;
    const terminate = parent?.terminate === true || capped;
    if (!parent?.isError && !terminate) return undefined;
    return {
      ...(parent?.isError ? { isError: true } : {}),
      ...(terminate ? { terminate: true } : {}),
    };
  }

  private emit(event: AgentEventEnvelope["event"]): void {
    this.opts.onEvent({
      sessionId: this.opts.sessionId,
      turnId: this.opts.turnId,
      ts: Date.now(),
      event,
      parentToolCallId: this.opts.parentToolCallId,
      agentName: this.opts.definition.name,
    });
  }

  private newAssistantRow(): UiMessage {
    return {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: nowIso(),
      status: "streaming",
      modelId: this.opts.provider.modelId,
      providerId: this.opts.provider.id,
      parentToolCallId: this.opts.parentToolCallId,
      agentName: this.opts.definition.name,
    };
  }

  /**
   * Translate delegate events into transcript events.
   *
   * Only message and tool events are forwarded. `agent_end`, `turn_end` and
   * error events stay inside: Electron main ends the durable turn on those,
   * and a delegate finishing must never end the parent's turn.
   */
  private handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this.turns += 1;
        break;
      case "message_start": {
        if (event.message.role !== "assistant") break;
        const content = assistantContent((event.message as AssistantMessage).content);
        this.currentAssistant = {
          ...this.newAssistantRow(),
          content: content.text,
          ...(content.hasThinking && content.thinking
            ? { thinking: content.thinking }
            : {}),
        };
        this.emit({ type: "message_start", message: this.currentAssistant });
        break;
      }
      case "message_update": {
        if (!this.currentAssistant || event.message.role !== "assistant") break;
        const content = assistantContent((event.message as AssistantMessage).content);
        const previousText = this.currentAssistant.content;
        const previousThinking = this.currentAssistant.thinking ?? "";
        const nextText = content.hasText ? content.text : previousText;
        const nextThinking = content.hasThinking
          ? content.thinking
          : previousThinking;
        const deltaText = content.hasText
          ? content.text.startsWith(previousText)
            ? content.text.slice(previousText.length)
            : content.text
          : "";
        const deltaThinking = content.hasThinking
          ? content.thinking.startsWith(previousThinking)
            ? content.thinking.slice(previousThinking.length)
            : content.thinking
          : "";
        this.currentAssistant = {
          ...this.currentAssistant,
          content: nextText,
          ...(nextThinking ? { thinking: nextThinking } : {}),
          status: "streaming",
        };
        this.emit({
          type: "message_update",
          message: this.currentAssistant,
          deltaText,
          ...(deltaThinking ? { deltaThinking } : {}),
        });
        break;
      }
      case "message_end": {
        if (event.message.role !== "assistant") break;
        const message = event.message as AssistantMessage;
        const content = assistantContent(message.content);
        const stopReason = message.stopReason as string | undefined;
        const failed = stopReason === "error";
        if (failed) {
          const raw =
            typeof (message as { errorMessage?: unknown }).errorMessage === "string"
              ? ((message as { errorMessage?: string }).errorMessage as string)
              : "provider stream failed";
          const classified = classifyAgentError(raw);
          this.streamError = {
            code: classified.code,
            message: classified.message,
          };
        }
        const messageUsage = usageFromPi(message.usage);
        this.usage = addUsage(this.usage, messageUsage);
        // The report is the last assistant text; a call-only turn has none and
        // must not clear the text an earlier turn already produced.
        if (content.hasText && content.text.trim() && !failed) {
          this.lastReportText = content.text;
        }
        const row: UiMessage = {
          ...(this.currentAssistant ?? this.newAssistantRow()),
          content: content.hasText
            ? content.text
            : (this.currentAssistant?.content ?? ""),
          ...(content.hasThinking && content.thinking
            ? { thinking: content.thinking }
            : {}),
          status: failed ? "error" : stopReason === "aborted" ? "aborted" : "complete",
          ...(messageUsage ? { usage: messageUsage } : {}),
          ...(failed ? { isError: true } : {}),
        };
        this.currentAssistant = undefined;
        this.emit({ type: "message_end", message: row });
        break;
      }
      case "tool_execution_start":
        this.toolCalls += 1;
        this.emit({
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_update":
        this.emit({
          type: "tool_update",
          toolCallId: event.toolCallId,
          partialResult: event.partialResult,
        });
        break;
      case "tool_execution_end":
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
        });
        break;
      default:
        break;
    }
  }

  /** Close a bubble left streaming when the run died without a message_end. */
  private finalizeCurrentAssistant(): void {
    if (!this.currentAssistant) return;
    const row: UiMessage = { ...this.currentAssistant, status: "aborted" };
    this.currentAssistant = undefined;
    this.emit({ type: "message_end", message: row });
  }
}
