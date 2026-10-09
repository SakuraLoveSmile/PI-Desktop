import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { WorkPanel } from "../../apps/desktop/src/components/workpanel/WorkPanel";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

declare global {
  var workPanelLauncherProbe: () => Promise<{ ok: true; cases: number }>;
  var showLauncher: (width: number, height: number, theme: string) => void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const host = document.createElement("div");
host.style.cssText = "display:flex;height:100%;width:100%";
document.body.append(host);
const root = createRoot(host);
const i18n = createInstance();
const rows = () => [...host.querySelectorAll<HTMLButtonElement>("[data-work-panel-launcher-item]")];
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await nextFrame();
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
  }
  await nextFrame();
};

globalThis.showLauncher = (width, height, theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--font-scale", "1");
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  flushSync(() => useAppStore.setState({ workPanelWidth: width }));
  flushSync(() => root.render(
    <I18nextProvider i18n={i18n}>
      <WorkPanel containerWidth={width + 450} sidebarCollapsed />
    </I18nextProvider>,
  ));
};

globalThis.workPanelLauncherProbe = async () => {
  await i18n.init({
    lng: "zh-CN", fallbackLng: "en",
    resources: { en: { translation: catalogs.en }, "zh-CN": { translation: catalogs["zh-CN"] } },
    interpolation: { escapeValue: false },
  });
  useAppStore.setState({
    activeSessionId: undefined, workPanelOpen: true,
    workPanelTabs: [], activeWorkPanelTabId: null, workPanelContexts: {},
    sessions: [], messages: [],
    pluginViews: [
      { pluginId: "pi.file-manager", viewId: "manager", ref: "pi.file-manager/manager", title: "文件管理器", pluginName: "Files", icon: "folder", order: 1 },
      { pluginId: "pi.browser", viewId: "browser", ref: "pi.browser/browser", title: "浏览器", pluginName: "Browser", icon: "browser", order: 2 },
      { pluginId: "fixture", viewId: "long", ref: "fixture/long", title: "Long contributed view title that must wrap in a narrow work panel", pluginName: "Fixture", order: 3 },
    ],
  });
  let cases = 0;
  for (const language of ["zh-CN", "en"]) {
    await i18n.changeLanguage(language);
    for (const theme of ["dark", "light"]) {
      for (const [width, height] of [[244, 400], [360, 600], [671, 739]]) {
        globalThis.showLauncher(width, height, theme);
        await settle();
        const list = host.querySelector<HTMLElement>(".work-panel-launcher-list");
        const launcher = host.querySelector<HTMLElement>(".work-panel-launcher");
        assert(list && launcher, "launcher missing");
        assert(rows().length === 5, "available tools were lost");
        assert(host.querySelector('[data-work-panel-launcher-item="context"]'), "native Context Insights entry was lost during integration");
        assert(list.clientWidth <= 380, "cards exceeded the reference content width");
        assert(launcher.scrollWidth <= launcher.clientWidth, "launcher overflows horizontally");
        const bounds = list.getBoundingClientRect();
        const panel = host.querySelector<HTMLElement>(".work-panel-main")!.getBoundingClientRect();
        assert(Math.abs(bounds.left + bounds.width / 2 - panel.left - panel.width / 2) < 2,
          `cards are not centered: ${JSON.stringify({ width, height, theme, list: bounds.toJSON(), panel: panel.toJSON(), style: getComputedStyle(launcher).padding })}`);
        for (const row of rows()) {
          assert(row.getBoundingClientRect().height >= 56, "card hit target too small");
          assert(row.scrollWidth <= row.clientWidth, "card content clipped");
          assert(getComputedStyle(row).borderTopWidth === "1px", "card outline missing");
        }
        rows()[0].focus();
        assert(document.activeElement === rows()[0], "card cannot receive focus");
        cases++;
      }
    }
  }

  // Exercise the production component and store, with no provider or native plugin calls.
  flushSync(() => useAppStore.setState({ activeSessionId: "fixture-session" }));
  const click = (selector: string) => {
    const button = host.querySelector<HTMLButtonElement>(selector);
    assert(button, `missing button: ${selector}`);
    flushSync(() => button.click());
  };
  click(".work-panel-new-tab");
  assert(rows().length === 5, "New tab did not show the same tools");
  click('[data-work-panel-launcher-item="review"]');
  assert(useAppStore.getState().activeWorkPanelTabId === "review", "card did not select Review");
  assert(!rows().length && host.querySelector(".work-tab-empty"), "Review did not replace the launcher");
  click(".work-panel-new-tab");
  click('[data-work-panel-launcher-item="review"]');
  assert(useAppStore.getState().workPanelTabs.length === 1, "singleton was duplicated");
  click(".work-panel-tab-close");
  assert(useAppStore.getState().workPanelOpen, "closing the final tab collapsed the panel");
  click(".work-panel-new-tab");
  assert(rows().length === 5, "launcher could not be reopened");
  await i18n.changeLanguage("zh-CN");
  flushSync(() => useAppStore.setState({ pluginViews: useAppStore.getState().pluginViews.filter((view) => view.pluginId !== "fixture") }));
  globalThis.showLauncher(671, 739, "dark");
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await settle();
  return { ok: true, cases };
};
