/**
 * App auto-update via electron-updater against GitHub Releases.
 *
 * The feed (latest*.yml + installers) is attached to each GitHub Release by
 * .github/workflows/release.yml. Discovery always tracks the latest stable
 * release (`allowPrerelease = false`) so RC installs still graduate to newer
 * stables. Delivery mode per install:
 *  - Windows NSIS / Linux AppImage → full in-app flow: silent background
 *    download, "restart to update" prompt, install-on-quit fallback.
 *  - macOS → manual discovery and a releases-page link. In-app installation
 *    remains disabled until a signed channel is explicitly qualified.
 *  - Linux deb (no $APPIMAGE in env) → notify + link, like macOS.
 *  - Unpackaged dev runs → disabled (no app-update.yml in resources).
 */
import { app, shell } from "electron";
import electronUpdaterPkg from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";
import { IPC, type UpdateMode, type UpdateState } from "@pi-desktop/shared";
import type { Logger } from "./logger";

const { autoUpdater } = electronUpdaterPkg;

export const RELEASES_URL = "https://github.com/vastsa/PI-Desktop/releases/latest";

const AUTO_CHECK_INITIAL_DELAY_MS = 15_000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdaterOptions = {
  logger: Logger;
  send: (channel: string, payload: unknown) => void;
  currentVersion: string;
  /** Overrides for tests. */
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
};

export function resolveUpdateMode(
  platform: NodeJS.Platform,
  isPackaged: boolean,
): UpdateMode {
  if (!isPackaged) return "disabled";
  if (platform === "win32") return "in-app";
  if (platform === "linux" && process.env.APPIMAGE) return "in-app";
  // darwin (unsigned) and non-AppImage linux installs
  return "manual";
}

export class AppUpdaterController {
  private readonly logger: Logger;
  private readonly send: (channel: string, payload: unknown) => void;
  private state: UpdateState;
  private manualRequested = false;
  private initialTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private listenersAttached = false;

  constructor(options: UpdaterOptions) {
    this.logger = options.logger;
    this.send = options.send;
    const mode = resolveUpdateMode(
      options.platform ?? process.platform,
      options.isPackaged ?? app.isPackaged,
    );
    this.state = {
      mode,
      status: "idle",
      currentVersion: options.currentVersion,
      releasesUrl: RELEASES_URL,
    };
    if (mode !== "disabled") this.attachListeners();
  }

  private attachListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    autoUpdater.autoDownload = this.state.mode === "in-app";
    // electron-updater defaults allowPrerelease=true when the installed
    // version has a prerelease component (e.g. 0.2.0-rc.6). That pins the
    // GitHub provider to the same custom channel ("rc") and never offers a
    // newer stable release such as 0.2.2. Always track GitHub's latest
    // stable release so RC installs can graduate to stable.
    autoUpdater.allowPrerelease = false;
    // Even if the user ignores the restart prompt, a downloaded update
    // lands on the next normal quit.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (m: unknown) => this.logger.app("info", `updater: ${String(m)}`),
      warn: (m: unknown) => this.logger.app("warn", `updater: ${String(m)}`),
      error: (m: unknown) => this.logger.app("error", `updater: ${String(m)}`),
      debug: (m: unknown) => this.logger.app("debug", `updater: ${String(m)}`),
    };

    autoUpdater.on("checking-for-update", () => {
      this.setState({ status: "checking", error: undefined });
    });
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.setState({
        status: this.state.mode === "in-app" ? "downloading" : "available",
        availableVersion: info.version,
        progressPercent: this.state.mode === "in-app" ? 0 : undefined,
      });
    });
    autoUpdater.on("update-not-available", () => {
      this.setState({
        status: "up-to-date",
        availableVersion: undefined,
        progressPercent: undefined,
      });
    });
    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      this.setState({
        status: "downloading",
        progressPercent: Math.round(progress.percent),
      });
    });
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.setState({
        status: "downloaded",
        availableVersion: info.version,
        progressPercent: 100,
      });
    });
    autoUpdater.on("error", (error: Error) => {
      // Auto checks fail quietly (offline, private repo, rate limits);
      // the renderer only surfaces errors when `manual` is set.
      this.logger.app("warn", "updater error", { data: String(error) });
      this.setState({ status: "error", error: error.message });
    });
  }

  private setState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch, manual: this.manualRequested };
    this.send(IPC.event.updatesState, this.state);
  }

  getState(): UpdateState {
    return this.state;
  }

  /** User- or schedule-triggered check. Resolves with the settled state. */
  async check(options: { manual?: boolean } = {}): Promise<UpdateState> {
    if (this.state.mode === "disabled") {
      throw new Error("updates are disabled in development builds");
    }
    if (
      this.state.status === "checking" ||
      this.state.status === "downloading" ||
      this.state.status === "downloaded"
    ) {
      return this.state;
    }
    this.manualRequested = Boolean(options.manual);
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // The 'error' listener already recorded state; rethrow for manual
      // callers so the invoke rejects and the UI can toast it.
      if (options.manual) throw error;
    }
    return this.state;
  }

  /** Explicit download for in-app installs when a check was manual-only. */
  async download(): Promise<UpdateState> {
    if (this.state.mode !== "in-app") {
      throw new Error("in-app download is not supported on this install");
    }
    if (this.state.status === "downloading" || this.state.status === "downloaded") {
      return this.state;
    }
    await autoUpdater.downloadUpdate();
    return this.state;
  }

  /** Quit and install a downloaded update (in-app mode). */
  install(): void {
    if (this.state.status !== "downloaded") {
      throw new Error("no downloaded update to install");
    }
    // Fires 'before-quit' first, so host/sidecar shutdown still runs.
    autoUpdater.quitAndInstall(false, true);
  }

  async openReleases(): Promise<void> {
    await shell.openExternal(RELEASES_URL);
  }

  startAutoCheck() {
    if (this.state.mode === "disabled" || this.initialTimer || this.intervalTimer) {
      return;
    }
    this.initialTimer = setTimeout(() => {
      void this.check().catch(() => undefined);
    }, AUTO_CHECK_INITIAL_DELAY_MS);
    this.intervalTimer = setInterval(() => {
      void this.check().catch(() => undefined);
    }, AUTO_CHECK_INTERVAL_MS);
  }

  dispose() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
  }
}
