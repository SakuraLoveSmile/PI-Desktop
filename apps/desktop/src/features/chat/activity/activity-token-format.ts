import { formatCompactTokenCount } from "@pi-desktop/shared";

/** Chinese counts in units of ten thousand: `8.2万` (`8.2萬` in Traditional Chinese) where other locales write `82K`. */
function tenThousandUnit(language: string): "万" | "萬" | undefined {
  if (/^zh-(?:TW|HK|MO|Hant)/i.test(language)) return "萬";
  return /^zh(?:-|$)/i.test(language) ? "万" : undefined;
}

/**
 * A token count for the rail's Context section. Chinese locales read it in 万 (one decimal, never a trailing `.0`);
 * a count below ten thousand is written out in full. Every other locale keeps the shared K/M form the composer uses.
 */
export function formatActivityTokens(tokens: number, language: string): string {
  const unit = tenThousandUnit(language);
  if (!unit) return formatCompactTokenCount(tokens);
  if (tokens < 10_000) return tokens.toLocaleString(language);
  return `${Math.round(tokens / 1_000) / 10}${unit}`;
}
