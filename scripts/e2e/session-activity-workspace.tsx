import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { ContextInsightsSnapshot, GitWorkspaceSnapshot, McpServerRecord, McpServerStatus, ModelInfo, ProviderPublic, SessionActivityPage, SessionSummary, UiMessage } from "@pi-desktop/shared";
import { SessionActivity } from "../../apps/desktop/src/features/chat/activity/SessionActivity";
import { ReviewTab } from "../../apps/desktop/src/components/workpanel/ReviewTab";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";

const PROJECTS = {
  a: { id: "ws-a", path: "/Users/dev/Code/project-a", name: "Project A", branch: "feat/activity-rail" },
  b: { id: "ws-b", path: "/Users/dev/Code/project-b", name: "Project B", branch: "main" },
  plain: { id: "ws-plain", path: "/Users/dev/Code/plain-folder", name: "Plain folder", branch: null },
  // Three servers that failed, for the Reconnect action: one that comes back, one the Host cannot be asked about, one that stays down.
  mcp: { id: "ws-mcp", path: "/Users/dev/Code/project-mcp", name: "Project MCP", branch: "main" },
} as const;

/**
 * The workspace sections of the real activity pane (environment, context, changes, MCP rows) read through the real
 * store, hooks and stylesheet; only the Host edge (git, MCP list, activity aggregate, processes) is replaced. No
 * provider, account or user data is read.
 */
export async function sessionActivityWorkspaceProbe() {
  const initial = useAppStore.getState();
  const i18n = createInstance();
  await i18n.init({ lng: "en", interpolation: { escapeValue: false }, resources: { en: { translation: en } } });
  const host = document.createElement("div");
  // The real pane: 264px wide with 16px side padding, which the rows' −8px margins reach into.
  host.style.cssText = "position:fixed;top:40px;right:40px;width:264px;box-sizing:border-box;padding:8px 16px 16px;max-height:90vh;overflow:auto;background:var(--color-bg-primary);z-index:1000;";
  document.body.append(host);
  const reviewHost = document.createElement("div");
  reviewHost.style.cssText = "position:fixed;top:40px;left:40px;width:420px;max-height:80vh;overflow:auto;background:var(--color-bg-primary);z-index:1000;";
  document.body.append(reviewHost);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const reviewRoot = createRoot(reviewHost, { onUncaughtError: (error) => errors.push(error) });
  const initialTheme = document.documentElement.getAttribute("data-theme");
  const initialScale = document.documentElement.style.getPropertyValue("--font-scale");
  const original = {
    git: api.getWorkspaceGit, mcp: api.listMcpServers, activity: api.getSessionActivity, activityChanged: api.onSessionActivityChanged,
    list: api.listBackgroundProcesses, processesChanged: api.onBackgroundProcessesChanged, hostStatus: api.onHostStatus,
    insights: api.getContextInsights, agentEvent: api.onAgentEvent, insightsChanged: api.onContextInsightsChanged,
    testMcp: api.testMcpServer,
  };

  const at = new Date(Date.now() - 60_000).toISOString();
  const gitRequests: string[] = [];
  const gitSnapshot = (project: { path: string; branch: string | null }): GitWorkspaceSnapshot => ({
    projectPath: project.path, rootPath: project.path, mainPath: project.path, branch: project.branch, head: "a".repeat(40),
    isWorktree: false, dirty: false, branches: [], worktrees: [],
  });
  api.getWorkspaceGit = async (request) => {
    gitRequests.push(request.projectPath);
    // The second project answers late, so a stale answer from the first would have time to show.
    if (request.projectPath === PROJECTS.b.path) await new Promise((resolve) => setTimeout(resolve, 150));
    const project = Object.values(PROJECTS).find((candidate) => candidate.path === request.projectPath);
    return { git: project && project.branch ? gitSnapshot(project) : null };
  };
  let docsReads = 0;
  const server = (id: string, label: string, over: Partial<McpServerRecord> = {}): McpServerRecord => ({
    id, label, transport: "stdio", enabled: true, createdAt: at, updatedAt: at, ...over,
  });
  // What the Host would say: a server it has connected to since stays connected on the next read.
  const connected = new Set<string>();
  api.listMcpServers = async (query) => {
    if (query?.level === "project") return { servers: [], statuses: [] };
    docsReads += 1;
    const down = (serverId: string, message: string): McpServerStatus => connected.has(serverId)
      ? { serverId, state: "ready", toolCount: 2, updatedAt: 1 } : { serverId, state: "failed", toolCount: 0, message, updatedAt: 1 };
    const statuses: McpServerStatus[] = [
      { serverId: "kaneo", state: "ready", toolCount: 3, updatedAt: 1 },
      { serverId: "docs", state: docsReads < 2 ? "connecting" : "ready", toolCount: 0, updatedAt: 1 },
      { serverId: "remote", state: "failed", toolCount: 0, message: "HTTP 401", authRequired: true, updatedAt: 1 },
      down("search", "connect ECONNRESET"), down("flaky", "ETIMEDOUT"), down("broken", "spawn broken ENOENT"),
    ];
    return {
      servers: [server("kaneo", "Kaneo", { transport: "http", url: "https://kaneo.test/mcp" }), server("docs", "Docs"),
        server("remote", "Remote", { transport: "http", url: "https://remote.test/mcp" }),
        server("search", "Search", { level: "global" }), server("flaky", "Flaky", { level: "global" }), server("broken", "Broken", { level: "global" })],
      statuses,
    };
  };
  // The test call answers when the probe says so, which keeps the row's in-between state still enough to look at.
  type Answer = { connects: true } | { stillDown: string } | { rejects: string };
  const testCalls: Array<{ id: string; query: unknown }> = [];
  const answers = new Map<string, (answer: Answer) => void>();
  api.testMcpServer = async (id, query) => {
    testCalls.push({ id, query });
    const answer = await new Promise<Answer>((resolve) => answers.set(id, resolve));
    if ("rejects" in answer) throw new Error(answer.rejects);
    if ("stillDown" in answer) return { status: { serverId: id, state: "failed", toolCount: 0, message: answer.stillDown, updatedAt: 2 } };
    connected.add(id);
    return { status: { serverId: id, state: "ready", toolCount: 2, updatedAt: 2 } };
  };
  // The newest request of project A carries a breakdown, so its Context section can show the legend; the others have none.
  const entry = (category: "system" | "tools" | "user" | "toolResult", estimatedTokens: number) =>
    ({ id: `${category}-${estimatedTokens}`, category, label: category, content: "", estimatedTokens, originalChars: estimatedTokens * 4, truncated: false }) as const;
  const insights = (sessionId: string): ContextInsightsSnapshot => ({
    version: 1, sessionId, events: [], updatedAt: 1,
    requests: sessionId !== PROJECTS.a.id ? [] : [{ id: "request-1", step: 1, startedAt: 10, status: "completed", providerId: "preview-provider", modelId: "preview-model",
      mode: "agent", contextWindow: 200_000, estimatedTokens: 40_000, estimateSource: "runtime-usage-anchor", contentTruncated: false,
      entries: [entry("system", 4_000), entry("tools", 4_000), entry("user", 4_000), entry("toolResult", 8_000)] }],
    retention: { maxRequests: 40, maxEvents: 160, maxContentChars: 120000, maxTotalContentChars: 1200000, droppedRequests: 0, droppedEvents: 0 },
  });
  api.getContextInsights = async (sessionId) => insights(sessionId);
  api.onAgentEvent = () => () => {};
  api.onContextInsightsChanged = () => () => {};
  // The Host's complete-activity page for project A mirrors its transcript; the others have nothing recorded.
  const MCP_TOOLS = ["mcp_kaneo_create_task", "mcp_kaneo_list_tasks", "mcp_docs_search", "mcp_remote_ping", "mcp_gone_fetch"];
  const FAILED_TOOLS = ["mcp_search_find", "mcp_flaky_run", "mcp_broken_run"];
  const activityPage = (sessionId: string): SessionActivityPage => {
    const first = sessionId === PROJECTS.a.id;
    const files = first ? [["src/one.ts", 10, 2], ["src/two.ts", 5, 0], ["src/three.ts", 100, 20]] as const : [];
    const mcp = (first ? MCP_TOOLS : sessionId === PROJECTS.mcp.id ? FAILED_TOOLS : []).map((label) => ({ id: label, label }));
    const skills = first ? [{ id: "frontend-design", label: "frontend-design" }] : [];
    return { version: 1, sessionId, limited: false, revision: "a".repeat(64), hasMore: false, nextOffset: null,
      totals: { subagents: 0, changedFiles: files.length, websites: 0, attachments: 0, skills: skills.length, memory: 0, mcp: mcp.length },
      subagents: [], websites: [], attachments: [], references: { skills, memory: [], mcp },
      changedFiles: files.map(([path, addedLines, removedLines]) => ({ id: path, label: path, path, changeCount: 1, addedLines, removedLines })) };
  };
  api.getSessionActivity = async (sessionId) => ({ activity: activityPage(sessionId) });
  api.onSessionActivityChanged = () => () => {};
  api.listBackgroundProcesses = async () => ({ processes: [] });
  api.onBackgroundProcessesChanged = () => () => {};
  api.onHostStatus = () => () => {};

  const msg = (id: string, role: UiMessage["role"], content: string, extra: Partial<UiMessage> = {}): UiMessage => ({ id, role, content, createdAt: at, ...extra });
  const write = (id: string, path: string, additions: number, deletions: number) => msg(`write-${id}`, "tool", "Wrote file", {
    toolName: "Write", toolStatus: "success", toolCallId: `call-${id}`, toolArgs: { path },
    toolResult: { details: { root: "workspace", review: { version: 1, snapshotId: `snap-${id}`, messageId: `write-${id}`, path, operation: "write",
      status: "modified", state: "active", additions, deletions, hunks: [{ header: "@@ -1,1 +1,1 @@", lines: [{ type: "add", text: "x" }] }], reversible: true } } },
  });
  const used = (id: string, tokens: number) => msg(id, "assistant", "Done.", {
    status: "complete", providerId: "preview-provider", modelId: "preview-model",
    usage: { inputTokens: tokens - 2_000, outputTokens: 2_000, totalTokens: tokens },
  });
  const tool = (id: string, name: string, args: Record<string, unknown> = {}) => msg(id, "tool", "ok", { toolName: name, toolStatus: "success", toolCallId: `call-${id}`, toolArgs: args });
  const transcripts: Record<string, UiMessage[]> = {
    [PROJECTS.a.id]: [msg("a-user", "user", "Wire the rail."), write("1", "src/one.ts", 10, 2), write("2", "src/two.ts", 5, 0), write("3", "src/three.ts", 100, 20),
      tool("a-skill", "Skill", { id: "frontend-design" }), tool("a-kaneo", "mcp_kaneo_create_task"), tool("a-kaneo-2", "mcp_kaneo_list_tasks"), tool("a-docs", "mcp_docs_search"),
      tool("a-remote", "mcp_remote_ping"), tool("a-gone", "mcp_gone_fetch"), used("a-usage", 40_000)],
    [PROJECTS.b.id]: [msg("b-user", "user", "Another project."), used("b-usage", 150_000)],
    [PROJECTS.plain.id]: [msg("p-user", "user", "A folder outside git."), used("p-usage", 10_000)],
    [PROJECTS.mcp.id]: [msg("m-user", "user", "Use the servers."), ...FAILED_TOOLS.map((name) => tool(`m-${name}`, name)), used("m-usage", 10_000)],
  };
  const model: ModelInfo = { modelId: "preview-model", displayName: "Preview", providerId: "preview-provider", contextWindow: 200_000,
    capabilities: ["text", "tools"], supportedThinkingLevels: ["off"], source: "user" };
  const provider: ProviderPublic = { id: "preview-provider", name: "Preview", vendorKey: "custom", type: "custom", protocol: "openai", enabled: true,
    authKind: "none", hasSecret: false, models: [{ id: "preview-model", alias: "Preview", contextWindow: 200_000, maxTokens: 8192, thinkingLevels: ["off"], defaultThinkingLevel: "off" }],
    defaultModelId: "preview-model", supportsReasoning: false, supportedThinkingLevels: ["off"], createdAt: at, updatedAt: at };
  const session = (project: { id: string; path: string; name: string }): SessionSummary => ({
    id: project.id, title: project.name, mode: "agent", thinkingLevel: "off", permissionMode: "auto", createdAt: at, updatedAt: at,
    messageCount: transcripts[project.id].length, source: "desktop", executionProfile: "standard", providerId: provider.id, modelId: model.modelId,
    projectPath: project.path, projectName: project.name,
  });
  const set = (patch: Parameters<typeof useAppStore.setState>[0]) => flushSync(() => useAppStore.setState(patch));
  const activate = (id: string) => set({ activeSessionId: id, messages: transcripts[id], retainedTranscripts: transcripts });
  set({
    workspace: { path: PROJECTS.a.path, name: PROJECTS.a.name, branch: PROJECTS.a.branch }, openProjects: [], activeSessionId: PROJECTS.a.id,
    retainedSessionIds: Object.values(PROJECTS).map((project) => project.id), retainedTranscripts: transcripts, messages: transcripts[PROJECTS.a.id],
    sessions: Object.values(PROJECTS).map(session), runningSessions: {}, isRunning: false,
    settings: { defaultMode: "agent", theme: "dark", thinkingDisplayMode: "compact", enterToSend: true, onboardingDismissed: true },
    providers: [provider], providerModels: { [provider.id]: [model] }, planHistory: {}, pendingPlans: {}, planCheckpoints: {}, pendingPermissions: {}, pendingAsks: {},
    workPanelOpen: false, workPanelTabs: [], activeWorkPanelTabId: null, workPanelContexts: {}, page: "chat",
  });

  const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  async function until(predicate: () => boolean, label: string, timeout = 5000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`${label}; git=${gitRequests.join()}; mcpReads=${docsReads}; errors=${errors.map(String).join(";")}; rail=${host.textContent?.slice(0, 600)}`);
      await paint();
    }
    if (errors.length) throw new Error(errors.map(String).join(";"));
  }
  const checks: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const click = (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error(`Missing fixture control; rail=${host.textContent?.slice(0, 400)}`);
    flushSync(() => element.click());
  };
  const rail = (id: string) => host.querySelector<HTMLElement>(`.session-activity-rail[data-session-id="${id}"]:not([hidden])`);
  const section = (id: string, name: string) => rail(id)?.querySelector<HTMLElement>(`[data-activity-section="${name}"]`) ?? null;
  const sectionIds = (id: string) => [...(rail(id)?.querySelectorAll<HTMLElement>("[data-activity-section]") ?? [])].map((element) => element.dataset.activitySection).join();
  const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  const openedTabs = (id: string) => useAppStore.getState().workPanelContexts[id]?.tabs.map((tab) => tab.kind) ?? [];
  // A frame sampled while another session shows must never carry the first session's branch.
  let leaked = false;
  const watchLeak = new MutationObserver(() => {
    if (rail(PROJECTS.b.id) && text(rail(PROJECTS.b.id)).includes(PROJECTS.a.branch)) leaked = true;
  });
  watchLeak.observe(host, { childList: true, subtree: true, characterData: true });

  const cleanup = () => {
    watchLeak.disconnect();
    flushSync(() => { root.unmount(); reviewRoot.unmount(); });
    host.remove(); reviewHost.remove();
    Object.assign(api, { getWorkspaceGit: original.git, listMcpServers: original.mcp, testMcpServer: original.testMcp, getSessionActivity: original.activity,
      onSessionActivityChanged: original.activityChanged, listBackgroundProcesses: original.list,
      onBackgroundProcessesChanged: original.processesChanged, onHostStatus: original.hostStatus,
      getContextInsights: original.insights, onAgentEvent: original.agentEvent, onContextInsightsChanged: original.insightsChanged });
    useAppStore.setState(initial);
    if (initialTheme === null) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", initialTheme);
    document.documentElement.style.setProperty("--font-scale", initialScale || "1");
  };

  function Panes() {
    const active = useAppStore((state) => state.activeSessionId);
    // Every retained session keeps its own pane, hidden until it is the active one, as the chat surface does.
    return <I18nextProvider i18n={i18n}>{Object.values(PROJECTS).map((project) => (
      <SessionActivity key={project.id} sessionId={project.id} messages={transcripts[project.id]} visible={active === project.id} rangeLimited={false} />))}
    </I18nextProvider>;
  }

  try {
    document.documentElement.setAttribute("data-theme", "dark");
    flushSync(() => root.render(<Panes />));

    // --- Project A: git project with changes, usage and MCP tools -------------------------------------------------
    await until(() => Boolean(section(PROJECTS.a.id, "environment")?.textContent?.includes(PROJECTS.a.branch)), "environment did not load its branch");
    // Live status shows only when something is live, or when it is all the rail has (then it carries the hint).
    check(sectionIds(PROJECTS.a.id) === "environment,context,artifacts,skills,changes",
      `the sections follow the canvas order (read ${sectionIds(PROJECTS.a.id)})`);
    const environment = section(PROJECTS.a.id, "environment")!;
    check(text(environment).includes("Environment") && text(environment).includes("Project A") && text(environment).includes("~/Code/project-a"),
      "environment names the project and writes its path from ~, shortened to the last two folders");
    check(environment.querySelector('[aria-label="Branch"]') !== null && text(environment).includes("feat/activity-rail"), "environment shows the git branch");
    check(!gitRequests.includes(PROJECTS.b.path) && !gitRequests.includes(PROJECTS.plain.path), "panes that are not shown read no git state");

    const context = section(PROJECTS.a.id, "context")!;
    check(text(context).includes("Used 20%") && text(context).includes("~40K / 200K"), "context shows the newest request's use against the model's window");
    check(context.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "20", "the context bar is filled to the used share");
    await until(() => Boolean(context.querySelector(".session-activity-context-legend")), "the request's breakdown did not load");
    const cells = (item: Element) => [...item.children].filter((child) => child.tagName === "SPAN").map((child) => text(child)).join(" ");
    check([...context.querySelectorAll(".session-activity-context-legend > li")].map(cells).join("|")
      === "System prompt ~4K 4.0%|Tool definitions ~4K 4.0%|Conversation ~12K 12.0%|Free space 160K 80.0%", "the legend lists each part of the window with its share and the free space");
    const swatch = context.querySelector<HTMLElement>('.session-activity-context-swatch[data-bucket="system"]')!;
    const swatchBox = swatch.getBoundingClientRect();
    check(swatchBox.width === 8 && swatchBox.height === 8 && getComputedStyle(swatch).borderTopLeftRadius === "2px",
      "each legend swatch is an 8px square with a 2px corner, not a dot");
    const bar = context.querySelector<HTMLElement>(".session-activity-context-bar")!;
    const segments = [...bar.children].map((child) => child.getBoundingClientRect().width);
    check(segments.length === 3 && Math.abs(segments.reduce((total, width) => total + width, 0) - bar.getBoundingClientRect().width * 0.2) < 1.5,
      "the bar's segments add up to the used share of the window");

    const changes = section(PROJECTS.a.id, "changes")!;
    check(text(changes.querySelector(".session-activity-static-title")).replace(/\s/g, "") === "Changes+115−22", `changes shows the recorded totals (read ${text(changes)})`);
    check(!changes.querySelector("[aria-expanded]"), "the changes heading cannot fold");

    // The numbers equal what the Review tab itself prints for the same transcript.
    flushSync(() => reviewRoot.render(<I18nextProvider i18n={i18n}><ReviewTab /></I18nextProvider>));
    check(text(reviewHost.querySelector(".review-summary")) === "3 recorded changes"
      && text(reviewHost.querySelector(".review-toolbar-counts")) === "+115−22", "the Review tab counts the same changes and lines");
    flushSync(() => reviewRoot.render(<></>));

    // --- Skills & MCP -------------------------------------------------------------------------------------------
    const skills = () => section(PROJECTS.a.id, "skills");
    const row = (name: string) => [...(skills()?.querySelectorAll<HTMLElement>(".session-skill-reference-row") ?? [])].find((item) => text(item).startsWith(name)) ?? null;
    await until(() => Boolean(row("Kaneo")?.querySelector(".session-activity-status")), "MCP states did not load");
    check([...skills()!.querySelectorAll(".session-skill-reference-name")].map((item) => text(item)).join() === "frontend-design,Kaneo,Docs,Remote,mcp_gone_fetch",
      "each server is one row, in the order its tools were first used");
    check(text(row("Kaneo")?.querySelector(".session-activity-status")) === "Connected", "a connected server reads Connected");
    check(row("Docs")?.querySelector('.session-activity-status[data-state="active"] .session-activity-spinner') !== null, "a server that is connecting shows a spinner");
    const remote = row("Remote")?.querySelector<HTMLElement>(".session-activity-status");
    check(text(remote) === "Sign-in needed" && remote?.dataset.tone === "warning", "a server that asks for sign-in says so in the warning colour");
    check(row("Kaneo")?.querySelector("[title]")?.getAttribute("title") === "Kaneo · Connected" && row("Remote")?.querySelector("[title]")?.getAttribute("title") === "Remote · Sign-in needed · HTTP 401",
      "a row's tooltip names the server, its state and the server's message");
    check(!row("frontend-design")?.querySelector(".session-activity-status") && !row("mcp_gone_fetch")?.querySelector(".session-activity-status"), "skills and unknown tools carry no status");
    check(skills()!.querySelector(".session-activity-row-action") === null, "servers that are connected, connecting or waiting for a sign-in offer no Reconnect");
    const docsRow = row("Docs")!;
    const before = docsRow.querySelector(".session-activity-status")!.getBoundingClientRect().right;
    flushSync(() => docsRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    check(Math.abs(docsRow.querySelector(".session-activity-status")!.getBoundingClientRect().right - before) < 0.5, "a server's status does not move when its row is hovered");
    await until(() => text(row("Docs")?.querySelector(".session-activity-status")) === "Connected", "a connecting server did not settle", 6000);
    check(true, "a connecting server is read again and settles without a click");

    // --- Layout at the real pane width, both themes and an enlarged font scale ------------------------------------
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.setProperty("--font-scale", "1.4");
      await paint();
      const bounds = host.getBoundingClientRect();
      const beyond = [...host.querySelectorAll<HTMLElement>("*")].filter((element) => element.getBoundingClientRect().right > bounds.right + 0.5)
        .slice(0, 6).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}[${getComputedStyle(element).display},${Math.round(element.getBoundingClientRect().right - bounds.right)}px]: ${element.outerHTML.slice(0, 140)}`).join(" | ");
      const within = host.scrollWidth <= host.clientWidth;
      check(within, within ? `${theme}: the 264px pane stays within bounds at an enlarged font scale` : `${theme}: the pane overflows (scroll ${host.scrollWidth} > client ${host.clientWidth}) at ${beyond}`);
    }
    document.documentElement.style.setProperty("--font-scale", "1");
    document.documentElement.setAttribute("data-theme", "dark");
    await paint();
    const grips = ["environment", "context", "changes"].map((name) => section(PROJECTS.a.id, name)!.querySelector<HTMLElement>("[data-activity-section-grip]")!.getBoundingClientRect());
    check(grips.every((grip) => Math.abs(grip.right - grips[0].right) < 0.5), "every workspace heading's grip sits at the same edge");
    const headings = ["environment", "context", "changes"].map((name) => section(PROJECTS.a.id, name)!.querySelector<HTMLElement>(".session-activity-heading")!.getBoundingClientRect().height);
    check(headings.every((height) => Math.abs(height - 32) < 0.5), `the workspace headings are 32px tall (read ${headings.join()})`);
    for (const [name, link] of [["context", "Details"], ["changes", "Review"]] as const) {
      const button = [...section(PROJECTS.a.id, name)!.querySelectorAll<HTMLElement>(".session-activity-heading-link")].find((item) => text(item) === link);
      check(Boolean(button) && button!.getBoundingClientRect().right <= section(PROJECTS.a.id, name)!.querySelector("[data-activity-section-grip]")!.getBoundingClientRect().left + 0.5,
        `the ${link} link sits before the grip`);
      check(getComputedStyle(button!).borderTopWidth === "0px" && getComputedStyle(button!).backgroundColor === "rgba(0, 0, 0, 0)", `the ${link} link has no frame until hovered`);
    }

    // --- Folding and the links -----------------------------------------------------------------------------------
    click(environment.querySelector(".session-activity-disclosure"));
    check(environment.querySelector(".session-activity-disclosure")?.getAttribute("aria-expanded") === "false" && !text(environment).includes("feat/activity-rail")
      && text(environment.querySelector(".session-activity-heading-summary")) === "Project A", "a folded environment keeps the project's name beside its heading");
    click(environment.querySelector(".session-activity-disclosure"));
    check(text(environment).includes("feat/activity-rail"), "unfolding brings the rows back");
    click([...context.querySelectorAll<HTMLElement>(".session-activity-heading-link")].find((item) => text(item) === "Details"));
    check(openedTabs(PROJECTS.a.id).includes("context"), "Details opens the context dashboard beside the conversation");
    click([...changes.querySelectorAll<HTMLElement>(".session-activity-heading-link")].find((item) => text(item) === "Review"));
    check(openedTabs(PROJECTS.a.id).includes("review"), "Review opens the Review tab");

    // --- Project B: its own branch, never project A's --------------------------------------------------------------
    activate(PROJECTS.b.id);
    await until(() => Boolean(rail(PROJECTS.b.id)), "project B did not show");
    check(!section(PROJECTS.b.id, "environment")?.textContent?.includes(PROJECTS.a.branch), "a session that is still loading shows no branch rather than another session's");
    await until(() => Boolean(section(PROJECTS.b.id, "environment")?.textContent?.includes("main")), "project B did not load its branch");
    check(!leaked, "no frame of project B carried project A's branch");
    check(text(section(PROJECTS.b.id, "context")).includes("Used 75%") && section(PROJECTS.b.id, "context")!.querySelector('[data-tone="warning"]') !== null,
      "context warns at the composer's capacity levels");
    check(!section(PROJECTS.b.id, "changes") && sectionIds(PROJECTS.b.id) === "live,environment,context,skills",
      `a session without recorded changes has no changes section (read ${sectionIds(PROJECTS.b.id)})`);

    // --- A folder outside git: no environment at all -----------------------------------------------------------------
    activate(PROJECTS.plain.id);
    await until(() => Boolean(rail(PROJECTS.plain.id)) && gitRequests.includes(PROJECTS.plain.path), "the plain folder was not read");
    await paint();
    check(!section(PROJECTS.plain.id, "environment") && sectionIds(PROJECTS.plain.id) === "live,context,skills",
      `a folder outside git shows no environment block (read ${sectionIds(PROJECTS.plain.id)})`);

    // --- Reconnect: a failed server's row offers it once, and settles on what the Host answers --------------------------
    activate(PROJECTS.mcp.id);
    const failedRow = (name: string) => [...(section(PROJECTS.mcp.id, "skills")?.querySelectorAll<HTMLElement>(".session-skill-reference-row") ?? [])].find((item) => text(item).startsWith(name)) ?? null;
    const action = (name: string) => failedRow(name)?.querySelector<HTMLElement>(".session-activity-row-action") ?? null;
    const tooltip = (name: string) => failedRow(name)?.querySelector("[title]")?.getAttribute("title");
    const toastMessages = () => useAppStore.getState().toasts.map((toast) => toast.message);
    await until(() => Boolean(action("Search") && action("Flaky") && action("Broken")), "failed servers did not offer Reconnect");
    check([...section(PROJECTS.mcp.id, "skills")!.querySelectorAll(".session-skill-reference-name")].map((item) => text(item)).join() === "Search,Flaky,Broken",
      "each failed server is one row");
    const search = action("Search")!;
    check(text(search) === "Reconnect" && search.getAttribute("aria-label") === "Reconnect Search (connection failed)",
      "a failed server offers Reconnect, named for the server and for the failure the word replaced");
    check(!failedRow("Search")!.querySelector(".session-activity-status") && tooltip("Search") === "Search · Failed · connect ECONNRESET",
      "the button stands where the failed word was, and the failure stays in the row's tooltip");
    const ink = document.createElement("span");
    ink.style.color = "var(--ds-warning-ink)";
    host.append(ink);
    const warning = getComputedStyle(ink).color;
    ink.remove();
    const look = getComputedStyle(search);
    check(look.color === warning && look.borderTopWidth === "0px" && look.backgroundColor === "rgba(0, 0, 0, 0)", "the action is a word in the warning colour with no frame");
    check(look.height === "28px" && look.fontSize === "12px" && look.borderTopLeftRadius === "6px",
      `the action has the canvas' metrics: 28px tall, 12px type, 6px corners (read ${look.height}, ${look.fontSize}, ${look.borderTopLeftRadius})`);
    const inner = failedRow("Search")!.querySelector<HTMLElement>(".session-skill-reference")!;
    check(Math.abs(inner.getBoundingClientRect().right - 8 - search.getBoundingClientRect().right) < 1, "the action ends 8px inside the row, as on the canvas");
    document.documentElement.style.setProperty("--font-scale", "1.4");
    await paint();
    const fits = host.scrollWidth <= host.clientWidth;
    check(fits, fits ? "the 264px pane stays within bounds with Reconnect at an enlarged font scale" : `the pane overflows with Reconnect at an enlarged font scale (scroll ${host.scrollWidth} > client ${host.clientWidth})`);
    document.documentElement.style.setProperty("--font-scale", "1");
    await paint();

    // One click starts one request: a second click in the same tick finds it already running.
    const toastsBefore = toastMessages().length;
    flushSync(() => { search.click(); search.click(); });
    check(testCalls.length === 1 && JSON.stringify(testCalls[0]) === JSON.stringify({ id: "search", query: { level: "global" } }),
      `Reconnect asks the Host to test the server at its own level, once (read ${JSON.stringify(testCalls)})`);
    check(!action("Search") && failedRow("Search")!.querySelector('.session-activity-status[data-state="active"] .session-activity-spinner[aria-label="Connecting…"]') !== null,
      "while the Host answers the row spins and offers nothing");
    check(Boolean(action("Flaky") && action("Broken")), "the other failed servers keep their button meanwhile");
    answers.get("search")!({ connects: true });
    await until(() => text(failedRow("Search")?.querySelector(".session-activity-status")) === "Connected", "the row did not settle on the Host's answer");
    check(!action("Search") && toastMessages().length === toastsBefore, "a server that connects says so in its row and nowhere else");

    // The Host cannot be asked: the row goes back to its button and the reason is said once, with the server's name.
    click(action("Flaky"));
    check(!action("Flaky") && failedRow("Flaky")!.querySelector(".session-activity-spinner") !== null, "a second server spins on its own");
    answers.get("flaky")!({ rejects: "host unavailable" });
    await until(() => Boolean(action("Flaky")), "a request the Host could not take left the row spinning");
    check(toastMessages().includes("Flaky: host unavailable") && tooltip("Flaky") === "Flaky · Failed · ETIMEDOUT",
      "a request that could not be made says why and leaves the row as it was");

    // The Host answers that the server is still down: the new message replaces the old one in the tooltip and is said once.
    click(action("Broken"));
    answers.get("broken")!({ stillDown: "spawn broken EACCES" });
    await until(() => Boolean(action("Broken")) && tooltip("Broken") === "Broken · Failed · spawn broken EACCES", "the Host's new answer did not reach the row");
    check(toastMessages().includes("Broken: spawn broken EACCES"), "a server that is still down says what the Host said");

    // The pane moves to another project while a request runs: the late answer must not paint the new project's rows.
    const callsBefore = testCalls.length;
    click(action("Broken"));
    check(testCalls.length === callsBefore + 1, "a failed server can be asked again");
    const moveMcpSession = (projectPath: string) => set({ sessions: useAppStore.getState().sessions.map((item) => item.id === PROJECTS.mcp.id ? { ...item, projectPath } : item) });
    moveMcpSession(PROJECTS.plain.path);
    await until(() => Boolean(action("Broken")), "the other project's rows did not load");
    answers.get("broken")!({ connects: true });
    await paint(); await paint(); await paint();
    check(Boolean(action("Broken")) && !text(failedRow("Broken")).includes("Connected"), "an answer for the project the pane left does not reach the rows of the one it shows");
    moveMcpSession(PROJECTS.mcp.path);
    await until(() => text(failedRow("Broken")?.querySelector(".session-activity-status")) === "Connected", "coming back, the row was not read from the Host again");
    check(!failedRow("Broken")!.querySelector(".session-activity-spinner") && testCalls.length === callsBefore + 1,
      "the abandoned request left no spinner behind and started nothing else");

    // --- Back to A: the environment is still there and the hidden pane read nothing meanwhile ---------------------------
    activate(PROJECTS.a.id);
    await until(() => Boolean(section(PROJECTS.a.id, "environment")?.textContent?.includes(PROJECTS.a.branch)), "project A lost its branch on return");
    check(!errors.length, "no uncaught render error");
    return { ok: true, checks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error), checks };
  } finally {
    cleanup();
  }
}
