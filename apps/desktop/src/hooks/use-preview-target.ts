import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { isHtmlFilePath, toWorkspaceRel, type ChatPreviewTarget } from "../lib/chat-links";
import { FILE_MANAGER_PLUGIN_TAB, fileManagerPluginTab } from "../lib/work-panel-tabs";

/**
 * Open a resolved chat reference in the work panel: files in the viewer, URLs
 * in the embedded browser. Shared by the transcript's tool row summaries and
 * tool result file/match lists.
 */
export function useOpenPreviewTarget() {
  const openFile = useAppStore((s) => s.openFileInWorkPanel);
  const openUrl = useAppStore((s) => s.openUrlInWorkPanel);
  return useCallback(
    (target: ChatPreviewTarget) => {
      if (target.kind === "file") openFile(target.path);
      else openUrl(target.url);
    },
    [openFile, openUrl],
  );
}

/** Dot-relative references resolve against the markdown file being viewed. */
function isDotRelative(path: string): boolean {
  return path.startsWith("./") || path.startsWith("../");
}

/**
 * Open a file reference the conversation mentioned.
 *
 * The reference is completed in the main process first, because the token is
 * routinely a shorthand: an agent that works on `/root/dir/openimage.js` names
 * only `openimage.js` in its reply, and the open project answers before the
 * session's own scratch store does.
 *
 * Completion also picks the destination. A project file goes to the bundled
 * file view (ADR 0241), which can read and edit it and shows it beside the
 * conversation that named it; a scratch or attachment file is addressed by
 * absolute path outside that plugin's project root, so it goes to the host
 * file tab, which already reaches both stores.
 *
 * A workspace `.html` page stays with the side browser (ADR 0163): it is a
 * page to run, not a file to read. A reference that matches nothing says so
 * instead of opening an empty panel.
 */
export function useOpenChatFileRef() {
  const { t } = useTranslation();
  const workspacePath = useAppStore((s) => s.workspace?.path ?? null);
  const sessionId = useAppStore((s) => s.activeSessionId);
  const pluginViews = useAppStore((s) => s.pluginViews);
  const openFile = useAppStore((s) => s.openFileInWorkPanel);
  const openUrl = useAppStore((s) => s.openUrlInWorkPanel);
  const openTab = useAppStore((s) => s.openWorkPanelTab);
  const showToast = useAppStore((s) => s.showToast);

  const fileViewAvailable = useMemo(
    () =>
      pluginViews.some(
        (view) =>
          view.pluginId === FILE_MANAGER_PLUGIN_TAB.pluginId &&
          view.viewId === FILE_MANAGER_PLUGIN_TAB.viewId,
      ),
    [pluginViews],
  );

  return useCallback(
    (path: string, baseDir?: string, mimeType?: string) => {
      const raw = String(path ?? "").trim();
      if (!raw) return;
      // `./x` and `../x` are the one shape the caller resolves better than the
      // main process can: the base is the markdown file on screen, which only
      // the caller knows. Everything else is completed against the roots.
      const anchored = isDotRelative(raw)
        ? toWorkspaceRel(raw, workspacePath, baseDir)
        : null;
      void (async () => {
        let match = null;
        try {
          match = (await api.fsResolveRef(anchored ?? raw, sessionId)).match;
        } catch {
          match = null;
        }
        if (!match) {
          showToast(t("chat.fileRefMissing", { name: raw }), {
            variant: "error",
          });
          return;
        }
        if (match.root === "workspace") {
          if (isHtmlFilePath(match.relativePath)) {
            openUrl(match.relativePath);
            return;
          }
          if (fileViewAvailable) {
            openTab(fileManagerPluginTab(match.relativePath));
            return;
          }
          openFile(match.relativePath, mimeType);
          return;
        }
        openFile(match.absolutePath, mimeType);
      })();
    },
    [
      fileViewAvailable,
      openFile,
      openTab,
      openUrl,
      sessionId,
      showToast,
      t,
      workspacePath,
    ],
  );
}
