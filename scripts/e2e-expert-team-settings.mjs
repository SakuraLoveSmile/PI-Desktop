#!/usr/bin/env node
/** Expert team settings with production SettingsPage, store, primitives and CSS in isolated Electron. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const evidenceDir = process.env.PI_EXPERT_SETTINGS_EVIDENCE_DIR || join(root, ".review-evidence");
await mkdir(evidenceDir, { recursive: true });
const evidencePath = join(evidenceDir, `expert-team-settings-${Date.now()}.png`);
const temp = await mkdtemp(join(tmpdir(), "pi-expert-team-settings-"));
try {
  await build({ entryPoints: [join(root, "scripts/e2e/expert-team-settings.tsx")],
    outfile: join(temp, "renderer.js"), bundle: true, platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    plugins: [{ name: "fixture-url-assets", setup(builder) {
      builder.onResolve({ filter: /\?url$/ }, (args) => ({ path: resolve(dirname(args.importer), args.path.slice(0, -4)), namespace: "fixture-url" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-url" }, async ({ path }) => {
        const name = basename(path);
        await cp(path, join(temp, name));
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
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
      i18next: join(root, "apps/desktop/node_modules/i18next"),
      "react-i18next": join(root, "apps/desktop/node_modules/react-i18next") },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  const { compile } = createRequire(join(root, "apps/desktop/package.json"))("tailwindcss");
  const cssPath = join(temp, "renderer.css");
  const compiledCss = await compile(await readFile(cssPath, "utf8"));
  await writeFile(cssPath, compiledCss.build(["block", "space-y-1.5", "text-sm", "text-text-secondary"]));
  await writeFile(join(temp, "index.html"), `<!doctype html><html data-platform="darwin"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"><link rel="stylesheet" href="renderer.css"></head><body><script type="module" src="renderer.js"></script></body></html>`);
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { writeFileSync } = require("node:fs");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    win.webContents.setZoomFactor(0.8);
    const result = await win.webContents.executeJavaScript("globalThis.expertTeamSettingsProbe()");
    result.overview = { viewport: await win.webContents.executeJavaScript("window.innerWidth"), zoom: win.webContents.getZoomFactor() };
    await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const screenshot = await win.capturePage();
    writeFileSync(process.env.PI_E2E_EVIDENCE_PATH, screenshot.toPNG());
    win.webContents.setZoomFactor(1);
    win.setSize(800, 840);
    result.narrow = await win.webContents.executeJavaScript("globalThis.expertTeamSettingsViewportProbe()");
    await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    writeFileSync(process.env.PI_E2E_EVIDENCE_PATH.replace(/\\.png$/, "-narrow-light.png"), (await win.capturePage()).toPNG());
    await win.webContents.executeJavaScript("globalThis.expertTeamSettingsCleanup?.()");
    console.log("EXPERT_TEAM_SETTINGS " + JSON.stringify(result));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  env.PI_E2E_EVIDENCE_PATH = evidencePath;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  assert.equal(code, 0, output);
  const result = output.split(/\r?\n/).find((line) => line.startsWith("EXPERT_TEAM_SETTINGS "));
  assert(result, output);
  console.log(result);
  console.log(`EXPERT_TEAM_SETTINGS_SCREENSHOT ${evidencePath}`);
  assert.equal(JSON.parse(result.slice("EXPERT_TEAM_SETTINGS ".length)).ok, true);
} finally { await rm(temp, { recursive: true, force: true }); }
