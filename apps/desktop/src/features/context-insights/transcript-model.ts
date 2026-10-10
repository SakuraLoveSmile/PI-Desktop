import type { UiMessage } from "@pi-desktop/shared";
import { isDelegationStartTool } from "../../lib/tool-display";
import { delegationIdForMessage } from "../../lib/subagent-panel";

export type FileOperation = {
  id: string;
  path: string;
  tool: string;
  kind: "read" | "write" | "edit" | "search";
  at: string;
  durationMs?: number;
  args: unknown;
  result: unknown;
  lineDelta?: number;
};
export function transcriptFileOperations(messages: UiMessage[]): FileOperation[] {
  const rows = new Map<string, FileOperation>();
  for (const message of messages) {
    if (
      message.role !== "tool" ||
      !message.toolName ||
      !/^(Read|Write|Edit|Glob|Grep)$/i.test(message.toolName)
    )
      continue;
    if (
      !message.toolArgs ||
      typeof message.toolArgs !== "object" ||
      Array.isArray(message.toolArgs)
    )
      continue;
    const args = message.toolArgs as Record<string, unknown>;
    const path = args.path ?? args.file_path ?? args.filePath;
    if (typeof path !== "string" || !path.trim()) continue;
    const kind =
      message.toolName.toLowerCase() === "read"
        ? "read"
        : message.toolName.toLowerCase() === "write"
          ? "write"
          : message.toolName.toLowerCase() === "edit"
            ? "edit"
            : "search";
    const lineCount = (text: string) => (text.length ? text.split("\n").length : 0);
    const before = args.oldText ?? args.old_string;
    const after = args.newText ?? args.new_string;
    const lineDelta =
      kind === "edit" && typeof before === "string" && typeof after === "string"
        ? lineCount(after) - lineCount(before)
        : undefined;
    const id = message.toolCallId ?? message.id;
    rows.set(id, {
      id,
      path,
      tool: message.toolName,
      kind,
      at: message.createdAt,
      durationMs: message.toolDurationMs,
      args: message.toolArgs,
      result: message.toolResult ?? message.content,
      lineDelta,
    });
  }
  return [...rows.values()];
}

export function transcriptAgents(messages: UiMessage[]) {
  const rows = new Map<
    string,
    { id: string; callId: string; name: string; parent?: string; status?: string }
  >();
  for (const message of messages) {
    if (message.role !== "tool" || !isDelegationStartTool(message.toolName)) continue;
    const args =
      message.toolArgs && typeof message.toolArgs === "object"
        ? (message.toolArgs as Record<string, unknown>)
        : {};
    rows.set(delegationIdForMessage(message), {
      id: delegationIdForMessage(message),
      callId: message.toolCallId ?? message.id,
      name:
        typeof args.agent === "string" ? args.agent : (message.agentName ?? message.toolName ?? ""),
      parent: message.parentToolCallId,
      status: message.toolStatus,
    });
  }
  return [...rows.values()];
}

export function readableValue(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}
