import { randomUUID } from "node:crypto";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { MessageUsage, UsageProvenance } from "@pi-desktop/shared";
import { usageFromPi, usageToPi } from "./agent-messages.js";

/** Native rates must be present and finite before a zero cost can mean free use. */
export function nativeCostStatus(cost: Model<Api>["cost"] | undefined): UsageProvenance["costStatus"] {
  if (!cost) return undefined;
  return [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].every(rate => Number.isFinite(rate) && rate >= 0)
    ? "estimated" : "unknown";
}

export type UsageObserver = (usage: MessageUsage) => void;

/** Create before dispatch. Each physical retry gets its own identity. */
export function requestUsageIdentity(model: Pick<Model<Api>, "id" | "provider">, providerId?: string): UsageProvenance {
  return { operationId: randomUUID(), usageOrigin: "pi", providerId: providerId ?? model.provider, modelId: model.id };
}

export function accountModelResult(
  message: AssistantMessage,
  identity: UsageProvenance,
  onUsage?: UsageObserver,
): AssistantMessage {
  const usage = usageFromPi(message.usage, identity);
  if (usage) {
    message.usage = usageToPi(usage);
    onUsage?.(usage);
  }
  return message;
}

/**
 * Observe at the real request boundary, inside the retry factory. Intermediate
 * failed paid attempts are reported even when a retry reuses the visible row.
 * The proxy preserves Pi's event stream ownership and cancellation semantics.
 */
export function accountModelStream(
  model: Pick<Model<Api>, "id" | "provider">,
  createStream: () => AssistantMessageEventStream,
  options: { providerId?: string; costStatus?: UsageProvenance["costStatus"]; nativeCost?: Model<Api>["cost"]; onUsage?: UsageObserver; onRequest?: (identity: UsageProvenance) => void; onResult?: (message: AssistantMessage, identity: UsageProvenance, durationMs: number) => void; onError?: (identity: UsageProvenance, durationMs: number) => void } = {},
): AssistantMessageEventStream {
  const costStatus = options.costStatus === "reported" ? "reported"
    : nativeCostStatus(options.nativeCost) ?? options.costStatus;
  const identity = { ...requestUsageIdentity(model, options.providerId),
    ...(costStatus ? { costStatus } : {}) };
  const startedAt = Date.now();
  options.onRequest?.(identity);
  let stream: AssistantMessageEventStream;
  try { stream = createStream(); } catch (error) {
    options.onError?.(identity, Math.max(0, Date.now() - startedAt));
    throw error;
  }
  let reported = false;
  let settled = false;
  const account = (message: AssistantMessage): AssistantMessage => {
    const result = accountModelResult(message, identity, (usage) => {
    if (reported) return;
    reported = true;
    options.onUsage?.(usage);
    });
    if (!settled) {
      settled = true;
      options.onResult?.(result, identity, Math.max(0, Date.now() - startedAt));
    }
    return result;
  };
  const failure = () => {
    if (settled) return;
    settled = true;
    options.onError?.(identity, Math.max(0, Date.now() - startedAt));
  };
  return new Proxy(stream, {
    get(target, property, receiver) {
      if (property === "result") return async () => {
        try { return account(await target.result()); } catch (error) { failure(); throw error; }
      };
      if (property === Symbol.asyncIterator) return async function* () {
        try { for await (const event of target) {
          if (event.type === "done") account(event.message);
          if (event.type === "error") account(event.error);
          yield event;
        } } catch (error) { failure(); throw error; }
      };
      return Reflect.get(target, property, receiver);
    },
  });
}
