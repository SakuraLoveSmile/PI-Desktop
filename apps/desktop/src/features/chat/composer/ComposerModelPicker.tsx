import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import {
  IconBot,
  IconChevronDown,
  IconSettings,
} from "../../../components/icons";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { Button, TooltipButton } from "../../../components/ui";
import { ComposerModelList } from "./ComposerModelList";
import type { useComposerModelMenu } from "./hooks/useComposerModelMenu";
import { ThinkingLevelSlider } from "./ThinkingLevelSlider";

type ModelMenuController = ReturnType<typeof useComposerModelMenu>;

export type ComposerModelPickerProps = {
  t: TFunction;
  controller: ModelMenuController;
  modelLabel: string;
  thinkingLabel: string;
  thinkingLevel: string;
  selectedProviderId?: string;
  selectedModelId?: string;
  controlsBlocked: boolean;
  onCloseOtherMenus: () => void;
  rootActions?: ReactNode;
  onOpenModelSettings?: () => void;
};

/** Model/reasoning picker with its keyboard and focus contract intact. */
export function ComposerModelPicker({
  t,
  controller,
  modelLabel,
  thinkingLabel,
  thinkingLevel,
  selectedProviderId,
  selectedModelId,
  controlsBlocked,
  onCloseOtherMenus,
  rootActions,
  onOpenModelSettings,
}: ComposerModelPickerProps) {
  const {
    open,
    setOpen,
    modelHighlight,
    setModelHighlight,
    modelListRef,
    modelGroups,
    thinkingMenuLevels,
    selectModel,
    commitThinkingLevel,
    onMenuKeyDown,
  } = controller;

  return (
    <AnchoredMenu
      className="composer-model-thinking"
      open={open}
      onClose={() => setOpen(false)}
      menuClassName="composer-model-menu composer-model-thinking-menu"
      label={`${t("chat.model")} ${t("chat.reasoningLevel")}`}
      role="menu"
      align="end"
      side="top"
      initialFocus="none"
      onMenuKeyDown={onMenuKeyDown}
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn composer-model-thinking-chip ${open ? "active" : ""}`}
          tooltip={`${modelLabel} · ${t("chat.reasoningLevel")}: ${thinkingLabel}`}
          ariaLabel={`${t("chat.model")}: ${modelLabel}. ${t("chat.reasoningLevel")}: ${thinkingLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={controlsBlocked}
          onClick={() => {
            onCloseOtherMenus();
            if (!open) {
              setModelHighlight(-1);
            }
            setOpen((current) => !current);
          }}
        >
          <span className="composer-model-thinking-icon" aria-hidden="true">
            <IconBot size={14} />
          </span>
          <span className="composer-model-thinking-model">{modelLabel}</span>
          {thinkingLevel !== "off" ? (
            <>
              <span className="composer-model-thinking-dot" aria-hidden="true">·</span>
              <span className="composer-model-thinking-level">{thinkingLabel}</span>
            </>
          ) : null}
          <IconChevronDown size={12} aria-hidden="true" className="composer-model-thinking-chevron" />
        </TooltipButton>
      )}
    >
      {rootActions}
      <ComposerModelList
        t={t} modelListRef={modelListRef}
        modelGroups={modelGroups} modelHighlight={modelHighlight}
        setModelHighlight={setModelHighlight} selectModel={selectModel}
        selectedProviderId={selectedProviderId} selectedModelId={selectedModelId}
      />
      {thinkingMenuLevels.length > 1 ? (
        <ThinkingLevelSlider
          key={`${selectedProviderId}:${selectedModelId}:${thinkingMenuLevels.join("|")}`}
          levels={thinkingMenuLevels}
          level={thinkingLevel}
          label={t("chat.reasoningLevel")}
          commit={commitThinkingLevel}
        />
      ) : null}
      {onOpenModelSettings ? (
        <>
          <div className="composer-menu-separator" />
          <Button
            type="button"
            variant="ghost"
            className="composer-model-settings"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenModelSettings();
            }}
          >
            <IconSettings size={15} aria-hidden="true" />
            <span>{t("settings.modelConfigurations")}</span>
          </Button>
        </>
      ) : null}
    </AnchoredMenu>
  );
}
