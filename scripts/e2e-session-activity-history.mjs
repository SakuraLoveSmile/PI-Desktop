/** Real isolated Rust Host -> Electron IPC -> production Overview, with a tail-only transcript. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const scratch = await mkdtemp(join(tmpdir(), "pi-activity-history-"));
try {
  await build({ entryPoints: [join(root, "scripts/e2e/session-activity-history.tsx")], outfile: join(scratch, "renderer.js"),
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
    loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl", ".gif": "dataurl" },
    alias: { "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"), react: join(root, "apps/desktop/node_modules/react"), "react-dom": join(root, "apps/desktop/node_modules/react-dom") },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  await build({ entryPoints: [join(root, "scripts/e2e/session-activity-history-main.mjs")], outfile: join(scratch, "main.mjs"), bundle: true, platform: "node", format: "esm", external: ["electron"] });
  await writeFile(join(scratch, "preload.cjs"), `const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("piDesktop", { platform: process.platform, invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args), on: (channel, listener) => { const handler = (_event, value) => listener(value); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); } });`);
  const renderer = join(root, "apps/desktop/out/renderer");
  const html = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...html.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
  for (const name of await readdir(join(renderer, "assets"))) {
    if (name.endsWith(".css") && (await readFile(join(renderer, "assets", name), "utf8")).includes(".session-activity-rail{")) css.push(`./assets/${name}`);
  }
  assert.ok(css.length, "Desktop production stylesheet is required");
  await cp(join(renderer, "assets"), join(scratch, "assets"), { recursive: true });
  await writeFile(join(scratch, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"><title>Isolated complete session activity probe</title>${[...new Set(css)].map((path) => `<link rel="stylesheet" href="${path}">`).join("")}<script src="renderer.js"></script>`);
  const env = { ...process.env, PI_DESKTOP_HOST_BIN: resolveHostBinary() };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(scratch, "main.mjs"), scratch], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  assert.equal(code, 0, output.slice(-6000));
  const line = output.split("\n").find((value) => value.startsWith("SESSION_ACTIVITY_HISTORY_PROBE "));
  assert.ok(line, output);
  const result = JSON.parse(line.slice("SESSION_ACTIVITY_HISTORY_PROBE ".length));
  assert.equal(result.ok, true);
  console.log("SESSION_ACTIVITY_HISTORY_PROBE " + JSON.stringify(result));
} finally { await rm(scratch, { recursive: true, force: true }); }
