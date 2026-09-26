import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { ExecutionProfile } from "@pi-desktop/shared";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { TooltipButton } from "../../../components/ui";
import {
  IconBot,
  IconCheck,
  IconChevronDown,
  IconUsers,
} from "../../../components/icons";

export type ComposerExecutionProfilePickerProps = {
  t: TFunction;
  executionProfile: ExecutionProfile;
  disabled?: boolean;
  controlsBlocked?: boolean;
  runActive?: boolean;
  canSwitchToStandard?: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onSelectProfile: (profile: ExecutionProfile) => Promise<void> | void;
  onCloseOtherMenus?: () => void;
};

export function ComposerExecutionProfilePicker({
  t,
  executionProfile,
  disabled = false,
  controlsBlocked = false,
  canSwitchToStandard = true,
  open,
  setOpen,
  onSelectProfile,
  onCloseOtherMenus,
}: ComposerExecutionProfilePickerProps) {
  const isTeam = executionProfile === "team";
  const label = isTeam ? t("chat.profileTeam") : t("chat.profileAgent");
  const tooltip = isTeam
    ? `${t("chat.profileTeam")} · ${t("chat.profileTeamDesc")}`
    : `${t("chat.profileAgent")} · ${t("chat.profileAgentDesc")}`;

  return (
    <AnchoredMenu
      className="composer-profile"
      open={open && !disabled}
      onClose={() => setOpen(false)}
      menuClassName="composer-profile-menu"
      label={t("chat.executionProfile")}
      role="menu"
      align="start"
      side="top"
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn mode-chip composer-mode-chip composer-profile-chip ${open ? "active" : ""}`}
          data-profile={executionProfile}
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
          <span className="composer-mode-chip-face" key={executionProfile}>
            {isTeam ? <IconUsers size={14} /> : <IconBot size={14} />}
            <span className="composer-mode-chip-label text-sm">{label}</span>
          </span>
          <IconChevronDown size={12} />
        </TooltipButton>
      )}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={executionProfile === "standard"}
        disabled={controlsBlocked || (!canSwitchToStandard && isTeam)}
        className={`composer-plus-item ${executionProfile === "standard" ? "active" : ""}`}
        onClick={async () => {
          setOpen(false);
          if (executionProfile !== "standard") {
            await onSelectProfile("standard");
          }
        }}
      >
        <IconBot size={14} className="composer-item-icon" />
        <div className="flex-1 text-left min-w-0">
          <div className="font-medium text-sm">{t("chat.profileAgent")}</div>
          <div className="text-xs text-muted truncate">
            {t("chat.profileAgentDesc")}
          </div>
        </div>
        {executionProfile === "standard" ? <IconCheck size={13} /> : null}
      </button>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={executionProfile === "team"}
        disabled={controlsBlocked}
        className={`composer-plus-item ${executionProfile === "team" ? "active" : ""}`}
        onClick={async () => {
          setOpen(false);
          if (executionProfile !== "team") {
            await onSelectProfile("team");
          }
        }}
      >
        <IconUsers size={14} className="composer-item-icon" />
        <div className="flex-1 text-left min-w-0">
          <div className="font-medium text-sm">{t("chat.profileTeam")}</div>
          <div className="text-xs text-muted truncate">
            {t("chat.profileTeamDesc")}
          </div>
          <div className="text-xs text-amber-500/80 truncate">
            {t("chat.profileTeamNotice")}
          </div>
        </div>
        {executionProfile === "team" ? <IconCheck size={13} /> : null}
      </button>
    </AnchoredMenu>
  );
}
