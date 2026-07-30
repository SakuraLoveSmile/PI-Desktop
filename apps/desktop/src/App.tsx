import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type ErrorInfo,
  type ReactNode,
} from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import {
  KEYBOARD_SHORTCUTS,
  keybindingDisplayParts,
  keybindingMatchesEvent,
  resolveKeybinding,
  type AppMenuCommand,
  type KeyboardShortcutId,
  type ShortcutPlatform,
} from "@pi-desktop/shared";
import { Sidebar } from "./components/Sidebar";
import { WorkPanel } from "./components/workpanel/WorkPanel";
import { ChatSurface } from "./components/ChatSurface";
import { CommandPalette } from "./components/CommandPalette";
import { SearchDialog } from "./components/SearchDialog";
import { ToastHost } from "./components/Toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { WindowControls } from "./components/WindowControls";
import { useAppStore } from "./stores/app-store";
import type { ToastOptions } from "./stores/app-store";
import { api } from "./lib/api";
import { commitWorkPanelPresentation } from "./lib/work-panel-presentation";
import { toolWorkPanelTab } from "./lib/work-panel-tabs";
import { StartupSplash } from "./components/StartupSplash";
import { cx } from "./components/ui";
import {
  IconNewSession,
  IconSidebar,
} from "./components/icons";

const MODIFIER_ONLY_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
]);

const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const PullRequestsPage = lazy(() =>
  import("./pages/PullRequestsPage").then((module) => ({
    default: module.PullRequestsPage,
  })),
);
const ScheduledPage = lazy(() =>
  import("./pages/ScheduledPage").then((module) => ({
    default: module.ScheduledPage,
  })),
);
const PluginsPage = lazy(() =>
  import("./pages/PluginsPage").then((module) => ({
    default: module.PluginsPage,
  })),
);

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-bg-primary p-8 text-text-primary">
          <div className="max-w-lg rounded-lg-plus border border-border-default bg-bg-secondary p-5">
            <div className="mb-2 text-base-plus font-semibold">{i18n.t("app.uiCrashed")}</div>
            <pre className="whitespace-pre-wrap text-sm-plus text-error">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function CollapsedTitlebarActions({
  onToggleSidebar,
  onNewTask,
  sidebarToggleShortcut,
}: {
  onToggleSidebar: () => void;
  onNewTask: () => void;
  sidebarToggleShortcut: string;
}) {
  const { t } = useTranslation();
  const toggleLabel = t("nav.expandSidebar");
  return (
    <div className="titlebar-nav no-drag">
      <button
        className="title-nav-btn"
        title={`${toggleLabel} (${sidebarToggleShortcut})`}
        aria-label={toggleLabel}
        aria-expanded={false}
        data-nav="toggle-sidebar"
        onClick={onToggleSidebar}
      >
        <IconSidebar size={13} />
      </button>
      <button
        className="title-nav-btn"
        title={t("nav.newTask")}
        aria-label={t("nav.newTask")}
        data-nav="new-task"
        onClick={onNewTask}
      >
        <IconNewSession size={13} />
      </button>
    </div>
  );
}

function RoutePending() {
  const { t } = useTranslation();
  return (
    <div className="route-pending" role="status" aria-label={t("app.loadingView")}>
      <span className="route-pending-indicator" aria-hidden />
    </div>
  );
}

function AppShell() {
  const { t } = useTranslation();
  const platform = window.piDesktop?.platform ?? "darwin";
  const bootstrap = useAppStore((s) => s.bootstrap);
  const ready = useAppStore((s) => s.ready);
  const page = useAppStore((s) => s.page);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const showToast = useAppStore((s) => s.showToast);
  const handleAgentEvent = useAppStore((s) => s.handleAgentEvent);
  const abort = useAppStore((s) => s.abort);
  const settings = useAppStore((s) => s.settings);
  const workspace = useAppStore((s) => s.workspace);
  const reviewRev = useAppStore((s) => s.reviewRev);
  const refreshWorkspaceDiff = useAppStore((s) => s.refreshWorkspaceDiff);
  const workPanelOpen = useAppStore((s) => s.workPanelOpen);
  const workPanelWidth = useAppStore((s) => s.workPanelWidth);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarExiting, setSidebarExiting] = useState(false);
  const toggleSidebar = () => {
    if (sidebarCollapsed) {
      setSidebarExiting(false);
      setSidebarCollapsed(false);
    } else {
      setSidebarExiting(true);
      setSidebarCollapsed(true);
    }
  };
  const handleSidebarAnimationEnd = (event: ReactAnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!sidebarExiting) return;
    if (!event.animationName.startsWith("sidebar-out")) return;
    setSidebarExiting(false);
  };

  // Fallback in case animationend is skipped (e.g. display:none mid-flight).
  useEffect(() => {
    if (!sidebarExiting) return;
    const timer = window.setTimeout(() => setSidebarExiting(false), 240);
    return () => window.clearTimeout(timer);
  }, [sidebarExiting]);
  const [presentedWorkPanelOpen, setPresentedWorkPanelOpen] = useState(false);
  const [workPanelExiting, setWorkPanelExiting] = useState(false);
  const workPanelReservationRequest = useRef(0);
  const workPanelExitGeneration = useRef(0);
  const workPanelExitClosing = useRef(false);
  const presentedWorkPanelRef = useRef(false);
  const workPanelExitingRef = useRef(false);
  const [backendDown, setBackendDown] = useState<
    { fatal: boolean; component?: string } | null
  >(null);
  const [splashPhase, setSplashPhase] = useState<"loading" | "exiting" | "done">(
    "loading",
  );
  const splashStartedAt = useRef(
    typeof performance !== "undefined" ? performance.now() : 0,
  );

  useEffect(() => {
    presentedWorkPanelRef.current = presentedWorkPanelOpen;
  }, [presentedWorkPanelOpen]);

  useEffect(() => {
    workPanelExitingRef.current = workPanelExiting;
  }, [workPanelExiting]);

  const finishWorkPanelExit = useCallback((generation: number) => {
    if (generation !== workPanelExitGeneration.current) return;
    if (workPanelExitClosing.current) return;
    if (!workPanelExitingRef.current) return;
    workPanelExitClosing.current = true;
    const request = ++workPanelReservationRequest.current;
    void commitWorkPanelPresentation({
      reservation: api.setWorkPanelReservation(0),
      isCurrent: () =>
        request === workPanelReservationRequest.current &&
        generation === workPanelExitGeneration.current,
      commit: () => {
        setPresentedWorkPanelOpen(false);
        setWorkPanelExiting(false);
        workPanelExitingRef.current = false;
        workPanelExitClosing.current = false;
      },
    }).then((committed) => {
      // Reservation failed or was superseded — allow a later exit retry.
      if (!committed) workPanelExitClosing.current = false;
    });
  }, []);

  useEffect(() => {
    const shouldPresent = ready && page !== "settings" && workPanelOpen;
    const request = ++workPanelReservationRequest.current;

    if (shouldPresent) {
      // Cancel any in-flight exit and reserve native width before mount.
      workPanelExitGeneration.current += 1;
      workPanelExitClosing.current = false;
      workPanelExitingRef.current = false;
      setWorkPanelExiting(false);
      // Internal-dock redesign (ADR 0033): the work panel is a flex column
      // inside the fixed client area, so it never expands the OS window. The
      // native reservation target is therefore always 0; the native browser
      // view still follows the renderer-measured panel rect via browserSetBounds.
      const requestedWidth = 0;
      void commitWorkPanelPresentation({
        reservation: api.setWorkPanelReservation(requestedWidth),
        isCurrent: () => request === workPanelReservationRequest.current,
        commit: () => setPresentedWorkPanelOpen(shouldPresent),
      });
      return;
    }

    // Close: keep the dock mounted through work-panel-out, then release the
    // native reservation. Instant path when the shell was never presented.
    if (presentedWorkPanelRef.current || workPanelExitingRef.current) {
      if (presentedWorkPanelRef.current && !workPanelExitingRef.current) {
        workPanelExitGeneration.current += 1;
        workPanelExitingRef.current = true;
        setWorkPanelExiting(true);
      }
      return;
    }

    const requestedWidth = 0;
    void commitWorkPanelPresentation({
      reservation: api.setWorkPanelReservation(requestedWidth),
      isCurrent: () => request === workPanelReservationRequest.current,
      commit: () => setPresentedWorkPanelOpen(shouldPresent),
    });
  }, [page, ready, workPanelOpen, workPanelWidth]);

  // Fallback if animationend is skipped (display:none mid-flight, etc.).
  useEffect(() => {
    if (!workPanelExiting) return;
    const generation = workPanelExitGeneration.current;
    const timer = window.setTimeout(() => {
      finishWorkPanelExit(generation);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [workPanelExiting, finishWorkPanelExit]);

  const runMenuCommand = useCallback(
    async (command: AppMenuCommand) => {
      try {
        const store = useAppStore.getState();
        switch (command) {
          case "newTask":
            await store.newSession();
            requestAnimationFrame(() =>
              document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus(),
            );
            break;
          case "openProject":
            await store.openProject();
            break;
          case "openSettings":
            store.setSettingsTab("general");
            break;
          case "openSearch":
            setSearchOpen(true);
            break;
          case "openCommandPalette":
            setPaletteOpen(true);
            break;
          case "toggleSidebar":
            toggleSidebar();
            break;
          case "openHelp":
            store.setSettingsTab("about");
            break;
          case "openLogs":
            await api.openLogs();
            break;
          case "checkForUpdates": {
            const updateState = await api.updatesCheck();
            if (updateState.status === "up-to-date") {
              showToast(t("updates.upToDate"), { variant: "success" });
            }
            break;
          }
        }
      } catch (menuError) {
        showToast(
          menuError instanceof Error ? menuError.message : String(menuError),
          { variant: "error" },
        );
      }
    },
    [showToast],
  );

  useEffect(() => {
    const unsubscribe = api.onMenuCommand((command) => void runMenuCommand(command));
    void api.menuRendererReady().catch(() => undefined);
    return unsubscribe;
  }, [runMenuCommand]);

  useEffect(() => {
    // Fullscreen hides the macOS traffic lights; CSS shifts titlebar
    // controls left via this attribute.
    const off = api.onWindowFullScreen(({ fullScreen }) => {
      document.documentElement.dataset.fullscreen = fullScreen ? "true" : "false";
    });
    return off;
  }, []);

  useEffect(() => {
    const viewingSessionId = page === "chat" ? activeSessionId ?? null : null;
    void api
      .setNotificationViewingSession(viewingSessionId)
      .catch(() => undefined);
  }, [activeSessionId, page]);

  useEffect(() => {
    const theme = settings?.theme ?? "system";
    const apply = () => {
      if (theme === "system") {
        document.documentElement.dataset.theme = window.matchMedia(
          "(prefers-color-scheme: light)",
        ).matches
          ? "light"
          : "dark";
      } else {
        document.documentElement.dataset.theme = theme;
      }
    };
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings?.theme]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(
      () => void refreshWorkspaceDiff(),
      reviewRev === 0 ? 0 : 500,
    );
    return () => window.clearTimeout(timer);
  }, [ready, workspace?.path, reviewRev, refreshWorkspaceDiff]);

  useEffect(() => {
    if (!ready) return;
    const refreshOnFocus = () => void refreshWorkspaceDiff();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [ready, refreshWorkspaceDiff]);

  useEffect(() => {
    void bootstrap();
    const offEvent = api.onAgentEvent(handleAgentEvent);
    // Host-pushed toasts (plugin runtime etc.) are informational.
    const offToast = api.onToast((message) => showToast(message));
    // Agent-driven HTML preview: surface the browser tab when the agent
    // opens a workspace file in the embedded browser (BrowserPreview tool).
    const offBrowserPreview = api.onBrowserPreview((event) => {
      useAppStore
        .getState()
        .openWorkPanelTabForSession(event.sessionId, {
          ...toolWorkPanelTab("browser"),
          resource: event.path,
        });
    });
    const offHostStatus = api.onHostStatus((status) => {
      if (status.ok) {
        setBackendDown(null);
        if (status.restarted) {
          showToast(t("status.restored"), { variant: "success" });
        }
      } else {
        setBackendDown({
          fatal: status.fatal === true,
          component: status.component,
        });
        // A dead sidecar cannot finish the turn; unstick the composer.
        useAppStore.setState({ isRunning: false });
      }
    });
    const offNotificationChanged = api.onNotificationChanged((notification) => {
      useAppStore.getState().receiveNotification(notification);
      const failed = notification.kind === "task.failed";
      const title = t(
        failed ? "notifications.failedTitle" : "notifications.completedTitle",
        { sessionTitle: notification.sessionTitle },
      );
      const body = failed
        ? notification.errorCode
          ? t("notifications.failedBodyWithCode", { code: notification.errorCode })
          : t("notifications.failedBody")
        : t("notifications.completedBody");
      void api
        .showNativeNotification({
          id: notification.id,
          sessionId: notification.sessionId,
          title,
          body,
        })
        .catch(() => undefined);
    });
    const offNotificationActivated = api.onNotificationActivated(({ id }) => {
      void useAppStore
        .getState()
        .openNotification(id)
        .catch((activationError) =>
          showToast(
            activationError instanceof Error
              ? activationError.message
              : String(activationError),
            { variant: "error" },
          ),
        );
    });
    const onKey = (e: KeyboardEvent) => {
      const modifierOnly = MODIFIER_ONLY_KEYS.has(e.key);
      if (modifierOnly || e.isComposing || e.keyCode === 229) return;
      const shortcut = KEYBOARD_SHORTCUTS.find((candidate) =>
        keybindingMatchesEvent(
          resolveKeybinding(
            candidate,
            settings?.keybindings,
            platform as ShortcutPlatform,
          ),
          e,
          platform as ShortcutPlatform,
        ),
      );
      if (!shortcut) return;
      if (
        e.repeat &&
        (shortcut.id === "navigateBack" || shortcut.id === "navigateForward")
      ) {
        return;
      }
      e.preventDefault();

      const runShortcut = (id: KeyboardShortcutId) => {
        switch (id) {
          case "navigateBack":
            useAppStore.getState().navBack();
            break;
          case "navigateForward":
            useAppStore.getState().navForward();
            break;
          case "newTask":
          case "openProject":
          case "openSettings":
            void runMenuCommand(id);
            break;
          case "openSearch":
            setSearchOpen(true);
            break;
          case "openCommandPalette":
            setPaletteOpen(true);
            break;
          case "toggleSidebar":
            toggleSidebar();
            break;
          case "abort":
            void abort();
            break;
          case "closeWindow":
            void api.windowControl("close");
            break;
          case "resetZoom":
          case "zoomIn":
          case "zoomOut":
          case "toggleFullScreen":
            void api.nativeMenuAction(id);
            break;
        }
      };
      runShortcut(shortcut.id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offEvent();
      offToast();
      offBrowserPreview();
      offHostStatus();
      offNotificationChanged();
      offNotificationActivated();
      window.removeEventListener("keydown", onKey);
    };
  }, [
    bootstrap,
    handleAgentEvent,
    showToast,
    abort,
    t,
    platform,
    runMenuCommand,
    settings?.keybindings,
  ]);

  useEffect(() => {
    const originalRefreshNotifications =
      useAppStore.getState().refreshNotifications;
    (window as any).__PI_DESKTOP__ = {
      setPage: (page: string) => useAppStore.getState().setPage(page as any),
      refreshProviders: () => useAppStore.getState().refreshProviders(),
      selectSession: (id: string) => useAppStore.getState().selectSession(id),
      setSettingsTab: (tab: string) => useAppStore.getState().setSettingsTab(tab as any),
      setThemeAttr: (theme: "light" | "dark") => {
        document.documentElement.dataset.theme = theme;
      },
      clearProject: () => useAppStore.getState().clearProject(),
      showToast: (message: string, opts?: ToastOptions) =>
        useAppStore.getState().showToast(message, opts),
      openWorkPanelArtifact: (
        kind: "review" | "terminal" | "browser" | "file",
        resource?: string,
      ) => {
        if (!(window as any).__PI_CAPTURE__) return;
        if (kind === "file" && resource) {
          useAppStore.getState().openFileInWorkPanel(resource);
          return;
        }
        if (kind !== "file") {
          useAppStore.getState().openWorkPanelTab(toolWorkPanelTab(kind));
        }
      },
      collapseWorkPanel: () => {
        if (!(window as any).__PI_CAPTURE__) return;
        useAppStore.getState().collapseWorkPanel();
      },
      seedTranscript: (count = 12) => {
        // Capture-only transcript fixture (conversation minimap scenes);
        // count 0 restores the empty transcript for later scenes.
        if (!(window as any).__PI_CAPTURE__) return;
        if (count <= 0) {
          useAppStore.setState({ messages: [] });
          return;
        }
        const base = Date.parse("2026-07-20T09:00:00Z");
        const samples: [role: "user" | "assistant", content: string][] = [
          ["user", "帮我配置一下这个项目并启动"],
          [
            "assistant",
            "好的。先安装依赖并生成本地配置：\n\n1. `pnpm install`\n2. 复制 `.env.example` 为 `.env`\n3. `pnpm dev` 启动开发服务\n\n启动后默认监听 5173 端口。",
          ],
          ["user", "启动报错了，说找不到 host 二进制"],
          [
            "assistant",
            "这是因为 Rust 侧还没编译。运行 `cargo build -p pi-desktop-host-core`，产物会出现在 `target/debug/` 下，Electron 主进程会自动拾取。",
          ],
          ["user", "编译通过了，界面也起来了"],
          [
            "assistant",
            "很好。接下来可以在设置里添加模型提供方并保存 API 密钥，然后打开一个项目文件夹就能开始对话了。",
          ],
          ["user", "顺便把侧边栏最近会话按项目分组"],
          [
            "assistant",
            "已按项目路径分组：每组显示项目名与最近活动时间，未关联项目的会话归入“临时会话”。分组逻辑在 `sidebar-session-groups.ts`。",
          ],
          ["user", "分组标题的字号再小一点"],
          [
            "assistant",
            "已把分组标题从 `--text-sm` 调整为 `--text-2xs`，同时收紧了上下间距，现在与 PI-Desktop 的密度一致。",
          ],
          ["user", "最后跑一遍检查"],
          [
            "assistant",
            "`pnpm typecheck` 与样式令牌检查均通过，无回归。",
          ],
        ];
        const messages = Array.from(
          { length: Math.min(count, samples.length) },
          (_, i) => ({
            id: `capture-msg-${i}`,
            role: samples[i][0],
            content: samples[i][1],
            createdAt: new Date(base + i * 60_000).toISOString(),
            status: "complete" as const,
          }),
        );
        useAppStore.setState({ messages });
      },
      seedPlugins: (count = 3) => {
        // Capture-only plugins fixture (plugins index scenes); count 0 clears.
        if (!(window as any).__PI_CAPTURE__) return;
        if (count <= 0) {
          useAppStore.setState({ plugins: [] });
          return;
        }
        const samples = [
          {
            id: "pi.git-insights",
            name: "Git Insights",
            version: "1.4.2",
            enabled: true,
          },
          {
            id: "pi.markdown-tools",
            name: "Markdown Tools",
            version: "0.9.0",
            enabled: true,
          },
          {
            id: "pi.deploy-preview",
            name: "Deploy Preview",
            version: "dev",
            enabled: false,
          },
        ];
        useAppStore.setState({
          plugins: samples.slice(0, count).map((sample) => ({
            ...sample,
            source: "dev" as const,
            status: sample.enabled ? ("ready" as const) : ("disabled" as const),
            permissions: [],
          })),
        });
      },
      seedNotifications: (count = 105) => {
        // Capture-only notification fixture; count 0 restores an empty inbox.
        if (!(window as any).__PI_CAPTURE__) return;
        if (count <= 0) {
          useAppStore.setState({
            notifications: [],
            unreadNotificationCount: 0,
            refreshNotifications: originalRefreshNotifications,
          });
          return;
        }
        const now = Date.now();
        const titles = [
          "重新设计设置页面插件板块手机端 UI 布局并验证所有断点",
          "修复 host-core 启动失败并补充错误恢复测试",
          "同步代码",
        ];
        const notifications = Array.from({ length: count }, (_, index) => ({
          id: `capture-notification-${index}`,
          kind: index === 1 ? ("task.failed" as const) : ("task.completed" as const),
          sessionId: `capture-session-${index}`,
          sessionTitle: titles[index] ?? `后台任务 ${index + 1}`,
          turnId: `capture-turn-${index}`,
          ...(index === 1 ? { errorCode: "MODEL_REQUEST_TIMEOUT" } : {}),
          createdAt: new Date(now - (index + 1) * 60_000).toISOString(),
          readAt: index === 2 ? new Date(now - 30_000).toISOString() : null,
        }));
        useAppStore.setState({
          notifications,
          unreadNotificationCount: notifications.reduce(
            (total, notification) => total + (notification.readAt ? 0 : 1),
            0,
          ),
          refreshNotifications: async () => undefined,
        });
      },
      seedSidebarStatuses: () => {
        if (!(window as any).__PI_CAPTURE__) return null;
        const sessions = useAppStore.getState().sessions.slice(0, 4);
        if (sessions.length < 4) return null;
        const [selected, running, completed, failed] = sessions;
        useAppStore.setState({
          page: "chat",
          activeSessionId: selected.id,
          isRunning: false,
          runningSessions: { [running.id]: true },
          sessionOutcomes: {
            [completed.id]: "completed",
            [failed.id]: "failed",
          },
        });
        return {
          selected: selected.id,
          running: running.id,
          completed: completed.id,
          failed: failed.id,
        };
      },
      ensureVisualFixtures: async () => {
        // Destructive fixture seeding is capture-rig only; the rig sets
        // __PI_CAPTURE__ before invoking (see electron/main capture suite).
        if (!(window as any).__PI_CAPTURE__) return;
        // Optical hero title length: short folder basenames under-ink vs Codex gold.
        const ws = useAppStore.getState().workspace;
        if (ws?.path) {
          const base = (ws.name || ws.path.split(/[\/]/).filter(Boolean).pop() || "").trim();
          if (base.length > 0 && base.length < 12) {
            useAppStore.setState({
              workspace: { ...ws, name: "PI-Desktop" },
            });
          }
        }
        // Seed representative session titles for capture residuals (data band).
        try {
          await useAppStore.getState().refreshSessions();
          const englishNoise = new Set([
            "Review open pull requests",
            "Tighten composer elevation",
            "Dark theme night plate",
            "Sidebar recents density",
            "Settings appearance polish",
            "Plugins empty state",
            "Fix TypeScript build errors",
            "Exploring repository structure",
          ]);
          for (const s of useAppStore.getState().sessions || []) {
            if (englishNoise.has((s.title || "").trim())) {
              try {
                await api.deleteSession(s.id);
              } catch {
                // ignore
              }
            }
          }
          await useAppStore.getState().refreshSessions();
          const existing = new Set(
            (useAppStore.getState().sessions || []).map((s) => (s.title || "").trim()),
          );
          const titles = [
            "同步代码",
            "你好",
            "终止进程里面有一个注册机的",
            "加一下",
            "帮我彻底卸载比特浏览器",
            "帮我配置一下这个项目并启动",
            "重新设计设置页面插件板块手机端ui布局",
            "制作台的布局重新设计，需要现代化简",
          ];
          for (const title of titles) {
            if (existing.has(title)) continue;
            if ((useAppStore.getState().sessions?.length ?? 0) >= 14) break;
            await api.createSession({ title });
            existing.add(title);
          }
          await useAppStore.getState().refreshSessions();
          const preferred = useAppStore
            .getState()
            .sessions.find((s) => (s.title || "").trim() === "同步代码");
          if (preferred) {
            try {
              const raw = localStorage.getItem("pi.desktop.pinnedSessions");
              const parsed = raw ? JSON.parse(raw) : [];
              const pins = Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
              if (!pins.includes(preferred.id)) {
                localStorage.setItem(
                  "pi.desktop.pinnedSessions",
                  JSON.stringify([preferred.id, ...pins].slice(0, 40)),
                );
              }
            } catch {
              // ignore
            }
            await useAppStore.getState().selectSession(preferred.id);
          }
        } catch {
          // optional capture-only fixture
        }
      },
    };
    return () => {
      useAppStore.setState({
        refreshNotifications: originalRefreshNotifications,
      });
      try {
        delete (window as any).__PI_DESKTOP__;
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minMs = reduceMotion ? 0 : 420;
    const exitMs = reduceMotion ? 0 : 280;
    const wait = Math.max(
      0,
      minMs - (performance.now() - splashStartedAt.current),
    );

    let cancelled = false;
    let endTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
      if (exitMs === 0) {
        setSplashPhase("done");
        return;
      }
      setSplashPhase("exiting");
      endTimer = window.setTimeout(() => {
        if (!cancelled) setSplashPhase("done");
      }, exitMs);
    }, wait);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (endTimer !== undefined) window.clearTimeout(endTimer);
    };
  }, [ready]);

  const showSplash = splashPhase !== "done";
  const splash = showSplash ? (
    <StartupSplash exiting={splashPhase === "exiting"} />
  ) : null;

  const shortcutPlatform = platform as ShortcutPlatform;
  const toggleSidebarShortcut = KEYBOARD_SHORTCUTS.find(
    (shortcut) => shortcut.id === "toggleSidebar",
  );
  const sidebarToggleShortcut = toggleSidebarShortcut
    ? keybindingDisplayParts(
        resolveKeybinding(
          toggleSidebarShortcut,
          settings?.keybindings,
          shortcutPlatform,
        ),
        shortcutPlatform,
      ).join(shortcutPlatform === "darwin" ? "" : "+")
    : "";

  let shell: ReactNode = null;
  if (ready) {
    if (page === "settings") {
      shell = (
        <>
          <WindowControls />
          <Suspense fallback={<RoutePending />}>
            <SettingsPage />
          </Suspense>
          <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <ToastHost />
          <UpdateBanner />
        </>
      );
    } else {
      shell = (
        <>
          <WindowControls />
          {!sidebarCollapsed || sidebarExiting ? (
            <Sidebar
              className={sidebarExiting ? "is-exiting" : undefined}
              onAnimationEnd={handleSidebarAnimationEnd}
              onOpenSearch={() => setSearchOpen(true)}
              onToggleSidebar={toggleSidebar}
              sidebarToggleShortcut={sidebarToggleShortcut}
            />
          ) : null}

          <section className="main-pane">
            <div
              className={cx(
                "main-titlebar",
                presentedWorkPanelOpen && "work-panel-open",
              )}
            >
              {sidebarCollapsed && (
                <div className="main-titlebar-left no-drag">
                  <CollapsedTitlebarActions
                    onToggleSidebar={toggleSidebar}
                    onNewTask={() => void runMenuCommand("newTask")}
                    sidebarToggleShortcut={sidebarToggleShortcut}
                  />
                </div>
              )}
            </div>
            <UpdateBanner />

            {backendDown && (
              <div
                className={`backend-banner no-drag ${backendDown.fatal ? "fatal" : "warn"}`}
                role="status"
              >
                <span className="backend-dot" aria-hidden />
                <span>
                  {backendDown.fatal ? t("status.fatal") : t("status.restarting")}
                </span>
                {backendDown.fatal && (
                  <button
                    type="button"
                    className="backend-action"
                    onClick={() => void api.openLogs()}
                  >
                    {t("status.openLogs")}
                  </button>
                )}
              </div>
            )}

            <Suspense fallback={<RoutePending />}>
              {page === "pulls" ? (
                <div className="route-surface route-page">
                  <PullRequestsPage />
                </div>
              ) : page === "scheduled" ? (
                <div className="route-surface route-page">
                  <ScheduledPage />
                </div>
              ) : page === "plugins" ? (
                <div className="route-surface route-page">
                  <PluginsPage />
                </div>
              ) : (
                <ChatSurface />
              )}
            </Suspense>
          </section>

          {(presentedWorkPanelOpen || workPanelExiting) && (
            <WorkPanel
              browserBlocked={paletteOpen || searchOpen}
              exiting={workPanelExiting}
              onExitAnimationEnd={() =>
                finishWorkPanelExit(workPanelExitGeneration.current)
              }
              onCollapse={() => useAppStore.getState().collapseWorkPanel()}
            />
          )}

          <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <ToastHost />
        </>
      );
    }
  }

  return (
    <div
      className={cx(
        "app-shell",
        !ready && "app-shell-boot",
        page === "settings" && ready && "settings-mode",
        showSplash && "is-booting",
      )}
    >
      {shell}
      {splash}
    </div>
  );
}


export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
