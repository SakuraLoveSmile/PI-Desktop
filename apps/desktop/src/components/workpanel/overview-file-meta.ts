export type OverviewFileGlyph = { text: string; tone: "markup" | "plain" };

const MARKUP_EXTENSIONS = new Set(["html", "htm", "xml", "svg"]);
const STYLE_EXTENSIONS = new Set(["css", "scss", "less"]);
const SCRIPT_GLYPHS: Record<string, string> = { js: "JS", jsx: "JS", mjs: "JS", cjs: "JS", ts: "TS", tsx: "TS" };

/**
 * Glyph for a recorded file, chosen by its extension. Unknown types return null so the row keeps the generic
 * file icon. The palette has no per-language colour, so only markup takes the warning tone.
 */
export function overviewFileGlyph(path: string): OverviewFileGlyph | null {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (MARKUP_EXTENSIONS.has(extension)) return { text: "<>", tone: "markup" };
  if (STYLE_EXTENSIONS.has(extension)) return { text: "#", tone: "plain" };
  const script = SCRIPT_GLYPHS[extension];
  return script ? { text: script, tone: "plain" } : null;
}

/**
 * Exact line counts for one recorded file. A file with any inexact recorded edit has no counts at all,
 * so the row never shows a partial total as if it were the whole change.
 */
export function overviewLineCounts(
  counts: { addedLines?: number; removedLines?: number } | undefined,
): { added: number; removed: number } | null {
  if (counts?.addedLines === undefined || counts.removedLines === undefined) return null;
  if (counts.addedLines === 0 && counts.removedLines === 0) return null;
  return { added: counts.addedLines, removed: counts.removedLines };
}
