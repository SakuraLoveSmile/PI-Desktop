#!/usr/bin/env node
/** E2E-GOAL-BLOCKED-UI-001: real Goal card, Composer, store and native readers. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { IPC } from "../packages/shared/dist/index.js";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const temp = await mkdtemp(join(tmpdir(), "pi-goal-blocked-ui-"));
const evidence = join(root, ".review-evidence");
try {
  await mkdir(evidence, { recursive: true });
  await build({ entryPoints: [join(root, "scripts/e2e/goal-blocked-ui.tsx")], outfile: join(temp, "renderer.js"),
    bundle: true, platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
    plugins: [{ name: "fixture-url-assets", setup(builder) {
      builder.onResolve({ filter: /\?url$/ }, (args) => ({ path: resolve(dirname(args.importer), args.path.slice(0, -4)), namespace: "fixture-url" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-url" }, async ({ path }) => {
        const name = basename(path); await cp(path, join(temp, name));
        return { contents: `export default ${JSON.stringify(`./${name}`)}`, loader: "js" };
      });
    } }],
    alias: { "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"),
      "@pi-desktop/shared/changelog-loader": join(root, "packages/shared/src/changelog-loader.ts"),
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      "@pi-desktop/i18n/locale-info": join(root, "packages/i18n/src/locale-info.ts"),
      ...Object.fromEntries(["en", "zh-CN", "zh-TW", "tr", "de", "es", "fr", "ko", "pt-BR"].map((locale) =>
        [`@pi-desktop/i18n/locales/${locale}`, join(root, `packages/i18n/src/locales/${locale}/index.ts`)])),
      "@pi-desktop/voice-runtime/live": join(root, "packages/voice-runtime/src/live/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"), "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
      i18next: join(root, "apps/desktop/node_modules/i18next"), "react-i18next": join(root, "apps/desktop/node_modules/react-i18next") },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  const renderer = join(root, "apps/desktop/out/renderer");
  const html = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...html.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
  assert(css.length, "Run pnpm build:js before this test");
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  await writeFile(join(temp, "index.html"), `<!doctype html><html data-platform="darwin"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:">${css.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}<style>body{overflow:auto}.e2e-goal-surface{max-width:880px;margin:0 auto;padding:20px;box-sizing:border-box}.e2e-goal-surface .chat-message-content{margin:16px 0}.e2e-goal-surface .composer-dock{position:relative;left:auto;right:auto;bottom:auto;width:100%}.e2e-goal-surface .composer{width:100%}</style></head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>`);
  await writeFile(join(temp, "preload.cjs"), `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("piDesktop", { platform: "darwin", locale: "en-US",
  invoke: (channel, ...args) => ipcRenderer.invoke("fixture:invoke", channel, ...args),
  on: (channel, listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); }
});`);
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path"); const fs = require("node:fs/promises");
const IPC = ${JSON.stringify(IPC)}; const evidence = ${JSON.stringify(evidence)};
app.setPath("userData", path.join(__dirname, "profile"));
let win, counter = 0, fixture, calls = [], failResume = false;
const events = () => {
  win.webContents.send(IPC.event.goalExecutionChanged, { sessionId: fixture.session.id, executionId: fixture.execution.id });
  win.webContents.send(IPC.event.goalReportChanged, { sessionId: fixture.session.id, executionId: fixture.execution.id });
};
const reset = (remote) => {
  counter++; calls = []; failResume = false;
  const sessionId = (remote ? "remote:" : "") + "goal-ui-" + counter; const executionId = "execution-" + counter;
  const progress = { schemaVersion: 1, sessionId, executionId, proposalId: "proposal-" + counter, revision: 2, updatedAt: 1000,
    items: [{ id: "M1", label: "Local checks", status: "completed" }, { id: "M2", label: "User acceptance", status: "pending" }] };
  const hold = { sessionId, executionId, state: "blocked", version: 7, reasons: [{ code: "verdict_partial" },
    { code: "team_unsettled", tasks: [{ id: "task-1", title: "Acceptance task", status: "pending", assigneeId: "tester" }] }],
    segments: [{ turnId: "turn-1", startedAt: 900, endedAt: 1000 }], blocks: [], resumeCount: 0, pausedTeam: true, createdAt: 900, updatedAt: 1000,
    draft: { summary: "Implementation available; acceptance incomplete", verdict: "partial",
      limitations: ["Validation unavailable in the isolated environment"], nextSteps: ["Run remaining acceptance checks"] }, progress };
  const artifact = { relativePath: "plan.md", sha256: "a".repeat(64), sizeBytes: 12 };
  fixture = { session: { id: sessionId, title: "Ship verified Goal", source: remote ? "remote" : "desktop", mode: "goal", permissionMode: "auto",
      providerId: "old-provider", modelId: "old-model", thinkingLevel: "off", executionProfile: "standard", createdAt: 900, updatedAt: 1000 },
    execution: { id: executionId, proposalId: progress.proposalId, sessionId, kind: "goal", executionKind: "goal", title: "Ship verified Goal",
      plan: "Approved plan", question: "Deliver verified result", artifact, targetPermissionMode: "ask", state: "interrupted" }, hold, progress, reports: [],
    proposal: { id: progress.proposalId, sessionId, turnId: "turn-1", toolCallId: "tool-1", kind: "goal", executionKind: "goal", title: "Ship verified Goal",
      markdown: "Approved plan", plan: "Approved plan", question: "Deliver verified result", artifact, version: 1, status: "approved",
      executionId, executionState: "interrupted", createdAt: "1970-01-01T00:00:00.900Z", updatedAt: "1970-01-01T00:00:01.000Z" } };
  return fixture;
};
const snapshot = () => ({ execution: fixture.execution, hold: fixture.hold });
const summary = () => ({ reportId: "report-" + counter, sessionId: fixture.session.id, executionId: fixture.execution.id,
  proposalId: fixture.execution.proposalId, status: "ready", executionStatus: fixture.hold.state === "accepted" ? "completed" : "interrupted", verdict: "partial", integrity: "structured",
  summary: fixture.hold.draft.summary, goalTitle: fixture.execution.title, closure: "user_accepted", completedAt: 1000, createdAt: 1000 });
ipcMain.handle("fixture:invoke", async (_event, channel, ...args) => {
  const input = args[0]; let data;
  if (channel === "fixture:control") {
    if (input.action === "reset") data = reset(input.remote);
    else if (input.action === "calls") data = { calls };
    else if (input.action === "failResume") { failResume = true; data = {}; }
    else if (input.action === "restart") {
      fixture.hold.version = input.version; fixture.hold.draft.limitations = ["Restart recovered checkpoint"];
      win.webContents.send(IPC.event.hostStatus, { ok: true, restarted: true }); data = {};
    } else throw new Error("Unknown fixture control: " + input.action);
    return { ok: true, data };
  }
  calls.push({ channel, input });
  switch (channel) {
    case IPC.invoke.goalExecutionGet: data = snapshot(); break;
    case IPC.invoke.goalProgressGet: data = { progress: fixture.progress }; break;
    case IPC.invoke.goalReportGet:
      data = fixture.reports.length ? { state: "ready", report: { ...fixture.reports[0], integrity: { kind: "structured" } } } : { state: "draft", report: null }; break;
    case IPC.invoke.goalReportList: data = { reports: fixture.session.source === "remote" && !fixture.reports.length ?
      [{ ...summary(), closure: undefined, hold: fixture.hold }] : fixture.reports }; break;
    case IPC.invoke.goalResume:
    case IPC.invoke.goalClose:
      if (input.executionId !== fixture.execution.id || input.sessionId !== fixture.session.id || input.expectedVersion !== fixture.hold.version)
        return { ok: false, error: { code: "STALE", message: "Invalid execution/version" } };
      if (channel === IPC.invoke.goalResume && failResume) { failResume = false; return { ok: false, error: { code: "TEST", message: "Resume failed" } }; }
      fixture.hold = { ...fixture.hold, version: fixture.hold.version + 1,
        state: channel === IPC.invoke.goalResume ? "resumed" : input.action === "accept" ? "accepted" : "abandoned" };
      if (channel === IPC.invoke.goalResume) {
        fixture.execution.state = "running";
        fixture.session = { ...fixture.session, mode: "agent", permissionMode: fixture.execution.targetPermissionMode };
      }
      if (input.action === "accept") fixture.reports = [summary()];
      data = snapshot(); events(); break;
    case IPC.invoke.sessionList: data = { sessions: [fixture.session] }; break;
    case IPC.invoke.sessionConfigure:
      fixture.session = { ...fixture.session, ...args[1] }; data = { session: fixture.session }; break;
    case IPC.invoke.providersListModels:
      data = { models: [{ providerId: input.providerId, modelId: input.providerId === "current-provider" ? "current-model" : "old-model", displayName: "Fixture model", capabilities: ["text"], source: "user", contextWindow: 32000 }], source: "catalog" }; break;
    case IPC.invoke.agentPrompt: data = { accepted: true, sessionId: input.sessionId }; break;
    default: data = null;
  }
  return { ok: true, data };
});
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1000, height: 920,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    await win.webContents.executeJavaScript("new Promise((resolve, reject) => { const end = performance.now() + 10000; const check = () => { if (window.goalBlockedUIProbe) resolve(); else if (performance.now() > end) reject(new Error('Renderer probe not ready')); else requestAnimationFrame(check); }; check(); })");
    const result = await win.webContents.executeJavaScript("window.goalBlockedUIProbe()");
    result.layouts = [await win.webContents.executeJavaScript("window.goalBlockedUILayout()")];
    await fs.writeFile(path.join(evidence, "goal-blocked-ui.png"), (await win.webContents.capturePage()).toPNG());
    win.setSize(420, 920);
    await win.webContents.executeJavaScript("new Promise((resolve, reject) => { const end = performance.now() + 5000; const check = () => { if (innerWidth === 420) resolve(); else if (performance.now() > end) reject(new Error('Resize not applied')); else requestAnimationFrame(check); }; check(); })");
    result.layouts.push(await win.webContents.executeJavaScript("window.goalBlockedUILayout()"));
    await fs.writeFile(path.join(evidence, "goal-blocked-ui-narrow.png"), (await win.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(evidence, "goal-blocked-ui.json"), JSON.stringify(result, null, 2));
    console.log("GOAL_BLOCKED_UI " + JSON.stringify(result)); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  assert.equal(code, 0, output);
  const result = output.split(/\r?\n/).find((line) => line.startsWith("GOAL_BLOCKED_UI "));
  assert(result, output); console.log(result);
} finally { await rm(temp, { recursive: true, force: true }); }
