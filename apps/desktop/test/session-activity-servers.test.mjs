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
const { serverAddress, splitServerProcesses } = await activity("activity-server-rows.ts");
const { backgroundProcessName, backgroundProcessTitle } = await activity("activity-rail-presentation.ts");
const { activityRailVisibility } = await activity("activity-rail-visibility.ts");
const { ACTIVITY_SECTION_IDS, mergeActivitySectionOrder } = await activity("activity-section-order.ts");
const { SessionActivityRail } = await activity("SessionActivityRail.tsx");
const { activitySectionOrderStore } = await activity("use-activity-section-order.ts");
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });

afterEach(() => activitySectionOrderStore.reset());

const withI18n = (element) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const baseProps = { sessionId: "a", visible: true, plans: [], goals: [], agents: [], outputs: [], sources: [], processes: [],
  processesLoading: false, onRefreshProcesses() {}, onOpenProcess() {}, supported: true };
const render = (props) => withI18n(createElement(SessionActivityRail, { ...baseProps, ...props }));
const sections = (markup) => markup.split('data-activity-section="').slice(1).map((chunk) => ({ id: chunk.slice(0, chunk.indexOf('"')), markup: chunk }));
const ids = (markup) => sections(markup).map((candidate) => candidate.id);
const section = (markup, id) => sections(markup).find((candidate) => candidate.id === id)?.markup ?? "";
const count = (markup, needle) => markup.split(needle).length - 1;
const proc = (id, command, over = {}) => ({ id, sessionId: "a", toolCallId: `call-${id}`, command, cwd: "/work/app", status: "running",
  startedAt: "2026-11-22T00:00:00.000Z", ...over });

test("only the exact origin the Host sends is an address: a loopback host, an explicit port, nothing else", () => {
  assert.deepEqual(serverAddress("http://localhost:3000"), { display: "localhost:3000", url: "http://localhost:3000/" });
  assert.deepEqual(serverAddress("https://127.0.0.1:8443"), { display: "127.0.0.1:8443", url: "https://127.0.0.1:8443/" });
  assert.deepEqual(serverAddress("http://127.0.0.2:4000"), { display: "127.0.0.2:4000", url: "http://127.0.0.2:4000/" });
  assert.deepEqual(serverAddress("http://[::1]:5173"), { display: "[::1]:5173", url: "http://[::1]:5173/" });
  assert.deepEqual(serverAddress("http://localhost:65535"), { display: "localhost:65535", url: "http://localhost:65535/" });
  for (const value of [undefined, null, 3000, "", "localhost:3000", "http://localhost", "http://localhost/", "http://localhost:3000/",
    "http://localhost:3000/lab?token=x", "http://localhost:3000?x=1", "http://localhost:0", "http://localhost:03000", "http://localhost:65536",
    "http://localhost:3000@evil.test", "http://user:pw@localhost:3000", "http://localhost.evil.test:3000", "http://evil.test:3000",
    "http://192.168.1.5:3000", "http://128.0.0.1:3000", "http://127.0.0.256:3000", "http://127.0.0.01:3000", "http://0.0.0.0:3000",
    "http://[::]:3000", "ftp://localhost:3000", "ws://localhost:3000", "HTTP://localhost:3000", "http://localhost:3000\n",
    `http://localhost:3000${" ".repeat(64)}`]) {
    assert.equal(serverAddress(value), null, String(value));
  }
});

test("a running process with an address is a server whatever its kind; every other process stays where it was", () => {
  const dev = proc("dev", "pnpm dev --port 3000", { address: "http://localhost:3000" });
  const service = proc("svc", "node api.js", { backgroundKind: "service", address: "http://127.0.0.1:8080" });
  const worker = proc("worker", "node worker.js", { backgroundKind: "service" });
  const plain = proc("watch", "pnpm test --watch");
  const stopping = proc("old", "vite", { status: "stopping", address: "http://localhost:5173" });
  const ended = proc("done", "vite", { status: "stopped", address: "http://localhost:5173" });
  const starting = proc("new", "vite", { status: "starting", address: "http://localhost:5173" });
  const foreign = proc("other", "vite", { sessionId: "b", address: "http://localhost:5173" });
  const forged = proc("forged", "node x.js", { address: "http://evil.test:80" });
  const { servers, rest } = splitServerProcesses([dev, service, worker, plain, stopping, ended, starting, foreign, forged], "a");
  assert.deepEqual(servers.map((item) => [item.id, item.name, item.display, item.status]), [
    ["dev", "pnpm dev", "localhost:3000", "running"],
    ["svc", "api.js", "127.0.0.1:8080", "running"],
    ["old", "vite", "localhost:5173", "stopping"],
  ]);
  assert.deepEqual(rest.map((item) => item.id), ["worker", "watch", "done", "new", "other", "forged"]);
  assert.equal(servers[0].url, "http://localhost:3000/");
  assert.equal(servers[0].command, "pnpm dev --port 3000");
  assert.equal(servers[0].cwd, "/work/app");
});

test("the server's name drops the port the address already shows, and the row title keeps it", () => {
  assert.equal(backgroundProcessName("pnpm dev --port 3000"), "pnpm dev");
  assert.equal(backgroundProcessTitle("pnpm dev --port 3000"), "pnpm dev · :3000");
  assert.equal(backgroundProcessName("PORT=8080 node server.js"), "server.js");
  assert.equal(backgroundProcessTitle("PORT=8080 node server.js"), "server.js · :8080");
  assert.equal(backgroundProcessName("vite"), "vite");
  assert.equal(backgroundProcessTitle("vite"), "vite");
  assert.equal(backgroundProcessName("   "), "");
});

test("servers get their own section right after Live, and a saved order that never saw it keeps its place around it", () => {
  assert.equal(ACTIVITY_SECTION_IDS[ACTIVITY_SECTION_IDS.indexOf("live") + 1], "server");
  const before = ["environment", "goals", "plans", "live", "context", "artifacts", "skills", "changes"];
  assert.deepEqual(mergeActivitySectionOrder(before), ["environment", "goals", "plans", "live", "server", "context", "artifacts", "skills", "changes"]);
  const markup = render({ agents: [{ id: "explore", label: "explore", status: "running", statusLabel: "Running" }],
    processes: [proc("dev", "pnpm dev --port 3000", { address: "http://localhost:3000" })] });
  assert.deepEqual(ids(markup), ["live", "server"]);
});

test("a server is listed once, under Servers, with its name, its address and a stop that names it", () => {
  const markup = render({ onOpenServerAddress() {}, onStopServer() {},
    processes: [proc("dev", "pnpm dev --port 3000", { address: "http://localhost:3000" }), proc("watch", "pnpm test --watch")] });
  assert.deepEqual(ids(markup), ["live", "server"]);
  const servers = section(markup, "server");
  assert.match(servers, /Servers/);
  assert.match(servers, /session-activity-server-name[^>]*>pnpm dev</);
  assert.match(servers, /session-activity-server-address[^>]*aria-label="Open localhost:3000"[^>]*>localhost:3000</);
  assert.match(servers, /session-activity-server-stop[^>]*aria-label="Stop pnpm dev"/);
  assert.match(servers, /aria-label="View process · pnpm dev"/);
  assert.equal(count(servers, 'data-server-id="'), 1);
  const live = section(markup, "live");
  assert.equal(count(live, "data-process-id="), 1);
  assert.match(live, /data-process-id="watch"/);
  assert.doesNotMatch(live, /data-process-id="dev"/);
  assert.doesNotMatch(live, /localhost:3000/);
});

test("a rail with only a server shows no empty hint and no Live section", () => {
  const markup = render({ onStopServer() {}, processes: [proc("dev", "vite", { address: "http://localhost:5173" })] });
  assert.deepEqual(ids(markup), ["server"]);
  assert.doesNotMatch(markup, /Subagents and background processes appear here/);
  const visibility = activityRailVisibility({ goals: 0, plans: 0, agents: 0, teamMembers: 0, processes: 0, outputs: 0, sources: 0, servers: 1,
    processesNotice: false, teamNotice: false, agentsNotice: false, resourcesNotice: false, rangeNotice: false, suggestions: false, suggestionsHaveRows: false });
  assert.deepEqual([visibility.live, visibility.emptyHint], [false, false]);
});

test("a server whose stop is under way offers no stop and shows the stopping spinner", () => {
  const up = section(render({ onStopServer() {}, processes: [proc("dev", "vite", { address: "http://localhost:5173" })] }), "server");
  assert.equal(count(up, "session-activity-server-stop"), 1);
  assert.equal(count(up, "session-activity-spinner"), 0);
  for (const markup of [
    render({ onStopServer() {}, stoppingServers: new Set(["dev"]), processes: [proc("dev", "vite", { address: "http://localhost:5173" })] }),
    render({ onStopServer() {}, processes: [proc("dev", "vite", { status: "stopping", address: "http://localhost:5173" })] }),
  ]) {
    const servers = section(markup, "server");
    assert.equal(count(servers, "session-activity-server-stop"), 0);
    assert.equal(count(servers, "session-activity-spinner"), 1);
    assert.match(servers, /aria-label="Stopping"/);
    assert.match(servers, /session-activity-server-end/);
  }
});

test("without handlers the section is read-only: the address is text and there is nothing to press but the name", () => {
  const servers = section(render({ processes: [proc("dev", "vite", { address: "http://localhost:5173" })] }), "server");
  assert.match(servers, /<span class="session-activity-server-address" data-static="true">localhost:5173<\/span>/);
  assert.equal(count(servers, "session-activity-server-stop"), 0);
  assert.equal(count(servers, "<button"), 3, "the heading's disclosure and grip, and the name");
});

test("a process of another session, an ended one and a forged address never reach the section", () => {
  const markup = render({ processes: [proc("x", "vite", { sessionId: "b", address: "http://localhost:5173" }),
    proc("y", "vite", { status: "completed", address: "http://localhost:5173" }), proc("z", "vite", { address: "http://localhost.evil.test:5173" })] });
  assert.equal(ids(markup).includes("server"), false);
  assert.match(markup, /data-process-id="z"/);
});

test("a server's details open under its own row, so opening them adds no empty Live status section", () => {
  const detail = createElement("div", { "data-test-detail": "yes" }, "DETAILS");
  const address = "http://localhost:5173";
  const only = render({ processDetails: detail, selectedProcessId: "dev", processes: [proc("dev", "vite", { address })] });
  assert.deepEqual(ids(only), ["server"]);
  assert.equal(count(section(only, "server"), 'data-test-detail="yes"'), 1);
  // Another process's details stay under Background processes, beside a server that is not the one asked about.
  const mixed = render({ processDetails: detail, selectedProcessId: "watch", processes: [proc("dev", "vite", { address }), proc("watch", "pnpm test --watch")] });
  assert.equal(count(section(mixed, "server"), "data-test-detail"), 0);
  assert.equal(count(section(mixed, "live"), 'data-test-detail="yes"'), 1);
  // A server that has ended is an ordinary process again, and so are the details of a process nobody named.
  const ended = render({ processDetails: detail, selectedProcessId: "dev", processes: [proc("dev", "vite", { status: "stopped", address })] });
  assert.deepEqual(ids(ended), ["live"]);
  assert.equal(count(section(ended, "live"), 'data-test-detail="yes"'), 1);
  const unnamed = render({ processDetails: detail, processes: [proc("dev", "vite", { address })] });
  assert.equal(count(section(unnamed, "server"), "data-test-detail"), 0);
  assert.equal(count(section(unnamed, "live"), 'data-test-detail="yes"'), 1);
  // Folding Servers folds its details with it, as folding Live status folds the details it holds.
  assert.equal(count(section(render({ processes: [proc("dev", "vite", { address })] }), "server"), "data-test-detail"), 0);
});
