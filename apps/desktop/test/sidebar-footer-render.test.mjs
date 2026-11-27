import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";

const buttons = (html) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
const attribute = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

test("the sidebar footer renders its four destinations, the build chip and notifications", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { SidebarFooter } = await server.ssrLoadModule("/src/features/sidebar/SidebarFooter.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    Object.assign(useAppStore.getInitialState(), {
      notifications: [],
      unreadNotificationCount: 0,
      refreshNotifications: async () => {},
      markAllNotificationsRead: async () => {},
      clearNotifications: async () => {},
      openNotification: async () => {},
      showToast: () => {},
    });
    const render = (props) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(SidebarFooter, {
            page: "chat",
            setPage() {},
            canNavBack: () => false,
            navBack() {},
            updateReady: false,
            buildLabel: "v1.2.3",
            buildTitle: "Check for updates",
            onBuildClick() {},
            onBeforeNotificationsOpen() {},
            ...props,
          }),
        ),
      );
    const html = render();
    const actions = buttons(html).filter((tag) => attribute(tag, "class")?.startsWith("footer-action"));
    assert.deepEqual(
      actions.map((tag) => attribute(tag, "data-nav")),
      ["settings", "plugins", "scheduled", "context-insights"],
    );
    for (const action of actions) {
      assert.ok(attribute(action, "aria-label"), "every icon-only action needs a label");
      assert.equal(attribute(action, "aria-pressed"), "false");
    }
    assert.ok(html.includes("footer-notification"), "notifications stay in the footer");
    assert.ok(html.includes("v1.2.3"));
    assert.ok(!html.includes("footer-build-dot"));

    const settingsActive = render({ page: "settings" });
    const settingsAction = buttons(settingsActive).find((tag) => attribute(tag, "data-nav") === "settings");
    assert.equal(attribute(settingsAction ?? "", "aria-pressed"), "true");

    const updating = render({ updateReady: true });
    assert.ok(updating.includes("footer-build-dot"));
  } finally {
    await server.close();
  }
});
