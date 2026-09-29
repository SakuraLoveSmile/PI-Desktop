#!/usr/bin/env node
/** Isolated Electron user-path coverage for Composer input history. */
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
const temp = await mkdtemp(join(tmpdir(), "pi-composer-input-history-"));

try {
  await build({
    entryPoints: [join(root, "scripts/e2e/composer-input-history.tsx")],
    outfile: join(temp, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  await writeFile(
    join(temp, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'"><style>body{margin:0;background:#202124;color:#eee;font:14px sans-serif}.composer-input{min-height:40px;padding:12px;outline:0;white-space:pre-wrap}</style><main id="root"></main><script src="renderer.js"></script>`,
  );
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const result = await window.webContents.executeJavaScript(
      "globalThis.composerInputHistoryProbe()",
    );
    console.log("COMPOSER_INPUT_HISTORY_PROBE " + JSON.stringify(result));
    app.exit(0);
  } catch (error) {
    console.error("COMPOSER_INPUT_HISTORY_PROBE " + JSON.stringify({ ok: false, error: String(error), stack: error?.stack }));
    app.exit(1);
  }
});
`,
  );

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output += data; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearTimeout(timeout);
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("COMPOSER_INPUT_HISTORY_PROBE "));
  assert(line, `renderer returned no probe (exit=${code}): ${output.slice(-3000)}`);
  const result = JSON.parse(line.slice("COMPOSER_INPUT_HISTORY_PROBE ".length));
  assert.equal(code, 0, output.slice(-4000));
  assert.equal(result.ok, true);
  console.log("PASS E2E-COMPOSER-input-history " + JSON.stringify(result));
} finally {
  await rm(temp, { recursive: true, force: true });
}
