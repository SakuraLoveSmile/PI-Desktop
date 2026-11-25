import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { ExecutionProfile } from "@pi-desktop/shared";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { TooltipButton } from "../../../components/ui";
import {
  IconCheck,
  IconChevronDown,
  IconUser,
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

export type ComposerExecutionProfileOptionsProps = {
  t: TFunction;
  executionProfile: ExecutionProfile;
  controlsBlocked: boolean;
  canSwitchToStandard: boolean;
  onChoose: (profile: ExecutionProfile) => void;
};

/**
 * The two profile rows, each a name over its description with a check on the
 * current one. A running team may not be switched back to standard while a
 * teammate is mid-run, so that row stays disabled until it can be.
 */
export function ComposerExecutionProfileOptions({
  t,
  executionProfile,
  controlsBlocked,
  canSwitchToStandard,
  onChoose,
}: ComposerExecutionProfileOptionsProps) {
  const rows = [
    {
      profile: "standard",
      Icon: IconUser,
      name: t("chat.profileAgent"),
      description: t("chat.profileAgentDesc"),
      disabled: controlsBlocked || (!canSwitchToStandard && executionProfile === "team"),
    },
    {
      profile: "team",
      Icon: IconUsers,
      name: t("chat.profileTeam"),
      description: t("chat.profileTeamDesc"),
      disabled: controlsBlocked,
    },
  ] as const;
  return (
    <>
      {rows.map(({ profile, Icon, name, description, disabled }) => {
        const active = executionProfile === profile;
        return (
          <button
            key={profile}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            disabled={disabled}
            className={`composer-plus-item is-two-line ${active ? "active" : ""}`}
            onClick={() => onChoose(profile)}
          >
            <Icon size={15} className="composer-item-icon" />
            <span className="composer-plus-item-text">
              <span className="composer-plus-item-name">{name}</span>
              <span className="composer-plus-item-desc">{description}</span>
            </span>
            {active ? <IconCheck size={15} className="composer-menu-check" /> : null}
          </button>
        );
      })}
    </>
  );
}

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
            {isTeam ? <IconUsers size={14} /> : <IconUser size={14} />}
            <span className="composer-mode-chip-label text-sm">{label}</span>
          </span>
          <IconChevronDown size={12} />
        </TooltipButton>
      )}
    >
      <ComposerExecutionProfileOptions
        t={t}
        executionProfile={executionProfile}
        controlsBlocked={controlsBlocked}
        canSwitchToStandard={canSwitchToStandard}
        onChoose={async (profile) => {
          setOpen(false);
          if (profile !== executionProfile) await onSelectProfile(profile);
        }}
      />
    </AnchoredMenu>
  );
}
