import type { UiMessage } from "@pi-desktop/shared";
import type { RecordedResource } from "../../../components/workpanel/overview-recorded-resources";
import { reviewChangeFromMessage } from "../../../lib/workspace-review";

export type ActivityChangedFile = RecordedResource & {
  path: string;
  changeCount: number;
  lastChangedAt?: string;
  messageId?: string;
  addedLines?: number;
  removedLines?: number;
  groupLabel?: string;
};

export type ActivityWebsite = {
  id: string;
  label: string;
  url: string;
  domain: string;
  sourceCount: number;
};

type LineCounts = { addedLines: number; removedLines: number };
const CHANGE_TOOLS = new Set(["Write", "Edit", "write", "edit"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function literalPath(args: Record<string, unknown> | undefined): string | undefined {
  return [args?.path, args?.file_path, args?.filePath].find((value): value is string =>
    typeof value === "string" && value.trim().length > 0 && !value.includes("\0"));
}

/** Do not reinterpret a Unix filename containing backslashes as a Windows path. */
function literalDirectory(path: string): string | undefined {
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
  const separator = windows ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) : path.lastIndexOf("/");
  return separator < 0 ? undefined : path.slice(0, separator) || "/";
}

function changeLineCounts(message: UiMessage, path: string): LineCounts | undefined {
  const change = reviewChangeFromMessage(message);
  if (change) {
    // Host uses zero as a placeholder for binary/truncated previews, not a full count.
    if (change.path !== path || change.messageId !== message.id || change.binary || change.truncated
      || !Number.isSafeInteger(change.additions) || !Number.isSafeInteger(change.deletions)) return undefined;
    return { addedLines: change.additions, removedLines: change.deletions };
  }
  // Legacy replacement snippets do not establish full-file line boundaries.
  return undefined;
}

function changeTime(message: UiMessage): string | undefined {
  return [message.toolCompletedAt, message.createdAt].find((value) =>
    typeof value === "string" && Number.isFinite(Date.parse(value)));
}

/** Loaded transcript evidence only; no filesystem lookup, path alias guessing or session cache. */
export function activityChangedFiles(messages: readonly UiMessage[]): ActivityChangedFile[] {
  const files = new Map<string, ActivityChangedFile>();
  for (const message of messages) {
    if (message.role !== "tool" || message.toolStatus !== "success" || message.isError || !CHANGE_TOOLS.has(message.toolName ?? "")) continue;
    const args = record(message.toolArgs);
    const path = literalPath(args);
    if (!path) continue;
    const counts = changeLineCounts(message, path);
    const time = changeTime(message);
    const existing = files.get(path);
    if (!existing) {
      const groupLabel = literalDirectory(path);
      files.set(path, { id: path, label: path, path, changeCount: 1, messageId: message.id,
        ...(time ? { lastChangedAt: time } : {}), ...(groupLabel ? { groupLabel } : {}), ...counts });
      continue;
    }
    existing.changeCount += 1;
    if (!existing.lastChangedAt || (time && Date.parse(time) >= Date.parse(existing.lastChangedAt))) {
      existing.messageId = message.id;
      if (time) existing.lastChangedAt = time;
    }
    // Unknown operations invalidate the total, even if some earlier operations had full evidence.
    if (!counts || existing.addedLines === undefined || existing.removedLines === undefined
      || !Number.isSafeInteger(existing.addedLines + counts.addedLines)
      || !Number.isSafeInteger(existing.removedLines + counts.removedLines)) {
      delete existing.addedLines;
      delete existing.removedLines;
    } else {
      existing.addedLines += counts.addedLines;
      existing.removedLines += counts.removedLines;
    }
  }
  return [...files.values()];
}

/** Each safe captured citation counts once; domain grouping keeps its first actionable URL. */
export function activityWebsites(messages: readonly UiMessage[]): ActivityWebsite[] {
  const websites = new Map<string, ActivityWebsite>();
  for (const message of messages) for (const round of message.hostedSearch?.rounds ?? []) {
    for (const source of round.sources ?? []) {
      try {
        const url = new URL(source.url);
        if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) continue;
        const existing = websites.get(url.hostname);
        if (existing) existing.sourceCount += 1;
        else websites.set(url.hostname, { id: url.href, label: source.title || url.hostname,
          url: url.href, domain: url.hostname, sourceCount: 1 });
      } catch { /* A malformed captured URL is not an actionable source. */ }
    }
  }
  return [...websites.values()];
}
