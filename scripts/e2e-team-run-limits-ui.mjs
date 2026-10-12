#!/usr/bin/env node
/** Isolated native Chromium interactions for Team budget settings and notices. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const { compile } = desktopRequire("tailwindcss");
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-team-run-limits-ui-"));
const evidenceDir = resolve(root, process.env.PI_E2E_EVIDENCE_DIR ?? ".review-evidence");
const evidenceId = `team-run-limits-ui-${Date.now()}`;
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/team-run-limits-ui.tsx")], outfile: join(temp, "renderer.js"),
    bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"), "react-dom": join(root, "apps/desktop/node_modules/react-dom") },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  const stylesheet = join(temp, "renderer.css");
  const compiled = await compile(await readFile(stylesheet, "utf8"));
  await writeFile(stylesheet, compiled.build([]));
  await writeFile(join(temp, "index.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:"><link rel="stylesheet" href="renderer.css"><title>Team run limits acceptance fixture</title><body><script src="renderer.js"></script>');
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { writeFileSync } = require("node:fs");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 900, height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const results = []; const screenshots = [];
  const js = (code) => window.webContents.executeJavaScript(code);
  const frame = () => js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const step = async (name, capture = false) => {
    results.push(await js("globalThis.teamRunLimitsUiStep(" + JSON.stringify(name) + ")"));
    await frame();
    if (capture) {
      const file = path.join(process.env.PI_E2E_EVIDENCE_DIR, process.env.PI_E2E_EVIDENCE_ID + "-" + name + ".png");
      writeFileSync(file, (await window.capturePage()).toPNG()); screenshots.push(file);
    }
  };
  const click = async (selector) => {
    const point = await js("(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); if (!element) throw new Error('Missing control'); element.scrollIntoView({block:'nearest'}); const r=element.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()");
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await frame();
  };
  const type = async (index, text) => {
    await js("(() => { const element = document.querySelectorAll('input[type=number]')[" + index + "]; element.focus(); element.select(); })()");
    await window.webContents.insertText(text); await frame();
  };
  const save = async () => {
    const selector = await js("(() => { const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '保存'); if (!button) throw new Error('Missing save'); button.id = 'fixture-save'; return '#fixture-save'; })()");
    await click(selector);
  };
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    await step("setup", true);
    await type(1, "5"); await step("invalid", true);
    await type(1, "10"); await click('[role="switch"]'); await save();
    await step("disabled-saved", true); await step("reload");
    await step("arm-role-conflict"); await click('[role="switch"]');
    await type(0, "7"); await type(1, "12"); await save(); await step("role-conflict-saved", true);
    await step("arm-policy-conflict"); await type(1, "14"); await save(); await step("policy-conflict", true);
    await step("notices", true);
    console.log("TEAM_RUN_LIMITS_UI_PROBE " + JSON.stringify({ ok: true, results, screenshots }));
    app.quit();
  } catch (error) {
    console.error("TEAM_RUN_LIMITS_UI_PROBE " + JSON.stringify({ ok: false, error: String(error), stack: error?.stack, results, screenshots }));
    app.exit(1);
  }
});
`);
  await mkdir(evidenceDir, { recursive: true });
  const env = { ...process.env, PI_E2E_EVIDENCE_DIR: evidenceDir, PI_E2E_EVIDENCE_ID: evidenceId };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output += data; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timeout); }
  const line = output.split(/\r?\n/).find((value) => value.startsWith("TEAM_RUN_LIMITS_UI_PROBE "));
  assert(line, `renderer returned no result (exit=${code}): ${output.slice(-4000)}`);
  const result = JSON.parse(line.slice("TEAM_RUN_LIMITS_UI_PROBE ".length));
  await writeFile(join(evidenceDir, evidenceId + ".json"), JSON.stringify(result, null, 2) + "\n");
  console.log("TEAM_RUN_LIMITS_UI_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000)); assert.equal(result.ok, true);
} finally { await rm(temp, { recursive: true, force: true }); }
