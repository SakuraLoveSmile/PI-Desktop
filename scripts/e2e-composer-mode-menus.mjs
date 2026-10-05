#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-composer-mode-menus-"));

try {
  await build({
    entryPoints: [join(root, "scripts/e2e/composer-mode-menus.tsx")],
    outfile: join(temp, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });

  const renderer = join(root, "apps/desktop/out/renderer");
  const appHtml = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...appHtml.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
  assert(css.length, "Build the desktop app before running the mode menu test");
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  await writeFile(join(temp, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:">${css.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}<style>body{margin:0;background:#181818}#root{position:absolute;left:24px;right:24px;bottom:24px}</style><div id="root"></div><script src="renderer.js"></script>`);
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 685, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  const waitFor = async (code) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    throw new Error("Timed out waiting for " + code);
  };
  const click = async (selector) => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const checkMenu = async (selector) => {
    await waitFor('!!document.querySelector(' + JSON.stringify(selector) + ')');
    const state = await evaluate('(() => { const menu = document.querySelector(' + JSON.stringify(selector) + '); const style = getComputedStyle(menu); const button = menu.querySelector("button:not([disabled])"); const rect = button.getBoundingClientRect(); return { opacity: style.opacity, visibility: style.visibility, pointerEvents: style.pointerEvents, hit: menu.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) }; })()');
    if (state.opacity !== "1" || state.visibility !== "visible" || state.pointerEvents !== "auto" || !state.hit) {
      throw new Error("Menu is not pointer-accessible: " + JSON.stringify({ selector, state }));
    }
  };
  const checkProfileLabel = async (expected) => {
    const label = await evaluate('(() => { const node = document.querySelector(".composer-profile-chip .composer-mode-chip-label"); return { text: node.textContent, visibleWidth: node.clientWidth, textWidth: node.scrollWidth }; })()');
    if (label.text !== expected || label.textWidth > label.visibleWidth) {
      throw new Error("Profile label is clipped: " + JSON.stringify(label));
    }
  };
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    await waitFor('!!document.querySelector(".composer-profile-chip")');
    await checkProfileLabel("智能体");
    await click(".composer-profile-chip");
    await checkMenu(".composer-profile-menu.is-open");
    await click('.composer-profile-menu.is-open [aria-checked="false"]');
    await waitFor('document.querySelector(".composer-profile-chip")?.dataset.profile === "team"');
    await checkProfileLabel("专家团队");
    win.setContentSize(498, 720);
    await checkProfileLabel("专家团队");
    await waitFor('!document.querySelector(".composer-contract-chip")');
    await click(".composer-plus > button");
    await checkMenu(".composer-plus-menu.is-open");
    await click('.composer-plus-menu.is-open [role="switch"][aria-label="Goal"]');
    await waitFor('document.querySelector(".composer-contract-chip")?.dataset.mode === "goal"');
    await click(".composer-plus > button");
    await waitFor('!document.querySelector(".composer-plus-menu.is-open")');
    await click(".composer-contract-chip");
    await checkMenu(".composer-plus-menu.is-open");
    await click('.composer-plus-menu.is-open [role="switch"][aria-label="Plan"]');
    await waitFor('document.querySelector(".composer-contract-chip")?.dataset.mode === "plan"');
    await click('.composer-plus-menu.is-open [role="switch"][aria-label="Plan"]');
    await waitFor('!document.querySelector(".composer-contract-chip")');
    await click('.composer-plus-menu.is-open [role="switch"][aria-label="Goal"]');
    await waitFor('document.querySelector(".composer-contract-chip")?.dataset.mode === "goal"');
    console.log("COMPOSER_MODE_MENUS " + JSON.stringify({ ok: true, profile: "team", mode: "goal" }));
    app.quit();
  } catch (error) {
    console.error("COMPOSER_MODE_MENUS " + JSON.stringify({ ok: false, error: String(error) }));
    app.exit(1);
  }
});
`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => { output += data; });
  }
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("COMPOSER_MODE_MENUS "));
  assert(line, `No menu result (exit=${code}): ${output.slice(-2000)}`);
  const result = JSON.parse(line.slice("COMPOSER_MODE_MENUS ".length));
  assert.equal(code, 0, output.slice(-3000));
  assert.equal(result.ok, true, result.error);
  console.log(line);
} finally {
  await rm(temp, { recursive: true, force: true });
}
