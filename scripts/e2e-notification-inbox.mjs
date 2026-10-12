#!/usr/bin/env node
/** Real isolated Host/SQLite, IPC, Electron Dock badge and NotificationCenter user path. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const temp = await mkdtemp(join(tmpdir(), "pi-notification-inbox-"));
const alias = {
  "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
  "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"),
  react: join(root, "apps/desktop/node_modules/react"),
  "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
  i18next: join(root, "apps/desktop/node_modules/i18next"),
  "react-i18next": join(root, "apps/desktop/node_modules/react-i18next"),
};
try {
  await build({ entryPoints: [join(root, "scripts/e2e/notification-inbox.tsx")],
    outfile: join(temp, "renderer.js"), bundle: true, platform: "browser", format: "esm", jsx: "automatic",
    loader: { ".svg": "dataurl" }, alias, nodePaths: [join(root, "apps/desktop/node_modules")],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
  });
  await build({ entryPoints: [join(root, "scripts/e2e/notification-inbox-main.mjs")],
    outfile: join(temp, "main.mjs"), bundle: true, platform: "node", format: "esm", external: ["electron"],
    alias: { "@pi-desktop/shared": alias["@pi-desktop/shared"] },
  });
  const renderer = join(root, "apps/desktop/out/renderer");
  const html = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...html.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
  assert(css.length, "Build Desktop before running notification E2E");
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  await writeFile(join(temp, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:">${css.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}</head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>`);
  await writeFile(join(temp, "preload.cjs"), `
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("piDesktop", {
  platform: process.platform,
  invoke: (channel, input) => ipcRenderer.invoke("fixture:invoke", channel, input),
  on: (channel, listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
contextBridge.exposeInMainWorld("notificationFixture", { action: (name, input) => ipcRenderer.invoke("fixture:action", name, input) });
`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.mjs"), temp, resolveHostBinary()],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 55_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  assert.equal(code, 0, output);
  const result = output.split(/\r?\n/).find((line) => line.startsWith("NOTIFICATION_INBOX "));
  assert(result, output);
  console.log(result);
} finally { await rm(temp, { recursive: true, force: true }); }
