import type { UiMessage } from "@pi-desktop/shared";
import { messageThinking, type SubagentRunItem } from "./assistant-turns";

export type TeamMemberTranscriptRow = { kind: "user"; message: UiMessage } | SubagentRunItem;

export function buildTeamMemberTranscriptRows(messages: readonly UiMessage[]): TeamMemberTranscriptRow[] {
  const rows: TeamMemberTranscriptRow[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      rows.push({ kind: "user", message });
    } else if (message.role === "tool" || (message.role === "assistant" && message.toolName)) {
      rows.push({ kind: "tool", message });
    } else if (message.role === "assistant") {
      if (messageThinking(message)) rows.push({ kind: "thinking", message });
      if (message.content.trim() || message.error) rows.push({ kind: "answer", message });
    }
  }
  return rows;
}
