// Real renderer components and capture-rig seeds; only the API boundary is faked.
import { type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { MAC_TRAFFIC_LIGHT_EDGE_DIP } from "@pi-desktop/shared";
import { Sidebar } from "../../apps/desktop/src/components/Sidebar";
import { ConversationTopbar } from "../../apps/desktop/src/components/ConversationTopbar";
import { ChatSurface } from "../../apps/desktop/src/components/ChatSurface";
import { SettingsPage } from "../../apps/desktop/src/pages/SettingsPage";
import { PluginsPage } from "../../apps/desktop/src/pages/PluginsPage";
import { ProviderSetupDialog } from "../../apps/desktop/src/components/settings/ProviderSetupDialog";
import { ToastHost } from "../../apps/desktop/src/components/Toast";
import { WorkPanel } from "../../apps/desktop/src/components/workpanel/WorkPanel";
import { installCaptureRig, type CaptureRig } from "../../apps/desktop/src/capture/capture-rig";
import { PortalVisibilityProvider } from "../../apps/desktop/src/lib/portal-visibility";
import { goalReportWorkPanelTab, teamWorkPanelTab } from "../../apps/desktop/src/lib/work-panel-tabs";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { installScrollbarReveal } from "../../apps/desktop/src/lib/scrollbar-reveal";
import {
  assertBoundaryClean, assertSubscriptionsReleased, installFixtureBoundary,
  proposal, providers, resetFixtureState, sessionId,
} from "./fixtures";
import "../../apps/desktop/src/styles/globals.css";

const sceneIds = new Set([
  "sidebar-states", "chat-transcript", "composer-menu", "team-panel", "team-work-page", "goal-progress",
  "goal-report", "work-panel", "settings-home", "model-provider-settings", "plugins", "dialog",
]);
const sceneTargets: Record<string, string> = {
  "sidebar-states": ".sidebar .thread-item",
  "chat-transcript": ".message-row",
  "composer-menu": ".composer-model-option",
  "team-panel": "[data-testid=team-panel] .team-member-card",
  "team-work-page": "[data-testid=team-task-tab] .team-transcript-list .message-row.assistant",
  "goal-progress": ".goal-progress-item-entry",
  "goal-report": ".goal-report-metric-value",
  "work-panel": ".file-viewer-markdown h1",
  "settings-home": ".settings-card-block",
  "model-provider-settings": ".model-provider-panel",
  plugins: ".plugins-row-name",
  dialog: ".provider-setup-dialog",
};
let currentSceneId = "";
const errors: string[] = [];
const platform = window.piDesktop?.platform;
assert(platform, "Fixture preload must identify the native platform");
document.documentElement.dataset.platform = platform;
if (platform === "darwin") document.documentElement.style.setProperty("--ds-traffic-light-edge", `${MAC_TRAFFIC_LIGHT_EDGE_DIP}px`);
installScrollbarReveal(document);
window.addEventListener("error", event => errors.push(event.error?.stack ?? event.message));
window.addEventListener("unhandledrejection", event => errors.push(event.reason?.stack ?? String(event.reason)));
const ready = i18n.use(initReactI18next).init({
  lng: "zh-CN", fallbackLng: "en", interpolation: { escapeValue: false },
  resources: Object.fromEntries(Object.entries(catalogs).map(([language, catalog]) => [language, { translation: catalog }])),
});
const host = document.getElementById("root");
assert(host, "Fixture HTML must provide the production root container");
const root = createRoot(host);
let rig: CaptureRig | undefined;
const noAction = () => undefined;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function assert(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description);
}
async function until(test: () => unknown, description: string) {
  const deadline = performance.now() + 6000;
  while (!test()) {
    assertBoundaryClean();
    assert(!errors.length, `UI fixture errors: ${errors.join("; ")}`);
    if (performance.now() >= deadline) throw new Error(`UI fixture did not reach ${description}: ${document.body.textContent?.slice(0, 2000)}`);
    await frame();
  }
  await frame();
}
function Shell({ children, panel = false, plugins = false }: { children?: ReactNode; panel?: boolean; plugins?: boolean }) {
  return <div className="app-shell" style={{ "--ds-sidebar-width": "260px" } as CSSProperties}>
    <div className="app-scenic-backdrop" aria-hidden />
    <PortalVisibilityProvider visible>
      <div className="app-chat-shell">
        <Sidebar onToggleSidebar={noAction} sidebarToggleShortcut="" sidebarWidth={260}
          onWidthChange={noAction} onWidthCommit={noAction} onResizeCollapse={noAction} />
        <section className="main-pane">
          {plugins ? <div className="main-titlebar" /> : <ConversationTopbar sidebarCollapsed={false} workPanelOpen={panel}
            onToggleSidebar={noAction} onNewTask={noAction} onOpenSearch={noAction} />}
          {plugins ? <div className="route-surface route-page"><PluginsPage /></div> : <ChatSurface />}
        </section>
        {panel ? <WorkPanel containerWidth={1440} sidebarWidth={260} /> : null}
      </div>
      {children}
      <ToastHost />
    </PortalVisibilityProvider>
  </div>;
}
function Settings({ dialog = false }: { dialog?: boolean }) {
  return <div className="app-shell settings-mode">
    <div className="app-scenic-backdrop" aria-hidden />
    <SettingsPage />
    {dialog ? <ProviderSetupDialog provider={providers[0]} onClose={noAction} onSaved={noAction} vendors={[]} /> : null}
    <ToastHost />
  </div>;
}
function openPanel(tab: ReturnType<typeof teamWorkPanelTab>) {
  useAppStore.setState({ workPanelOpen: true, workPanelTabs: [tab], activeWorkPanelTabId: tab.id });
}
async function settleAssets() {
  await document.fonts.ready;
  await Promise.all([...document.images].map(async image => {
    if (!image.complete) await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`Fixture image failed: ${image.getAttribute("src")}`)), { once: true });
    });
    assert(image.naturalWidth > 0, `Fixture image is empty: ${image.getAttribute("src")}`);
    await image.decode();
  }));
  await frame(); await frame();
}
async function show(sceneId: string) {
  assert(sceneIds.has(sceneId), `Unknown UI capture scene: ${sceneId}`);
  currentSceneId = sceneId;
  await ready;
  flushSync(() => root.render(null));
  await frame();
  assertBoundaryClean();
  assert(!errors.length, `UI fixture cleanup errors: ${errors.join("; ")}`);
  assertSubscriptionsReleased();
  rig?.dispose();
  localStorage.clear();
  sessionStorage.clear();
  errors.length = 0;
  installFixtureBoundary();
  resetFixtureState(sceneId);
  window.__PI_CAPTURE__ = true;
  document.documentElement.dataset.theme = "dark";
  document.documentElement.lang = "zh-CN";
  rig = installCaptureRig();
  let settings = false;
  switch (sceneId) {
    case "sidebar-states": rig.seedSidebarStatuses(); break;
    case "chat-transcript": rig.seedTranscript(8); break;
    case "composer-menu": rig.seedTranscript(2); break;
    case "team-panel": openPanel(teamWorkPanelTab(sessionId)); break;
    case "team-work-page": openPanel(teamWorkPanelTab(sessionId, { kind: "task", taskId: "ui-capture-task-1" }, "实现用户管理 API")); break;
    case "goal-progress":
      rig.seedTranscript(2);
      useAppStore.setState({ planCheckpoints: { [sessionId]: structuredClone(proposal) } });
      break;
    case "goal-report": openPanel(goalReportWorkPanelTab(proposal.executionId!, proposal.title)); break;
    case "work-panel": useAppStore.getState().openFileInWorkPanel("README.md"); break;
    case "settings-home": settings = true; break;
    case "model-provider-settings":
    case "dialog": settings = true; useAppStore.setState({ settingsTab: "agent" }); break;
    case "plugins":
      rig.seedPlugins(4);
      // Fixed installed rows exclude transient update notifications and sounds.
      useAppStore.setState(state => ({ page: "plugins", plugins: state.plugins.map(plugin => ({ ...plugin, updateAvailable: undefined })) }));
      break;
  }
  const panel = useAppStore.getState().workPanelOpen;
  flushSync(() => root.render(settings ? <Settings key={sceneId} dialog={sceneId === "dialog"} />
    : <Shell key={sceneId} panel={panel} plugins={sceneId === "plugins"} />));
  await until(() => settings ? document.querySelector(".settings-content-inner")
    : sceneId === "plugins" ? document.querySelector(".plugins-page") : document.querySelector(".composer-input"), "real page and composer");
  switch (sceneId) {
    case "sidebar-states":
      await until(() => document.querySelectorAll(".sidebar .thread-item").length >= 4, "four sidebar sessions"); break;
    case "chat-transcript":
      await until(() => document.querySelectorAll(".message-row").length >= 8, "seeded transcript"); break;
    case "composer-menu": {
      const trigger = document.querySelector<HTMLButtonElement>(".composer-model-thinking-chip");
      assert(trigger && !trigger.disabled, "Real Composer model menu trigger is unavailable");
      flushSync(() => trigger.click());
      await until(() => document.querySelectorAll(".composer-model-option").length >= 2, "configured model menu");
      break;
    }
    case "team-panel":
      await until(() => document.querySelectorAll("[data-testid=team-panel] .team-member-card").length === 3 &&
        document.querySelectorAll("[data-testid=team-panel] .team-progress-row").length === 4, "Team roster and task rows"); break;
    case "team-work-page":
      await until(() => document.querySelector("[data-testid=team-task-tab] .team-transcript-list .message-row.assistant"), "task transcript"); break;
    case "goal-progress": {
      await until(() => document.querySelector(".goal-progress-ring"), "loaded Goal progress");
      const toggle = document.querySelector<HTMLButtonElement>(".goal-progress-toggle-btn");
      assert(toggle, "Goal progress toggle missing");
      if (toggle.getAttribute("aria-expanded") !== "true") flushSync(() => toggle.click());
      await until(() => document.querySelectorAll(".goal-progress-item-entry").length === 4, "expanded Goal milestones");
      assert(!document.body.textContent?.includes(i18n.t("panel.activity.goal.reportUnavailable")), "Goal fixture must not fabricate a report read failure");
      break;
    }
    case "goal-report":
      await until(() => document.querySelector("[data-testid=goal-report-summary]") &&
        document.querySelectorAll(".goal-report-metric-value").length === 3, "ready structured Goal report"); break;
    case "work-panel":
      await until(() => document.querySelector(".file-viewer-markdown h1")?.textContent === "Project overview", "fixture README content"); break;
    case "settings-home":
      await until(() => document.querySelectorAll(".settings-card-block").length >= 3 &&
        document.body.textContent?.includes("/fixture/data"), "General settings and storage read"); break;
    case "model-provider-settings":
      await until(() => document.querySelector(".model-provider-panel")?.textContent?.includes(providers[0]!.name) &&
        document.querySelector(".model-catalog-status-text"), "provider rows and bundled catalog status"); break;
    case "plugins":
      await until(() => document.querySelectorAll(".plugins-row-name").length === 4, "installed plugin rows");
      break;
    case "dialog":
      await until(() => document.querySelector(".provider-setup-dialog[aria-modal=true] .provider-setup-actions"), "provider edit dialog"); break;
  }
  document.querySelectorAll<HTMLElement>(".settings-content,.messages-scroll,.work-panel-body").forEach(node => { node.scrollTop = 0; });
  window.scrollTo(0, 0);
  await settleAssets();
  assertBoundaryClean();
  assert(!errors.length, `UI fixture errors: ${errors.join("; ")}`);
  return { id: sceneId };
}

declare global {
  var uiCaptureShow: (sceneId: string) => Promise<{ id: string }>;
  var uiCaptureValidate: () => void;
}
globalThis.uiCaptureShow = show;
globalThis.uiCaptureValidate = () => {
  assertBoundaryClean();
  assert(!errors.length, `UI fixture errors: ${errors.join("; ")}`);
  const shell = host.querySelector(".app-shell");
  assert(shell, "Real shell is missing");
  const bounds = shell.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1 &&
    bounds.width > innerWidth / 2 && bounds.height > innerHeight / 2, "Real shell is outside the capture viewport");
  const content = document.querySelectorAll(sceneTargets[currentSceneId]!);
  assert([...content].some(node => {
    const rect = node.getBoundingClientRect();
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || rect.width <= 0 || rect.height <= 0 ||
      rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
    const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
    const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
    return node.contains(document.elementFromPoint(x, y));
  }), "Ready fixture content is not visible in the capture viewport");
};
