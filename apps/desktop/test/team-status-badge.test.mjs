import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("Team summary preserves terminal activity and task completion while members and pause remain independent", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { TeamStatusBadge } = await server.ssrLoadModule("/src/components/workpanel/team/TeamStatusBadge.tsx");
    const snapshot = { leadPhase: "completed", paused: false, members: [], tasks: [], queuedMessageCount: 0 };
    const render = (patch = {}) => renderToStaticMarkup(createElement(TeamStatusBadge, { snapshot: { ...snapshot, ...patch } }));
    assert.match(render(), /data-team-status="completed"/);
    assert.match(render({ leadPhase: "failed" }), /data-team-status="failed"/);
    assert.match(render({ tasks: [{ status: "pending", deleted: false }] }), /data-team-status="idle"/);
    assert.match(render({ queuedMessageCount: 1 }), /data-team-status="idle"/);
    assert.match(render({ tasks: [{ status: "pending", deleted: true }] }), /data-team-status="completed"/);
    assert.match(render({ members: [{ phase: "running" }] }), /data-team-status="active"/);
    assert.match(render({ paused: true, members: [{ phase: "running" }] }), /data-team-status="paused"/);
  } finally { await server.close(); }
});
