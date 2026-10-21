import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { catalogs } = await import("../../../packages/i18n/src/index.ts");

const hold = { executionId: "goal", sessionId: "session", state: "blocked", version: 1,
  reasons: [{ code: "verdict_partial" }, { code: "team_unsettled", tasks: [{ id: "qa", title: "Check installation", status: "pending", assigneeId: "qa_dev" }] }],
  progress: { items: [{ id: "M0", label: "Build", status: "completed" }, { id: "M1", label: "Install", status: "pending" }] },
  draft: { limitations: ["Signing credentials unavailable"], nextSteps: ["Provide a signing identity"] } };

test("blocked card exposes progress, unfinished owners, limitations and all three localized exits", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" },
    appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { GoalBlockedCard } = await server.ssrLoadModule("/src/components/GoalBlockedCard.tsx");
    const { BlockedGoalResumeChip } = await server.ssrLoadModule("/src/features/chat/composer/BlockedGoalResumeChip.tsx");
    const { GoalReportHeader, GoalReportMetadata } = await server.ssrLoadModule("/src/components/workpanel/goal-report/GoalReportHeader.tsx");
    for (const locale of ["en", "zh-CN", "zh-TW"]) {
      const i18n = createInstance(); await i18n.init({ lng: locale, resources: { [locale]: { translation: catalogs[locale] } } });
      const render = (Component, props) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Component, props)));
      const html = render(GoalBlockedCard, { title: "Release", hold, onResume() {}, onAccept() {}, onAbandon() {} });
      for (const value of ["M0: Build", "M1: Install", "Check installation", "qa_dev", "Signing credentials unavailable", "Provide a signing identity",
        i18n.t("goal.blocked.resume"), i18n.t("goal.blocked.accept"), i18n.t("goal.blocked.abandon")]) assert.ok(html.includes(value), value);
      assert.equal((html.match(/<button/g) ?? []).length, 3);
      assert.ok(!html.includes("goal.blocked."));
      const remote = render(GoalBlockedCard, { title: "Release", hold, readOnly: true });
      assert.ok(!remote.includes("<button")); assert.ok(remote.includes(i18n.t("goal.blocked.remoteReadOnly")));
      const chip = render(BlockedGoalResumeChip, { title: "Release", onDismiss() {} });
      assert.ok(chip.includes(i18n.t("goal.blocked.sendContinues", { title: "Release" })));
      assert.ok(chip.includes(i18n.t("goal.blocked.normalMessage")));
      const report = { goal: { title: "Release" }, verdict: "partial", metrics: [], integrity: { kind: "fallback" }, execution: { status: "completed" },
        closure: "user_accepted", segments: [{ turnId: "first", startedAt: 1000 }, { turnId: "second", startedAt: 3000 }], blocks: [{ at: 2000, reasons: hold.reasons }] };
      const accepted = render(GoalReportHeader, { report });
      assert.ok(accepted.includes(i18n.t("goal.blocked.userAccepted")));
      assert.ok(!accepted.includes(i18n.t("goalReport.view.fallbackNotice")));
      assert.ok(accepted.indexOf(i18n.t("goal.blocked.timelineStarted")) < accepted.indexOf(i18n.t("goal.blocked.timelineBlocked")));
      assert.ok(accepted.indexOf(i18n.t("goal.blocked.timelineBlocked")) < accepted.indexOf(i18n.t("goal.blocked.timelineResumed")));
      const metadata = render(GoalReportMetadata, { report });
      assert.ok(metadata.includes(i18n.t("goal.blocked.userAccepted")));
      assert.ok(!metadata.includes(i18n.t("goalReport.view.fallback")));
    }
  } finally { await server.close(); }
});
