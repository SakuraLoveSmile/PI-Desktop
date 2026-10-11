import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

test("Team budget settings expose enabled six/ten-hour defaults and status distinguishes safe finishing from paused", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { TeamRunLimitsSettings } = await server.ssrLoadModule("/src/features/settings/TeamRunLimitsSettings.tsx");
    const { TeamRunLimitNotice } = await server.ssrLoadModule("/src/components/workpanel/team/TeamRunLimitNotice.tsx");
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: {
      common: { loading: "Loading" }, settings: { expertTeam: { save: "Save", runLimits: { title: "Limits", enabled: "Enable limits", soft: "Wrap-up hours", hard: "Pause hours" } } },
      team: { runLimitHours: "Run {{elapsed}} · soft {{soft}} · hard {{hard}}", runLimitSoft: "Collect expert results", runLimitStopping: "Safely finishing", runLimitPaused: "Paused; adjust policy, then resume", runLimitDisabled: "Disabled; clock retained", runLimitReadyToResume: "Ready to Resume; clock retained" },
    } } } });
    const render = (component, props = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(component, props)));
    const settings = render(TeamRunLimitsSettings);
    assert.match(settings, /role="switch"[^>]*aria-checked="true"/);
    assert.match(settings, /aria-label="Wrap-up hours"[^>]*value="6"/);
    assert.match(settings, /aria-label="Pause hours"[^>]*value="10"/);
    assert.match(settings, />Save<\/button>/);
    const limits = { enabled: true, runId: "run", startedAt: 0, elapsedMs: 21600000, softMs: 21600000, hardMs: 36000000, softMessageId: "notice", hardReachedAt: null };
    assert.match(render(TeamRunLimitNotice, { limits, safelyFinishing: false }), /Collect expert results/);
    const hard = { ...limits, elapsedMs: 36000000, hardReachedAt: 36000000 };
    assert.match(render(TeamRunLimitNotice, { limits: hard, safelyFinishing: true }), /Safely finishing/);
    const paused = render(TeamRunLimitNotice, { limits: hard, safelyFinishing: false });
    assert.match(paused, /Paused; adjust policy, then resume/);
    assert.doesNotMatch(paused, /Safely finishing/);
    const disabled = render(TeamRunLimitNotice, { limits: { ...hard, enabled: false }, safelyFinishing: false });
    assert.match(disabled, /Disabled; clock retained/);
    assert.match(disabled, /Ready to Resume; clock retained/);
    assert.doesNotMatch(disabled, /adjust policy/);
    const extended = render(TeamRunLimitNotice, { limits: { ...hard, hardMs: 72_000_000 }, safelyFinishing: false });
    assert.match(extended, /Ready to Resume; clock retained/);
    assert.doesNotMatch(extended, /adjust policy/);
  } finally { await server.close(); }
});
