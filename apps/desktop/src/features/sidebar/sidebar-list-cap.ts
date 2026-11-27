/**
 * Split a sidebar list into the rows a collapsed section shows and the count
 * its "load more" row reports. One team group or project counts as one entry:
 * the caller passes top-level rows, never their members.
 */
export function capSidebarEntries<T>(
  entries: readonly T[],
  cap: number,
  expanded: boolean,
): { visible: T[]; hiddenCount: number } {
  const visible = expanded ? [...entries] : entries.slice(0, Math.max(0, cap));
  return { visible, hiddenCount: entries.length - visible.length };
}
