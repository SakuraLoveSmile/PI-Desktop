import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import test, { after, afterEach } from "node:test";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, logLevel: "silent",
  server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" },
  appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: [
    { find: /^@pi-desktop\/shared$/, replacement: fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)) },
    { find: /^@pi-desktop\/i18n$/, replacement: fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)) },
  ] },
});
after(() => server.close());
const activity = (name) => server.ssrLoadModule(`/src/features/chat/activity/${name}`);
const { catalogs } = await server.ssrLoadModule("@pi-desktop/i18n");
const { activityMcpReferences, mcpNeedsAuth, withReconnecting, withStatus } = await activity("activity-mcp-rows.ts");
const { activityContextView, activityContextLabelKey } = await activity("activity-context-view.ts");
const { formatActivityTokens } = await activity("activity-token-format.ts");
const { goalRowFacts, goalFoldedSummaryKind } = await activity("goal-row-facts.ts");
const { GoalFoldedSummary } = await activity("GoalFoldedSummary.tsx");
const { shortProjectPath, projectFolderName } = await activity("activity-workspace-view.ts");
const { ActivityMcpStatus, mcpStatusMark, mcpReferenceTitle } = await activity("ActivityMcpStatus.tsx");
const { ActivityContextMeter } = await activity("ActivityContextSection.tsx");
const { SessionActivityRail } = await activity("SessionActivityRail.tsx");
const { SessionSkillSuggestions } = await activity("SessionSkillSuggestions.tsx");
const { activitySectionOrderStore } = await activity("use-activity-section-order.ts");
const { openContextInsights } = await server.ssrLoadModule("/src/features/context-entry/open-context-insights.ts");
const { contextUsageLabelKey } = await server.ssrLoadModule("/src/lib/context-usage.ts");
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
const zh = createInstance();
await zh.init({ lng: "zh-CN", resources: { "zh-CN": { translation: catalogs["zh-CN"] } } });

afterEach(() => activitySectionOrderStore.reset());

const withI18n = (element) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const withChinese = (element) => renderToStaticMarkup(createElement(I18nextProvider, { i18n: zh }, element));
const baseProps = { sessionId: "a", visible: true, plans: [], goals: [], agents: [], outputs: [], sources: [], processes: [],
  processesLoading: false, onRefreshProcesses() {}, onOpenProcess() {}, supported: true };
const render = (props) => withI18n(createElement(SessionActivityRail, { ...baseProps, ...props }));
const renderChinese = (props) => withChinese(createElement(SessionActivityRail, { ...baseProps, ...props }));
/** Renders with the named groups folded, as a person leaves them; `attention` is what they had already seen in each. */
const withFolded = (groups, work) => {
  const folded = Object.fromEntries(groups.map(([group, attention = []]) => [`pi-desktop:activity-disclosure:v1:a:${group}`, JSON.stringify({ open: false, attention })]));
  globalThis.localStorage = { getItem: (name) => folded[name] ?? null, setItem() {} };
  try { return work(); } finally { delete globalThis.localStorage; }
};
const sections = (markup) => markup.split('data-activity-section="').slice(1).map((chunk) => ({ id: chunk.slice(0, chunk.indexOf('"')), markup: chunk }));
const ids = (markup) => sections(markup).map((candidate) => candidate.id);
const section = (markup, id) => sections(markup).find((candidate) => candidate.id === id)?.markup ?? "";
const count = (markup, needle) => markup.split(needle).length - 1;

const server_ = (id, over = {}) => ({ id, label: id, transport: "stdio", enabled: true, createdAt: "2026-11-21", updatedAt: "2026-11-21", ...over });
const status = (serverId, state, over = {}) => ({ serverId, state, toolCount: 0, updatedAt: 1, ...over });
const tool = (label) => ({ id: label, label });
const usage = (inputTokens, over = {}) => ({ inputTokens, outputTokens: 0, ...over });
const entry = (category, estimatedTokens) => ({ id: `${category}-${estimatedTokens}`, category, label: category, content: "", estimatedTokens, originalChars: 0, truncated: false });
const request = (entries) => ({ id: "request-1", step: 1, startedAt: 1, status: "completed", providerId: "p", modelId: "m", mode: "agent",
  contextWindow: 200_000, estimatedTokens: 0, estimateSource: "runtime-usage-anchor", entries, contentTruncated: false });
const rounded = (value) => Math.round(value * 10) / 10;

test("every tool of a known MCP server folds into that server's one row, which carries the server's state", () => {
  const rows = activityMcpReferences(
    [tool("mcp_kaneo_create_task"), tool("mcp_github_search"), tool("mcp_kaneo_list_tasks")],
    [server_("kaneo", { label: "Kaneo" }), server_("github", { label: "GitHub" })],
    [status("kaneo", "ready"), status("github", "connecting")],
  );
  assert.deepEqual(rows.map((row) => [row.id, row.label, row.kind, row.mcp?.state]),
    [["mcp-server:kaneo", "Kaneo", "mcp", "ready"], ["mcp-server:github", "GitHub", "mcp", "connecting"]]);
});

test("a server the runtime has not reported on reads as idle, a blank label falls back to the id, and its message travels along", () => {
  const [unreported] = activityMcpReferences([tool("mcp_kaneo_create_task")], [server_("kaneo", { label: "  " })], []);
  assert.equal(unreported.label, "kaneo");
  assert.deepEqual(unreported.mcp, { state: "idle", authRequired: false });
  const [failed] = activityMcpReferences([tool("mcp_kaneo_create_task")], [server_("kaneo")], [status("kaneo", "failed", { message: "ECONNRESET" })]);
  assert.deepEqual(failed.mcp, { state: "failed", authRequired: false, message: "ECONNRESET", reconnect: { serverId: "kaneo", label: "kaneo", level: "global" } });
});

test("a failed server that is not waiting for a sign-in says how to reconnect to it, by its level and project", () => {
  const http = { transport: "http", url: "https://example.test/mcp" };
  const rows = activityMcpReferences(
    [tool("mcp_kaneo_create_task"), tool("mcp_docs_search"), tool("mcp_stray_run"), tool("mcp_remote_ping"), tool("mcp_local_run"), tool("mcp_slow_run"), tool("mcp_new_run")],
    [server_("kaneo", { label: "Kaneo", level: "global" }), server_("docs", { level: "project", projectPath: "/work/project" }),
      server_("stray", { level: "global", projectPath: "/work/ignored" }), server_("remote", http), server_("local"), server_("slow"), server_("new")],
    [status("kaneo", "failed"), status("docs", "failed"), status("stray", "failed"), status("remote", "failed", { authRequired: true }),
      status("local", "ready"), status("slow", "connecting")],
  );
  const target = (id) => rows.find((row) => row.id === `mcp-server:${id}`)?.mcp?.reconnect;
  assert.deepEqual(target("kaneo"), { serverId: "kaneo", label: "Kaneo", level: "global" });
  assert.deepEqual(target("docs"), { serverId: "docs", label: "docs", level: "project", projectPath: "/work/project" });
  assert.deepEqual(target("stray"), { serverId: "stray", label: "stray", level: "global" }, "a global server is addressed by its level alone");
  assert.equal(target("remote"), undefined, "a server that asks for sign-in is not retried");
  for (const id of ["local", "slow", "new"]) assert.equal(target(id), undefined, `${id} reads ready, connecting or idle, so there is nothing to retry`);
  assert.equal(rows.find((row) => row.id === "mcp-server:remote").mcp.authRequired, true);
});

test("a reconnecting server reads as connecting and the Host's answer replaces what was read for it", () => {
  const read = [status("a", "failed", { message: "ECONNRESET" }), status("b", "ready"), status("a", "failed")];
  assert.deepEqual(withReconnecting(read, new Set(["a"])).map((item) => item.state), ["connecting", "ready", "connecting"]);
  assert.deepEqual(withReconnecting(read, new Set()).map((item) => item.state), ["failed", "ready", "failed"]);
  assert.equal(withReconnecting(read, new Set(["a"]))[0].message, "ECONNRESET", "what the Host said stays for the tooltip");
  assert.equal(read[0].state, "failed", "the statuses that were read are left alone");
  assert.deepEqual(withStatus(read, status("a", "ready")).map((item) => [item.serverId, item.state]), [["a", "ready"], ["b", "ready"], ["a", "ready"]]);
  assert.deepEqual(withStatus(read, status("c", "failed")).map((item) => item.serverId), ["a", "b", "a", "c"]);
  assert.deepEqual(withStatus([], status("a", "ready")).map((item) => item.state), ["ready"]);
});

test("a tool whose server is gone keeps a row of its own under the tool's name", () => {
  const rows = activityMcpReferences([tool("mcp_gone_fetch"), tool("mcp_kaneo_create_task")], [server_("kaneo")], [status("kaneo", "ready")]);
  assert.deepEqual(rows.map((row) => [row.id, row.label, row.mcp === undefined]),
    [["mcp:mcp_gone_fetch", "mcp_gone_fetch", true], ["mcp-server:kaneo", "kaneo", false]]);
  assert.deepEqual(activityMcpReferences([tool("mcp_gone_fetch")], [], []).map((row) => row.kind), ["mcp"]);
});

test("a tool belongs to the server with the longest matching id, and ids match the way the runtime spells their tools", () => {
  const servers = [server_("my"), server_("my_db"), server_("my-docs")];
  const owner = (label) => activityMcpReferences([tool(label)], servers, [])[0].id;
  assert.equal(owner("mcp_my_db_query"), "mcp-server:my_db");
  assert.equal(owner("mcp_my_other"), "mcp-server:my");
  assert.equal(owner("mcp_my_docs_search"), "mcp-server:my-docs");
  // A name that is only the prefix has no tool part, so no server claims it.
  assert.equal(owner("mcp_my_"), "mcp:mcp_my_");
});

test("a server needs sign-in only when it is HTTP, sends no Authorization header of its own and still asks for it", () => {
  const http = server_("remote", { transport: "http", url: "https://example.test/mcp" });
  assert.equal(mcpNeedsAuth(http, status("remote", "failed", { authRequired: true })), true);
  assert.equal(mcpNeedsAuth(http, status("remote", "failed")), false);
  assert.equal(mcpNeedsAuth(http, undefined), false);
  assert.equal(mcpNeedsAuth({ ...http, headers: { authorization: "Bearer x" } }, status("remote", "failed", { authRequired: true })), false);
  assert.equal(mcpNeedsAuth({ ...http, headers: { "X-Trace": "1" } }, status("remote", "failed", { authRequired: true })), true);
  assert.equal(mcpNeedsAuth(server_("local"), status("local", "failed", { authRequired: true })), false);
  const [row] = activityMcpReferences([tool("mcp_remote_ping")], [http], [status("remote", "failed", { authRequired: true })]);
  assert.equal(row.mcp.authRequired, true);
});

test("an MCP row reads as a spinner while connecting, a quiet word when idle or connected, and a coloured word when it needs you", () => {
  const mark = (state, authRequired = false) => mcpStatusMark({ state, authRequired });
  assert.deepEqual(mark("connecting"), { status: "running", labelKey: "extensions.mcp.state.connecting" });
  assert.deepEqual(mark("ready"), { status: "ready", labelKey: "extensions.mcp.state.ready" });
  assert.deepEqual(mark("failed"), { status: "failed", labelKey: "extensions.mcp.state.failed" });
  assert.deepEqual(mark("idle"), { status: "idle", labelKey: "panel.activity.mcp.idle" });
  for (const state of ["idle", "connecting", "ready", "failed"]) assert.equal(mark(state, true).labelKey, "panel.activity.mcp.authNeeded", `sign-in outranks ${state}`);

  const render_ = (state, authRequired = false) => withI18n(createElement(ActivityMcpStatus, { mcp: { state, authRequired } }));
  const connecting = render_("connecting");
  assert.ok(connecting.includes('data-state="active"') && connecting.includes("session-activity-spinner") && connecting.includes('aria-label="Connecting…"'));
  const ready = render_("ready");
  assert.ok(ready.includes('data-state="idle"') && ready.includes(">Connected<"));
  const idle = render_("idle");
  assert.ok(idle.includes('data-state="idle"') && idle.includes(">Idle<"));
  const failed = render_("failed");
  assert.ok(failed.includes('data-state="attention"') && failed.includes('data-tone="error"') && failed.includes(">Failed<"));
  const auth = render_("failed", true);
  assert.ok(auth.includes('data-state="attention"') && auth.includes('data-tone="warning"') && auth.includes(">Sign-in needed<") && !auth.includes(">Failed<"));
});

test("a failed server that can be reconnected offers Reconnect in the word's place, named for the server and its failure", () => {
  const mcp = { state: "failed", authRequired: false, message: "ECONNRESET", reconnect: { serverId: "kaneo", label: "Kaneo", level: "global" } };
  const offered = withI18n(createElement(ActivityMcpStatus, { mcp, name: "Kaneo", onReconnect() {} }));
  assert.ok(offered.includes("<button") && offered.includes("session-activity-row-action") && offered.includes(">Reconnect</button>"));
  assert.ok(offered.includes('aria-label="Reconnect Kaneo (connection failed)"'), "the button's name carries the server and the state the word replaced");
  assert.ok(!offered.includes("session-activity-status") && !offered.includes(">Failed<"), "the button stands where the word would");
  // With nothing to act with, nothing is offered: the row only says what happened.
  const unwired = withI18n(createElement(ActivityMcpStatus, { mcp, name: "Kaneo" }));
  assert.ok(!unwired.includes("<button") && unwired.includes(">Failed<"));
  // A server that needs sign-in is not offered a retry; one that is being reconnected spins where the button was.
  const auth = withI18n(createElement(ActivityMcpStatus, { mcp: { state: "failed", authRequired: true }, name: "Kaneo", onReconnect() {} }));
  assert.ok(!auth.includes("<button") && auth.includes(">Sign-in needed<"));
  const retrying = withI18n(createElement(ActivityMcpStatus, { mcp: { state: "connecting", authRequired: false }, name: "Kaneo", onReconnect() {} }));
  assert.ok(!retrying.includes("<button") && retrying.includes("session-activity-spinner") && retrying.includes('aria-label="Connecting…"'));
});

test("an MCP row's tooltip names the server, how it reads and the server's own message", () => {
  const translate = (key) => i18n.t(key);
  assert.equal(mcpReferenceTitle("Kaneo", undefined, translate), "Kaneo");
  assert.equal(mcpReferenceTitle("Kaneo", { state: "ready", authRequired: false }, translate), "Kaneo · Connected");
  assert.equal(mcpReferenceTitle("Kaneo", { state: "failed", authRequired: false, message: " ECONNRESET " }, translate), "Kaneo · Failed · ECONNRESET");
  assert.equal(mcpReferenceTitle("Kaneo", { state: "failed", authRequired: true, message: "401" }, translate), "Kaneo · Sign-in needed · 401");
});

test("the skills section lists a server with its state at the row's end and leaves skill rows as they were", () => {
  const references = [
    { id: "skill:design", label: "frontend-design", kind: "skill" },
    { id: "mcp-server:kaneo", label: "Kaneo", kind: "mcp", mcp: { state: "failed", authRequired: false, message: "ECONNRESET" } },
    { id: "mcp-server:docs", label: "Docs", kind: "mcp", mcp: { state: "connecting", authRequired: false }, onOpen() {} },
    { id: "mcp:mcp_gone_fetch", label: "mcp_gone_fetch", kind: "mcp" },
  ];
  const markup = withI18n(createElement(SessionSkillSuggestions, { sessionId: "a", messages: [], visible: true, supported: true, references }));
  const rows = markup.split('<li class="session-skill-reference-row">').slice(1);
  assert.equal(rows.length, 4);
  assert.ok(rows[0].includes("frontend-design") && !rows[0].includes("session-activity-status"));
  assert.ok(rows[1].includes('title="Kaneo · Failed · ECONNRESET"') && rows[1].includes('data-tone="error"') && rows[1].includes(">Failed<"));
  assert.ok(rows[1].indexOf("session-skill-reference-name") < rows[1].indexOf("session-activity-status"), "the status follows the name");
  assert.ok(rows[2].includes("session-activity-spinner") && rows[2].includes('title="Docs · Connecting…"') && rows[2].includes("<button"));
  assert.ok(rows[3].includes("mcp_gone_fetch") && !rows[3].includes("session-activity-status"));
});

test("the skills section puts Reconnect on a failed server's row, and never inside a row that is itself a button", () => {
  const failed = (id, label, over = {}) => ({ id: `mcp-server:${id}`, label, kind: "mcp",
    mcp: { state: "failed", authRequired: false, reconnect: { serverId: id, label, level: "global" }, ...over }, });
  const references = [
    { ...failed("kaneo", "Kaneo", { message: "ECONNRESET" }) },
    { ...failed("docs", "Docs"), onOpen() {} },
    { id: "mcp-server:search", label: "Search", kind: "mcp", mcp: { state: "ready", authRequired: false } },
  ];
  const rows = withI18n(createElement(SessionSkillSuggestions, { sessionId: "a", messages: [], visible: true, supported: true, references, onReconnectMcp() {} }))
    .split('<li class="session-skill-reference-row">').slice(1);
  assert.equal(rows.length, 3);
  assert.ok(rows[0].includes('<div class="session-skill-reference"') && rows[0].includes(">Reconnect</button>") && rows[0].includes('title="Kaneo · Failed · ECONNRESET"'),
    "the action sits in a row that is not a button, and the failure stays in the tooltip");
  assert.equal(count(rows[0], "<button"), 1);
  assert.equal(count(rows[1], "<button"), 1, "a row that opens something keeps the word, so no button holds another button");
  assert.ok(rows[1].includes(">Failed<") && !rows[1].includes(">Reconnect<"));
  assert.ok(rows[2].includes(">Connected<") && !rows[2].includes("<button"));
  const unwired = withI18n(createElement(SessionSkillSuggestions, { sessionId: "a", messages: [], visible: true, supported: true, references }));
  assert.ok(unwired.includes(">Failed<") && !unwired.includes(">Reconnect<"), "a pane that cannot reconnect shows the word");
});

test("the context view prints the composer's own figures in either framing, with the free space beside them", () => {
  const used = activityContextView(usage(30_000, { outputTokens: 2_000, cacheReadTokens: 8_000 }), 200_000, "used");
  assert.deepEqual([used.display, used.percent, used.usedPercent, used.usedTokens, used.windowTokens, used.level], ["used", 20, 20, 40_000, 200_000, "comfortable"]);
  assert.equal(used.buckets, undefined, "no breakdown until the newest request is known");
  assert.deepEqual([used.free.tokens, rounded(used.free.percent)], [160_000, 80]);
  const remaining = activityContextView(usage(40_000), 200_000, "remaining");
  assert.deepEqual([remaining.display, remaining.percent, remaining.usedPercent], ["remaining", 80, 20]);
});

test("the context view warns at the composer's capacity levels in both framings", () => {
  const level = (tokens, display = "used") => activityContextView(usage(tokens), 200_000, display).level;
  assert.equal(level(148_000), "comfortable");
  assert.equal(level(150_000), "warning");
  assert.equal(level(178_000), "warning");
  // 179,000 of 200,000 is 89.5%, which the composer rounds to 90% used, so 10% is left.
  assert.equal(level(179_000), "critical");
  assert.equal(level(180_000), "critical");
  assert.equal(level(150_000, "remaining"), "warning");
});

test("the context view splits the bar by the newest request's breakdown, scaled to the reported use", () => {
  const view = activityContextView(usage(40_000), 200_000, "used",
    request([entry("system", 4_000), entry("tools", 4_000), entry("user", 4_000), entry("toolResult", 8_000)]));
  assert.deepEqual(view.buckets.map((bucket) => [bucket.bucket, bucket.tokens, rounded(bucket.percent)]),
    [["system", 4_000, 4], ["tools", 4_000, 4], ["messages", 12_000, 12]]);
  const partial = activityContextView(usage(40_000), 200_000, "used", request([entry("user", 5_000)]));
  assert.deepEqual(partial.buckets.map((bucket) => [bucket.bucket, bucket.tokens]), [["system", 0], ["tools", 0], ["messages", 5_000]]);
  assert.equal(activityContextView(usage(40_000), 200_000, "used", request([])).buckets, undefined);
});

test("the context meter shows each part of the window with its share, and a single segment before the breakdown is known", () => {
  const detailed = activityContextView(usage(40_000), 200_000, "used",
    request([entry("system", 4_000), entry("tools", 4_000), entry("user", 12_000)]));
  const meter = withI18n(createElement(ActivityContextMeter, { view: detailed }));
  assert.ok(meter.includes("Used 20%") && meter.includes("~40K / 200K"));
  assert.ok(meter.includes('role="progressbar"') && meter.includes('aria-valuenow="20"'));
  assert.equal(count(meter, "<i data-bucket="), 3);
  for (const [label, tokens, share] of [["System prompt", "~4K", "4.0%"], ["Tool definitions", "~4K", "4.0%"], ["Conversation", "~12K", "12.0%"], ["Free space", "160K", "80.0%"]]) {
    const row = meter.slice(meter.indexOf(label));
    assert.ok(row.slice(0, row.indexOf("</li>")).includes(tokens) && row.slice(0, row.indexOf("</li>")).includes(share), label);
  }
  const bare = withI18n(createElement(ActivityContextMeter, { view: activityContextView(usage(40_000), 200_000, "used") }));
  assert.ok(bare.includes('data-bucket="used"') && !bare.includes("session-activity-context-legend") && !bare.includes("Free space"));
  const remaining = withI18n(createElement(ActivityContextMeter, { view: activityContextView(usage(40_000), 200_000, "remaining") }));
  assert.ok(remaining.includes("Remaining 80%") && remaining.includes('aria-valuenow="20"'), "the bar always shows what is used");
  const tight = withI18n(createElement(ActivityContextMeter, { view: activityContextView(usage(190_000), 200_000, "used") }));
  assert.ok(tight.includes('data-tone="critical"') && !meter.includes("data-tone="));
});

test("a project path under a person's home starts at ~ and keeps its last two folders, whichever separator it uses", () => {
  assert.equal(shortProjectPath("/Users/dev/Code/PI-Desktop"), "~/Code/PI-Desktop");
  assert.equal(shortProjectPath("/Users/dev/Code/Work/PI-Desktop"), "~/…/Work/PI-Desktop");
  assert.equal(shortProjectPath("/home/dev/work"), "~/work");
  assert.equal(shortProjectPath("C:\\Users\\dev\\Code\\PI-Desktop"), "~\\Code\\PI-Desktop");
  assert.equal(shortProjectPath("D:/Users/dev/Code/Work/App"), "~/…/Work/App");
  assert.equal(shortProjectPath("/Users/dev"), "~");
  assert.equal(shortProjectPath("/Users/dev/"), "~");
});

test("a project path outside a home folder is only shortened, and a shared Users folder is not mistaken for a home", () => {
  assert.equal(shortProjectPath("/srv/apps/PI-Desktop"), "…/apps/PI-Desktop");
  assert.equal(shortProjectPath("/PI-Desktop"), "/PI-Desktop");
  assert.equal(shortProjectPath("/opt/PI-Desktop"), "/opt/PI-Desktop");
  assert.equal(shortProjectPath("/Users"), "/Users");
  assert.equal(shortProjectPath("/Users/Shared/Code/PI-Desktop"), "…/Code/PI-Desktop");
  assert.equal(shortProjectPath("C:\\Users\\Public\\Code\\PI-Desktop"), "…\\Code\\PI-Desktop");
  assert.equal(projectFolderName("/Users/dev/Code/PI-Desktop/"), "PI-Desktop");
  assert.equal(projectFolderName("C:\\Users\\dev"), "dev");
  assert.equal(projectFolderName("/"), "/");
});

const environment = { name: "PI-Desktop", path: "/Users/dev/Code/PI-Desktop", branch: "feat/activity-rail" };
const changes = { count: 3, additions: 159, deletions: 45 };
const contextUsage = { usage: usage(40_000), turnUsage: usage(40_000), contextWindow: 200_000, tools: [], responseOutputEstimated: false };
const goal = { id: "goal-1", label: "Ship the importer", status: "running", statusLabel: "Running" };
const plan = { id: "plan-1", label: "Cleanup plan", status: "approved", statusLabel: "Approved" };
const agent = { id: "agent-1", label: "explore", detail: "Map the rail", status: "running", statusLabel: "Running" };
const output = { id: "output-1", label: "report.md", path: "report.md" };
const suggestions = createElement("section", { className: "session-skill-suggestions" }, createElement("p", null, "skills-body"));
const workspace = { environment, contextUsage, changes };

test("environment and context follow live status, changes comes last, and each appears only when the session has it", () => {
  const all = render({ goals: [goal], plans: [plan], agents: [agent], outputs: [output], suggestions, ...workspace });
  assert.deepEqual(ids(all), ["goals", "plans", "live", "environment", "context", "artifacts", "skills", "changes"]);
  assert.deepEqual(ids(render({ agents: [agent], ...workspace, environment: undefined })), ["live", "context", "changes"]);
  assert.deepEqual(ids(render({ agents: [agent], ...workspace, contextUsage: undefined })), ["live", "environment", "changes"]);
  assert.deepEqual(ids(render({ agents: [agent], ...workspace, changes: undefined })), ["live", "environment", "context"]);
});

test("workspace sections do not stand in for live content: a session with only a branch still shows the live hint", () => {
  const markup = render({ environment });
  assert.deepEqual(ids(markup), ["live", "environment"]);
  assert.ok(section(markup, "live").includes("Subagents and background processes appear here as they make progress."));
});

test("the environment section names the project, shortens its path and shows the branch", () => {
  const body = section(render({ environment }), "environment");
  assert.ok(body.includes('data-activity-group="environment"') && body.includes('data-variant="section"'));
  assert.ok(body.includes("Environment") && body.includes("PI-Desktop") && body.includes("~/Code/PI-Desktop"));
  assert.ok(body.includes("feat/activity-rail") && body.includes('aria-label="Branch"'));
  assert.ok(body.includes('aria-expanded="true"'));
});

test("a project that is open on a detached HEAD shows the folder alone, with no branch row", () => {
  const body = section(render({ environment: { ...environment, branch: null } }), "environment");
  assert.ok(body.includes("PI-Desktop") && !body.includes('aria-label="Branch"') && !body.includes("feat/activity-rail"));
});

test("a folded environment section keeps the project's name beside its heading", () => {
  const key = "pi-desktop:activity-disclosure:v1:a:environment";
  globalThis.localStorage = { getItem: (name) => name === key ? JSON.stringify({ open: false, attention: [] }) : null, setItem() {} };
  try {
    const body = section(render({ environment }), "environment");
    assert.ok(body.includes('aria-expanded="false"') && body.includes('<span class="session-activity-heading-summary">PI-Desktop</span>'));
    assert.ok(!body.includes("feat/activity-rail"), "a folded section lists none of its rows");
  } finally { delete globalThis.localStorage; }
});

test("a folded section that holds one plan or goal says that item's own word, and with several it keeps its counts", () => {
  const summary = (markup, id) => /<span class="session-activity-heading-summary">(.*?)<\/span>/.exec(section(markup, id))?.[1];
  const failedPlan = { id: "plan-2", label: "Second plan", status: "failed", statusLabel: "Failed" };
  const failedGoal = { id: "goal-2", label: "Second goal", status: "failed", statusLabel: "Failed" };
  const one = withFolded([["plans"], ["goals", ["goal-1:running"]]], () => render({ plans: [plan],
    goals: [{ ...goal, foldedSummary: (fallback) => createElement("b", null, `${fallback}!`) }] }));
  assert.equal(summary(one, "plans"), "Approved");
  assert.equal(summary(one, "goals"), "<b>1 running!</b>", "a summary that has nothing of its own to say is handed the heading's counts");
  const several = withFolded([["plans", ["plan-2:failed"]], ["goals", ["goal-1:running", "goal-2:failed"]]], () => render({ plans: [plan, failedPlan],
    goals: [{ ...goal, foldedSummary: () => createElement("b", null, "never") }, failedGoal] }));
  assert.equal(summary(several, "plans"), "1 failed");
  assert.equal(summary(several, "goals"), "1 running · 1 failed", "one goal's word never stands for several");
  const unworded = withFolded([["plans", ["plan-3:running"]]], () => render({ plans: [{ id: "plan-3", label: "Plan", status: "running" }] }));
  assert.equal(summary(unworded, "plans"), "1 running", "a plan with no status word keeps the counts");
});

const steps = (...statuses) => ({ items: statuses.map((status) => ({ status })) });
const goalFacts = (state, proposal = {}) => goalRowFacts({ progress: null, reportState: "none", reportError: null, ...state }, { status: "approved", ...proposal });

test("a folded Goal heading reports a failed report first, then a finished goal, then how many steps are done", () => {
  assert.equal(goalFoldedSummaryKind(goalFacts({ reportState: "failed", progress: steps("completed", "completed") })), "failed");
  assert.equal(goalFoldedSummaryKind(goalFacts({ progress: steps("completed", "completed") })), "done");
  assert.equal(goalFoldedSummaryKind(goalFacts({}, { executionState: "completed" })), "done", "a goal the Host settled is done before its steps are read");
  const partial = goalFacts({ progress: steps("completed", "in_progress", "pending") }, { executionState: "running" });
  assert.deepEqual([goalFoldedSummaryKind(partial), partial.completed, partial.total], ["steps", 1, 3]);
  assert.equal(goalFoldedSummaryKind(goalFacts({}, { executionState: "running" })), "unknown", "nothing is said before the steps are known");
});

test("the Goal row and its folded heading read one report state: an unreadable report is unavailable, a failed or blocked one is not hidden by it", () => {
  assert.equal(goalFacts({ reportError: "boom" }).reportState, "unavailable");
  assert.equal(goalFacts({ reportError: "boom", reportState: "failed" }).reportState, "failed");
  const blocked = goalFacts({ reportError: "boom", reportState: "blocked" });
  assert.deepEqual([blocked.reportState, blocked.status], ["blocked", "degraded"]);
  assert.equal(goalFacts({ reportState: "ready" }, { executionState: "running" }).status, "running");
});

test("the folded Goal summary says Completed in the success colour for a finished goal and otherwise hands back the heading's counts", () => {
  const proposal = (executionState) => ({ id: "plan-1", sessionId: "a", title: "Goal", status: "approved", executionId: "exec-1", executionState });
  const folded = (executionState) => withI18n(createElement(GoalFoldedSummary, { sessionId: "a", proposal: proposal(executionState), visible: false, fallback: "1 running" }));
  assert.equal(folded("completed"), '<span data-tone="success">Completed</span>');
  assert.equal(folded("running"), "1 running");
});

test("the context section folds like the others and says its figure after the chevron, with a link to the dashboard", () => {
  const open = section(render({ contextUsage, onOpenContext() {} }), "context");
  assert.ok(open.includes("Context") && open.includes("Used 20%") && open.includes("~40K / 200K"));
  assert.ok(open.includes('aria-label="Open context dashboard"') && open.includes(">Details<"));
  assert.ok(!section(render({ contextUsage }), "context").includes(">Details<"), "no link without a way to open the dashboard");
  const key = "pi-desktop:activity-disclosure:v1:a:context";
  globalThis.localStorage = { getItem: (name) => name === key ? JSON.stringify({ open: false, attention: [] }) : null, setItem() {} };
  try {
    const folded = section(render({ contextUsage: { ...contextUsage, usage: usage(190_000) } }), "context");
    assert.ok(folded.includes('aria-expanded="false"') && folded.includes('<span data-tone="critical">Used 95%</span>'));
    assert.ok(!folded.includes("session-activity-context-bar"));
  } finally { delete globalThis.localStorage; }
});

test("token counts in the rail are written in 万 for Chinese and 萬 for Traditional Chinese, in full below ten thousand, and in K elsewhere", () => {
  assert.equal(formatActivityTokens(0, "zh-CN"), "0");
  assert.equal(formatActivityTokens(9_999, "zh-CN"), "9,999");
  assert.equal(formatActivityTokens(10_000, "zh-CN"), "1万");
  assert.equal(formatActivityTokens(12_345, "zh-CN"), "1.2万");
  assert.equal(formatActivityTokens(200_000, "zh-CN"), "20万");
  assert.equal(formatActivityTokens(1_250_000, "zh-CN"), "125万");
  for (const language of ["zh-TW", "zh-HK", "zh-Hant"]) assert.equal(formatActivityTokens(200_000, language), "20萬", language);
  for (const language of ["en", "de", "ko", "pt-BR"]) assert.equal(formatActivityTokens(200_000, language), "200K", language);
});

test("Chinese reads the rail's context under the 已使用 headline in 万, while the composer keeps the label it already had", () => {
  const detailed = activityContextView(usage(40_000), 200_000, "used",
    request([entry("system", 4_000), entry("tools", 4_000), entry("user", 12_000)]));
  const meter = withChinese(createElement(ActivityContextMeter, { view: detailed }));
  assert.ok(meter.includes("已使用 20%") && meter.includes("~4万 / 20万"));
  assert.ok(meter.includes("~4,000") && meter.includes("~1.2万") && meter.includes("16万"), "the legend and the free space use the same units");
  assert.equal(activityContextLabelKey("used"), "panel.activity.contextUsed");
  assert.equal(activityContextLabelKey("remaining"), contextUsageLabelKey("remaining"), "the other framing is still the composer's own word");
  const folded = withFolded([["context"]], () => section(renderChinese({ contextUsage: { ...contextUsage, usage: usage(190_000) } }), "context"));
  assert.ok(folded.includes('<span data-tone="critical">已使用 95%</span>'));
});

test("the changes section is one heading with the recorded totals and a link to the Review tab", () => {
  const body = section(render({ changes, onOpenReview() {} }), "changes");
  assert.ok(body.includes('data-activity-group="changes"') && body.includes('data-variant="section"'));
  assert.ok(body.includes("Changes") && body.includes("+159") && body.includes("−45"));
  assert.ok(!body.includes("aria-expanded") && !body.includes("session-activity-group-body"), "a heading that cannot fold has no body");
  assert.ok(body.includes('aria-label="Review · 3 recorded changes · +159 −45"') && body.includes(">Review<"));
  assert.ok(!section(render({ changes }), "changes").includes(">Review<"), "no link without a way to open the tab");
  assert.ok(section(render({ changes: { count: 1, additions: 2, deletions: 0 }, onOpenReview() {} }), "changes").includes("1 recorded change ·"));
});

test("the rail's link to the Review tab is worded 审查 in Chinese, as the canvas draws it", () => {
  const body = section(renderChinese({ changes, onOpenReview() {} }), "changes");
  assert.ok(body.includes(">审查<") && body.includes('aria-label="审查 · '));
});

test("each workspace section has one grip that names it", () => {
  const markup = render({ agents: [agent], ...workspace });
  for (const [id, name] of [["environment", "Environment"], ["context", "Context"], ["changes", "Changes"]]) {
    const body = section(markup, id);
    assert.equal(count(body, "data-activity-section-grip="), 1, `${id} has exactly one grip`);
    assert.ok(body.includes(`aria-label="Move section: ${name}"`), id);
  }
});

test("the workspace sections move with the rest when a person reorders the rail", () => {
  const content = { agents: [agent], ...workspace };
  activitySectionOrderStore.set(["changes", "context", "environment", "live", "goals", "plans", "artifacts", "skills"]);
  assert.deepEqual(ids(render(content)), ["changes", "context", "environment", "live"]);
  assert.ok(render(content).includes("Reset order"));
});

test("the dashboard opens where the person chose: beside the conversation by default, in a dialog when they picked that", () => {
  const opened = [];
  const openTab = (sessionId, tab) => { opened.push([sessionId, tab]); };
  openContextInsights("session-1", openTab);
  assert.deepEqual(opened, [["session-1", { id: "context", kind: "context" }]]);
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ placement: "modal" }), setItem() {} } };
  try {
    openContextInsights("session-2", openTab);
    assert.equal(opened.length, 1, "a modal preference opens no tab");
  } finally { delete globalThis.window; }
});
