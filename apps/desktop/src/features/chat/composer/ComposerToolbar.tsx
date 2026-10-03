import { useState } from "react";
import type { TFunction } from "i18next";
import {
  keybindingDisplayParts,
  type ComposerCommand,
  type ExecutionProfile,
  type Mode,
  type PermissionMode,
  type ShortcutPlatform,
  type SessionThinkingLevel,
} from "@pi-desktop/shared";
import type { AppState } from "../../../stores/app-store";
import { TooltipButton } from "../../../components/ui";
import {
  IconArrowUp,
  IconSparkles,
  IconStop,
  IconUndo2,
} from "../../../components/icons";
import { LiveVoiceControls } from "../../voice/live/LiveVoiceControls";
import { ComposerPlusMenu } from "./ComposerPlusMenu";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { ComposerExecutionProfilePicker } from "./ComposerExecutionProfilePicker";
import { ComposerContractPicker } from "./ComposerContractPicker";
import { ComposerControlSlots } from "./ComposerControlSlots";
import type { useComposerModelMenu } from "./hooks/useComposerModelMenu";

type ModelMenuController = ReturnType<typeof useComposerModelMenu>;

export type ComposerToolbarProps = {
  t: TFunction;
  mode: Mode;
  displayMode?: Mode;
  executionProfile?: ExecutionProfile;
  planningLive: boolean;
  providerId?: string;
  modelId?: string;
  thinkingLevel: SessionThinkingLevel;
  sessionPermissionMode: PermissionMode;
  controlsBlocked: boolean;
  pasting: boolean;
  pickAndAttach: () => Promise<void>;
  configureActiveSession: AppState["configureActiveSession"];
  showToast: AppState["showToast"];
  modelMenu: ModelMenuController;
  modelLabel: string;
  thinkingLabel: string;
  enhancementDraft: string;
  value: string;
  modelReady: boolean;
  sendBlocked: boolean;
  enhancingPrompt: boolean;
  enhancementUndoText: string | null;
  enhancePrompt: () => Promise<void>;
  undoPromptEnhancement: () => void;
  runActive: boolean;
  hasDraftContent: boolean;
  abort: AppState["abort"];
  submit: () => Promise<void>;
  onInsertReference: (item: { path: string; name: string; isDir: boolean }) => void;
  onInsertCommand: (command: ComposerCommand) => void;
  workSessionId?: string;
  workSessionLabel?: string;
};

/**
 * Composer toolbar:
 * Left to right: fixed `+` menu trigger, profile picker, model/reasoning picker,
 * compact mode indicator (when Plan or Goal is active).
 * Right: plugin controls, prompt enhancement, live voice, send/stop.
 */
export function ComposerToolbar({
  t,
  mode,
  displayMode,
  executionProfile = "standard",
  planningLive,
  providerId,
  modelId,
  thinkingLevel,
  sessionPermissionMode,
  controlsBlocked,
  pasting,
  pickAndAttach,
  configureActiveSession,
  showToast,
  modelMenu,
  modelLabel,
  thinkingLabel,
  enhancementDraft,
  value,
  modelReady,
  sendBlocked,
  enhancingPrompt,
  enhancementUndoText,
  enhancePrompt,
  undoPromptEnhancement,
  runActive,
  hasDraftContent,
  abort,
  submit,
  onInsertReference,
  onInsertCommand,
  workSessionId,
  workSessionLabel,
}: ComposerToolbarProps) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const platform = (window.piDesktop?.platform ?? "darwin") as ShortcutPlatform;
  const steeringShortcut = keybindingDisplayParts("Alt+Enter", platform).join("+");

  const closeAllMenus = () => {
    setPlusOpen(false);
    setProfileOpen(false);
    modelMenu.setOpen(false);
  };

  return (
    <div className="composer-toolbar">
      {/* Slot 1 (+), Slot 2 (Profile), Slot 3 (Model), Slot 4 (Mode Indicator) */}
      <div className="composer-left">
        {/* Slot 1: Anchored Plus Menu */}
        <ComposerPlusMenu
          t={t}
          mode={mode}
          executionProfile={executionProfile}
          disabled={controlsBlocked || pasting}
          controlsBlocked={controlsBlocked}
          open={plusOpen}
          setOpen={setPlusOpen}
          onSelectProfile={async (profile) => {
            try {
              await configureActiveSession({
                mode,
                providerId,
                modelId,
                thinkingLevel,
                permissionMode: sessionPermissionMode,
                executionProfile: profile,
              });
            } catch (error) {
              showToast(error instanceof Error ? error.message : String(error), {
                variant: "error",
              });
            }
          }}
          onSelectMode={async (nextMode) => {
            try {
              await configureActiveSession({
                mode: nextMode,
                providerId,
                modelId,
                thinkingLevel,
                permissionMode: sessionPermissionMode,
                executionProfile,
              });
            } catch (error) {
              showToast(error instanceof Error ? error.message : String(error), {
                variant: "error",
              });
            }
          }}
          onPickAndAttach={pickAndAttach}
          onInsertReference={onInsertReference}
          onInsertCommand={onInsertCommand}
          onCloseOtherMenus={() => {
            setProfileOpen(false);
            modelMenu.setOpen(false);
          }}
        />

        {/* Slot 2: Agent / Expert Team Profile Picker */}
        <ComposerExecutionProfilePicker
          t={t}
          executionProfile={executionProfile}
          disabled={controlsBlocked}
          controlsBlocked={controlsBlocked}
          runActive={runActive}
          open={profileOpen}
          setOpen={setProfileOpen}
          onSelectProfile={async (profile) => {
            try {
              await configureActiveSession({
                mode,
                providerId,
                modelId,
                thinkingLevel,
                permissionMode: sessionPermissionMode,
                executionProfile: profile,
              });
            } catch (error) {
              showToast(error instanceof Error ? error.message : String(error), {
                variant: "error",
              });
            }
          }}
          onCloseOtherMenus={() => {
            setPlusOpen(false);
            modelMenu.setOpen(false);
          }}
        />

        {/* Slot 3: Model and Reasoning Picker */}
        <ComposerModelPicker
          t={t}
          controller={modelMenu}
          modelLabel={modelLabel}
          thinkingLabel={thinkingLabel}
          thinkingLevel={thinkingLevel}
          selectedProviderId={providerId}
          selectedModelId={modelId}
          controlsBlocked={controlsBlocked}
          onCloseOtherMenus={() => {
            setPlusOpen(false);
            setProfileOpen(false);
          }}
        />

        {/* Slot 4: Compact Indicator only when Plan or Goal is active */}
        <ComposerContractPicker
          t={t}
          mode={mode}
          displayMode={displayMode}
          planningLive={planningLive}
          disabled={controlsBlocked}
          controlsBlocked={controlsBlocked}
          onClick={() => {
            closeAllMenus();
            setPlusOpen(true);
          }}
        />
        <ComposerControlSlots side="left" />
      </div>

      {/* Right side: Plugin controls, Enhancement, Live voice, Send/Stop */}
      <div className="composer-right">
        <ComposerControlSlots side="right" />
        <TooltipButton
          type="button"
          className={`icon-btn icon-btn-square composer-enhance-btn${enhancingPrompt ? " is-loading" : ""}`}
          tooltip={t("chat.enhancePrompt")}
          ariaLabel={enhancingPrompt ? t("chat.enhancingPrompt") : t("chat.enhancePrompt")}
          aria-busy={enhancingPrompt}
          disabled={
            !enhancementDraft.trim() ||
            enhancementDraft.trim().startsWith("/") ||
            !modelReady ||
            sendBlocked ||
            enhancingPrompt
          }
          onClick={() => void enhancePrompt()}
        >
          {enhancingPrompt ? (
            <>
              <span className="tool-spinner" aria-hidden="true" />
              <span>{t("chat.enhancingPrompt")}</span>
            </>
          ) : (
            <IconSparkles size={15} aria-hidden="true" />
          )}
        </TooltipButton>

        {enhancementUndoText !== null ? (
          <TooltipButton
            type="button"
            className="icon-btn icon-btn-square composer-enhance-undo"
            tooltip={t("chat.undoEnhancement")}
            ariaLabel={t("chat.undoEnhancement")}
            disabled={controlsBlocked}
            onClick={undoPromptEnhancement}
          >
            <IconUndo2 size={15} aria-hidden="true" />
          </TooltipButton>
        ) : null}

        <LiveVoiceControls t={t} workSessionId={workSessionId} />

        {runActive && !hasDraftContent ? (
          <TooltipButton
            type="button"
            className="stop-btn"
            tooltip={t("chat.stopGenerating")}
            ariaLabel={t("chat.stopGenerating")}
            onClick={() => void abort()}
          >
            <IconStop size={14} />
          </TooltipButton>
        ) : (
          <TooltipButton
            type="button"
            className="send-btn"
            ariaLabel={modelReady ? t("chat.send") : t("settings.addProvider")}
            tooltip={
              runActive
                ? t("chat.sendWhileRunning", { shortcut: steeringShortcut })
                : modelReady
                  ? t("chat.send")
                  : t("settings.addProvider")
            }
            disabled={
              !hasDraftContent ||
              sendBlocked ||
              (!modelReady && !value.trim().startsWith("/"))
            }
            onClick={() => void submit()}
          >
            <IconArrowUp size={15} />
          </TooltipButton>
        )}
      </div>
    </div>
  );
}
