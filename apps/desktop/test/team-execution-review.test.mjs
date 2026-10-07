import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(relative, imports = {}) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)((id) => {
    assert.ok(Object.hasOwn(imports, id), `unexpected import: ${id}`);
    return imports[id];
  }, module.exports, module);
  return module.exports;
}

function hookHarness() {
  const cells = [];
  let cursor = 0;
  let effects = [];
  const same = (a, b) => a?.length === b?.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, dependencies) => {
    const index = cursor++;
    if (!cells[index] || !same(cells[index].dependencies, dependencies)) {
      cells[index] = { value: factory(), dependencies };
    }
    return cells[index].value;
  };
  return {
    react: {
      useMemo: memo,
      useCallback: (callback, dependencies) => memo(() => callback, dependencies),
      useRef: (value) => memo(() => ({ current: value }), []),
      useEffect(callback, dependencies) {
        const index = cursor++;
        if (!cells[index] || !same(cells[index].dependencies, dependencies)) {
          cells[index]?.cleanup?.();
          cells[index] = { dependencies };
          effects.push(() => { cells[index].cleanup = callback(); });
        }
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        const index = cursor++;
        if (cells[index]?.subscribe !== subscribe) {
          cells[index]?.cleanup?.();
          cells[index] = { subscribe, cleanup: subscribe(() => {}) };
        }
        return getSnapshot();
      },
    },
    render(hook, beforeEffects) {
      cursor = 0;
      effects = [];
      hook();
      beforeEffects?.();
      for (const effect of effects) effect();
    },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

const lead = (id = "lead-a", extra = {}) => ({
  id, mode: "agent", executionProfile: "team", source: "desktop", ...extra,
});
const review = (extra = {}) => ({
  reviewId: "review-a", teamSessionId: "lead-a", status: "pending",
  strategy: "delegate", launchPolicy: "user_confirmed", members: [{ name: "researcher" }],
  ...extra,
});
const snapshot = (proposal = review(), extra = {}) => ({
  teamSessionId: "lead-a", revision: 1, members: [], tasks: [], readiness: [],
  scopeOverlaps: [], paused: false, leadPhase: "idle", queuedMessageCount: 0,
  decision: null, review: proposal, ...extra,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(session = lead(), proposal = review()) {
  const harness = hookHarness();
  const opened = [];
  const reads = [];
  const pendingReads = [];
  const focusListeners = new Set();
  let currentSnapshot = snapshot(proposal, { teamSessionId: session.team?.teamSessionId ?? session.id });
  let deferRead = false;
  const state = {
    ready: true, page: "chat", sessions: [session], activeSessionId: session.id,
    workPanelOpen: false, workPanelTabs: [], activeWorkPanelTabId: null,
    planCheckpoints: {},
    refreshSessions: async () => {},
    openWorkPanelTabForSession(sessionId, tab) {
      opened.push({ sessionId, tab });
      state.workPanelOpen = true;
      state.activeWorkPanelTabId = tab.id;
    },
  };
  const store = (selector) => selector(state);
  store.getState = () => state;
  const api = {
    getTeamSnapshot: async (id) => {
      reads.push(id);
      if (deferRead) return new Promise((resolve) => pendingReads.push(resolve));
      return currentSnapshot;
    },
    onTeamChanged: () => () => {},
    onHostStatus: () => () => {},
  };
  const runtime = await load("../src/stores/runtime/team-runtime.ts");
  // The real reader and shared hook are used; only IPC and clock edges are controlled.
  const sharedHook = await load("../src/hooks/useTeamSnapshot.ts", {
    react: harness.react, "../lib/api": { api }, "../stores/app-store": { useAppStore: store },
    "../stores/runtime/team-runtime": {
      createTeamSnapshotReader: (id, transport) => runtime.createTeamSnapshotReader(id, transport, {
        now: () => 1, setTimeout: () => 1, clearTimeout() {},
      }),
    },
  });
  globalThis.window = {
    addEventListener: (_, listener) => focusListeners.add(listener),
    removeEventListener: (_, listener) => focusListeners.delete(listener),
  };
  const presentation = await load("../src/lib/team-presentation.ts");
  const tabs = await load("../src/lib/work-panel-tabs.ts");
  const hook = await load("../src/hooks/useTeamExecutionReview.ts", {
    react: harness.react, "../lib/team-presentation": presentation,
    "../lib/work-panel-tabs": tabs, "../lib/plan-mode-state": await load("../src/lib/plan-mode-state.ts"),
    "../stores/app-store": { useAppStore: store },
    "./useTeamSnapshot": sharedHook,
  });
  return {
    state, opened, reads, hook,
    render: (beforeEffects) => harness.render(hook.useTeamExecutionReview, beforeEffects),
    async refresh(next) {
      currentSnapshot = next;
      for (const listener of focusListeners) listener();
      await settle();
    },
    defer() { deferRead = true; },
    resolve(next) { for (const resolve of pendingReads.splice(0)) resolve(next); },
    cleanup: () => harness.unmount(),
  };
}

test("a current execution review opens the closed aggregate Team tab once", async () => {
  const f = await fixture();
  try {
    f.render();
    await settle();
    f.render();
    assert.equal(f.state.workPanelOpen, true);
    assert.equal(f.state.activeWorkPanelTabId, "team:lead-a");
    assert.deepEqual(f.opened[0].tab, { id: "team:lead-a", kind: "team", resource: "lead-a" });
    // Subsequent snapshots must let the user inspect a file or panorama.
    f.state.activeWorkPanelTabId = "team:lead-a:panorama";
    await f.refresh(snapshot(review(), { revision: 2 }));
    f.render();
    assert.equal(f.opened.length, 1);
    assert.equal(f.state.activeWorkPanelTabId, "team:lead-a:panorama");
    await f.refresh(snapshot(review({ reviewId: "review-b" }), { revision: 3 }));
    f.render();
    assert.equal(f.opened.length, 2);
    assert.equal(f.state.activeWorkPanelTabId, "team:lead-a");
  } finally { f.cleanup(); }
});

test("approved Plan and Goal execution reveal staffing consent while preserving contract mode", async () => {
  for (const mode of ["plan", "goal"]) {
    const f = await fixture(lead("lead-a", { mode }));
    try {
      f.render(); await settle(); f.render();
      assert.equal(f.opened.length, 0, "negotiation cannot reveal execution consent");
      f.state.planCheckpoints["lead-a"] = { kind: mode, status: "approved", executionState: "running" };
      f.render(); await settle(); f.render();
      assert.equal(f.opened.length, 1, `${mode} execution must reveal the pending roster`);
      assert.equal(f.state.activeWorkPanelTabId, "team:lead-a");
      assert.equal(f.state.sessions[0].mode, mode, "contract presentation stays intact");
    } finally { f.cleanup(); }
  }
});

test("current legacy pending approval is revealed on renderer reload", async () => {
  const f = await fixture(lead(), review({ launchPolicy: undefined }));
  try {
    f.render(); await settle(); f.render();
    assert.equal(f.opened.length, 1);
  } finally { f.cleanup(); }
});

test("Plan, members and nonlocal views neither read nor reveal execution reviews", async () => {
  for (const session of [
    lead("lead-a", { mode: "plan" }),
    lead("member-a", { team: { teamSessionId: "lead-a", role: "member" } }),
    lead("remote:lead-a"),
    lead("native-pi:lead-a"),
    lead("lead-a", { source: "remote" }),
    lead("lead-a", { executionProfile: "standard" }),
  ]) {
    const f = await fixture(session);
    try {
      f.render(); await settle(); f.render();
      assert.equal(f.reads.length, 0, JSON.stringify(session));
      assert.equal(f.opened.length, 0, JSON.stringify(session));
    } finally { f.cleanup(); }
  }
});

test("automatic, settled, empty and historical solo reviews do not steal focus", async () => {
  for (const proposal of [
    review({ launchPolicy: "automatic_plan" }),
    review({ status: "confirmed" }), review({ status: "cancelled" }),
    review({ members: [] }), review({ strategy: "lead_only" }),
    review({ teamSessionId: "other" }),
  ]) {
    const f = await fixture(lead(), proposal);
    try {
      f.render(); await settle(); f.render();
      assert.equal(f.opened.length, 0, JSON.stringify(proposal));
    } finally { f.cleanup(); }
  }
});

test("a stale pending read cannot reveal a background session or newly selected member", async () => {
  const f = await fixture();
  try {
    f.defer(); f.render();
    f.state.sessions.push(lead("member-b", { team: { teamSessionId: "lead-a", role: "member" } }));
    f.state.activeSessionId = "member-b";
    f.render();
    f.resolve(snapshot()); await settle(); f.render();
    assert.equal(f.opened.length, 0);
    // Returning to the Lead reveals its durable pending review.
    f.state.activeSessionId = "lead-a";
    f.render(); f.resolve(snapshot()); await settle(); f.render();
    assert.equal(f.opened.length, 1);
    assert.equal(f.opened[0].sessionId, "lead-a");
  } finally { f.cleanup(); }
});

test("the authoritative mode/page/selection is checked before opening the panel", async () => {
  for (const mutate of [
    (s) => { s.sessions = [lead("lead-a", { mode: "plan" })]; },
    (s) => { s.page = "settings"; },
    (s) => { s.selectingSessionId = "other"; },
    (s) => { s.activeSessionId = "other"; },
  ]) {
    const f = await fixture();
    try {
      f.render(); await settle();
      f.render(() => mutate(f.state));
      assert.equal(f.opened.length, 0);
    } finally { f.cleanup(); }
  }
});

test("TeamPanel preserves user approval history but never renders automatic research approval", async () => {
  const f = await fixture();
  try {
    const reviewPanel = () => {};
    const jsx = (type, props) => ({ type, props });
    const react = {
      useCallback: (callback) => callback, useEffect() {}, useRef: (value) => ({ current: value }),
      useState: (value) => [typeof value === "function" ? value() : value, () => {}],
    };
    const presentation = await load("../src/lib/team-presentation.ts");
    const view = await load("../src/lib/team-panel-view.ts");
    let current = snapshot();
    let currentMode = "agent";
    let checkpoint;
    const { TeamPanel } = await load("../src/components/workpanel/TeamPanel.tsx", {
      react, "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
      "../../lib/api": { api: {} }, "../../lib/team-panel-view": view,
      "../../hooks/useTeamSnapshot": { useTeamSnapshot: () => ({ snapshot: current, refresh: async () => {} }) },
      "../../hooks/useTeamExecutionReview": f.hook,
      "../../stores/app-store": {
        useAppStore: (selector) => selector({ sessions: [lead("lead-a", { mode: currentMode })], planCheckpoints: { "lead-a": checkpoint } }),
      },
      "../../lib/team-presentation": presentation,
      "./TeamLaunchReviewPanel": { TeamLaunchReviewPanel: reviewPanel },
      "../icons": {}, "../ui": {}, "./team/TeamMemberTranscript": {},
      "./team/TeamTaskBrief": {}, "./team/CompactTeamBoard": {},
      "./team/TeamStatusBadge": {}, "./team/TeamTaskProgress": {}, "../../styles/team-panel.css": {},
    });
    const findReview = (node) => {
      if (!node || typeof node !== "object") return undefined;
      if (Array.isArray(node)) return node.map(findReview).find(Boolean);
      return node.type === reviewPanel ? node : findReview(node.props?.children);
    };
    for (const launchPolicy of [undefined, "user_confirmed"]) {
      for (const status of ["pending", "confirmed"]) {
        current = snapshot(review({ launchPolicy, status }));
        assert.equal(findReview(TeamPanel({ teamSessionId: "lead-a" })).props.review.status, status);
      }
    }
    for (const status of ["pending", "confirmed"]) {
      current = snapshot(review({ launchPolicy: "automatic_plan", status }));
      assert.equal(findReview(TeamPanel({ teamSessionId: "lead-a" })), undefined);
    }
    for (const mode of ["plan", "goal"]) {
      currentMode = mode;
      checkpoint = { kind: mode, status: "approved", executionState: "running" };
      current = snapshot(review());
      assert.equal(findReview(TeamPanel({ teamSessionId: "lead-a" })).props.review.status, "pending",
        `${mode} execution must render its confirmation card`);
      current = snapshot(review({ launchPolicy: "automatic_plan", status: "confirmed" }));
      assert.equal(findReview(TeamPanel({ teamSessionId: "lead-a" })), undefined);
    }
    currentMode = "goal";
    checkpoint = { kind: "goal", status: "approved", executionState: "completed" };
    current = snapshot(review({ status: "confirmed" }));
    assert.equal(findReview(TeamPanel({ teamSessionId: "lead-a" })).props.review.status, "confirmed",
      "completed Goal keeps its existing consent history");
    checkpoint = undefined;
    currentMode = "plan";
    for (const launchPolicy of [undefined, "user_confirmed", "automatic_plan"]) {
      current = snapshot(review({ launchPolicy }));
      assert.equal(findReview(TeamPanel({ teamSessionId: "lead-a" })), undefined,
        "legacy and current Plan research never ask for staffing consent");
    }
  } finally { f.cleanup(); }
});
