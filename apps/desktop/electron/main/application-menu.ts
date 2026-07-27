import { Menu, type MenuItemConstructorOptions } from "electron";
import {
  APP_NAME,
  KEYBOARD_SHORTCUTS,
  keybindingToElectronAccelerator,
  resolveKeybinding,
  type AppMenuCommand,
  type KeybindingOverrides,
  type KeyboardShortcutId,
  type ShortcutPlatform,
} from "@pi-desktop/shared";
import { en, resolveLocale, zhCN } from "@pi-desktop/i18n";

export type ApplicationMenuOptions = {
  platform?: NodeJS.Platform;
  locale?: string;
  keybindings?: KeybindingOverrides;
  dispatch: (command: AppMenuCommand) => void;
};

function appCommand(
  label: string,
  command: AppMenuCommand,
  dispatch: ApplicationMenuOptions["dispatch"],
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => dispatch(command),
  };
}

export function buildApplicationMenuTemplate({
  platform = process.platform,
  locale = "en",
  keybindings,
  dispatch,
}: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const isMac = platform === "darwin";
  const shortcutPlatform = platform as ShortcutPlatform;
  const labels = resolveLocale(locale) === "zh-CN" ? zhCN : en;
  const template: MenuItemConstructorOptions[] = [];
  const accelerator = (id: KeyboardShortcutId) => {
    const shortcut = KEYBOARD_SHORTCUTS.find((candidate) => candidate.id === id);
    return shortcut
      ? keybindingToElectronAccelerator(
          resolveKeybinding(shortcut, keybindings, shortcutPlatform),
          shortcutPlatform,
        )
      : undefined;
  };

  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "about" },
        appCommand(labels.menu.checkForUpdates, "checkForUpdates", dispatch),
        { type: "separator" },
        appCommand(
          labels.menu.settings,
          "openSettings",
          dispatch,
          accelerator("openSettings"),
        ),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: labels.menu.file,
      submenu: [
        appCommand(labels.menu.newTask, "newTask", dispatch, accelerator("newTask")),
        appCommand(
          labels.menu.openProject,
          "openProject",
          dispatch,
          accelerator("openProject"),
        ),
        ...(!isMac
          ? ([
              { type: "separator" },
              appCommand(
                labels.menu.settings,
                "openSettings",
                dispatch,
                accelerator("openSettings"),
              ),
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { type: "separator" },
        { role: "close", accelerator: accelerator("closeWindow") },
      ],
    },
    {
      label: labels.menu.edit,
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? ([
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { role: "selectAll" },
      ],
    },
    {
      label: labels.menu.view,
      submenu: [
        appCommand(labels.menu.search, "openSearch", dispatch, accelerator("openSearch")),
        appCommand(
          labels.menu.commandPalette,
          "openCommandPalette",
          dispatch,
          accelerator("openCommandPalette"),
        ),
        appCommand(
          labels.menu.toggleSidebar,
          "toggleSidebar",
          dispatch,
          accelerator("toggleSidebar"),
        ),
        { type: "separator" },
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom", accelerator: accelerator("resetZoom") },
        { role: "zoomIn", accelerator: accelerator("zoomIn") },
        { role: "zoomOut", accelerator: accelerator("zoomOut") },
        { type: "separator" },
        {
          role: "togglefullscreen",
          accelerator: accelerator("toggleFullScreen"),
        },
      ],
    },
    {
      label: labels.menu.window,
      submenu: [
        { role: "minimize" },
        ...(isMac
          ? ([
              { role: "zoom" },
              { type: "separator" },
              { role: "front" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: "help",
      label: labels.menu.help,
      submenu: [
        appCommand(labels.menu.appHelp, "openHelp", dispatch),
        appCommand(labels.menu.openLogs, "openLogs", dispatch),
        ...(!isMac
          ? ([
              { type: "separator" },
              appCommand(
                labels.menu.checkForUpdates,
                "checkForUpdates",
                dispatch,
              ),
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
  );

  return template;
}

export function installApplicationMenu(options: ApplicationMenuOptions) {
  if ((options.platform ?? process.platform) !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = buildApplicationMenuTemplate(options);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
