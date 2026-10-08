import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { PlanProposal, SessionSummary, TeamChangedEvent, TeamSnapshot, UiMessage } from "@pi-desktop/shared";
import { OverviewTab } from "../../apps/desktop/src/components/workpanel/OverviewTab";
import { TeamPanoramaTab } from "../../apps/desktop/src/components/workpanel/team/TeamPanoramaTab";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/ui-kit.css";
import "../../apps/desktop/src/styles/work-panel.css";
import "../../apps/desktop/src/styles/team-panel.css";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
  var overviewReferenceProbe: () => Promise<unknown>;
  var overviewReferenceShow: (view: "overview" | "panorama", width?: number, theme?: "dark" | "light") => Promise<void>;
  var overviewReferenceCleanup: (() => void) | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); };
async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 6000;
  while (!condition() && performance.now() < deadline) await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  assert(condition(), `UI did not reach ${label}`);
}

// Deterministic visual fixtures; no model, working user profile, or real provider is used.
const roles = ["researcher", "researcher", "researcher", "executor", "executor", "collaborator", "reviewer", "reviewer", "reviewer"] as const;
const names = ["Alex", "Sam", "Jack", "Lee", "Chris", "Emily", "Mark", "Ryan", "Daniel"];
const subjects = ["规划用户管理系统：可维护性", "规划用户管理系统：性能与扩展", "规划用户管理系统：最小风险",
  "实现用户管理系统完整代码", "验证测试、lint 与服务启动", "浏览器验证 Swagger 全流程",
  "代码评审：完整性", "代码评审：正确性", "代码评审：影响面", "修复评审发现的问题", "修复后独立复验", "逐项验证 Spec 实现符合性", "最终浏览器验收与截图"];
const owners = [0, 1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 4, 5];
const dependencies = [[], [], [], [0, 1, 2], [0, 1, 2], [0, 1, 2], [3, 4, 5], [3, 4, 5], [3, 4, 5], [6, 7, 8], [6, 7, 8], [6, 7, 8], [9, 10, 11]];
const snapshot: TeamSnapshot = {
  teamSessionId: "reference-lead", revision: 1, paused: false, leadPhase: "completed", queuedMessageCount: 0,
  review: null, decision: null, scopeOverlaps: [],
  members: roles.map((role, index) => ({ teamSessionId: "reference-lead", memberSessionId: `member-${index}`,
    name: `expert-${index}`, contextKind: "fresh", phase: "completed", presentation: { role, displayName: names[index]! },
    createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z" })),
  tasks: subjects.map((subject, index) => ({ teamSessionId: "reference-lead", taskId: `task-${index}`, revision: 1,
    subject, status: "completed", ownerSessionId: `member-${owners[index]}`, blockedBy: dependencies[index]!.map((id) => `task-${id}`),
    writeScopes: [], deleted: false, createdAt: `2026-10-08T00:00:${String(index).padStart(2, "0")}Z`, updatedAt: "2026-10-08T00:01:00Z" })),
  readiness: subjects.map((_, index) => ({ taskId: `task-${index}`, isReady: true, unresolvedBlockedBy: [] })),
};

globalThis.overviewReferenceProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: catalogs["zh-CN"] } } });
  const host = document.createElement("div");
  Object.assign(host.style, { height: "100vh", margin: "0 auto" });
  document.body.style.margin = "0";
  document.body.append(host);
  const root = createRoot(host);
  let current = structuredClone(snapshot);
  const listeners = new Set<(event: TeamChangedEvent) => void>();
  const opened: Array<{ kind?: string; taskId?: string; filePath?: string }> = [];
  const openedFiles: string[] = [];
  const session = { id: "reference-lead", source: "desktop", title: "实现用户管理系统", projectPath: "/fixture/project",
    mode: "agent", thinkingLevel: "off", permissionMode: "ask", executionProfile: "team", messageCount: 8, providerId: "fixture", modelId: "fixture-model",
    createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z" } satisfies SessionSummary;
  const originals = { getTeamSnapshot: api.getTeamSnapshot, onTeamChanged: api.onTeamChanged, onHostStatus: api.onHostStatus,
    getSession: api.getSession, onAgentEvent: api.onAgentEvent, onSessionsChanged: api.onSessionsChanged,
    onPlansChanged: api.onPlansChanged, getTodos: api.getTodos };
  const previousState = useAppStore.getState();
  api.getTeamSnapshot = async () => structuredClone(current);
  api.onTeamChanged = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  api.onHostStatus = () => () => undefined;
  api.getSession = async () => ({ session: { ...session, messages: [] } });
  api.onAgentEvent = () => () => undefined;
  api.onSessionsChanged = () => () => undefined;
  api.onPlansChanged = () => () => undefined;
  api.getTodos = async () => ({ sessionId: session.id, revision: 0, todos: [], updatedAt: 0 });
  const messages: UiMessage[] = [
    ...["pyproject.toml", ".python-version", ".gitignore", ".env.example", "README.md"].map((path, index): UiMessage => ({
      id: `write-${index}`, role: "tool", content: "written", toolName: "Write", toolStatus: "success", toolArgs: { path }, createdAt: "2026-10-08T00:00:00Z" })),
    { id: "skill", role: "tool", content: "loaded", toolName: "Skill", toolStatus: "success", toolArgs: { id: "canvas" }, createdAt: "2026-10-08T00:00:00Z" },
    { id: "mcp", role: "tool", content: "captured", toolName: "mcp_browser_capture", toolStatus: "success", createdAt: "2026-10-08T00:00:00Z" },
  ];
  const proposal: PlanProposal = { id: "spec", sessionId: session.id, turnId: "turn", toolCallId: "plan", kind: "goal",
    title: "用户管理系统实现方案", question: "Approve?", markdown: "Fixture", plan: "Fixture", version: 1,
    status: "approved", executionState: "completed", createdAt: "now", updatedAt: "now",
    artifact: { relativePath: ".pi/goal/用户管理系统实现方案.md", sha256: "fixture", sizeBytes: 7 } };
  useAppStore.setState({ activeSessionId: session.id, sessions: [session], messages, planHistory: { [session.id]: [proposal] },
    sessionTodos: {}, pendingPlans: {}, planCheckpoints: {}, planningStates: {}, providers: [], runningSessions: {},
    sessionOutcomes: { [session.id]: "completed" }, workPanelTabs: [], activeWorkPanelTabId: null,
    openFileInWorkPanel: (path) => { openedFiles.push(path); },
    openWorkPanelTabForSession: (_id, tab) => { if (tab.teamTarget) opened.push(tab.teamTarget); else if (tab.kind === "file") opened.push({ kind: "file", filePath: tab.resource }); } });
  let view: "overview" | "panorama" = "overview";
  globalThis.overviewReferenceShow = async (nextView, width = nextView === "overview" ? 570 : 1120, theme = "dark") => {
    view = nextView;
    document.documentElement.setAttribute("data-theme", theme);
    host.style.width = `${width}px`;
    await act(async () => root.render(<I18nextProvider i18n={i18n}>{view === "overview"
      ? <OverviewTab /> : <TeamPanoramaTab teamSessionId={session.id} />}</I18nextProvider>));
    await until(() => view === "overview" ? host.querySelectorAll(".team-progress-row").length > 0 : host.querySelectorAll("[data-node-id]").length > 1, `${view} mounted`);
    if (view === "panorama") await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t("team.zoomFit")}"]`)?.click());
  };
  const update = async () => {
    current.revision += 1;
    await act(async () => listeners.forEach((listener) => listener({ teamSessionId: session.id, revision: current.revision, reason: "task" })));
  };
  const click = async (selector: string) => { const button = host.querySelector<HTMLButtonElement>(selector); assert(button, selector); await act(async () => button!.click()); };
  try {
    await globalThis.overviewReferenceShow("overview");
    assert(host.querySelectorAll(".team-progress-row").length === 6, "six bounded task rows");
    assert(host.textContent?.includes("任务 1："), "real task ordinal rendered");
    assert(!host.querySelector(".team-progress-group-toggle"), "redundant group removed");
    assert(host.querySelector('.team-person img[width="20"]'), "owner pixel portrait readable");
    await click(".team-progress-row");
    assert(opened.at(-1)?.taskId === "task-0", "Overview task opens actual task");
    await click(".team-progress-view-all");
    assert(opened.at(-1)?.kind === "board", "all tasks opens board");
    await click(".team-progress-panorama");
    assert(opened.at(-1)?.kind === "panorama", "panorama link opens graph");
    await click(".team-progress-toggle");
    assert(host.querySelector(".team-progress-body")?.hasAttribute("hidden"), "whole progress collapses");
    await click(".team-progress-toggle");
    assert(host.querySelector('[data-artifact-kind="specs"]'), "Spec group preserved");
    await click('[data-artifact-kind="specs"] .work-panel-overview-file');
    assert(opened.at(-1)?.filePath === proposal.artifact?.relativePath, "Spec opens owning plan artifact");
    await click('[data-artifact-kind="changedFiles"] .work-panel-overview-file');
    assert(openedFiles.at(-1) === "pyproject.toml", "recorded changed file opens actual path");
    assert(host.querySelector('[data-artifact-kind="changedFiles"]')?.textContent?.includes("5"), "recorded five distinct files");
    assert(host.querySelector(".work-panel-overview-reference-list")?.textContent?.includes("canvas"), "recorded Skill only");
    await click(".work-panel-overview-reference-tab:nth-child(2)");
    assert(host.querySelector(".work-panel-overview-reference-list")?.children.length === 0, "Memory has no fabricated usage");
    await click(".work-panel-overview-reference-tab:nth-child(3)");
    assert(host.querySelector(".work-panel-overview-reference-list")?.textContent?.includes("mcp_browser_capture"), "recorded MCP only");
    await click(".work-panel-overview-reference-tab:first-child");
    await act(async () => useAppStore.setState({ sessionTodos: { [session.id]: { sessionId: session.id, revision: 2,
      todos: [{ content: "实时会话清单", status: "in_progress", priority: "medium" }], updatedAt: 2 } } }));
    assert(host.querySelector('[data-testid="overview-session-checklist"]')?.textContent?.includes("实时会话清单"), "moved session checklist retained");
    await act(async () => useAppStore.setState({ sessionTodos: {} }));
    current.tasks[12]!.status = "failed";
    await update();
    await until(() => host.querySelector('.team-progress-row [data-state="failed"]') !== null, "live failed task priority");
    current = structuredClone(snapshot);
    current.revision = 3;
    await update();
    await globalThis.overviewReferenceShow("panorama");
    assert(host.querySelectorAll("[data-node-id]").length === 14, "one card per real task plus Lead");
    assert(host.querySelector('[data-edge-from="task-3"][data-edge-to="task-6"]'), "real dependency edge");
    assert(!host.querySelector('[data-edge-from="reference-lead"][data-edge-to="task-6"]'), "no invented direct Lead dependency");
    const y = (id: string) => Number(host.querySelector(`[data-node-id="${id}"]`)?.getAttribute("style")?.match(/translate\([^,]+, ([\d.]+)px/)?.[1]);
    assert(y("task-12") > y("task-0"), "tasks form dependency tiers");
    await click('[data-node-id="task-9"]');
    assert(opened.at(-1)?.taskId === "task-9", "repeated owner task navigates independently");
    const zoom = Number(host.querySelector("[data-panorama-canvas]")?.getAttribute("data-panorama-zoom"));
    await click('[aria-label="放大"]');
    assert(Number(host.querySelector("[data-panorama-canvas]")?.getAttribute("data-panorama-zoom")) > zoom, "zoom control works");
    await globalThis.overviewReferenceShow("overview", 360, "light");
    assert(host.scrollWidth <= host.clientWidth, "narrow Overview has no page overflow");
    await globalThis.overviewReferenceShow("overview");
    globalThis.overviewReferenceCleanup = () => { root.unmount(); host.remove(); Object.assign(api, originals); useAppStore.setState(previousState, true); };
    return { ok: true, tasks: 13, dependencyEdges: dependencies.reduce((count, row) => count + row.length, 0), checks: "task/board/panorama navigation, live update, collapse, references, resources, narrow light, repeated owners" };
  } catch (error) {
    await act(async () => root.unmount()); host.remove(); Object.assign(api, originals); useAppStore.setState(previousState, true);
    throw error;
  }
};
