#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-team-review-ui-"));

try {
  await build({
    entryPoints: [join(root, "scripts/e2e/team-review-ui.tsx")],
    outfile: join(temp, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    plugins: [{
      name: "team-review-api-boundary",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^\.\.\/\.\.\/lib\/api$/ }, () => ({
          path: "api",
          namespace: "team-review-fixture",
        }));
        pluginBuild.onResolve({ filter: /^\.\.\/\.\.\/stores\/app-store$/ }, () => ({
          path: "store",
          namespace: "team-review-fixture",
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "team-review-fixture" }, (args) => ({
          contents: args.path === "api"
            ? "export const api = new Proxy({}, { get: (_target, key) => (...args) => globalThis.__teamReviewApi[key](...args) });"
            : "export const useAppStore = (selector) => selector(globalThis.__teamReviewStore);",
          loader: "js",
        }));
      },
    }],
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  await writeFile(join(temp, "index.html"), '<!doctype html><meta charset="utf-8"><title>Team review UI</title><body></body><script src="renderer.js"></script>');
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on("console-message", (_event, _level, message) => console.error(message));
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const result = await window.webContents.executeJavaScript("globalThis.teamReviewUiProbe()");
    console.log("TEAM_REVIEW_UI_PROBE " + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error("TEAM_REVIEW_UI_PROBE " + JSON.stringify({ ok: false, error: String(error), stack: error?.stack }));
    app.exit(1);
  }
});
`);
  const env = { ...process.env };
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
  const line = output.split(/\r?\n/).find((value) => value.startsWith("TEAM_REVIEW_UI_PROBE "));
  assert(line, `renderer returned no probe result (exit=${code}): ${output.slice(-4000)}`);
  const result = JSON.parse(line.slice("TEAM_REVIEW_UI_PROBE ".length));
  console.log("TEAM_REVIEW_UI_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
} finally {
  await rm(temp, { recursive: true, force: true });
}
