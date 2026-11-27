import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { PlanProposal, SessionSummary, TeamChangedEvent, TeamSnapshot, UiMessage } from "@pi-desktop/shared";
import { SessionActivity } from "../../apps/desktop/src/features/chat/activity/SessionActivity";
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
  var overviewReferenceShow: (view: "activity" | "panorama", width?: number, theme?: "dark" | "light") => Promise<void>;
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
    onPlansChanged: api.onPlansChanged, getTodos: api.getTodos, getSessionActivity: api.getSessionActivity,
    onSessionActivityChanged: api.onSessionActivityChanged, listBackgroundProcesses: api.listBackgroundProcesses };
  const previousState = useAppStore.getState();
  api.getTeamSnapshot = async () => structuredClone(current);
  api.onTeamChanged = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  api.onHostStatus = () => () => undefined;
  api.getSession = async () => ({ session: { ...session, messages: [] } });
  api.onAgentEvent = () => () => undefined;
  api.onSessionsChanged = () => () => undefined;
  api.onPlansChanged = () => () => undefined;
  api.getTodos = async () => ({ sessionId: session.id, revision: 0, todos: [], updatedAt: 0 });
  api.getSessionActivity = async () => { throw new Error("activity aggregate unavailable in this fixture"); };
  api.onSessionActivityChanged = () => () => undefined;
  api.listBackgroundProcesses = async () => ({ processes: [] });
  const messages: UiMessage[] = [
    ...["pyproject.toml", ".python-version", ".gitignore", ".env.example", "README.md"].map((path, index): UiMessage => ({
      id: `write-${index}`, role: "tool", content: "written", toolName: "Write", toolStatus: "success", toolArgs: { path }, createdAt: "2026-10-08T00:00:00Z" })),
    // A recorded delegation: the panorama entry only exists while the session has sub-agents.
    { id: "delegate", role: "tool", content: "", toolName: "Task", toolStatus: "success", toolCallId: "delegate-call",
      toolArgs: { agent: "researcher", task: "核对实现范围" }, toolResult: { details: { delegationId: "delegate-1", status: "running" } },
      createdAt: "2026-10-08T00:00:00Z" },
    { id: "skill", role: "tool", content: "loaded", toolName: "Skill", toolStatus: "success", toolArgs: { id: "canvas" }, createdAt: "2026-10-08T00:00:00Z" },
    { id: "mcp", role: "tool", content: "captured", toolName: "mcp_browser_capture", toolStatus: "success", createdAt: "2026-10-08T00:00:00Z" },
  ];
  const proposal: PlanProposal = { id: "spec", sessionId: session.id, turnId: "turn", toolCallId: "plan", kind: "plan",
    title: "用户管理系统实现方案", question: "Approve?", markdown: "Fixture", plan: "Fixture", version: 1,
    status: "approved", createdAt: "now", updatedAt: "now",
    artifact: { relativePath: ".pi/plan/用户管理系统实现方案.md", sha256: "fixture", sizeBytes: 7 } };
  useAppStore.setState({ activeSessionId: session.id, sessions: [session], messages, planHistory: { [session.id]: [proposal] },
    sessionTodos: {}, pendingPlans: {}, planCheckpoints: {}, planningStates: {}, providers: [], runningSessions: {},
    sessionOutcomes: { [session.id]: "completed" }, workPanelTabs: [], activeWorkPanelTabId: null,
    transcriptViews: {}, retention: [], retainedSessionIds: [session.id],
    openFileInWorkPanel: (path) => { openedFiles.push(path); },
    openWorkPanelTabForSession: (_id, tab) => { if (tab.teamTarget) opened.push(tab.teamTarget); else if (tab.kind === "file") opened.push({ kind: "file", filePath: tab.resource }); } });
  let view: "activity" | "panorama" = "activity";
  globalThis.overviewReferenceShow = async (nextView, width = 420, theme = "dark") => {
    view = nextView;
    document.documentElement.setAttribute("data-theme", theme);
    host.style.width = `${width}px`;
    await act(async () => root.render(<I18nextProvider i18n={i18n}>{view === "activity"
      ? <div className="activity-dock-tab"><SessionActivity sessionId={session.id} messages={messages} visible rangeLimited={false} /></div>
      : <TeamPanoramaTab teamSessionId={session.id} />}</I18nextProvider>));
    await until(() => view === "activity"
      ? host.querySelectorAll('[data-activity-group="teamTasks"] .session-activity-team-task').length > 0
      : host.querySelectorAll("[data-node-id]").length > 1, `${view} mounted`);
    if (view === "panorama") await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t("team.zoomFit")}"]`)?.click());
  };
  const update = async () => {
    current.revision += 1;
    await act(async () => listeners.forEach((listener) => listener({ teamSessionId: session.id, revision: current.revision, reason: "task" })));
  };
  const click = async (selector: string) => { const button = host.querySelector<HTMLButtonElement>(selector); assert(button, selector); await act(async () => button!.click()); };
  const teamTask = '[data-activity-group="teamTasks"] .session-activity-team-task';
  try {
    await globalThis.overviewReferenceShow("activity");
    assert(host.querySelectorAll(teamTask).length === 6, "six bounded task rows");
    assert(host.textContent?.includes("任务 1："), "real task ordinal rendered");
    const ownerWord = host.querySelector('[data-activity-group="teamTasks"] .session-activity-team-task-owner')?.textContent?.trim() ?? "";
    assert(ownerWord.length > 0 && !host.querySelector('[data-activity-group="teamTasks"] .session-activity-team-task-owner img'), "owner role word instead of an avatar");
    assert(!host.querySelector('[data-activity-group="teamTasks"] .team-person'), "no owner avatar in the rail");
    await click(teamTask);
    assert(opened.at(-1)?.taskId === "task-0", "the rail task opens that actual task");
    await click('[data-activity-group="teamTasks"] .session-activity-team-board');
    assert(opened.at(-1)?.kind === "board", "the board action opens the board");
    await click('[data-activity-group="teamTasks"] .session-activity-disclosure');
    assert(host.querySelector('[data-activity-group="teamTasks"] .session-activity-group-body')?.hasAttribute("hidden"), "the section collapses");
    await click('[data-activity-group="teamTasks"] .session-activity-disclosure');
    assert(!host.querySelector('[data-activity-group="teamTasks"] .session-activity-group-body')?.hasAttribute("hidden"), "the section reopens");
    await click('[data-activity-group="plans"] .session-activity-row');
    await until(() => opened.some((item) => item.filePath === proposal.artifact?.relativePath), "the plan row opens its owning plan artifact");
    await click('[data-activity-group="agents"] .session-activity-panorama');
    assert(opened.at(-1)?.kind === "panorama", "the panorama entry opens the Team panorama");
    await act(async () => useAppStore.setState({ sessionTodos: { [session.id]: { sessionId: session.id, revision: 2,
      todos: [{ content: "实时会话清单", status: "in_progress", priority: "medium" }], updatedAt: 2 } } }));
    await until(() => Boolean(host.querySelector('[data-activity-group="todos"]')?.textContent?.includes("实时会话清单")), "moved session checklist retained");
    await act(async () => useAppStore.setState({ sessionTodos: {} }));
    current.tasks[12]!.status = "failed";
    await update();
    await until(() => host.querySelector('[data-activity-group="teamTasks"] .session-activity-team-task [data-state="failed"]') !== null, "live failed task priority");
    current = structuredClone(snapshot);
    current.revision = 3;
    await update();
    for (const theme of ["dark", "light"] as const) {
      for (const width of [320, 360, 570]) {
        await globalThis.overviewReferenceShow("activity", width, theme);
        if (host.scrollWidth > host.clientWidth + 1) {
          const offender = [...host.querySelectorAll("*")].map((element) => ({ element, right: element.getBoundingClientRect().right }))
            .filter(({ right }) => right > host.clientWidth + 1)
            .sort((left, right) => right.right - left.right)[0];
          const detail = offender ? `${offender.element.tagName}.${String(offender.element.className).slice(0, 80)} right=${Math.round(offender.right)}` : "none";
          throw new Error(`${theme} ${width}px rail overflows: scroll=${host.scrollWidth} client=${host.clientWidth}; widest=${detail}`);
        }
        assert(host.querySelector('[data-activity-group="teamTasks"] .session-activity-team-task')!.scrollWidth <= width, "task rows stay inside the rail");
      }
    }
    await globalThis.overviewReferenceShow("panorama", 1120);
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
    globalThis.overviewReferenceCleanup = () => { root.unmount(); host.remove(); Object.assign(api, originals); useAppStore.setState(previousState, true); };
    return { ok: true, tasks: 13, dependencyEdges: dependencies.reduce((count, row) => count + row.length, 0),
      checks: "six task rows, numbered labels, owner role words, task/board/panorama navigation, plan artifact, section collapse, checklist, live update, panorama tiers/zoom, 320/360/570px light/dark" };
  } catch (error) {
    await act(async () => root.unmount()); host.remove(); Object.assign(api, originals); useAppStore.setState(previousState, true);
    throw error;
  }
};
