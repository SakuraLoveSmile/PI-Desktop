import { THINKING_LEVELS, type ThinkingLevel } from "./types.js";

export function highestSupportedThinkingLevel(
  levels: readonly ThinkingLevel[] | undefined,
): ThinkingLevel {
  const supported = new Set(levels ?? []);
  for (let index = THINKING_LEVELS.length - 1; index >= 0; index -= 1) {
    const level = THINKING_LEVELS[index];
    if (supported.has(level)) return level;
  }
  return "off";
}
