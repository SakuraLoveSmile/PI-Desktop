import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Renders the production update banner and Settings row through Vite SSR with
 * the update state supplied by the test instead of the Electron bridge.
 *
 * Server rendering runs no effects, so what a test sees is the first frame for
 * the given state. Clicks and the state transitions behind them are covered at
 * the controller layer.
 */
export async function updateUiSsr(t, locale = "en") {
  const server = await createServer({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "stub-update-state",
        enforce: "pre",
        resolveId(source) {
          return /hooks\/use-update-state$/.test(source) ? "\0stub-update-state" : undefined;
        },
        load(id) {
          return id === "\0stub-update-state"
            ? "export const useUpdateState = () => globalThis.__piUpdateState ?? null;"
            : undefined;
        },
      },
    ],
  });
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: { dataset: {} } };
  t.after(async () => {
    delete globalThis.__piUpdateState;
    globalThis.document = originalDocument;
    await server.close();
  });

  const i18n = createInstance();
  await i18n.init({ lng: locale, resources: { [locale]: { translation: catalogs[locale] } } });
  const { UpdateBanner } = await server.ssrLoadModule("/src/components/UpdateBanner.tsx");
  const { UpdatesRow } = await server.ssrLoadModule("/src/features/settings/agent-sections.tsx");

  const wrap = (element) =>
    renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
  const state = (overrides) => ({
    mode: "in-app",
    preference: "automatic",
    defaultPreference: "manual",
    automaticSupported: true,
    status: "idle",
    currentVersion: "0.16.0",
    releasesUrl: "https://github.com/SakuraLoveSmile/PI-Desktop/releases",
    delivery: "assisted",
    ...overrides,
  });
  return {
    t: (key, options) => i18n.t(key, options),
    state,
    banner(update) {
      globalThis.__piUpdateState = update;
      return wrap(createElement(UpdateBanner));
    },
    row(update, settings = { updatePreference: update?.preference ?? "manual" }) {
      globalThis.__piUpdateState = update;
      return wrap(
        createElement(UpdatesRow, {
          currentVersion: update?.currentVersion,
          settings,
          saveSettings: async () => undefined,
        }),
      );
    },
  };
}
