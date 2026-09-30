import type { TFunction } from "i18next";
import type { Mode } from "@pi-desktop/shared";
import { TooltipButton } from "../../../components/ui";
import { ModeIcon } from "./ComposerModeIcon";

export type ComposerContractPickerProps = {
  t: TFunction;
  mode: Mode;
  displayMode?: Mode;
  planningLive: boolean;
  disabled?: boolean;
  controlsBlocked?: boolean;
  onClick: () => void;
};

/**
 * Compact indicator rendered only while Plan or Goal is active.
 * Clicking it opens the Composer '+' menu where mode toggles reside.
 */
export function ComposerContractPicker({
  t,
  mode,
  displayMode,
  planningLive,
  disabled = false,
  controlsBlocked = false,
  onClick,
}: ComposerContractPickerProps) {
  const effectiveMode = displayMode ?? mode;
  if (effectiveMode === "agent") {
    return null;
  }

  const label = effectiveMode === "plan" ? t("settings.modePlan") : t("settings.modeGoal");
  const tooltip = planningLive
    ? t(`${effectiveMode}.planning`)
    : `${t("chat.contractMode")}: ${label}`;

  return (
    <TooltipButton
      type="button"
      className="icon-btn mode-chip composer-mode-chip composer-contract-chip"
      data-mode={effectiveMode}
      data-planning={planningLive ? "true" : undefined}
      tooltip={tooltip}
      ariaLabel={tooltip}
      disabled={disabled || controlsBlocked}
      onClick={onClick}
    >
      <span className="composer-mode-chip-face" key={effectiveMode}>
        <ModeIcon mode={effectiveMode} />
        <span className="composer-mode-chip-label text-sm composer-mode-indicator-label">{label}</span>
      </span>
    </TooltipButton>
  );
}
