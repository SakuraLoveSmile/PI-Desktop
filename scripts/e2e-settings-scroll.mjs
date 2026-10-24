#!/usr/bin/env node
/** Settings navigation in isolated Electron, with the production component/store/CSS. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const urlAssets = {
  name: "local-url-assets",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, ({ path, resolveDir }) => ({
      path: join(resolveDir, path.slice(0, -4)), namespace: "local-url-asset",
    }));
    build.onLoad({ filter: /.*/, namespace: "local-url-asset" }, async ({ path }) => ({
      contents: await readFile(path), loader: "file",
    }));
  },
};
const temp = await mkdtemp(join(tmpdir(), "pi-settings-scroll-"));
try {
  await build({ entryPoints: [join(root, "scripts/e2e/settings-scroll.jsx")],
    outfile: join(temp, "renderer.js"), bundle: true, platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "true" },
    alias: { "@pi-desktop/i18n": join(root, "packages/i18n/src"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
      i18next: join(root, "apps/desktop/node_modules/i18next"),
      "react-i18next": join(root, "apps/desktop/node_modules/react-i18next") },
    nodePaths: [join(root, "apps/desktop/node_modules")],
    plugins: [urlAssets],
  });
  const renderer = join(root, "apps/desktop/out/renderer");
  const html = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...html.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
  assert(css.length, "Run pnpm build:js before this test");
  // esbuild emits styles imported by lazy Settings features separately.
  // Load them after the app stylesheet, matching the production feature order.
  css.push("./renderer.css");
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  await writeFile(join(temp, "index.html"), `<!doctype html><html data-platform="darwin"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:">${css.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}</head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>`);
  if (process.argv.includes("--serve")) {
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      let name;
      try { name = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1)); }
      catch { response.writeHead(400); response.end(); return; }
      const file = resolve(temp, name);
      if (!(name === "index.html" || name === "renderer.js" || name === "renderer.css" || name.startsWith("assets/")) ||
          !file.startsWith(temp + sep)) { response.writeHead(404); response.end(); return; }
      try {
        const content = await readFile(file);
        response.setHeader("content-type", name.endsWith(".html") ? "text/html" :
          name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        response.end(content);
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolvePromise => server.listen(0, "127.0.0.1", resolvePromise));
    try {
      console.log(`SETTINGS_SCROLL_FIXTURE_URL http://127.0.0.1:${server.address().port}`);
      await new Promise(resolvePromise => {
        process.once("SIGINT", resolvePromise);
        process.once("SIGTERM", resolvePromise);
      });
    } finally {
      server.closeAllConnections();
      await new Promise(resolvePromise => server.close(resolvePromise));
    }
  } else {
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 720,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    const result = await win.webContents.executeJavaScript("window.settingsScrollProbe().catch(error => { console.error(error.stack); throw error; })");
    console.log("SETTINGS_SCROLL " + JSON.stringify(result));
    for (const skills of ["empty", "populated"]) {
      await win.loadFile(path.join(__dirname, "index.html"), { query: { skills } });
      const skillsResult = await win.webContents.executeJavaScript("window.settingsSkillsProbe().catch(error => { console.error(error.stack); throw error; })");
      console.log("SETTINGS_SKILLS " + JSON.stringify(skillsResult));
    }
    win.setContentSize(560, 780);
    await win.loadFile(path.join(__dirname, "index.html"), { query: { skills: "populated", tab: "skills" } });
    const narrowResult = await win.webContents.executeJavaScript("window.settingsSkillsNarrowProbe().catch(error => { console.error(error.stack); throw error; })");
    console.log("SETTINGS_SKILLS_NARROW " + JSON.stringify(narrowResult));
    for (const width of [560, 720, 800, 1120, 1440]) {
      win.setContentSize(width, 780);
      await win.loadFile(path.join(__dirname, "index.html"), { query: { locale: "zh-CN", theme: "light" } });
      console.log("SETTINGS_DIRECTORY " + JSON.stringify(await win.webContents.executeJavaScript("window.settingsDirectoryProbe()")));
    }
    win.setContentSize(1440, 1000);
    await win.loadFile(path.join(__dirname, "index.html"), { query: { locale: "en", theme: "dark" } });
    win.webContents.setZoomFactor(2);
    await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    console.log("SETTINGS_DIRECTORY_ZOOM " + JSON.stringify(await win.webContents.executeJavaScript("window.settingsDirectoryProbe()")));
    win.webContents.setZoomFactor(1);
    await win.loadFile(path.join(__dirname, "index.html"));
    console.log("SETTINGS_SAVE " + JSON.stringify(await win.webContents.executeJavaScript("window.settingsSaveProbe()")));
    for (const [locale, theme] of [["zh-CN", "light"], ["en", "dark"]]) {
      for (const width of [560, 720, 800, 1120, 1440]) {
        win.setContentSize(width, 780);
        await win.loadFile(path.join(__dirname, "index.html"), { query: { preview: "all", locale, theme, skills: "populated", sync: "configured" } });
        console.log("SETTINGS_ALL_LAYOUT " + JSON.stringify(await win.webContents.executeJavaScript("window.settingsAllPagesLayoutProbe()")));
      }
      win.setContentSize(1440, 1000);
      await win.loadFile(path.join(__dirname, "index.html"), { query: { preview: "all", locale, theme, skills: "populated", sync: "configured" } });
      win.webContents.setZoomFactor(2);
      await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      console.log("SETTINGS_ALL_ZOOM " + JSON.stringify(await win.webContents.executeJavaScript("window.settingsAllPagesLayoutProbe()")));
      win.webContents.setZoomFactor(1);
    }
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  assert.equal(code, 0, output);
  const result = output.split(/\r?\n/).find((line) => line.startsWith("SETTINGS_SCROLL "));
  assert(result, output);
  console.log(result);
  const skillResults = output.split(/\r?\n/).filter((line) => line.startsWith("SETTINGS_SKILLS "));
  assert.equal(skillResults.length, 2, output);
  for (const skillsResult of skillResults) console.log(skillsResult);
  const narrowResult = output.split(/\r?\n/).find((line) => line.startsWith("SETTINGS_SKILLS_NARROW "));
  assert(narrowResult, output);
  console.log(narrowResult);
  for (const line of output.split(/\r?\n/).filter(line => /^SETTINGS_(DIRECTORY|SAVE|ALL)/.test(line))) console.log(line);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
