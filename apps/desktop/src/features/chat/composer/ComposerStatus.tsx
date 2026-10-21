import type { TFunction } from "i18next";
import { useEffect, useRef } from "react";
import { TooltipButton } from "../../../components/ui";
import { IconFolder, IconX } from "../../../components/icons";
import type { ComposerDropItem } from "../../../lib/composer-drop";
import type { QueuedPrompt, QueuedPromptDirection } from "../../../lib/queued-prompts";
import { useAppStore } from "../../../stores/app-store";
import { ComposerQueue } from "./ComposerQueue";

export type ComposerStatusProps = {
  t: TFunction;
  queueScopeKey: string;
  queuedPrompts: readonly QueuedPrompt[];
  removeQueuedPrompt: (id: string) => void;
  moveQueuedPrompt: (id: string, direction: QueuedPromptDirection) => Promise<void>;
  editQueuedPrompt: (id: string) => void;
  sendQueuedNow: (id: string) => Promise<void>;
  approvalPending: boolean;
  enhancementError: { message: string; code: string } | null;
  clearEnhancementError: () => void;
  droppedDirectories: ComposerDropItem[];
  openDroppedFolderAsProject: () => Promise<void>;
  insertDroppedDirectoryPaths: () => void;
  dismissDroppedDirectories: () => void;
};

/** Non-editor composer status rows: queue, folder drops, and the one-shot
 *  enhancement failure, which is reported through the global toast. */
export function ComposerStatus({
  t,
  queueScopeKey,
  queuedPrompts,
  removeQueuedPrompt,
  moveQueuedPrompt,
  editQueuedPrompt,
  sendQueuedNow,
  approvalPending,
  enhancementError,
  clearEnhancementError,
  droppedDirectories,
  openDroppedFolderAsProject,
  insertDroppedDirectoryPaths,
  dismissDroppedDirectories,
}: ComposerStatusProps) {
  const showToast = useAppStore((state) => state.showToast);
  // A failed enhancement is a one-shot result of the Enhance action: it goes to
  // the toast stack and the pending error is cleared, so a remount can neither
  // re-report it nor render the old inline row again.
  const reportedEnhancementError = useRef<string | null>(null);
  useEffect(() => {
    if (!enhancementError) {
      reportedEnhancementError.current = null;
      return;
    }
    const key = `${enhancementError.code}\u0000${enhancementError.message}`;
    if (reportedEnhancementError.current === key) return;
    reportedEnhancementError.current = key;
    // The store already reads the provider's own answer as either a specific
    // reason or the generic failure, so the sentence is not prefixed again; the
    // inline row carried the verbatim code, so the toast keeps it.
    showToast(
      `${enhancementError.message} (${enhancementError.code})`,
      { variant: "error" },
    );
    clearEnhancementError();
  }, [enhancementError, clearEnhancementError, showToast, t]);

  return (
    <>
      <ComposerQueue
        t={t}
        queueScopeKey={queueScopeKey}
        queuedPrompts={queuedPrompts}
        removeQueuedPrompt={removeQueuedPrompt}
        moveQueuedPrompt={moveQueuedPrompt}
        editQueuedPrompt={editQueuedPrompt}
        sendQueuedNow={sendQueuedNow}
        approvalPending={approvalPending}
      />
      {droppedDirectories.length ? (
        <div className="composer-directory-drop" role="status">
          <IconFolder size={13} aria-hidden />
          <span className="composer-directory-drop-name">
            {t("project.droppedFolder", {
              count: droppedDirectories.length,
              defaultValue: "Folder dropped",
            })}
          </span>
          <button
            type="button"
            className="composer-directory-drop-action"
            data-action="open-dropped-folder-project"
            onClick={() => void openDroppedFolderAsProject()}
          >
            {t("project.openAsProject", { defaultValue: "Open as project" })}
          </button>
          <button
            type="button"
            className="composer-directory-drop-action"
            data-action="reference-dropped-folder"
            onClick={insertDroppedDirectoryPaths}
          >
            {t("project.referenceFolder", { defaultValue: "Reference folder" })}
          </button>
          <TooltipButton
            type="button"
            className="composer-directory-drop-dismiss"
            tooltip={t("nav.dismissFolderDrop")}
            ariaLabel={t("nav.dismissFolderDrop")}
            onClick={dismissDroppedDirectories}
          >
            <IconX size={13} aria-hidden />
          </TooltipButton>
        </div>
      ) : null}
    </>
  );
}
