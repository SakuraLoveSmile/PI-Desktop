import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createServer } from "vite";

test("team session disclosure keeps row actions beside the toggle and hides folded children from keyboard access", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { TeamSessionGroup } = await server.ssrLoadModule(
      "/src/features/sessions/TeamSessionGroup.tsx",
    );
    const html = renderToStaticMarkup(createElement(TeamSessionGroup, {
      sessionId: "lead-session",
      expanded: false,
      toggleLabel: "Expand team sessions",
      members: [{ id: "member-session", team: { role: "member", teamSessionId: "lead-session" } }],
      visibleMembers: [{ id: "member-session", team: { role: "member", teamSessionId: "lead-session" } }],
      leadRow: createElement("div", { "data-lead-row": "true" },
        createElement("button", { "data-existing-action": "true" }, "Session actions")),
      renderMember: () => createElement("div", { "data-member-row": "true" }, "Member"),
      onToggle() {},
    }));

    assert.match(html, /aria-label="Expand team sessions"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="sidebar-team-members-lead-session"/);
    assert.match(html, /data-existing-action="true"/);
    assert.match(html, /data-member-row="true"/);
    assert.match(html, /aria-hidden="true" inert=""/);
    assert.doesNotMatch(html, /<button[^>]*>[^<]*<button/);
  } finally {
    await server.close();
  }
});

test("team session disclosure exposes children when expanded", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { TeamSessionGroup } = await server.ssrLoadModule(
      "/src/features/sessions/TeamSessionGroup.tsx",
    );
    const html = renderToStaticMarkup(createElement(TeamSessionGroup, {
      sessionId: "lead-session",
      expanded: true,
      toggleLabel: "Collapse team sessions",
      members: [{ id: "member-session", team: { role: "member", teamSessionId: "lead-session" } }],
      visibleMembers: [{ id: "member-session", team: { role: "member", teamSessionId: "lead-session" } }],
      leadRow: createElement("div", null, "Lead"),
      renderMember: () => createElement("div", null, "Member"),
      onToggle() {},
    }));

    assert.match(html, /aria-label="Collapse team sessions"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /aria-hidden="false"/);
    assert.doesNotMatch(html, /\binert=/);
  } finally {
    await server.close();
  }
});
