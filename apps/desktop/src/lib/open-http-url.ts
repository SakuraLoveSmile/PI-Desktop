import { api } from "./api";
import { useAppStore } from "../stores/app-store";

export type ResolvedLinkOpenTarget = "workpanel" | "external";

/** Persistable setting → destination. Absent or unknown values keep the work panel. */
export function resolveLinkOpenTarget(
  linkOpenTarget: string | null | undefined,
): ResolvedLinkOpenTarget {
  return linkOpenTarget === "external" ? "external" : "workpanel";
}

/** Work-panel tabs are per-session; without one the dock cannot open. */
export function canPresentWorkPanelBrowser(state: {
  activeSessionId?: string | null;
}): boolean {
  return Boolean(state.activeSessionId);
}

/**
 * Open an HTTP(S) URL using Settings → AI → Link open destination.
 *
 * Explicit preview (workspace HTML, BrowserPreview, the link context-menu
 * "Open in work panel" item) keeps calling `openUrlInWorkPanel` directly.
 *
 * Plugin/settings pages cover or unmount the dock, so a work-panel destination
 * returns to chat first. A missing session falls back to the OS browser.
 */
export function openHttpUrl(url: string): void {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return;
  const state = useAppStore.getState();
  const wantsWorkPanel =
    resolveLinkOpenTarget(state.settings?.linkOpenTarget) === "workpanel";
  if (wantsWorkPanel && canPresentWorkPanelBrowser(state)) {
    if (state.page !== "chat") {
      state.setPage("chat");
    }
    state.openUrlInWorkPanel(trimmed);
    return;
  }
  void api.browserOpenExternal(trimmed);
}
