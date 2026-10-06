#!/usr/bin/env node
/** Isolated React/Chromium coverage for Plan/Goal cards in the transcript. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const vite = await import(pathToFileURL(desktopRequire.resolve("vite")).href);
const { default: tailwind } = await import(pathToFileURL(desktopRequire.resolve("@tailwindcss/vite")).href);
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-plan-transcript-ui-"));
const evidenceDir = join(root, ".review-evidence");
const evidencePath = join(evidenceDir, "plan-transcript-ui.png");
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/plan-transcript-ui.tsx")],
    outfile: join(temp, "renderer.js"),
    bundle: true,
    platform: "browser",
    conditions: ["style", "browser", "import", "default"],
    format: "iife",
    jsx: "automatic",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  // Use production Tailwind scanning as well as @theme compilation, including
  // sr-only and shared Button utilities; an empty candidate list omits them.
  const styles = await vite.build({
    configFile: false, root: join(root, "apps/desktop"), logLevel: "error", plugins: [tailwind()],
    build: { write: false, rollupOptions: { input: join(root, "apps/desktop/src/styles/globals.css") } },
  });
  const outputs = (Array.isArray(styles) ? styles : [styles]).flatMap((result) => result.output);
  const css = outputs.filter((entry) => entry.type === "asset" && entry.fileName.endsWith(".css"));
  assert(css.length > 0, "Production CSS was not compiled");
  await writeFile(join(temp, "renderer.css"), css.map((entry) => entry.source).join("\n"));
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><title>Plan transcript cards</title><body><script src="renderer.js"></script>');
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { writeFileSync, readFileSync } = require("node:fs");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1000, height: 760,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.session.on("will-download", (_event, item) => {
    const filename = item.getFilename();
    const file = path.join(__dirname, filename);
    item.setSavePath(file);
    item.once("done", (_event, state) => {
      const result = { state, filename, content: state === "completed" ? readFileSync(file, "utf8") : null };
      void window.webContents.executeJavaScript("globalThis.planDownloadResult = " + JSON.stringify(result));
    });
  });
  window.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const result = await window.webContents.executeJavaScript("globalThis.planTranscriptUiProbe()");
    const screenshot = await window.capturePage();
    writeFileSync(process.env.PI_E2E_EVIDENCE_PATH, screenshot.toPNG());
    console.log("PLAN_TRANSCRIPT_UI_PROBE " + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error("PLAN_TRANSCRIPT_UI_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
    app.exit(1);
  }
});
`);
  const env = { ...process.env, PI_E2E_EVIDENCE_PATH: evidencePath };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output += data; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  const line = output.split(/\r?\n/).find((value) => value.startsWith("PLAN_TRANSCRIPT_UI_PROBE "));
  assert(line, `renderer returned no result (exit=${code}): ${output.slice(-3000)}`);
  const result = JSON.parse(line.slice("PLAN_TRANSCRIPT_UI_PROBE ".length));
  console.log("PLAN_TRANSCRIPT_UI_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
  console.log(`PLAN_TRANSCRIPT_UI_SCREENSHOT ${evidencePath}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
