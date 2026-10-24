import type { TFunction } from "i18next";

/**
 * The reasoning chip names the off state instead of hiding it. Other levels
 * keep their canonical values, as the slider's ticks do.
 */
export function thinkingLevelLabel(level: string, t: TFunction): string {
  return level === "off" ? t("chat.thinkingOff") : level;
}
