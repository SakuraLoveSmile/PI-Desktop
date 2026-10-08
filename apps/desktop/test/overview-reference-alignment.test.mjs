import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

async function withModules(run) {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try { await run((path) => server.ssrLoadModule(`/src/components/workpanel/${path}`)); }
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
