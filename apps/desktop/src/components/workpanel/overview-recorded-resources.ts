import type { UiMessage } from "@pi-desktop/shared";

export type RecordedResource = { id: string; label: string; path?: string };
export type OverviewReferences = { skills: RecordedResource[]; memory: RecordedResource[]; mcp: RecordedResource[] };

function argumentString(args: unknown, names: string[]): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const values = args as Record<string, unknown>;
  return names.map((name) => values[name]).find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

/** Use recorded actions only, never enabled extension inventories or assistant claims. */
export function recordedOverviewResources(messages: UiMessage[]): {
  changedFiles: RecordedResource[];
  attachments: RecordedResource[];
  references: OverviewReferences;
} {
  const files = new Map<string, RecordedResource>();
  const attachments = new Map<string, RecordedResource>();
  const skills = new Map<string, RecordedResource>();
  const mcp = new Map<string, RecordedResource>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "session") continue;
      attachments.set(attachment.ref, { id: attachment.ref, label: attachment.name || attachment.ref, path: attachment.ref });
    }
    for (const mention of message.skillMentions ?? []) {
      skills.set(mention.id, { id: mention.id, label: mention.id });
    }
    if (message.role !== "tool" || message.toolStatus !== "success" || message.isError) continue;
    if (["Write", "Edit", "write", "edit"].includes(message.toolName ?? "")) {
      const path = argumentString(message.toolArgs, ["path", "file_path", "filePath"]);
      if (path) files.set(path, { id: path, label: path, path });
    }
    if (message.toolName === "Skill") {
      const id = argumentString(message.toolArgs, ["id"]);
      if (id) skills.set(id, { id, label: id });
    }
    if (message.toolName?.startsWith("mcp_")) {
      mcp.set(message.toolName, { id: message.toolName, label: message.toolName });
    }
  }
  return { changedFiles: [...files.values()], attachments: [...attachments.values()],
    references: { skills: [...skills.values()], memory: [], mcp: [...mcp.values()] } };
}

/** File rows lead with the file name; an item that already carries a detail keeps it. */
export function overviewRowText(item: { label: string; detail?: string }): { label: string; detail?: string } {
  if (item.detail) return { label: item.label, detail: item.detail };
  const separator = Math.max(item.label.lastIndexOf("/"), item.label.lastIndexOf("\\"));
  if (separator <= 0 || separator === item.label.length - 1) return { label: item.label };
  return { label: item.label.slice(separator + 1), detail: item.label.slice(0, separator) };
}
