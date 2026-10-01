#!/usr/bin/env node
/**
 * Runner for the isolated Electron IPC smoke of the manual Local Network
 * trigger (`scripts/e2e/local-network-manual-discovery.ts`).
 *
 * It bundles the scenario for the Electron main process, writes the trivial
 * preload/document that make the `ipcMain`/`ipcRenderer` round trip real, runs
 * one hidden window, and asserts the scenario's own verdict line. No real
 * provider, no user profile, no OS permission prompt, no UI suite.
 */
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
const temp = await mkdtemp(join(tmpdir(), "pi-local-network-smoke-"));
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/local-network-manual-discovery.ts")],
    outfile: join(temp, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // The Electron runtime supplies these; the scenario must use the real ones.
    external: ["electron"],
  });
  await writeFile(
    join(temp, "preload.cjs"),
    `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("piSmoke", {
  invoke: (channel, input) => ipcRenderer.invoke(channel, input),
});
`,
  );
  await writeFile(
    join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>Local Network manual discovery smoke</title>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output += data;
    });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  const line = output
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("LOCAL_NETWORK_SMOKE "));
  assert(line, `the smoke returned no verdict (exit=${code}): ${output.slice(-3000)}`);
  const result = JSON.parse(line.slice("LOCAL_NETWORK_SMOKE ".length));
  console.log("LOCAL_NETWORK_SMOKE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-3000));
  assert.equal(result.ok, true, JSON.stringify(result));
} finally {
  await rm(temp, { recursive: true, force: true });
}
