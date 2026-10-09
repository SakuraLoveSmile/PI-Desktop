import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { contentText, getCurrentTools, normalizeContext, toToolDeclaration } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { CONTEXT_INSIGHTS_MAX_CONTENT_CHARS, type ContextInsightsCategory, type ContextInsightsEntry, type ContextInsightsRequest } from "@pi-desktop/shared";
import { estimateContextTokens, estimateTokens } from "./pi-runtime-estimates.js";
import { usageFromPi } from "./agent-messages.js";
import { SKILL_SECTION_PREFIX, SKILL_TOOL_NAME } from "./plugin-skills-prompt.js";

/** Pure read of the assembled Pi input. Never observes request options/auth. */
export function captureContextRequest(model: Model<Api>, context: Context, metadata: {
  id: string; providerId: string; turnId?: string; step: number; mode: string; startedAt?: number; agentName?: string; parentToolCallId?: string; purpose?: "agent" | "compaction" | "subagent";
}): ContextInsightsRequest {
  const entries: ContextInsightsEntry[] = [];
  let omittedEntries = 0;
  let remaining = CONTEXT_INSIGHTS_MAX_CONTENT_CHARS;
  const add = (category: ContextInsightsCategory, label: string, content: string, tokens: number, images?: ContextInsightsEntry["images"], kind?: ContextInsightsEntry["kind"]) => {
    if (entries.length >= 2048) { omittedEntries++; return; }
    let retained = content.slice(0, remaining);
    if (retained.length && /[\uD800-\uDBFF]/.test(retained.at(-1)!)) retained = retained.slice(0, -1);
    remaining -= retained.length;
    entries.push({ id: `${metadata.id}:${entries.length}`, category, label: label.slice(0, 128), content: retained,
      estimatedTokens: tokens, originalChars: content.length, truncated: retained.length < content.length,
      ...(images?.length ? { images } : {}), ...(kind ? { kind } : {}) });
  };
  const normalized = normalizeContext(context);
  const systems = normalized.messages.filter(message => message.role === "system");
  for (const [epoch, system] of systems.entries()) {
    const firstEntry = entries.length;
    const text = contentText(system.content);
    if (text) add("system", "System prompt", text, estimateTokens({ role: "system", content: text, timestamp: 0 }, model));
    for (const [name, text] of Object.entries(system.sections ?? {})) {
      if (!text) continue;
      const category = name === "skills" || name.startsWith(SKILL_SECTION_PREFIX) ? "skill" : name === "context" || name === "context_budget" ? "injected" : "system";
      add(category, `${name} [${epoch + 1}]`, text, estimateTokens({ role: "system", content: text, timestamp: 0 }, model));
    }
    for (let i = firstEntry; i < entries.length; i++) entries[i]!.historical = epoch < systems.length - 1;
  }
  for (const tool of getCurrentTools(normalized.messages)) {
    const content = JSON.stringify(toToolDeclaration(tool), null, 2);
    add("tools", tool.name, content, Math.ceil(content.length / 4));
  }
  for (const message of normalized.messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      for (const block of message.content) {
        const tokens = estimateTokens({ ...message, content: [block] }, model);
        if (block.type === "text") add("assistant", "Assistant", block.text, tokens, undefined, "answer");
        else if (block.type === "thinking") add("assistant", "Thinking", block.thinking, tokens, undefined, "thinking");
        else if (block.type === "toolCall") add("assistant", block.name, JSON.stringify(block.arguments, null, 2), tokens, undefined, "toolCall");
        else add("assistant", block.type, JSON.stringify(block, null, 2), tokens);
      }
      continue;
    }
    const images: NonNullable<ContextInsightsEntry["images"]> = [];
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content, (_key, value: unknown) => {
      if (value && typeof value === "object" && Reflect.get(value, "type") === "image") {
        const data = Reflect.get(value, "data");
        const mimeType = Reflect.get(value, "mimeType");
        const image = { mimeType: typeof mimeType === "string" ? mimeType : "unknown", encodedBytes: typeof data === "string" ? Buffer.byteLength(data, "utf8") : 0 };
        images.push(image);
        return { type: "image", ...image, binaryOmitted: true };
      }
      return value;
    }, 2);
    const category = message.role === "toolResult" && message.toolName === SKILL_TOOL_NAME ? "skill" : message.role;
    const label = message.role === "toolResult" ? message.toolName : message.role;
    add(category, label, content ?? "", estimateTokens(message as AgentMessage, model), images);
  }
  const captured: ContextInsightsRequest = { ...metadata, startedAt: metadata.startedAt ?? Date.now(), status: "running", modelId: model.id,
    contextWindow: model.contextWindow, estimatedTokens: estimateContextTokens(context.messages, model).tokens,
    estimateSource: "runtime-usage-anchor", captureSource: "pi-context", contentRevision: 0, entries, contentTruncated: omittedEntries > 0 || entries.some(entry => entry.truncated), ...(omittedEntries ? { omittedEntries } : {}) };
  return boundContextRequest(captured);
}

function safePrefix(text: string, count: number): string {
  let retained = text.slice(0, Math.max(0, count));
  if (retained.length && /[\uD800-\uDBFF]/.test(retained.at(-1)!)) retained = retained.slice(0, -1);
  return retained;
}
const MAX_SERIALIZED_REQUEST_BYTES = 590_000;
/** Keep transport bounded even for control escapes, long labels and image metadata. */
function boundContextRequest(request: ContextInsightsRequest): ContextInsightsRequest {
  let bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  for (let i = request.entries.length - 1; bytes > MAX_SERIALIZED_REQUEST_BYTES && i >= 0; i--) {
    const entry = request.entries[i]!;
    const before = Buffer.byteLength(JSON.stringify(entry), "utf8");
    entry.content = safePrefix(entry.content, entry.content.length - (bytes - MAX_SERIALIZED_REQUEST_BYTES + 64));
    entry.truncated = entry.content.length < entry.originalChars;
    bytes += Buffer.byteLength(JSON.stringify(entry), "utf8") - before;
    request.contentTruncated = true;
  }
  while (bytes > MAX_SERIALIZED_REQUEST_BYTES && request.entries.length) {
    const entry = request.entries.pop()!;
    bytes -= Buffer.byteLength(JSON.stringify(entry), "utf8") + 1;
    request.omittedEntries = (request.omittedEntries ?? 0) + 1;
    request.contentTruncated = true;
  }
  return request;
}

function captureProviderPayload(request: ContextInsightsRequest, payload: unknown): ContextInsightsRequest {
  let redacted = false;
  const content = JSON.stringify(payload, (key, value: unknown) => {
    if (/^(?:headers|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|credentials|cookie|cookies)$/i.test(key)) {
      redacted = true; return "[redacted]";
    }
    if (value && typeof value === "object" && ArrayBuffer.isView(value)) {
      redacted = true; return { binaryOmitted: true, encodedBytes: value.byteLength };
    }
    if (value instanceof ArrayBuffer) {
      redacted = true; return { binaryOmitted: true, encodedBytes: value.byteLength };
    }
    if (value && typeof value === "object" && Reflect.get(value, "type") === "Buffer" && Array.isArray(Reflect.get(value, "data"))) {
      redacted = true; return { binaryOmitted: true, encodedBytes: Reflect.get(value, "data").length };
    }
    if ((key === "inlineData" || key === "inline_data") && value && typeof value === "object" && typeof Reflect.get(value, "data") === "string") {
      redacted = true; return { binaryOmitted: true, mimeType: Reflect.get(value, "mimeType") ?? Reflect.get(value, "mime_type"),
        encodedBytes: Buffer.byteLength(Reflect.get(value, "data"), "utf8") };
    }
    if (key === "bytes" && Array.isArray(value) && value.every(byte => typeof byte === "number" && byte >= 0 && byte <= 255)) {
      redacted = true; return { binaryOmitted: true, encodedBytes: value.length };
    }
    if (typeof value === "string" && /^data:(?:image|audio|video)\/[^;]+;base64,/.test(value)) {
      redacted = true; return `[binary omitted: ${Buffer.byteLength(value, "utf8")} encoded bytes]`;
    }
    if (value && typeof value === "object" && (Reflect.get(value, "type") === "image" || Reflect.get(value, "type") === "base64") && typeof Reflect.get(value, "data") === "string") {
      redacted = true;
      return { type: Reflect.get(value, "type"), mimeType: Reflect.get(value, "mimeType") ?? Reflect.get(value, "media_type"), encodedBytes: Buffer.byteLength(Reflect.get(value, "data"), "utf8"), binaryOmitted: true };
    }
    return value;
  }, 2) ?? "";
  const retainedPayload = safePrefix(content, CONTEXT_INSIGHTS_MAX_CONTENT_CHARS / 2);
  let remaining = CONTEXT_INSIGHTS_MAX_CONTENT_CHARS - retainedPayload.length;
  const entries = request.entries.map(entry => {
    const retained = safePrefix(entry.content, remaining); remaining -= retained.length;
    return { ...entry, content: retained, truncated: entry.truncated || retained.length < entry.content.length };
  });
  return boundContextRequest({ ...request, entries, captureSource: "provider-payload",
    contentRevision: (request.contentRevision ?? 0) + 1,
    providerPayload: { content: retainedPayload, originalChars: content.length, truncated: retainedPayload.length < content.length, redacted },
    contentTruncated: request.contentTruncated || retainedPayload.length < content.length || entries.some(entry => entry.truncated),
  });
}

/** Observer owned by one physical attempt, so abandoned retries cannot settle a later request. */
export function contextRequestObserver(model: Model<Api>, context: Context, metadata: {
  providerId: string; turnId?: string; step: number; mode: string; agentName?: string; parentToolCallId?: string; purpose?: "agent" | "compaction" | "subagent";
}, emit: (request: ContextInsightsRequest) => void, transport?: () => {
  providerStatus?: number; requestBytes?: number; aborted?: boolean;
}) {
  let request: ContextInsightsRequest | undefined;
  return {
    onRequest(identity: import("@pi-desktop/shared").UsageProvenance) {
      request = captureContextRequest(model, context, { ...metadata, id: identity.operationId! });
      emit(request);
    },
    onPayload(payload: unknown) {
      if (!request) return;
      request = captureProviderPayload(request, payload);
      emit(request);
    },
    onResult(message: import("@earendil-works/pi-ai").AssistantMessage, _identity: import("@pi-desktop/shared").UsageProvenance, durationMs: number) {
      if (!request) return;
      const facts = transport?.();
      emit({ ...request, completedAt: request.startedAt + durationMs, durationMs,
        status: message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "error" : "completed",
        usage: usageFromPi(message.usage), ...(facts?.providerStatus !== undefined ? { providerStatus: facts.providerStatus } : {}),
        ...(facts?.requestBytes !== undefined ? { requestBytes: facts.requestBytes } : {}),
      });
    },
    onError(_identity: import("@pi-desktop/shared").UsageProvenance, durationMs: number) {
      if (!request) return;
      emit({ ...request, completedAt: request.startedAt + durationMs, durationMs, status: transport?.().aborted ? "aborted" : "error" });
    },
  };
}
