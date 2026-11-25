import type { FsIndexEntry } from "@pi-desktop/shared";

/** The most workspace entries the Add menu lists for one search. */
export const PLUS_MENU_FILE_LIMIT = 10;

/** The last segment of a path, or the path itself when it has none. */
export function fileLeaf(path: string): string {
  const parts = path.split(/[\/\\]/);
  return parts[parts.length - 1] || path;
}

/** The folder part of a path, empty for a file at the workspace root. */
export function fileDir(path: string): string {
  const parts = path.split(/[\/\\]/);
  parts.pop();
  return parts.join("/");
}

/**
 * Workspace entries matching a search. Files are a search result in the Add
 * menu, never a default list: the `@` autocomplete is the browsing entry, and
 * an unsearched list buried the commands and the mode switches below it.
 */
export function searchPlusMenuFiles(
  entries: readonly FsIndexEntry[],
  query: string,
): FsIndexEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries
    .filter((entry) => entry.path.toLowerCase().includes(needle))
    .slice(0, PLUS_MENU_FILE_LIMIT);
}
