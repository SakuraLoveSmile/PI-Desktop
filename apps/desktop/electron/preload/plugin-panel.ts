import { contextBridge, ipcRenderer } from "electron";
import {
  PLUGIN_PANEL_TITLEBAR_HEIGHT,
  PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX,
  PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL,
  PLUGIN_PANEL_WINDOW_STATE_CHANNEL,
  type PluginPanelWindowControlAction,
  type PluginPanelTheme,
} from "../shared/plugin-panel-chrome";

const bridge = {
  invoke: async (channel: string, payload?: Record<string, unknown>) => {
    return ipcRenderer.invoke("pi-plugin-panel-invoke", channel, payload ?? {});
  },
  // Compatibility with the sample panel's older shape.
  send: (channel: string, payload?: Record<string, unknown>) => {
    return ipcRenderer.sendSync("pi-plugin-panel-bridge", channel, payload ?? {});
  },
  on: (event: string, handler: (...args: unknown[]) => void) => {
    const wrapped = (_evt: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args);
    ipcRenderer.on(`pi-plugin-panel-event:${event}`, wrapped);
    return () => ipcRenderer.removeListener(`pi-plugin-panel-event:${event}`, wrapped);
  },
};

contextBridge.exposeInMainWorld("pluginBridge", bridge);

type ChromeLabels = {
  toolbar: string;
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
  safeArea: string;
};

function isDevelopmentPanel(): boolean {
  return process.argv.includes("--pi-plugin-panel-development=1");
}

function panelTitle(): string {
  const prefix = "--pi-plugin-panel-title=";
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  if (!raw) return document.title;
  try {
    return decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return document.title;
  }
}

function panelTheme(): PluginPanelTheme {
  const prefix = "--pi-plugin-panel-theme=";
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  if (raw?.slice(prefix.length) === "light") return "light";
  if (raw?.slice(prefix.length) === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function panelLocale(): string {
  const raw = process.argv.find((argument) =>
    argument.startsWith(PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX),
  );
  if (!raw) return navigator.language;
  try {
    return decodeURIComponent(raw.slice(PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX.length));
  } catch {
    return navigator.language;
  }
}

function usableColor(value: string): boolean {
  return value !== "transparent" && value !== "rgba(0, 0, 0, 0)";
}

function pageColor(property: "backgroundColor" | "color", fallback: string): string {
  for (const element of [document.body, document.documentElement]) {
    if (!element) continue;
    const value = window.getComputedStyle(element)[property];
    if (usableColor(value)) return value;
  }
  return fallback;
}

function pageSurface(theme: PluginPanelTheme): string {
  return pageColor("backgroundColor", theme === "light" ? "#ffffff" : "#181818");
}

function chromeLabels(): ChromeLabels {
  if (panelLocale().toLowerCase().startsWith("zh")) {
    return {
      toolbar: "插件面板窗口控制",
      minimize: "最小化",
      maximize: "最大化",
      restore: "还原",
      close: "关闭",
      safeArea: "开发提示 · 安全区 46px",
    };
  }
  return {
    toolbar: "Plugin panel window controls",
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",
    safeArea: "Dev hint · 46px safe area",
  };
}

function createControlButton(
  action: PluginPanelWindowControlAction,
  label: string,
  icon: "minimize" | "maximize" | "restore" | "close",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control control-${action === "close" ? "close" : "default"}`;
  button.title = label;
  button.setAttribute("aria-label", label);

  const glyph = document.createElement("span");
  glyph.className = `glyph glyph-${icon}`;
  glyph.setAttribute("aria-hidden", "true");
  button.append(glyph);
  return button;
}

function installPanelChrome(): void {
  const body = document.body;
  if (!body || document.querySelector("pi-plugin-panel-titlebar")) return;

  document.documentElement.style.setProperty(
    "--pi-plugin-titlebar-height",
    `${PLUGIN_PANEL_TITLEBAR_HEIGHT}px`,
  );

  const originalPaddingTop = Number.parseFloat(
    window.getComputedStyle(body).paddingTop,
  );
  body.style.setProperty("box-sizing", "border-box", "important");
  body.style.setProperty(
    "padding-top",
    `${
      (Number.isFinite(originalPaddingTop) ? originalPaddingTop : 0) +
      PLUGIN_PANEL_TITLEBAR_HEIGHT
    }px`,
    "important",
  );

  const labels = chromeLabels();
  const theme = panelTheme();
  const surface = pageSurface(theme);
  const host = document.createElement("pi-plugin-panel-titlebar");
  host.dataset.theme = theme;
  host.style.setProperty(
    "--pi-plugin-panel-page-background",
    surface,
  );
  host.style.setProperty(
    "--pi-plugin-panel-page-foreground",
    pageColor("color", theme === "light" ? "#1a1c1f" : "#ffffff"),
  );
  host.setAttribute("role", "toolbar");
  host.setAttribute("aria-label", labels.toolbar);
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      color-scheme: light dark;
      pointer-events: none;
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 2147483647;
      display: block;
      height: ${PLUGIN_PANEL_TITLEBAR_HEIGHT}px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    .titlebar {
      -webkit-app-region: drag;
      app-region: drag;
      pointer-events: auto;
      box-sizing: border-box;
      display: flex;
      height: ${PLUGIN_PANEL_TITLEBAR_HEIGHT}px;
      align-items: center;
      overflow: hidden;
      border-bottom: 1px solid color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 12%, transparent);
      background: var(--pi-plugin-panel-page-background);
      color: var(--pi-plugin-panel-page-foreground);
      box-shadow: 0 1px 10px color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 8%, transparent);
      backdrop-filter: blur(18px);
      user-select: none;
    }
    .title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      padding: 0 12px;
      color: var(--pi-plugin-panel-page-foreground);
      font-size: 13px;
      font-weight: 550;
      letter-spacing: -0.01em;
      line-height: 1.25;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .titlebar.platform-darwin .title {
      padding-left: 76px;
      padding-right: 76px;
    }
    .titlebar.platform-win32 .title,
    .titlebar.platform-linux .title {
      padding-left: 112px;
    }
    .safe-area-hint {
      box-sizing: border-box;
      flex: 0 0 auto;
      max-width: 180px;
      margin-right: 8px;
      overflow: hidden;
      border: 1px solid color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 20%, transparent);
      border-radius: 999px;
      padding: 4px 8px;
      background: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 6%, transparent);
      color: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 68%, transparent);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .controls {
      -webkit-app-region: no-drag;
      app-region: no-drag;
      pointer-events: auto;
      display: flex;
      width: 112px;
      height: ${PLUGIN_PANEL_TITLEBAR_HEIGHT}px;
      flex: 0 0 112px;
      border-left: 1px solid color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 10%, transparent);
    }
    .control {
      -webkit-app-region: no-drag;
      app-region: no-drag;
      pointer-events: auto;
      display: inline-flex;
      min-width: 0;
      height: 100%;
      flex: 1 1 0;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 0;
      outline: none;
      background: transparent;
      color: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 58%, transparent);
      cursor: default;
      transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1), color 150ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .control:hover {
      background: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 8%, transparent);
      color: var(--pi-plugin-panel-page-foreground);
    }
    .control:focus-visible {
      box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 50%, transparent);
    }
    .control-close:hover {
      background: rgba(210, 43, 51, 0.92);
      color: #ffffff;
    }
    .glyph {
      position: relative;
      display: block;
      box-sizing: border-box;
      width: 12px;
      height: 12px;
    }
    .glyph-minimize::before {
      position: absolute;
      top: 6px;
      left: 1px;
      width: 10px;
      border-top: 1px solid currentColor;
      content: "";
    }
    .glyph-maximize {
      width: 10px;
      height: 10px;
      border: 1px solid currentColor;
    }
    .glyph-restore::before,
    .glyph-restore::after {
      position: absolute;
      box-sizing: border-box;
      width: 8px;
      height: 8px;
      border: 1px solid currentColor;
      content: "";
    }
    .glyph-restore::before {
      top: 1px;
      right: 1px;
    }
    .glyph-restore::after {
      bottom: 1px;
      left: 1px;
      background: var(--pi-plugin-panel-page-background);
    }
    .control:hover .glyph-restore::after {
      background: var(--pi-plugin-panel-page-background);
    }
    .glyph-close::before,
    .glyph-close::after {
      position: absolute;
      top: 5.5px;
      left: 0.5px;
      width: 11px;
      border-top: 1px solid currentColor;
      content: "";
      transform: rotate(45deg);
    }
    .glyph-close::after {
      transform: rotate(-45deg);
    }
    :host([data-theme="light"]) {
      color-scheme: light;
    }
    :host([data-theme="dark"]) {
      color-scheme: dark;
    }
    @media (max-width: 520px) {
      .titlebar.platform-win32 .title,
      .titlebar.platform-linux .title {
        padding-left: 80px;
      }
      .safe-area-hint {
        max-width: 100px;
        margin-right: 4px;
        padding-right: 6px;
        padding-left: 6px;
        font-size: 9px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .control {
        transition-duration: 0.01ms;
      }
    }
  `;

  const titlebar = document.createElement("div");
  titlebar.className = `titlebar platform-${process.platform}`;

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = panelTitle();
  title.title = panelTitle();
  titlebar.append(title);

  if (isDevelopmentPanel()) {
    const safeAreaHint = document.createElement("span");
    safeAreaHint.className = "safe-area-hint";
    safeAreaHint.textContent = labels.safeArea;
    safeAreaHint.title = labels.safeArea;
    safeAreaHint.setAttribute("aria-label", labels.safeArea);
    titlebar.append(safeAreaHint);
  }

  if (process.platform !== "darwin") {
    const controls = document.createElement("div");
    controls.className = "controls";

    const minimize = createControlButton(
      "minimize",
      labels.minimize,
      "minimize",
    );
    const maximize = createControlButton(
      "toggleMaximize",
      labels.maximize,
      "maximize",
    );
    const close = createControlButton("close", labels.close, "close");

    const setMaximized = (maximized: boolean) => {
      const label = maximized ? labels.restore : labels.maximize;
      maximize.title = label;
      maximize.setAttribute("aria-label", label);
      const glyph = maximize.firstElementChild;
      if (glyph) {
        glyph.className = `glyph glyph-${maximized ? "restore" : "maximize"}`;
      }
    };
    const invokeControl = async (action: PluginPanelWindowControlAction) => {
      try {
        const result = (await ipcRenderer.invoke(
          PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL,
          action,
        )) as { maximized?: boolean };
        if (action === "getState" || action === "toggleMaximize") {
          setMaximized(Boolean(result?.maximized));
        }
      } catch {
        // A close action can destroy the sender before Electron resolves IPC.
      }
    };

    minimize.addEventListener("click", () => void invokeControl("minimize"));
    maximize.addEventListener(
      "click",
      () => void invokeControl("toggleMaximize"),
    );
    close.addEventListener("click", () => void invokeControl("close"));
    ipcRenderer.on(
      PLUGIN_PANEL_WINDOW_STATE_CHANNEL,
      (_event, state: { maximized?: boolean }) =>
        setMaximized(Boolean(state?.maximized)),
    );
    void invokeControl("getState");

    controls.append(minimize, maximize, close);
    titlebar.append(controls);
  }

  shadow.append(style, titlebar);
  document.documentElement.append(host);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", installPanelChrome, { once: true });
} else {
  installPanelChrome();
}

export type PluginPanelBridge = typeof bridge;
