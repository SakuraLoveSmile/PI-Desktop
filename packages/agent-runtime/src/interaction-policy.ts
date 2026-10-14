import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AskToolQuestion, InteractionMode, InteractionRequiredDetails } from "@pi-desktop/shared";
import { normalizeInteractionRequiredDetails } from "@pi-desktop/shared";
import type { ClassifiedAgentError } from "./agent-errors.js";

const requiredErrors = new WeakMap<AssistantMessage, ClassifiedAgentError>();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize only well-shaped arguments; never retain malformed raw input. */
export function normalizeInteractionQuestions(params: unknown): AskToolQuestion[] | undefined {
  if (!record(params)) return undefined;
  return normalizeInteractionRequiredDetails({ kind: "interaction_required", toolName: "asktool",
    toolCallId: "arguments", questions: params.questions })?.questions;
}

export function interactionRequiredError(toolCallId: string, questions: AskToolQuestion[] | undefined): ClassifiedAgentError {
  const invalidId = !toolCallId.trim() || new TextEncoder().encode(toolCallId).length > 512;
  const id = invalidId ? "invalid-tool-call-id" : toolCallId;
  const normalized = !invalidId && questions
    ? normalizeInteractionRequiredDetails({ kind: "interaction_required", toolName: "asktool", toolCallId: id, questions })
    : undefined;
  const details: InteractionRequiredDetails = normalized ?? {
    kind: "interaction_required", toolName: "asktool", toolCallId: id, questions: [], invalidArguments: true,
  };
  return { code: "INTERACTION_REQUIRED", message: "This unattended turn requires a user decision.",
    retriable: false, details };
}

/** Only runtime-created decisions, never provider-supplied error metadata. */
export function readInteractionRequiredError(message: AssistantMessage): ClassifiedAgentError | undefined {
  return requiredErrors.get(message);
}

/** Preflight the finalized batch before pi's lookup/validation/execution.
 * Outside retries, accounting and watchdogs, the error uses pi's full terminal
 * lifecycle and hard exit while retaining role, tool-call blocks and usage. */
export function withInteractionPolicy(
  stream: AssistantMessageEventStream,
  mode: InteractionMode,
  normalizeQuestions: (arguments_: unknown) => AskToolQuestion[] | undefined,
): AssistantMessageEventStream {
  if (mode === "interactive") return stream;
  const guarded = new WeakMap<AssistantMessage, AssistantMessage>();
  const preflight = (message: AssistantMessage): AssistantMessage => {
    const cached = guarded.get(message);
    if (cached) return cached;
    // Errors and cancellation already hard-exit; keep their original meaning.
    if (message.stopReason === "error" || message.stopReason === "aborted") return message;
    const asks = message.content.filter(block => block.type === "toolCall" && block.name === "asktool");
    const first = asks[0];
    if (!first || first.type !== "toolCall") return message;
    const questions: AskToolQuestion[] = [];
    let invalid = false;
    for (const ask of asks) {
      if (ask.type !== "toolCall") continue;
      const current = normalizeQuestions(ask.arguments);
      if (!current) invalid = true;
      else questions.push(...current);
    }
    const error = interactionRequiredError(first.id, invalid ? undefined : questions);
    const result: AssistantMessage = { ...message, stopReason: "error", errorMessage: error.message };
    guarded.set(message, result);
    requiredErrors.set(result, error);
    return result;
  };
  return new Proxy(stream, {
    get(target, property, receiver) {
      if (property === "result") return async () => preflight(await target.result());
      if (property === Symbol.asyncIterator) return async function* () {
        for await (const event of target) {
          if (event.type === "done") {
            const message = preflight(event.message);
            yield readInteractionRequiredError(message)
              ? { type: "error" as const, reason: "error" as const, error: message }
              : event;
          } else yield event;
        }
      };
      return Reflect.get(target, property, receiver);
    },
  });
}
