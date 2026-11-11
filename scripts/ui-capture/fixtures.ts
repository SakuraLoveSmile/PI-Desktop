import type {
  GoalProgressSnapshot, GoalReport, PlanProposal, ProviderPublic,
  SessionSummary, TeamSnapshot, UiMessage,
} from "@pi-desktop/shared";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { liveVoiceApi } from "../../apps/desktop/src/features/voice/live/live-voice-api";

export const instant = "2026-11-11T12:00:00.000Z";
export const sessionId = "ui-capture-lead";
export const providers: ProviderPublic[] = [{
  id: "ui-capture-provider", name: "视觉验收夹具", vendorKey: "custom", type: "custom",
  protocol: "openai", createdAt: instant, updatedAt: instant, supportsReasoning: false,
  enabled: true, hasSecret: false, authKind: "none", apiStyle: "openai-completions",
  baseUrl: "https://fixture.invalid/v1", supportedThinkingLevels: ["off"],
  models: [
    { id: "fixture-model", alias: "Fixture Model", contextWindow: 32000, maxTokens: 4000, thinkingLevels: ["off"], defaultThinkingLevel: "off" },
    { id: "fixture-review", alias: "Fixture Review", contextWindow: 64000, maxTokens: 4000, thinkingLevels: ["off"], defaultThinkingLevel: "off" },
  ],
}];
export const sessions: SessionSummary[] = ["实现用户管理系统", "检查测试与验证", "整理交付报告", "修复启动问题"].map((title, index) => ({
  id: index ? `ui-capture-session-${index}` : sessionId, title, source: "desktop", mode: "agent",
  permissionMode: "ask", executionProfile: "standard", providerId: providers[0]!.id,
  modelId: "fixture-model", thinkingLevel: "off", messageCount: 6, projectPath: "/fixture/project",
  createdAt: instant, updatedAt: instant,
}));
export const team: TeamSnapshot = {
  teamSessionId: sessionId, revision: 1, paused: false, leadPhase: "running", queuedMessageCount: 0,
  review: null, decision: null, scopeOverlaps: [],
  members: ["Alex", "Sam", "Lee"].map((displayName, index) => ({
    teamSessionId: sessionId, memberSessionId: `ui-capture-member-${index}`, name: `expert-${index}`,
    contextKind: "fresh", phase: index === 0 ? "completed" : "running",
    presentation: { role: index === 0 ? "researcher" : index === 1 ? "executor" : "reviewer", displayName },
    createdAt: instant, updatedAt: instant,
  })),
  tasks: ["核实需求与技术方案", "实现用户管理 API", "独立验证并检查边界", "整理验收结果"].map((subject, index) => ({
    teamSessionId: sessionId, taskId: `ui-capture-task-${index}`, revision: 1, subject,
    description: "按已确认的方案完成本项工作，并记录可检查的结果。",
    status: index === 0 ? "completed" : index === 1 ? "in_progress" : "pending",
    ownerSessionId: `ui-capture-member-${Math.min(index, 2)}`, blockedBy: index > 1 ? [`ui-capture-task-${index - 1}`] : [],
    writeScopes: index === 1 ? ["services/"] : [], deleted: false, createdAt: instant, updatedAt: instant,
  })),
  readiness: [0, 1, 2, 3].map(index => ({ taskId: `ui-capture-task-${index}`, isReady: index < 2,
    unresolvedBlockedBy: index > 1 ? [`ui-capture-task-${index - 1}`] : [] })),
};
export const proposal: PlanProposal = {
  id: "ui-capture-goal", sessionId, turnId: "ui-capture-turn", toolCallId: "ui-capture-plan",
  kind: "goal", executionKind: "goal", title: "交付基础用户管理系统", question: "批准执行？",
  markdown: "实现用户管理 API，验证输入边界并交付报告。", plan: "实现用户管理 API，验证输入边界并交付报告。",
  version: 1, status: "approved", executionId: "ui-capture-execution", executionState: "running",
  artifact: { relativePath: ".pi/goal/implementation.md", sha256: "0".repeat(64), sizeBytes: 64 },
  createdAt: instant, updatedAt: instant,
};
export const progress: GoalProgressSnapshot = {
  schemaVersion: 1, sessionId, proposalId: proposal.id, executionId: proposal.executionId!, revision: 1,
  updatedAt: Date.parse(instant), items: [
    { id: "research", label: "核实需求和技术方案", status: "completed" },
    { id: "implementation", label: "实现用户管理 API", status: "in_progress" },
    { id: "verification", label: "独立验证与边界检查", status: "pending" },
    { id: "report", label: "整理报告并交付验收", status: "pending" },
  ],
};
export const memberMessages: UiMessage[] = [
  { id: "member-user", role: "user", content: "按批准方案实现用户管理 API，完成后记录验证结果。", createdAt: instant },
  { id: "member-answer", role: "assistant", content: "已完成输入校验与服务分层。\n\n- 注册与登录\n- 用户查询与更新\n- 统一错误处理\n\n接下来检查边界条件。", createdAt: instant, status: "complete" },
  { id: "member-tool", role: "tool", toolName: "Bash", toolStatus: "success", toolArgs: { command: "uv run pytest -q" },
    content: "12 passed (isolated visual fixture)", createdAt: instant },
];
export const report: GoalReport = {
  schemaVersion: 1, reportId: "ui-capture-report", sessionId, executionId: proposal.executionId!,
  proposalId: proposal.id, turnId: "ui-capture-turn", goal: { title: proposal.title, markdown: proposal.markdown },
  execution: { status: "completed", startedAt: 1000, completedAt: 121000, timingSource: "turn" },
  integrity: { kind: "structured" }, verdict: "met",
  deliveryContext: { sourceLabel: "FastAPI + SQLite", revisionLabel: "视觉验收夹具" },
  summary: "完成基础用户管理 API，覆盖注册、登录和用户查询。以下是受控视觉夹具中的交付与验证记录，不代表真实服务已经运行。",
  metrics: [{ label: "单元测试", value: "12 通过", evidenceRefs: ["unit"] }, { label: "代码检查", value: "0 告警", evidenceRefs: ["lint"] }, { label: "API 端点", value: "6 个" }],
  steps: ["核实需求与方案", "实现 API 与输入校验", "独立验证与交付"].map((title, index) => ({ id: `step-${index}`, title, status: "completed", detail: "结果已记录在本地验收夹具。" })),
  files: [{ path: "services/users.py", group: "业务逻辑", changeType: "created", attribution: "direct", detail: "用户注册、查询和输入校验" },
    { path: "tests/test_users.py", group: "验证", changeType: "created", attribution: "subagent", detail: "正常路径与错误边界" }],
  checks: [{ id: "unit", label: "单元测试", command: "uv run pytest -q", result: "passed", disposition: "executed", exitCode: 0, detail: "12 passed（视觉夹具）", evidenceRefs: ["unit"] },
    { id: "production", label: "生产部署", command: "deploy --production", result: "inconclusive", disposition: "not_run", detail: "不在本次授权范围" }],
  criteria: [{ id: "api", text: "基础用户管理 API", verdict: "met", explanation: "正常路径与边界已有记录", evidenceRefs: ["unit"] }],
  checkObservations: [{ checkId: "unit", result: "passed", evidenceIds: ["unit"], command: "uv run pytest -q", exitCode: 0 }],
  evidences: [{ id: "unit", kind: "tool_result", refId: "unit-call", summary: "受控视觉夹具中的测试结果" }, { id: "lint", kind: "tool_result", refId: "lint-call", summary: "受控视觉夹具中的代码检查" }],
  evidenceResolution: ["unit", "lint"].map(evidenceId => ({ evidenceId, state: "recorded" })),
  screenshots: [], assets: [], limitations: ["真实服务和生产部署未运行。"], nextSteps: ["由用户确认交付结果。"], conclusion: "记录已齐备，等待用户体验与确认。",
};

const initialState = useAppStore.getState();
const originalApi = { ...api };
const originalLiveVoiceApi = { ...liveVoiceApi };
const subscriptions = new Set<object>();
const unexpected: string[] = [];
const subscribe = (_listener: unknown) => {
  const token = {};
  subscriptions.add(token);
  return () => { subscriptions.delete(token); };
};
export function assertBoundaryClean() {
  if (unexpected.length) throw new Error(`Unexpected fixture API calls: ${unexpected.join(", ")}`);
}
export function assertSubscriptionsReleased() {
  if (subscriptions.size) throw new Error(`Fixture leaked ${subscriptions.size} API subscriptions across scenes`);
}
export function installFixtureBoundary() {
  unexpected.length = 0;
  Object.assign(api, originalApi);
  Object.assign(liveVoiceApi, originalLiveVoiceApi);
  for (const [namespace, boundary] of [["desktop", api], ["liveVoice", liveVoiceApi]] as const) {
    for (const name of Object.keys(boundary)) {
      if (typeof Reflect.get(boundary, name) !== "function") continue;
      Reflect.set(boundary, name, () => {
        unexpected.push(`${namespace}.${name}`);
        throw new Error(`API method is not part of the offline UI fixture: ${namespace}.${name}`);
      });
    }
  }
  liveVoiceApi.status = async () => ({ enabled: false, settingsRevision: 1, bindings: [], call: null });
  liveVoiceApi.onView = subscribe;
  liveVoiceApi.onControl = subscribe;
  liveVoiceApi.onTranscript = subscribe;
  const stub = <K extends keyof typeof api>(key: K, value: typeof api[K]) => { api[key] = value; };
  for (const name of ["onUpdateState", "onPluginChanged", "onPluginInstallProgress", "onTeamChanged", "onHostStatus", "onAgentEvent",
    "onSessionsChanged", "onPlansChanged", "onGoalProgressChanged", "onGoalReportChanged", "onGoalExecutionChanged",
    "onSessionActivityChanged", "onBackgroundProcessesChanged", "onOauthLogin", "onSettingsChanged"] as const) stub(name, subscribe);
  stub("updatesGetState", async () => ({ mode: "disabled", preference: "manual", defaultPreference: "manual", automaticSupported: false,
    status: "idle", currentVersion: "0.15.16", releasesUrl: "https://fixture.invalid/releases" }));
  stub("listProjectGroups", async () => ({ groups: [] }));
  stub("listProjects", async () => ({ projects: [] }));
  stub("listProviders", async () => ({ providers: structuredClone(providers) }));
  stub("getSettings", async () => ({ ...useAppStore.getState().settings! }));
  stub("composerCommands", async () => ({ commands: [] }));
  stub("getWorkspaceGit", async () => ({ git: null }));
  stub("getTeamSnapshot", async (id) => {
    if (id !== sessionId) throw new Error(`Unexpected fixture Team: ${id}`);
    return structuredClone(team);
  });
  stub("getSession", async (id) => {
    if (id !== sessionId && !team.members.some(member => member.memberSessionId === id)) throw new Error(`Unexpected fixture session: ${id}`);
    return { session: { ...sessions[0]!, id, messages: structuredClone(memberMessages) } };
  });
  stub("getGoalProgress", async () => ({ progress: structuredClone(progress) }));
  stub("goalExecutionGet", async () => ({}));
  stub("getGoalReport", async () => ({ state: currentScene === "goal-progress" ? "not_found" : "ready", report: currentScene === "goal-progress" ? null : structuredClone(report) }));
  stub("listGoalReports", async () => ({ reports: [] }));
  stub("listPluginScenicThemesDestinations", async () => []);
  stub("listPluginViews", async () => []);
  stub("listPluginServices", async () => []);
  stub("listPlugins", async () => ({ plugins: structuredClone(useAppStore.getState().plugins) }));
  stub("marketCheckUpdates", async () => ({ updates: [], plugins: structuredClone(useAppStore.getState().plugins) }));
  stub("listOauthVendors", async () => ({ vendors: [] }));
  stub("modelCatalogStatus", async () => ({ status: { loaded: true, source: "bundled", catalogPath: "/fixture/models.json", providerCount: 1, modelCount: 2 } }));
  stub("listProviderModels", async () => ({ models: [], source: "cache" }));
  stub("listSystemFonts", async () => []);
  stub("getStorageInfo", async () => ({ dataPath: "/fixture/data", browserPath: "/fixture/browser", managed: true,
    cacheBytes: 1024 * 1024, pendingPath: null, lastError: null, backupPaths: [] }));
  stub("getTodos", async () => ({ sessionId, revision: 0, todos: [], updatedAt: 0 }));
  stub("listBackgroundProcesses", async () => ({ processes: [] }));
  stub("getSessionActivity", async (id) => ({ activity: {
    version: 1, sessionId: id, limited: false, revision: "0".repeat(64), hasMore: false, nextOffset: null,
    totals: { subagents: 0, changedFiles: 0, websites: 0, attachments: 0, skills: 0, memory: 0, mcp: 0 },
    subagents: [], changedFiles: [], websites: [], attachments: [], references: { skills: [], memory: [], mcp: [] },
  } }));
  stub("fsRead", async (path) => {
    if (path !== "README.md") { unexpected.push(`fsRead(${path})`); throw new Error(`Unexpected fixture file: ${path}`); }
    const content = "# Project overview\n\n基础用户管理 API 的交付与验证记录。\n\n## 工作内容\n\n- 注册与登录\n- 输入校验和错误处理\n- 独立验证与报告\n\n所有内容均来自本地视觉夹具，不读取工作区文件。";
    return { kind: "text", content, size: new TextEncoder().encode(content).length };
  });
  stub("fsList", async () => ({ entries: [
    { name: "services", size: 0, kind: "dir" },
    { name: "README.md", size: 120, kind: "file" },
    { name: "pyproject.toml", size: 80, kind: "file" },
  ] }));
}
let currentScene = "";
export function resetFixtureState(scene: string) {
  currentScene = scene;
  useAppStore.setState(initialState, true);
  useAppStore.setState({
    page: "chat", ready: true, activeSessionId: sessionId, retainedSessionIds: [sessionId], sessions: structuredClone(sessions),
    messages: [], retainedTranscripts: {}, sessionHistory: {}, transcriptViews: {}, selectingSessionId: undefined,
    providers: structuredClone(providers),
    providerModels: { [providers[0]!.id]: providers[0]!.models.map(model => ({ providerId: providers[0]!.id, modelId: model.id,
      displayName: model.alias ?? model.id, contextWindow: model.contextWindow, capabilities: ["text"], source: "user" })) },
    settings: { onboardingDismissed: true, language: "zh-CN", theme: "dark", defaultMode: "agent", defaultPermissionMode: "ask",
      defaultProviderId: providers[0]!.id, defaultModelId: "fixture-model", enterToSend: true, fontScale: 1 },
    workspace: { path: "/fixture/project", name: "PI-Desktop", branch: "main" },
    openProjects: [{ path: "/fixture/project", name: "PI-Desktop", branch: "main" }], openProjectPaths: ["/fixture/project"], activeProjectPath: "/fixture/project", projectMeta: {}, projectCollapsed: {}, sessionMeta: {},
    isRunning: false, runningSessions: {}, sessionOutcomes: {}, planHistory: {}, planCheckpoints: {}, pendingPlans: {},
    goalReports: {}, pendingPermissions: {}, pendingAsks: {}, toasts: [], pluginViews: [], plugins: [], pluginThemes: [],
    notifications: [], unreadNotificationCount: 0, workPanelOpen: false, workPanelTabs: [], activeWorkPanelTabId: null,
    workPanelWidth: 570, settingsTab: "general", settingsAnchor: null,
  });
}
