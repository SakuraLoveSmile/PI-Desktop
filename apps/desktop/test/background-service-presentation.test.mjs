import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, logLevel: "silent",
  server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" },
  appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: [
    { find: /^@pi-desktop\/shared$/, replacement: fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)) },
    { find: /^@pi-desktop\/i18n$/, replacement: fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)) },
  ] },
});
after(() => server.close());
const { catalogs } = await server.ssrLoadModule("@pi-desktop/i18n");
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en }, "zh-CN": { translation: catalogs["zh-CN"] } } });
const render = (element) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const process = {
  id: "service-1", sessionId: "owner-1", toolCallId: "bash-1", command: "node preview.mjs", cwd: "/fixture",
  status: "running", startedAt: "2026-10-11T00:00:00Z", backgroundKind: "service",
  teamSessionId: "team-1", teamRunId: "run-1", deadlineAt: "2026-10-11T06:00:00Z", stopMode: "unix-term-then-kill",
};

test("service details show ownership, deadline and declared stop policy without inventing a stop result", async () => {
  const { BackgroundServiceMetadata } = await server.ssrLoadModule("/src/features/chat/activity/BackgroundServiceMetadata.tsx");
  const html = render(createElement(BackgroundServiceMetadata, { process }));
  for (const value of ["Service", "owner-1", "team-1", "run-1", 'dateTime="2026-10-11T06:00:00Z"', "TERM, then KILL after up to 5 seconds"]) {
    assert.ok(html.includes(value), value);
  }
  assert.ok(!html.includes("Escalated to KILL"));
  assert.ok(!html.includes("Stopped after TERM"));
  assert.equal(render(createElement(BackgroundServiceMetadata, { process: { ...process, backgroundKind: undefined } })), "");
});

test("a paused service retains its reason and truthful Unix or Windows stop outcome", async () => {
  const { BackgroundServiceMetadata } = await server.ssrLoadModule("/src/features/chat/activity/BackgroundServiceMetadata.tsx");
  const stopped = { ...process, status: "stopped", stopReason: "team_paused", stopRequestedAt: "2026-10-11T00:01:00Z" };
  const unix = render(createElement(BackgroundServiceMetadata, { process: { ...stopped, serviceStopEscalated: true } }));
  assert.ok(unix.includes("Team paused"));
  assert.ok(unix.includes("Escalated to KILL"));
  assert.ok(unix.includes('dateTime="2026-10-11T00:01:00Z"'));
  const graceful = render(createElement(BackgroundServiceMetadata, { process: { ...stopped, serviceStopEscalated: false } }));
  assert.ok(graceful.includes("Stopped after TERM"));
  const windows = render(createElement(BackgroundServiceMetadata, { process: { ...stopped, stopMode: "windows-job-force", serviceStopEscalated: false } }));
  assert.ok(windows.includes("Force stop with Windows JobObject"));
  assert.ok(!windows.includes("Stopped after TERM"));
  await i18n.changeLanguage("zh-CN");
  const chinese = render(createElement(BackgroundServiceMetadata, { process: { ...stopped, serviceStopEscalated: true } }));
  assert.ok(chinese.includes("团队已暂停"));
  assert.ok(chinese.includes("升级为 KILL"));
  await i18n.changeLanguage("en");
});

test("an interrupted historical service shows recorded metadata without claiming its shutdown policy completed", async () => {
  const { BackgroundServiceMetadata } = await server.ssrLoadModule("/src/features/chat/activity/BackgroundServiceMetadata.tsx");
  const historical = { ...process, status: "interrupted", endedAt: "2026-10-11T01:00:00Z", stopReason: "host_restart" };
  const html = render(createElement(BackgroundServiceMetadata, { process: historical }));
  assert.ok(html.includes("Interrupted by Host restart"));
  assert.ok(html.includes("owner-1"));
  assert.ok(html.includes("team-1"));
  assert.ok(html.includes("run-1"));
  assert.ok(html.includes('dateTime="2026-10-11T06:00:00Z"'));
  assert.ok(!html.includes("Escalated to KILL"));
  assert.ok(!html.includes("Stopped after TERM"));
  const unknownPlatform = render(createElement(BackgroundServiceMetadata, {
    process: { ...historical, stopMode: undefined, serviceStopEscalated: true },
  }));
  assert.ok(unknownPlatform.includes("Interrupted by Host restart"));
  assert.ok(!unknownPlatform.includes("Escalated to KILL"));
  assert.ok(!unknownPlatform.includes("Stopped after TERM"));
  assert.ok(!unknownPlatform.includes("TERM, then KILL"));
  assert.ok(!unknownPlatform.includes("Force stop with Windows JobObject"));
  const ordinary = { ...historical, backgroundKind: "command" };
  assert.equal(render(createElement(BackgroundServiceMetadata, { process: ordinary })), "");
});

test("the Activity process entry identifies services and keeps legacy command titles unchanged", async () => {
  const { SessionActivityRail } = await server.ssrLoadModule("/src/features/chat/activity/SessionActivityRail.tsx");
  const props = { sessionId: "owner-1", visible: true, plans: [], agents: [], outputs: [], sources: [],
    processesLoading: false, onRefreshProcesses() {}, onOpenProcess() {}, supported: true };
  const service = render(createElement(SessionActivityRail, { ...props, processes: [process] }));
  assert.ok(service.includes("Service · preview.mjs"));
  const command = render(createElement(SessionActivityRail, { ...props, processes: [{ ...process, backgroundKind: undefined }] }));
  assert.ok(command.includes("preview.mjs"));
  assert.ok(!command.includes("Service · preview.mjs"));
  const explicitCommand = render(createElement(SessionActivityRail, { ...props, processes: [{ ...process, backgroundKind: "command" }] }));
  assert.equal(explicitCommand, command);
});
