import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createInteractionSlice } = await import("../src/stores/slices/interaction-slice.ts");
const { usePluginBrowseState } = await import("../src/features/plugins/browse-state.ts");

function harness(page = "chat") {
  let intents = 0;
  const selections = [];
  let state = {
    page, utilityReturnPage: "chat", activeSessionId: "session-a",
    navStack: [{ page, sessionId: page === "chat" ? "session-a" : undefined }], navIndex: 0,
    selectSession: (...args) => selections.push(args),
  };
  const actions = createInteractionSlice({
    get: () => state,
    set: (update) => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; },
    runtime: { beginNavigationIntent: () => ++intents },
    interactionRuntime: {},
  });
  state = { ...state, ...actions };
  return { get: () => state, actions, selections, set: (patch) => { state = { ...state, ...patch }; } };
}

for (const page of ["chat", "pulls", "scheduled"]) {
  test(`utility toggle returns to ${page} without reloading the active session`, () => {
    const h = harness(page);
    h.actions.toggleUtilityPage("plugins");
    assert.equal(h.get().page, "plugins");
    h.actions.toggleUtilityPage("plugins");
    assert.equal(h.get().page, page);
    assert.equal(h.get().activeSessionId, "session-a");
    assert.deepEqual(h.selections, []);
  });
}

test("switching utilities or settings tabs does not replace the return destination", () => {
  const h = harness("scheduled");
  h.actions.toggleUtilityPage("plugins");
  h.actions.toggleUtilityPage("settings");
  h.actions.setSettingsTab("models");
  h.actions.toggleUtilityPage("settings");
  assert.equal(h.get().page, "scheduled");
  h.actions.setPage("pulls");
  h.actions.toggleUtilityPage("settings");
  h.actions.toggleUtilityPage("settings");
  assert.equal(h.get().page, "pulls");
});

test("utility navigation preserves a newer or deleted active session instead of restoring an old id", () => {
  for (const activeSessionId of ["session-b", undefined]) {
    const h = harness();
    h.actions.toggleUtilityPage("plugins");
    h.set({ activeSessionId });
    h.actions.toggleUtilityPage("plugins");
    assert.equal(h.get().page, "chat");
    assert.equal(h.get().activeSessionId, activeSessionId);
    assert.deepEqual(h.selections, []);
  }
});

test("direct navigation, no-history navigation and browser history retain a usable return page", () => {
  const h = harness("pulls");
  h.actions.setPage("settings", { record: false });
  h.actions.toggleUtilityPage("settings");
  assert.equal(h.get().page, "pulls");
  h.actions.setPage("plugins");
  h.actions.navBack();
  h.actions.navForward();
  h.actions.toggleUtilityPage("plugins");
  assert.equal(h.get().page, "pulls");
  const fresh = harness();
  fresh.set({ page: "plugins" });
  fresh.actions.toggleUtilityPage("plugins");
  assert.equal(fresh.get().page, "chat");
});

test("plugin browsing choices survive subscribers disconnecting without retaining dialogs or operations", () => {
  const before = usePluginBrowseState.getInitialState();
  try {
    const unsubscribe = usePluginBrowseState.subscribe(() => {});
    usePluginBrowseState.getState().setTab("market");
    usePluginBrowseState.getState().setQuery("browser");
    usePluginBrowseState.getState().setInstalledQuery("local");
    usePluginBrowseState.getState().setCategory("productivity");
    unsubscribe();
    const reopened = usePluginBrowseState.getState();
    assert.equal(reopened.tab, "market");
    assert.equal(reopened.query, "browser");
    assert.equal(reopened.installedQuery, "local");
    assert.equal(reopened.category, "productivity");
    assert.deepEqual(Object.keys(reopened).filter((key) => typeof reopened[key] !== "function").sort(),
      ["category", "installedQuery", "query", "tab"]);
  } finally { usePluginBrowseState.setState(before, true); }
});
