import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "@pi-desktop/shared";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { TooltipButton } from "../../../components/ui";
import { IconCheck, IconChevronDown } from "../../../components/icons";
import { ModeIcon } from "./ComposerModeIcon";

export type ComposerContractPickerProps = {
  t: TFunction;
  mode: Mode;
  planningLive: boolean;
  disabled?: boolean;
  controlsBlocked?: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onSelectMode: (mode: Mode) => Promise<void> | void;
  onCloseOtherMenus?: () => void;
};

export function ComposerContractPicker({
  t,
  mode,
  planningLive,
  disabled = false,
  controlsBlocked = false,
  open,
  setOpen,
  onSelectMode,
  onCloseOtherMenus,
}: ComposerContractPickerProps) {
  const getContractLabel = (m: Mode) => {
    switch (m) {
      case "agent":
        return t("chat.contractNone");
      case "plan":
        return t("settings.modePlan");
      case "goal":
        return t("settings.modeGoal");
    }
  };

  const getContractDesc = (m: Mode) => {
    switch (m) {
      case "agent":
        return t("chat.contractNoneDesc");
      case "plan":
        return t("chat.contractPlanDesc");
      case "goal":
        return t("chat.contractGoalDesc");
    }
  };

  const label = getContractLabel(mode);
  const tooltip = planningLive
    ? t(`${mode}.planning`)
    : `${t("chat.contractMode")}: ${label}`;

  return (
    <AnchoredMenu
      className="composer-contract"
      open={open && !disabled}
      onClose={() => setOpen(false)}
      menuClassName="composer-contract-menu"
      label={t("chat.contractMode")}
      role="menu"
      align="start"
      side="top"
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn mode-chip composer-mode-chip composer-contract-chip ${open ? "active" : ""}`}
          data-mode={mode}
          data-planning={planningLive ? "true" : undefined}
          tooltip={tooltip}
          ariaLabel={tooltip}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled || controlsBlocked}
          onClick={() => {
            onCloseOtherMenus?.();
            setOpen((prev) => !prev);
          }}
        >
          <span className="composer-mode-chip-face" key={mode}>
            <ModeIcon mode={mode} />
            <span className="composer-mode-chip-label text-sm">{label}</span>
          </span>
          <IconChevronDown size={12} />
        </TooltipButton>
      )}
    >
      {(["agent", "plan", "goal"] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="menuitemradio"
          aria-checked={mode === candidate}
          disabled={controlsBlocked}
          className={`composer-plus-item ${mode === candidate ? "active" : ""}`}
          onClick={async () => {
            setOpen(false);
            if (mode !== candidate) {
              await onSelectMode(candidate);
            }
          }}
        >
          <span className="composer-item-icon">
            <ModeIcon mode={candidate} />
          </span>
          <div className="flex-1 text-left min-w-0">
            <div className="font-medium text-sm">{getContractLabel(candidate)}</div>
            <div className="text-xs text-muted truncate">
              {getContractDesc(candidate)}
            </div>
          </div>
          {mode === candidate ? <IconCheck size={13} /> : null}
        </button>
      ))}
    </AnchoredMenu>
  );
}
