import type { TFunction } from "i18next";
import type { Mode } from "@pi-desktop/shared";
import { IconX } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { ModeIcon } from "./ComposerModeIcon";
import { isComposerContractVisible } from "./model";

export type ComposerContractPickerProps = {
  t: TFunction;
  mode: Mode;
  displayMode?: Mode;
  planningLive: boolean;
  /** A plan awaiting approval; the host refuses a mode change until it is resolved. */
  planAwaitingApproval?: boolean;
  goalExecutionActive?: boolean;
  disabled?: boolean;
  controlsBlocked?: boolean;
  onClick: () => void;
  /** Leaves Plan for Agent. Offered only while Plan is the committed mode. */
  onExitPlan?: () => void;
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
  planAwaitingApproval = false,
  goalExecutionActive = false,
  disabled = false,
  controlsBlocked = false,
  onClick,
  onExitPlan,
}: ComposerContractPickerProps) {
  const effectiveMode = displayMode ?? mode;
  if (!isComposerContractVisible(effectiveMode, goalExecutionActive)) {
    return null;
  }

  const label = effectiveMode === "plan" ? t("settings.modePlan") : t("settings.modeGoal");
  const tooltip = planningLive
    ? t(`${effectiveMode}.planning`)
    : `${t("chat.contractMode")}: ${label}`;

  const chip = (
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
  // The close control sits beside the chip, not inside it: buttons cannot nest.
  if (!onExitPlan || mode !== "plan" || effectiveMode !== "plan") return chip;

  const exitLabel = t("chat.exitPlanMode");
  return (
    <span className="composer-contract-group">
      {chip}
      <TooltipButton
        type="button"
        className="icon-btn composer-contract-exit"
        tooltip={exitLabel}
        ariaLabel={exitLabel}
        disabled={disabled || controlsBlocked || planningLive || planAwaitingApproval}
        onClick={onExitPlan}
      >
        <IconX size={12} />
      </TooltipButton>
    </span>
  );
}
