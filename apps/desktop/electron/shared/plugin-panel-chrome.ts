export const PLUGIN_PANEL_TITLEBAR_HEIGHT = 46;

export type PluginPanelTheme = "light" | "dark";

export const PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX = "--pi-plugin-panel-locale=";

export const PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL =
  "pi-plugin-panel-window-control";
export const PLUGIN_PANEL_WINDOW_STATE_CHANNEL =
  "pi-plugin-panel-window-state";

export const PLUGIN_PANEL_WINDOW_CONTROL_ACTIONS = [
  "getState",
  "minimize",
  "toggleMaximize",
  "close",
] as const;

export type PluginPanelWindowControlAction =
  (typeof PLUGIN_PANEL_WINDOW_CONTROL_ACTIONS)[number];

export function isPluginPanelWindowControlAction(
  value: unknown,
): value is PluginPanelWindowControlAction {
  return (
    typeof value === "string" &&
    PLUGIN_PANEL_WINDOW_CONTROL_ACTIONS.includes(
      value as PluginPanelWindowControlAction,
    )
  );
}
