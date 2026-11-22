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
const { catalogs } = await server.ssrLoadModule("@pi-desktop/i18n");
const { SessionActivityRail } = await server.ssrLoadModule("/src/features/chat/activity/SessionActivityRail.tsx");
const { activitySectionOrderStore } = await server.ssrLoadModule("/src/features/chat/activity/use-activity-section-order.ts");
const { ActivitySectionGrip } = await server.ssrLoadModule("/src/features/chat/activity/ActivitySectionGrip.tsx");
const { activityRailVisibility } = await server.ssrLoadModule("/src/features/chat/activity/activity-rail-visibility.ts");
const { ActivityRowStatus, activityRowState } = await server.ssrLoadModule("/src/features/chat/activity/ActivityRowStatus.tsx");
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });

// The order store is a renderer-wide singleton; every case starts from the default order.
afterEach(() => activitySectionOrderStore.reset());

const baseProps = { sessionId: "a", visible: true, plans: [], goals: [], agents: [], outputs: [], sources: [], processes: [],
  processesLoading: false, onRefreshProcesses() {}, onOpenProcess() {}, supported: true };
// Stands in for SessionSkillSuggestions, which renders the section's grip inside its own heading.
const suggestions = createElement("section", { className: "session-skill-suggestions" },
  createElement("div", { className: "session-skill-suggestions-heading" }, createElement(ActivitySectionGrip)), createElement("p", null, "skills-body"));
const render = (props) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SessionActivityRail, { ...baseProps, ...props })));
/** The rail's sections in document order, each with the markup it owns. */
const sections = (markup) => markup.split('data-activity-section="').slice(1).map((chunk) => ({ id: chunk.slice(0, chunk.indexOf('"')), markup: chunk }));
const ids = (markup) => sections(markup).map((section) => section.id);
const section = (markup, id) => sections(markup).find((candidate) => candidate.id === id)?.markup ?? "";

const goal = { id: "goal-1", label: "Ship the importer", status: "running", statusLabel: "Running" };
const plan = { id: "plan-1", label: "Cleanup plan", status: "approved", statusLabel: "Approved" };
const agent = { id: "agent-1", label: "explore", detail: "Map the rail", status: "running", statusLabel: "Running" };
const output = { id: "output-1", label: "report.md", path: "report.md" };
const source = { id: "source-1", label: "docs.example.com" };
const emptyHint = "Subagents and background processes appear here as they make progress.";

test("the rail lists goals, plans, live status, artifacts and skills as separate sections in that order", () => {
  const markup = render({ goals: [goal], plans: [plan], agents: [agent], outputs: [output], suggestions });
  assert.deepEqual(ids(markup), ["goals", "plans", "live", "artifacts", "skills"]);
});

test("a goal belongs to the goals section and a plan to the plans section, never both", () => {
  const markup = render({ goals: [goal], plans: [plan] });
  assert.ok(section(markup, "goals").includes("Ship the importer"));
  assert.ok(!section(markup, "goals").includes("Cleanup plan"));
  assert.ok(section(markup, "plans").includes("Cleanup plan"));
  assert.ok(!section(markup, "plans").includes("Ship the importer"));
  assert.ok(section(markup, "goals").includes('data-activity-group="goals"'));
  assert.ok(section(markup, "plans").includes('data-activity-group="plans"'));
});

test("a section with nothing to show is left out, so each kind of content brings only its own section", () => {
  assert.deepEqual(ids(render({ goals: [goal] })), ["goals"]);
  assert.deepEqual(ids(render({ plans: [plan] })), ["plans"]);
  assert.deepEqual(ids(render({ agents: [agent] })), ["live"]);
  assert.deepEqual(ids(render({ outputs: [output] })), ["artifacts"]);
  assert.deepEqual(ids(render({ sources: [source] })), ["artifacts"]);
});

test("an empty rail keeps one hint line in the live section and nothing else", () => {
  const empty = render({});
  assert.deepEqual(ids(empty), ["live"]);
  assert.ok(section(empty, "live").includes(emptyHint));
  assert.ok(!empty.includes('data-activity-group="agents"') && !empty.includes('data-activity-group="processes"'));
  assert.deepEqual(ids(render({ suggestions, suggestionsHaveRows: false })), ["live", "skills"]);
  const withSkills = render({ suggestions, suggestionsHaveRows: true });
  assert.deepEqual(ids(withSkills), ["skills"]);
  assert.ok(!withSkills.includes(emptyHint));
});

test("a live section opens only the groups that have something to show", () => {
  const live = section(render({ agents: [agent] }), "live");
  assert.ok(live.includes('data-activity-group="agents"'));
  assert.ok(!live.includes('data-activity-group="team-members"') && !live.includes('data-activity-group="processes"'));
  assert.ok(!live.includes(emptyHint));
  const unsupported = section(render({ agents: [agent], supported: false }), "live");
  assert.ok(unsupported.includes('data-activity-group="processes"') && unsupported.includes("Available for local Desktop sessions only"));
});

test("a notice that only says activity is still loading never opens an empty group", () => {
  const loading = createElement("p", null, "still-loading");
  const pending = render({ agentsNotice: loading, resourcesNotice: loading, pendingNotices: { activity: true } });
  assert.deepEqual(ids(pending), ["live"]);
  assert.ok(!pending.includes("still-loading") && section(pending, "live").includes(emptyHint));
  const failed = render({ agentsNotice: loading, resourcesNotice: loading, pendingNotices: {} });
  assert.deepEqual(ids(failed), ["live", "artifacts"]);
  assert.equal(failed.split("still-loading").length - 1, 2);
});

test("outputs are listed under artifacts without opening anything, and sources stay folded until opened", () => {
  const artifacts = section(render({ outputs: [output], sources: [source] }), "artifacts");
  assert.ok(artifacts.includes("report.md"));
  assert.ok(artifacts.includes('data-activity-group="outputs"'));
  assert.ok(artifacts.includes('aria-expanded="true"'));
  const folded = artifacts.slice(artifacts.indexOf('data-activity-group="sources"'));
  assert.ok(folded.includes('aria-expanded="false"'));
  assert.ok(!artifacts.includes("docs.example.com"));
});

test("a goal row that still arrives through the plans prop renders under plans as before", () => {
  const markup = render({ plans: [{ id: "goal", label: "Goal", content: createElement("output", null, "5/8 · Report degraded") }], supported: false });
  assert.ok(section(markup, "plans").includes("5/8 · Report degraded"));
  assert.ok(!markup.includes('data-activity-section="goals"'));
});

test("every section heading carries one grip that names its section", () => {
  const markup = render({ goals: [goal], plans: [plan], agents: [agent], outputs: [output], suggestions });
  for (const [id, name] of [["goals", "Goal"], ["plans", "Plan"], ["live", "Live status"], ["artifacts", "Artifacts"]]) {
    const body = section(markup, id);
    assert.equal(body.split("data-activity-section-grip=").length - 1, 1, `${id} has exactly one grip`);
    assert.ok(body.includes(`data-activity-section-grip="${id}"`), id);
    assert.ok(body.includes(`aria-label="Move section: ${name}"`), id);
  }
  assert.equal(section(markup, "skills").split("data-activity-section-grip=").length - 1, 1);
  assert.equal(markup.split("data-activity-section-grip=").length - 1, 5);
});

test("each grip is described by the one hint that explains dragging and the arrow keys", () => {
  const markup = render({ goals: [goal], plans: [plan], agents: [agent], outputs: [output], suggestions });
  const hint = /<p id="([^"]+)" hidden="">Drag to reorder, or press ↑ ↓<\/p>/.exec(markup);
  assert.ok(hint, "the hint is rendered once for assistive technology");
  assert.equal(markup.split(`aria-describedby="${hint[1]}"`).length - 1, 5);
});

test("a section heading is its toggle followed by the grip, and a nested group heading adds a count", () => {
  const goals = section(render({ goals: [goal] }), "goals");
  assert.ok(goals.indexOf("session-activity-disclosure") >= 0 && goals.indexOf("session-activity-grip") > goals.indexOf("session-activity-disclosure"));
  assert.ok(!goals.includes("session-activity-group-count"), "a section heading has no count");
  const live = section(render({ agents: [agent] }), "live");
  const nested = live.slice(live.indexOf('data-variant="sub"'));
  assert.ok(nested.indexOf("session-activity-group-title") < nested.indexOf("session-activity-group-count"));
});

test("a folded section summarises itself after its chevron", () => {
  const key = "pi-desktop:activity-disclosure:v1:a:artifacts";
  globalThis.localStorage = { getItem: (name) => name === key ? JSON.stringify({ open: false, attention: [] }) : null, setItem() {} };
  try {
    const artifacts = section(render({ outputs: [output, { ...output, id: "output-2", label: "notes.md", path: "notes.md" }] }), "artifacts");
    assert.ok(artifacts.includes('aria-expanded="false"'));
    assert.ok(artifacts.includes('<span class="session-activity-heading-summary">2</span>'));
    assert.ok(!artifacts.includes("report.md"), "a folded section lists none of its rows");
  } finally { delete globalThis.localStorage; }
});

test("a chosen order lays the sections out in that order and offers a reset until it is the default again", () => {
  const content = { goals: [goal], plans: [plan], agents: [agent], outputs: [output], suggestions };
  assert.ok(!render(content).includes("Reset order"));
  activitySectionOrderStore.set(["live", "plans", "goals", "artifacts", "skills"]);
  const markup = render(content);
  assert.deepEqual(ids(markup), ["live", "plans", "goals", "artifacts", "skills"]);
  assert.ok(markup.includes("Reset order"));
  activitySectionOrderStore.reset();
  const restored = render(content);
  assert.deepEqual(ids(restored), ["goals", "plans", "live", "artifacts", "skills"]);
  assert.ok(!restored.includes("Reset order"));
});

test("sections that are not shown keep their slot in the chosen order without moving the shown ones", () => {
  activitySectionOrderStore.set(["skills", "artifacts", "live", "plans", "goals"]);
  assert.deepEqual(ids(render({ plans: [plan], agents: [agent] })), ["live", "plans"]);
  assert.deepEqual(ids(render({ goals: [goal], plans: [plan], outputs: [output], suggestions })), ["skills", "artifacts", "plans", "goals"]);
});

test("a failed goal is listed under needs attention and points at the goals group", () => {
  const markup = render({ goals: [{ ...goal, status: "failed", statusLabel: "Failed" }], plans: [plan] });
  assert.ok(markup.includes("Needs attention"));
  assert.ok(markup.includes("Ship the importer"));
});

test("a row's status spins while it runs, shows a check once done and is written out only when it needs attention", () => {
  const status = (value, label) => renderToStaticMarkup(createElement(ActivityRowStatus, { status: value, label }));
  const running = status("running", "Running");
  assert.ok(running.includes('data-state="active"') && running.includes("session-activity-spinner") && !running.includes(">Running<"));
  const done = status("completed", "Completed");
  assert.ok(done.includes('data-state="done"') && done.includes("<svg") && !done.includes(">Completed<"));
  const timedOut = status("timed_out", "Timed out");
  assert.ok(timedOut.includes('data-state="attention"') && timedOut.includes('data-tone="warning"') && timedOut.includes(">Timed out<"));
  const failed = status("failed", "Failed");
  assert.ok(failed.includes('data-state="attention"') && failed.includes('data-tone="error"') && failed.includes(">Failed<"));
  const approved = status("approved", "Approved");
  assert.ok(approved.includes('data-state="idle"') && approved.includes(">Approved<"));
  assert.deepEqual(["starting", "completed", "blocked", "stopped"].map(activityRowState), ["active", "done", "attention", "idle"]);
});

test("the rail's visibility follows the content: notices count, loading hints and skill rows do not decide a section", () => {
  const none = { goals: 0, plans: 0, agents: 0, teamMembers: 0, processes: 0, outputs: 0, sources: 0, processesNotice: false, teamNotice: false,
    agentsNotice: false, resourcesNotice: false, rangeNotice: false, suggestions: false, suggestionsHaveRows: false };
  assert.deepEqual(activityRailVisibility(none), { goals: false, plans: false, live: true, artifacts: false, skills: false, team: false, processes: false, emptyHint: true });
  const withTeam = activityRailVisibility({ ...none, teamMembers: 2 });
  assert.deepEqual([withTeam.live, withTeam.team, withTeam.processes, withTeam.emptyHint], [true, true, false, false]);
  const processNotice = activityRailVisibility({ ...none, processesNotice: true });
  assert.deepEqual([processNotice.live, processNotice.processes, processNotice.emptyHint], [true, true, false]);
  const sourcesOnly = activityRailVisibility({ ...none, sources: 1 });
  assert.deepEqual([sourcesOnly.artifacts, sourcesOnly.live, sourcesOnly.emptyHint], [true, false, false]);
  const range = activityRailVisibility({ ...none, rangeNotice: true });
  assert.deepEqual([range.live, range.emptyHint], [true, false]);
  const goalOnly = activityRailVisibility({ ...none, goals: 1 });
  assert.deepEqual([goalOnly.goals, goalOnly.live, goalOnly.emptyHint], [true, false, false]);
  const skillsHeaderOnly = activityRailVisibility({ ...none, suggestions: true });
  assert.deepEqual([skillsHeaderOnly.skills, skillsHeaderOnly.live, skillsHeaderOnly.emptyHint], [true, true, true]);
  const skillsWithRows = activityRailVisibility({ ...none, suggestions: true, suggestionsHaveRows: true });
  assert.deepEqual([skillsWithRows.skills, skillsWithRows.live, skillsWithRows.emptyHint], [true, false, false]);
});

test("a partly loaded transcript says so in each section that lists transcript-derived rows", () => {
  const notice = "session-activity-range-notice";
  const markup = render({ agents: [agent], outputs: [output], rangeLimited: true, hasMoreBefore: true, onLoadEarlier() {} });
  assert.ok(section(markup, "live").includes(notice));
  assert.ok(section(markup, "artifacts").includes(notice));
  assert.equal(markup.split(notice).length - 1, 2);
  const bare = render({ rangeLimited: true });
  assert.deepEqual(ids(bare), ["live"]);
  assert.ok(section(bare, "live").includes(notice) && !bare.includes(emptyHint));
});
