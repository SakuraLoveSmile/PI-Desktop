import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as shared from "@pi-desktop/shared";

const require = createRequire(import.meta.url);
const sourceRoot = new URL("../src/", import.meta.url).pathname;
const pendingLabel = "team.review.status.pending";
const passthrough = ({ children }) => children;
const empty = () => null;
const jsx = (type, props) => ({ type, props: props ?? {} });

function fixture() {
  const opened = [];
  const progressView = { progress: null, error: null, loading: true };
  const lead = { id: "lead", mode: "goal", executionProfile: "team", source: "desktop" };
  const execution = { id: "goal", sessionId: "lead", kind: "goal", status: "approved", executionState: "running", executionId: "execution-current", title: "Build" };
  const state = {
    activeSessionId: "lead", sessions: [lead], providers: [], messages: [],
    settings: { thinkingDisplayMode: "detailed" }, pendingPlans: {},
    planCheckpoints: { lead: execution }, planHistory: {}, planningStates: {},
    runningSessions: { lead: true }, sessionOutcomes: {}, latestTurnResults: {},
    goalReports: {}, agentStatuses: { lead: { activity: { phase: "preparing", since: 1 } } },
    sessionCompactions: {}, sessionTodos: {}, activeWorkPanelTabId: null, workPanelTabs: [],
    openWorkPanelTabForSession: (sessionId, tab) => opened.push({ sessionId, tab }),
    showToast() {}, openFileInWorkPanel() {}, openSubagentTab() {},
  };
  const snapshot = {
    teamSessionId: "lead", members: [], tasks: [], readiness: [], paused: false,
    review: { reviewId: "review", teamSessionId: "lead", status: "pending",
      strategy: "delegate", launchPolicy: "user_confirmed", members: [{ name: "developer" }] },
  };
  const context = () => ({ Provider: passthrough });
  const react = {
    memo: (component) => component, useMemo: (factory) => factory(),
    useRef: (current) => ({ current }), useContext: () => null,
    useEffect() {}, useId: () => "detail", createContext: context,
    useState: (initial) => {
      const value = typeof initial === "function" ? initial() : initial;
      return [value && typeof value === "object" && "reportReady" in value
        ? { ...value, ...progressView } : value, () => {}];
    },
  };
  const modules = new Map([
    ["@pi-desktop/shared", shared],
    ["react", react], ["react/jsx-runtime", { jsx, jsxs: jsx, Fragment: passthrough }],
    ["react-i18next", { useTranslation: () => ({ t: (key) => key }) }],
  ]);
  const stub = (relative, exports) => modules.set(path.join(sourceRoot, relative), exports);
  stub("stores/app-store", { useAppStore: (selector) => selector(state) });
  stub("hooks/useTeamSnapshot", { useTeamSnapshot: () => ({ snapshot, loading: false }) });
  stub("hooks/useOverviewMetadata", { useOverviewMetadata: () => ({}) });
  stub("components/icons", new Proxy({}, { get: () => empty }));
  stub("components/ui", { Button: ({ children, variant: _variant, size: _size, ...props }) => jsx("button", { ...props, children }), TooltipButton: empty });
  for (const component of ["ConversationMinimap", "PermissionCard", "TurnOutcomeCard", "GoalReportCard", "PlanApprovalBar"]) {
    stub(`components/${component}`, { [component]: empty });
  }
  stub("components/workpanel/AgentPanorama", { AgentPanorama: empty });
  stub("components/workpanel/team/TeamTaskProgress", { TeamTaskProgress: ({ extra }) => extra });
  stub("plugins/renderer-slots/use-slots", { SlotSessionProvider: passthrough });
  stub("lib/api", { api: {} });
  for (const name of ["TranscriptSearchContext", "DisclosureAnchorContext", "PlanTranscriptContext"]) {
    const file = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    stub(`lib/${file}`, { [name]: context() });
  }
  stub("features/chat/transcript/TranscriptMenu", {
    TranscriptMenuProvider: passthrough, useTranscriptMenu: () => () => {},
    useChatTextActions: () => ({ copyText() {}, selectText() {} }),
  });
  stub("features/chat/transcript/ThinkingDisplayControl", { ThinkingDisplayControl: empty });
  stub("features/chat/transcript/AssistantTurn", { TranscriptHistory: empty, TranscriptTail: empty });
  stub("features/chat/transcript/hooks/useTranscriptScroll", { useTranscriptScroll: () => ({
    historyEntries: [], transcriptEntries: [], minimapMessages: [], veilPhase: "off",
  }) });
  stub("features/chat/transcript/ActivityItems", { ActivityItems: empty });
  const disclosure = {
    useAutomaticDisclosure: () => ({ open: false, toggle() {}, collapse() {}, claim() {} }),
    DisclosureScope: passthrough, disclosureKey: (...parts) => parts.join(":"),
  };
  stub("features/chat/transcript/disclosure", disclosure);
  stub("features/chat/transcript/shared", { ...disclosure, DisclosureCollapseRail: empty });
  // Render the status-bearing components and their pure transforms unchanged.
  // Only Host/store, DOM timing and unrelated renderer surfaces are replaced.
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const filename = [file, `${file}.ts`, `${file}.tsx`].find(existsSync);
    assert.ok(filename, `missing source module ${file}`);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    });
    const module = { exports: {} };
    modules.set(file, module.exports);
    new Function("require", "exports", "module", outputText)((id) => {
      if (modules.has(id)) return modules.get(id);
      return id.startsWith(".") ? load(path.resolve(path.dirname(filename), id)) : require(id);
    }, module.exports, module);
    modules.set(file, module.exports);
    return module.exports;
  }
  const nodes = [];
  const render = (element) => {
    nodes.length = 0;
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (value == null || typeof value === "boolean") return;
      if (typeof value !== "object") { nodes.push(value); return; }
      if (typeof value.type === "function") return visit(value.type(value.props));
      nodes.push(value);
      visit(value.props?.children);
    };
    visit(element);
    return nodes.filter((node) => typeof node === "string").join(" ");
  };
  return { state, snapshot, opened, nodes, render, progressView,
    component: (relative, name, props = {}) => jsx(load(path.join(sourceRoot, relative))[name], props) };
}

test("approved Goal waits visibly, opens its review, then resumes normal runtime presentation", () => {
  const f = fixture();
  const transcript = () => f.component("features/chat/transcript/ChatTranscript", "ChatTranscript", {
    sessionId: "lead", messages: [], isRunning: true,
  });
  assert.match(f.render(transcript()), new RegExp(pendingLabel));
  assert.doesNotMatch(f.render(transcript()), /chat.preparingNextRequest|chat.running/);
  const button = f.nodes.find((node) => node.props?.["aria-label"] === "chat.teamToolActions.strategy");
  assert.ok(button, "waiting status exposes a review action");
  button.props.onClick();
  assert.deepEqual(f.opened, [{ sessionId: "lead", tab: { id: "team:lead", kind: "team", resource: "lead" } }]);
  assert.equal(f.state.runningSessions.lead, true);
  assert.equal(f.state.planCheckpoints.lead.executionState, "running");
  assert.equal(f.snapshot.review.status, "pending");
  f.snapshot.review.status = "confirmed";
  assert.match(f.render(transcript()), /chat.preparingNextRequest/);
  assert.doesNotMatch(f.render(transcript()), new RegExp(pendingLabel));
});

test("ordinary Agent reviews stay reachable after the turn ends without leaking into other sessions or reading history", () => {
  const f = fixture();
  f.state.sessions[0].mode = "agent";
  f.state.planCheckpoints = {};
  const render = (extra = {}) => f.render(f.component("features/chat/transcript/ChatTranscript", "ChatTranscript", {
    sessionId: "lead", messages: [], isRunning: false, ...extra,
  }));
  assert.match(render(), new RegExp(pendingLabel));
  assert.doesNotMatch(render({ sessionId: "another" }), new RegExp(pendingLabel));
  assert.doesNotMatch(render({ readingWindow: true }), new RegExp(pendingLabel));
  f.snapshot.review.launchPolicy = "automatic_plan";
  assert.doesNotMatch(render(), new RegExp(pendingLabel));
});

test("active process summaries wait for review while completed historical groups keep their labels", () => {
  const f = fixture();
  const items = ["read", "edit"].map((id) => ({ kind: "tool", message: {
    id, role: "tool", toolName: "Read", content: "done", createdAt: "2026-10-07T00:00:00.000Z", toolStatus: "success",
  } }));
  const parts = [{ kind: "activity", items }];
  const process = (isActive) => f.component("features/chat/transcript/TurnProcess", "TurnProcess", {
    turnId: "turn", processParts: parts, turnParts: parts, isActive,
  });
  const activity = (isActive) => f.component("features/chat/transcript/ActivityGroup", "ActivityGroup", { items, isActive });
  assert.match(f.render(process(true)), new RegExp(pendingLabel));
  assert.doesNotMatch(f.render(process(false)), new RegExp(pendingLabel));
  assert.match(f.render(activity(true)), new RegExp(pendingLabel));
  assert.doesNotMatch(f.render(activity(true)), /chat.running/);
  assert.doesNotMatch(f.render(activity(false)), new RegExp(pendingLabel));
  f.snapshot.review.status = "cancelled";
  assert.match(f.render(process(true)), /chat.processingFor/);
  assert.match(f.render(activity(true)), /chat.running/);
});

test("Overview presents the active execution as waiting and preserves completed proposal history", () => {
  const f = fixture();
  f.state.sessionTodos.lead = { sessionId: "lead", revision: 1, updatedAt: 1, todos: [
    { content: "Inspect current execution", status: "completed", priority: "medium" },
    { content: "Wait for expert review", status: "in_progress", priority: "high" },
  ] };
  f.state.planHistory.lead = [
    { id: "old", sessionId: "lead", title: "Earlier", kind: "plan", status: "approved", executionState: "completed" },
    { id: "queued", sessionId: "lead", title: "Later", kind: "plan", status: "approved", executionState: "queued" },
  ];
  const overview = () => f.component("components/workpanel/OverviewTab", "OverviewTab");
  const waiting = f.render(overview());
  assert.equal(waiting.split(pendingLabel).length - 1, 2);
  assert.match(waiting, /panel.overview.status.completed/);
  assert.match(waiting, /panel.overview.status.queued/);
  assert.doesNotMatch(waiting, /panel.overview.status.running/);
  assert.match(waiting, /Inspect current execution.*chat.todo.status.completed/);
  assert.match(waiting, /Wait for expert review.*chat.todo.status.in_progress/);
  f.snapshot.review.status = "confirmed";
  const running = f.render(overview());
  assert.match(running, /panel.overview.status.running/);
  assert.doesNotMatch(running, new RegExp(pendingLabel));
  assert.match(running, /Inspect current execution.*chat.todo.status.completed/);
  assert.match(running, /Wait for expert review.*chat.todo.status.in_progress/);
});

test("the current Goal capsule waits for review then restores its preparing and running labels", () => {
  const f = fixture();
  const proposal = f.state.planCheckpoints.lead;
  const capsule = (value = proposal) => f.component("features/chat/composer/GoalProgressBar", "GoalProgressBar", {
    sessionId: "lead", proposal: value,
  });
  const waiting = f.render(capsule());
  assert.equal(waiting.split(pendingLabel).length - 1, 2);
  assert.doesNotMatch(waiting, /goal.progressInitializing|chat.scheduleExecutionState.running/);
  assert.equal(proposal.executionState, "running");
  assert.equal(f.snapshot.review.status, "pending");
  f.snapshot.review.status = "confirmed";
  const resumed = f.render(capsule());
  assert.match(resumed, /goal.progressInitializing/);
  assert.match(resumed, /chat.scheduleExecutionState.running/);
  assert.doesNotMatch(resumed, new RegExp(pendingLabel));
});

test("a pending review for the current Goal cannot rewrite another execution's capsule", () => {
  const f = fixture();
  const current = f.state.planCheckpoints.lead;
  for (const proposal of [
    { ...current, executionId: "earlier-execution" },
    { ...current, id: "another-proposal" },
    { ...current, executionState: "completed" },
    { ...current, executionState: "queued" },
    { ...current, sessionId: "another-session" },
  ]) {
    const text = f.render(f.component("features/chat/composer/GoalProgressBar", "GoalProgressBar", {
      sessionId: "lead", proposal,
    }));
    assert.doesNotMatch(text, new RegExp(pendingLabel));
  }
});

test("Goal waiting preserves loaded progress and keeps progress read errors observable", () => {
  const f = fixture();
  f.progressView.loading = false;
  f.progressView.progress = { items: [
    { id: "done", label: "Done", status: "completed" },
    { id: "next", label: "Next", status: "pending" },
  ] };
  const capsule = () => f.component("features/chat/composer/GoalProgressBar", "GoalProgressBar", {
    sessionId: "lead", proposal: f.state.planCheckpoints.lead,
  });
  assert.match(f.render(capsule()), new RegExp(pendingLabel));
  assert.ok(!f.nodes.some((node) => node.props?.className === "goal-progress-ring"));
  f.snapshot.review.status = "confirmed";
  f.render(capsule());
  assert.equal(f.nodes.find((node) => node.props?.className === "goal-progress-completed-num").props.children, 1);
  assert.deepEqual(f.nodes.find((node) => node.props?.className === "goal-progress-total-num").props.children, ["/", 2]);
  f.snapshot.review.status = "pending";
  f.progressView.error = "progress unavailable";
  assert.match(f.render(capsule()), /goal.progressFailed/);
  assert.equal(f.state.planCheckpoints.lead.executionState, "running");
});
