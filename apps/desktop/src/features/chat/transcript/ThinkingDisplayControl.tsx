import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import { resolveThinkingDisplayMode } from "../../../lib/turn-process";
import { SegmentedControl } from "../../../components/ui";
import "../../../styles/thinking-display-control.css";

export type ThinkingDisplayMode = NonNullable<
  AppSettings["thinkingDisplayMode"]
>;

export type ThinkingDisplayControlProps = {
  /** The persisted setting, with detailed as the backwards-compatible default. */
  mode: AppSettings["thinkingDisplayMode"];
  onChange: (mode: ThinkingDisplayMode) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
};

/**
 * Chat-level mirror of the Settings display preference.
 *
 * Persistence deliberately belongs to the caller so the transcript toolbar
 * can use the same settings write path as the Settings page without creating
 * a second source of truth.
 */
export function ThinkingDisplayControl({
  mode,
  onChange,
  disabled = false,
  className,
}: ThinkingDisplayControlProps) {
  const { t } = useTranslation();
  const current = resolveThinkingDisplayMode(mode);
  return (
    <div
      className={
        className
          ? `thinking-display-control ${className}`
          : "thinking-display-control"
      }
    >
      <SegmentedControl
        value={current}
        onChange={(value) => void onChange(resolveThinkingDisplayMode(value))}
        disabled={disabled}
        options={[
          { value: "detailed", label: t("settings.thinkingDisplayDetailed") },
          { value: "compact", label: t("settings.thinkingDisplayCompact") },
        ]}
        label={t("settings.thinkingDisplayMode")}
      />
    </div>
  );
}
