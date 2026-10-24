import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

async function withModules(run) {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try { await run((path) => server.ssrLoadModule(path.startsWith("/") ? path : `/src/components/workpanel/${path}`)); }
  finally { await server.close(); }
}

const task = (id, extra = {}) => ({ taskId: id, teamSessionId: "lead", subject: id, status: "completed",
  revision: 1, ownerSessionId: "alex", blockedBy: [], writeScopes: [], deleted: false,
  createdAt: id, updatedAt: id, ...extra });
const member = { memberSessionId: "alex", teamSessionId: "lead", name: "researcher", phase: "idle",
  contextKind: "fresh", presentation: { role: "researcher", displayName: "Alex" } };

test("task panorama keeps repeated owners, dependencies, unassigned work and terminal states", async () => withModules(async (load) => {
  const { projectTeamPanorama } = await load("team/team-panorama-projection.ts");
  const snapshot = { members: [member], tasks: [task("1"), task("2", { blockedBy: ["1"] }),
    task("3", { status: "pending", blockedBy: ["2"], ownerSessionId: null }), task("4", { status: "failed" }),
    task("5", { status: "cancelled" }), task("6", { deleted: true })],
    readiness: [{ taskId: "3", unresolvedBlockedBy: ["2"] }], paused: false };
  const projected = projectTeamPanorama(snapshot, (key) => key);
  assert.deepEqual(projected.nodes.map(({ id, status }) => [id, status]), [["1", "completed"], ["2", "completed"], ["3", "blocked"], ["4", "failed"], ["5", "cancelled"]]);
  assert.equal(projected.nodes[0].avatarSeed, projected.nodes[1].avatarSeed);
  assert.equal(projected.nodes[2].name, "team.unassigned");
  assert.deepEqual(projected.edges, [{ from: "1", to: "2" }, { from: "2", to: "3" }]);
  assert.deepEqual(projected.targets.get("2"), { kind: "task", taskId: "2" });
  assert.equal(projected.targets.has("6"), false);
  assert.deepEqual(projectTeamPanorama({ ...snapshot, paused: true }, (key) => key).nodes.map((node) => node.status),
    ["completed", "completed", "paused", "failed", "cancelled"]);
  const noTasks = projectTeamPanorama({ ...snapshot, tasks: [], members: [{ ...member, phase: "provisioning" }] }, (key) => key);
  assert.equal(noTasks.nodes[0].status, "provisioning");
  assert.deepEqual(noTasks.targets.get("alex"), { kind: "member", memberSessionId: "alex" });
}));

test("dependency layout tiers tasks by real predecessors and keeps every card and edge", async () => withModules(async (load) => {
  const { createDependencyPanoramaLayout } = await load("agent-panorama-graph.ts");
  const dependencies = [{ from: "a", to: "d" }, { from: "b", to: "d" }, { from: "d", to: "e" }];
  const layout = createDependencyPanoramaLayout("lead", ["a", "b", "c", "d", "e"], dependencies);
  assert.equal(layout.width, 912);
  const nodes = new Map(layout.children.map((node) => [node.id, node]));
  assert.equal(new Set([nodes.get("a").y, nodes.get("b").y, nodes.get("c").y]).size, 1);
  assert.ok(nodes.get("d").y > nodes.get("a").y);
  assert.ok(nodes.get("e").y > nodes.get("d").y);
  assert.deepEqual(layout.edges, [{ from: "lead", to: "a" }, { from: "lead", to: "b" }, { from: "lead", to: "c" }, ...dependencies]);
  assert.equal(nodes.get("d").x, (layout.width - 276) / 2);
  const malformed = createDependencyPanoramaLayout("lead", ["a", "b", "c"], [
    { from: "a", to: "b" }, { from: "b", to: "a" }, { from: "gone", to: "c" }, { from: "c", to: "c" }]);
  assert.equal(malformed.children.length, 3);
  assert.equal(malformed.edges.length, 3);
  assert.ok(malformed.children.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
}));

test("Overview resources expose recorded facts without promoting attempts, claims or attachments to changes", async () => withModules(async (load) => {
  const { recordedOverviewResources } = await load("overview-recorded-resources.ts");
  const tool = (name, args, extra = {}) => ({ role: "tool", toolName: name, toolArgs: args, toolStatus: "success", ...extra });
  const resources = recordedOverviewResources([
    tool("Write", { path: "src/real.ts" }), tool("Edit", { path: "src/real.ts" }),
    tool("Write", { path: "failed.ts" }, { toolStatus: "error" }),
    tool("plugin_external_Write", { path: "unknown.ts" }), tool("Bash", { command: "touch shell.ts" }),
    tool("Skill", { id: "canvas" }), tool("mcp_browser_screenshot", {}),
    { role: "assistant", content: "I changed invented.ts and used memory" },
    { role: "user", skillMentions: [{ id: "review" }], attachments: [
      { ref: "uploads/image.png", name: "image.png", kind: "image" }, { ref: "another-session", kind: "session" }] },
  ]);
  assert.deepEqual(resources.changedFiles.map((item) => item.path), ["src/real.ts"]);
  assert.deepEqual(resources.attachments.map((item) => item.path), ["uploads/image.png"]);
  assert.deepEqual(resources.references.skills.map((item) => item.label), ["canvas", "review"]);
  assert.deepEqual(resources.references.mcp.map((item) => item.label), ["mcp_browser_screenshot"]);
  assert.deepEqual(resources.references.memory, []);
}));

test("Overview file rows lead with the file name and keep the folder as their detail", async () => withModules(async (load) => {
  const { overviewRowText } = await load("overview-recorded-resources.ts");
  assert.deepEqual(overviewRowText({ label: "apps/desktop/src/lib/webdav-probe.ts" }),
    { label: "webdav-probe.ts", detail: "apps/desktop/src/lib" });
  assert.deepEqual(overviewRowText({ label: "README.md" }), { label: "README.md" });
  assert.deepEqual(overviewRowText({ label: "src\\win\\a.ts" }), { label: "a.ts", detail: "src\\win" });
  assert.deepEqual(overviewRowText({ label: "/rooted.ts" }), { label: "/rooted.ts" });
  assert.deepEqual(overviewRowText({ label: "src/folder/" }), { label: "src/folder/" });
  assert.deepEqual(overviewRowText({ label: "docs/plan.md", detail: "Expert team plan" }),
    { label: "docs/plan.md", detail: "Expert team plan" });
}));

test("Overview subagent rows localize one outcome and give badge and panorama the same tone", async () => withModules(async (load) => {
  const { overviewSubagentBadgeClass, overviewSubagentLabelKey, overviewSubagentTone } = await load("overview-subagent-status.ts");
  assert.equal(overviewSubagentLabelKey("timed_out"), "panel.activity.status.timed_out");
  const outcomes = ["running", "completed", "stopped", "aborted", "timed_out", "failed", "denied"];
  assert.deepEqual(outcomes.map((status) => overviewSubagentTone(status)),
    ["running", "completed", "paused", "paused", "paused", "failed", "failed"]);
  assert.deepEqual(["running", "completed", "paused", "failed"].map((tone) => overviewSubagentBadgeClass(tone)),
    ["team-phase-running", "team-phase-completed", "team-phase-idle", "team-phase-failed"]);
}));

test("Overview renders a finished subagent with its localized badge label, not the raw status", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { OverviewTab } = await server.ssrLoadModule("/src/components/workpanel/OverviewTab.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const { catalogs } = await server.ssrLoadModule(fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)));
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const sessionId = "overview-subagent-session";
    Object.assign(useAppStore.getInitialState(), {
      activeSessionId: sessionId,
      sessions: [{ id: sessionId, title: "Subagents", source: "desktop", executionProfile: "default", providerId: "command",
        modelId: "model", mode: "chat", messageCount: 2, projectPath: "/project" }],
      providers: [{ id: "command", name: "command" }],
      messages: [{ id: "delegate", role: "tool", toolName: "Task", toolCallId: "call-delegate", toolStatus: "success",
        toolArgs: { agent: "researcher", task: "Check the range probe" } }],
    });
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(OverviewTab)));
    assert.ok(html.includes(">Completed</span>"), "the badge shows the localized outcome label");
    assert.equal(html.includes(">completed</span>"), false, "the raw status must not reach the badge");
  } finally {
    await server.close();
  }
});

// Recorded edits for the count and link assertions; a review payload is attached only when the test passes one.
const recordedEdit = (id, path, review) => ({ id, role: "tool", toolName: "Edit", toolStatus: "success", toolCallId: `${id}-call`,
  toolArgs: { path }, toolResult: { details: { root: "workspace", ...(review ? { review: { version: 1, snapshotId: "snapshot",
    messageId: id, path, operation: "edit", status: "modified", state: "active", reversible: true, hunks: [], ...review } } : {}) } } });

async function renderOverviewFor(messages) {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { OverviewTab } = await server.ssrLoadModule("/src/components/workpanel/OverviewTab.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const { catalogs } = await server.ssrLoadModule(fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)));
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const sessionId = "overview-recorded-session";
    Object.assign(useAppStore.getInitialState(), {
      activeSessionId: sessionId,
      sessions: [{ id: sessionId, title: "Recorded edits", source: "desktop", executionProfile: "default", providerId: "command",
        modelId: "model", mode: "chat", messageCount: messages.length, projectPath: "/project" }],
      providers: [{ id: "command", name: "command" }],
      messages,
    });
    return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(OverviewTab)));
  } finally {
    await server.close();
  }
}

test("Overview file glyphs follow the recorded extension and line counts stay exact-only", async () => withModules(async (load) => {
  const { overviewFileGlyph, overviewLineCounts } = await load("overview-file-meta.ts");
  assert.deepEqual(overviewFileGlyph("apps/index.html"), { text: "<>", tone: "markup" });
  assert.deepEqual(overviewFileGlyph("style.CSS"), { text: "#", tone: "plain" });
  assert.deepEqual(overviewFileGlyph("src/script.mjs"), { text: "JS", tone: "plain" });
  assert.deepEqual(overviewFileGlyph("src/view.tsx"), { text: "TS", tone: "plain" });
  assert.equal(overviewFileGlyph("notes.md"), null);
  assert.equal(overviewFileGlyph("docs/README"), null);
  assert.deepEqual(overviewLineCounts({ addedLines: 3, removedLines: 1 }), { added: 3, removed: 1 });
  assert.equal(overviewLineCounts({ addedLines: 0, removedLines: 0 }), null);
  assert.equal(overviewLineCounts({ addedLines: 3 }), null);
  assert.equal(overviewLineCounts(undefined), null);
}));

test("recorded edits total only when every edit carries exact counts", async () => withModules(async (load) => {
  const { activityChangedFiles } = await load("/src/features/chat/activity/session-activity-resources.ts");
  const [exact] = activityChangedFiles([recordedEdit("e1", "src/a.ts", { additions: 3, deletions: 1 }),
    recordedEdit("e2", "src/a.ts", { additions: 2, deletions: 0 })]);
  assert.deepEqual([exact.addedLines, exact.removedLines], [5, 1]);
  const [inexact] = activityChangedFiles([recordedEdit("e1", "src/a.ts", { additions: 3, deletions: 1 }),
    recordedEdit("e2", "src/a.ts")]);
  assert.equal(inexact.addedLines, undefined);
  assert.equal(inexact.removedLines, undefined);
}));

test("Overview shows exact recorded totals and offers the review link only when the review tab has entries", async () => {
  const exact = await renderOverviewFor([recordedEdit("e1", "src/a.ts", { additions: 3, deletions: 1 }),
    recordedEdit("e2", "src/a.ts", { additions: 2, deletions: 0 })]);
  assert.ok(exact.includes(">+5</span>"), "two exact edits show their summed additions");
  assert.ok(exact.includes(">−1</span>"), "and their summed deletions");
  assert.ok(exact.includes("View all changes"), "the review link is offered when the review tab has entries");
  const mixed = await renderOverviewFor([recordedEdit("e1", "src/a.ts", { additions: 3, deletions: 1 }),
    recordedEdit("e2", "src/a.ts")]);
  assert.equal(mixed.includes("diff-count-add"), false, "one inexact edit hides the total rather than showing a partial one");
  assert.ok(mixed.includes("View all changes"));
  const legacy = await renderOverviewFor([recordedEdit("e1", "src/a.ts")]);
  assert.equal(legacy.includes("View all changes"), false, "a file without review payloads gets no link to an empty tab");
  assert.ok(legacy.includes("a.ts"), "the recorded file still lists");
});

test("Overview omits a zero line-count side instead of rendering +0 or −0", async () => {
  const html = await renderOverviewFor([recordedEdit("e1", "src/b.ts", { additions: 4, deletions: 0 })]);
  assert.ok(html.includes(">+4</span>"), "the non-zero addition still shows");
  assert.equal(html.includes("diff-count-del"), false, "a zero deletion side is not rendered");
});

test("Overview marks non-team sessions with the plain chrome class", async () => {
  const html = await renderOverviewFor([]);
  assert.ok(html.includes('class="work-panel-overview work-panel-overview-plain"'));
});
