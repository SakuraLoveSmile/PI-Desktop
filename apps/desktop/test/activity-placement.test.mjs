import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, logLevel: "silent",
  server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());
const { ACTIVITY_INLINE_MIN_WIDTH, activityPlacement } = await server.ssrLoadModule("/src/features/chat/activity/activity-placement.ts");
const { useActivityPlacementStore } = await server.ssrLoadModule("/src/features/chat/activity/activity-placement-store.ts");
const { activityWorkPanelTab, panoramaWorkPanelTab, sanitizeWorkPanelTabsState, teamWorkPanelTab, workPanelDisplayTabs } =
  await server.ssrLoadModule("/src/lib/work-panel-tabs.ts");

const place = (overrides = {}) => activityPlacement({
  visible: true, hasSession: true, panelOpen: false, surfaceWidth: 900, ...overrides,
});

test("only the chat width decides where the summary sits", () => {
  assert.equal(ACTIVITY_INLINE_MIN_WIDTH, 820);
  assert.equal(place({ surfaceWidth: 900 }), "inline");
  assert.equal(place({ panelOpen: true, surfaceWidth: 877 }), "inline");
  assert.equal(place({ panelOpen: true, surfaceWidth: 820 }), "inline");
  assert.equal(place({ panelOpen: true, surfaceWidth: 819 }), "docked");
  assert.equal(place({ panelOpen: true, surfaceWidth: 781 }), "docked");
  assert.equal(place({ surfaceWidth: 725 }), "button");
  // No summary for a surface that is not on screen, or for a chat with no session to summarise.
  assert.equal(place({ visible: false, surfaceWidth: 1200 }), "none");
  assert.equal(place({ visible: false, panelOpen: true, surfaceWidth: 600 }), "none");
  assert.equal(place({ hasSession: false, surfaceWidth: 1200 }), "none");
  assert.equal(place({ hasSession: false, surfaceWidth: 600 }), "none");
});

test("docked, the summary is the first tab and appears once", () => {
  const review = { id: "review", kind: "review" };
  const fresh = workPanelDisplayTabs([review], null, { hasSession: true, docked: true });
  assert.deepEqual(fresh.displayTabs.map((tab) => tab.id), ["activity", "review"]);
  assert.equal(fresh.activeTab?.kind, "activity");
  const stored = workPanelDisplayTabs([review, activityWorkPanelTab()], "review", { hasSession: true, docked: true });
  assert.deepEqual(stored.displayTabs.map((tab) => tab.id), ["activity", "review"]);
  assert.equal(stored.displayTabs.filter((tab) => tab.kind === "activity").length, 1);
  assert.equal(stored.activeTab?.id, "review");
  assert.equal(workPanelDisplayTabs([review], "review", { hasSession: true, docked: true }).activeTab?.id, "review");
});

test("not docked, a stored summary tab is hidden and the active tab falls to the next one", () => {
  const tabs = [activityWorkPanelTab(), { id: "review", kind: "review" }, { id: "file:README.md", kind: "file" }];
  const below = workPanelDisplayTabs(tabs, "activity", { hasSession: true, docked: false });
  assert.deepEqual(below.displayTabs.map((tab) => tab.id), ["review", "file:README.md"]);
  assert.equal(below.activeTab?.id, "review");
  // The summary is not in the panel at all once the rail fits beside the chat.
  assert.equal(workPanelDisplayTabs([activityWorkPanelTab()], "activity", { hasSession: true, docked: false }).activeTab, null);
  assert.equal(workPanelDisplayTabs([], null, { hasSession: true, docked: false }).activeTab, null);
  assert.equal(workPanelDisplayTabs([activityWorkPanelTab(), { id: "review", kind: "review" }], "activity",
    { hasSession: false, docked: true }).displayTabs.length, 1);
});

test("a legacy overview tab is dropped instead of rendering an unknown kind", () => {
  const sanitized = sanitizeWorkPanelTabsState({
    tabs: [{ id: "overview", kind: "overview" }, { id: "review", kind: "review" }],
    activeTabId: "overview",
  });
  assert.deepEqual(sanitized.tabs.map((tab) => tab.kind), ["review"]);
  assert.equal(sanitized.activeTabId, "review");
});

test("the panorama entry opens the Team panorama for a Team and its own tab otherwise", () => {
  assert.deepEqual(teamWorkPanelTab("team-1", { kind: "panorama" }).id, "team:team-1:panorama");
  assert.deepEqual(panoramaWorkPanelTab(), { id: "panorama", kind: "panorama" });
});

test("a hidden surface never takes the placement from the visible one", () => {
  const { report, release } = useActivityPlacementStore.getState();
  report("visible", "docked", true);
  report("hidden", "inline", false);
  assert.deepEqual([useActivityPlacementStore.getState().sessionId, useActivityPlacementStore.getState().placement], ["visible", "docked"]);
  // Unmounting the hidden surface releases only its own claim.
  release("hidden");
  assert.equal(useActivityPlacementStore.getState().placement, "docked");
  release("visible");
  assert.deepEqual([useActivityPlacementStore.getState().sessionId, useActivityPlacementStore.getState().placement], [null, "none"]);
});
