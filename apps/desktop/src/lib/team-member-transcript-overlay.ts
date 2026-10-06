import type { AgentEventEnvelope, UiMessage } from "@pi-desktop/shared";
import { projectMessageEnd, removeLiveSessionMessage, upsertLiveSessionMessage } from "./session-transcript";

const MARKER = "\n\n[truncated for display; the full content remains in the transcript]";
const METADATA = ["code", "exitCode", "path", "filePath", "type", "kind", "status", "isError", "message", "details"];

/** Keep the structure ToolRow reads, with bounded text and container traversal. */
export function boundTeamMemberMessages(messages: UiMessage[], messageLimit: number, contentLimit: number) {
  const messagesTruncated = messages.length > messageLimit;
  let truncated = messagesTruncated;
  const clip = (text: string, limit: number): string => {
    if (text.length <= limit) return text;
    let count = 0;
    let end = 0;
    for (const char of text) {
      if (count === limit) {
        truncated = true;
        const marker = MARKER.slice(0, limit);
        let headEnd = 0;
        let headCount = 0;
        for (const head of text) {
          if (headCount >= Math.max(0, limit - marker.length)) break;
          headEnd += head.length;
          headCount++;
        }
        return text.slice(0, headEnd) + marker;
      }
      end += char.length;
      count++;
    }
    return text.slice(0, end);
  };
  const preview = (value: unknown): unknown => {
    let remaining = contentLimit;
    let nodes = 2048;
    const walk = (item: unknown, depth: number): unknown => {
      if (--nodes < 0 || depth > 12) {
        truncated = true;
        return Array.isArray(item) ? [] : typeof item === "object" && item ? { _truncated: true } : null;
      }
      if (typeof item === "string") {
        const next = clip(item, remaining);
        remaining = Math.max(0, remaining - Array.from(next).length);
        return next;
      }
      if (!item || typeof item !== "object") return item;
      if (Array.isArray(item)) {
        if (item.length > 256) truncated = true;
        const result: unknown[] = [];
        for (const child of item.slice(0, 256)) {
          if (nodes <= 0) { truncated = true; break; }
          result.push(walk(child, depth + 1));
        }
        return result;
      }
      const record = item as Record<string, unknown>;
      const keys = METADATA.filter((key) => Object.hasOwn(record, key));
      for (const key in record) {
        if (!Object.hasOwn(record, key)) continue;
        if (keys.includes(key)) continue;
        if (keys.length === 256) { truncated = true; break; }
        keys.push(key);
      }
      keys.sort((a, b) => {
        const rank = (key: string) => METADATA.includes(key) ? METADATA.indexOf(key) : METADATA.length;
        return rank(a) - rank(b) || a.localeCompare(b);
      });
      const entries: [string, unknown][] = [];
      for (const key of keys) {
        if (nodes <= 0) { truncated = true; break; }
        entries.push([key, walk(record[key], depth + 1)]);
      }
      return Object.fromEntries(entries);
    };
    return walk(value, 0);
  };
  const bounded = messages.slice(-messageLimit).map((message) => ({
    ...message,
    content: clip(message.content, contentLimit),
    ...(message.thinking !== undefined ? { thinking: clip(message.thinking, contentLimit) } : {}),
    ...(message.toolArgs !== undefined ? { toolArgs: preview(message.toolArgs) } : {}),
    ...(message.toolResult !== undefined ? { toolResult: preview(message.toolResult) } : {}),
    ...(message.error ? { error: preview(message.error) as UiMessage["error"] } : {}),
  }));
  return { messages: bounded, truncated, messagesTruncated };
}

function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equalValue(value, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined).sort();
  const other = Object.keys(right).filter((key) => right[key] !== undefined).sort();
  return keys.length === other.length && keys.every((key, i) => key === other[i] && equalValue(left[key], right[key]));
}

/** Timestamps and JSON property order cannot keep an acknowledged row live. */
export function teamMemberVisibleMessageMatches(durable: UiMessage, live: UiMessage, partial = false): boolean {
  const fields = ["role", "content", "thinking", "status", "toolName", "toolCallId", "toolStatus", "toolArgs", "toolResult", "isError", "error", "attachments"] as const;
  const metadata = ["toolDurationMs", "providerId", "modelId", "usage", "toolUsage"] as const;
  return metadata.every((key) => live[key] === undefined || equalValue(durable[key], live[key])) && fields.every((key) => {
    if (partial && live[key] === undefined) return true;
    // ToolRow renders the structured result. Its JSON presentation can differ
    // in property order between the event preview and persisted transcript.
    if (key === "content" && live.role === "tool" && live.toolResult !== undefined && durable.toolResult !== undefined) {
      return equalValue(durable.toolResult, live.toolResult);
    }
    const fallback = key === "thinking" ? "" : key === "isError" ? false : undefined;
    return equalValue(durable[key] ?? fallback, live[key] ?? fallback);
  });
}

export function projectTeamMemberEvent(messages: UiMessage[], envelope: AgentEventEnvelope, contentLimit = 64 * 1024) {
  const { event } = envelope;
  const removed: string[] = [];
  let next = messages;
  const ids: string[] = [];
  let partial = false;
  if (event.type === "message_end") {
    if (event.precedingAssistant) {
      next = upsertLiveSessionMessage(next, event.precedingAssistant);
      ids.push(event.precedingAssistant.id);
    }
    if (event.replacesMessageId && event.replacesMessageId !== event.message.id) removed.push(event.replacesMessageId);
    next = projectMessageEnd(next, event);
    if (next.some((message) => message.id === event.message.id)) ids.push(event.message.id);
    else removed.push(event.message.id);
  } else if (event.type === "user_message_persisted") {
    if (event.optimisticMessageId !== event.message.id) {
      removed.push(event.optimisticMessageId);
      next = removeLiveSessionMessage(next, event.optimisticMessageId);
    }
    next = upsertLiveSessionMessage(next, event.message);
    ids.push(event.message.id);
  } else if (event.type === "tool_start") {
    next = upsertLiveSessionMessage(next, {
      id: event.toolCallId, role: "tool", content: "", createdAt: new Date(envelope.ts).toISOString(),
      toolName: event.toolName, toolCallId: event.toolCallId, toolArgs: event.args,
      toolStatus: "running", status: "streaming",
      ...(envelope.parentToolCallId ? { parentToolCallId: envelope.parentToolCallId } : {}),
      ...(envelope.agentName ? { agentName: envelope.agentName } : {}),
    });
    ids.push(event.toolCallId);
  } else if (event.type === "tool_end") {
    const existing = messages.find((message) => message.toolCallId === event.toolCallId);
    const preview = boundTeamMemberMessages([{ id: event.toolCallId, role: "tool", content: "", createdAt: new Date(envelope.ts).toISOString(), toolResult: event.result }], 1, contentLimit).messages[0].toolResult;
    const result = typeof preview === "string" ? preview : JSON.stringify(preview, null, 2) ?? "";
    const completed: UiMessage = {
      ...existing, id: existing?.id ?? event.toolCallId, role: "tool", content: result,
      createdAt: existing?.createdAt ?? new Date(envelope.ts).toISOString(),
      toolCallId: event.toolCallId, toolResult: preview, toolStatus: event.isError ? "error" : "success",
      status: "complete", isError: event.isError,
      ...(event.toolUsage ? { toolUsage: event.toolUsage } : {}),
    };
    next = upsertLiveSessionMessage(next, completed);
    ids.push(completed.id);
    partial = !existing;
  }
  return { messages: next, changed: next.filter((message) => ids.includes(message.id)), removed, partial };
}
