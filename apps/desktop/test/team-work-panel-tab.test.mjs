import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("Team tabs label and icon every target without parsing their IDs", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { teamTabLabel, teamTabIcon } = await server.ssrLoadModule("/src/components/workpanel/team/team-work-panel-tab.ts");
    const { IconMessageCircle, IconUsers } = await server.ssrLoadModule("/src/components/icons.tsx");
    const translate = (key, options) => key === "team.adHocTaskTitle" ? `Ad-hoc: ${options.subject}` : key;
    for (const kind of [undefined, "aggregate", "board", "panorama", "task", "member"]) {
      const tab = { id: "opaque-id", kind: "team", teamTarget: kind ? { kind } : undefined };
      assert.equal(teamTabLabel(tab, translate), kind === "panorama" ? "team.teamPanoramaTitle" : "panel.tabs.team");
      assert.equal(teamTabIcon(tab), kind === "task" || kind === "member" ? IconMessageCircle : IconUsers);
    }
    assert.equal(teamTabLabel({ kind: "team", teamTarget: { kind: "task" }, label: "Inspect" }, translate), "Ad-hoc: Inspect");
    assert.equal(teamTabLabel({ kind: "team", teamTarget: { kind: "member" }, label: "Alex" }, translate), "Alex");
  } finally {
    await server.close();
  }
});
