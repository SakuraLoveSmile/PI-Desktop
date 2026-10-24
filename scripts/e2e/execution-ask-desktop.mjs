/** Isolated real Electron bootstrap, with the release sidecar bundle staged as resources. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveElectronBinary } from "./boot.mjs";
import { waitFor } from "./wait.mjs";

export async function executionAskDesktop({ root, scratch, dataDir, binary, bundle, env, log }) {
  const connectionFile = join(dataDir, "mcp-control.json");
  // A restart must observe this process's bootstrap receipt, not the previous port.
  await rm(connectionFile, { force: true });
  const resources = join(scratch, "resources");
  await mkdir(resources, { recursive: true });
  await cp(bundle, join(resources, "agent-runtime"), { recursive: true });
  const entry = join(scratch, "desktop-fixture.cjs");
  const metadata = JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8"));
  // A directory entry supplies Electron's real app version on every platform.
  // A bare CJS file falls back to 0.0 on Linux, which storage correctly rejects.
  await writeFile(join(scratch, "package.json"), JSON.stringify({
    name: metadata.name, version: metadata.version, main: "desktop-fixture.cjs",
  }));
  await writeFile(entry, `const { app } = require('electron');
if (app.getVersion() !== ${JSON.stringify(metadata.version)}) throw new Error('Fixture app version does not match the candidate');
console.info('EXECUTION_ASK_DESKTOP_VERSION ' + app.getVersion());
Object.defineProperty(process, 'resourcesPath', {value: ${JSON.stringify(resources)}});
import(${JSON.stringify(pathToFileURL(join(root, "apps/desktop/out/main/index.js")).href)}).catch(error => {console.error(error); process.exit(1);});\n`);
  const probe = createServer();
  await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const { electronBinary, appDir } = resolveElectronBinary(root);
  const child = spawn(electronBinary, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(scratch, "profile")}`, scratch], {
    cwd: appDir, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, PI_DESKTOP_DATA_DIR: dataDir, PI_DESKTOP_HOST_BIN: binary,
      PI_DESKTOP_MCP_CONTROL: "1", PI_DESKTOP_MCP_PORT: "0", PI_DESKTOP_START_MAXIMIZED: "0" },
  });
  let outputTail = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    const text = String(chunk);
    outputTail = (outputTail + text).slice(-8000);
    log(text);
  });
  let ws;
  const stop = async () => {
    ws?.close();
    if (child.exitCode !== null) return;
    const ended = once(child, "exit");
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    await Promise.race([ended, new Promise(done => setTimeout(done, 5000))]);
    try { process.kill(-child.pid, "SIGKILL"); } catch { if (child.exitCode === null) child.kill("SIGKILL"); }
  };
  try {
    let target;
    await waitFor(async () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Desktop fixture exited (code=${child.exitCode}, signal=${child.signalCode})`);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row => row.type === "page" && row.url.endsWith("/out/renderer/index.html")); return !!target; }
      catch { return false; }
    }, 30000, "real Desktop renderer");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await once(ws, "open");
    let seq = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data), waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id); clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(JSON.stringify(message.error))); else waiting.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const invoke = (name, ...args) => evaluate(`(async()=>{ const r=await window.piDesktop.invoke(window.piDesktop.channels.invoke[${JSON.stringify(name)}],...${JSON.stringify(args)});if(!r.ok)throw new Error(JSON.stringify(r.error));return r.data;})()`);
    await waitFor(() => evaluate("!!window.piDesktop && !document.querySelector('.startup-splash')"), 30000, "Desktop ready");
    let connection;
    await waitFor(async () => { try { connection = JSON.parse(await readFile(connectionFile, "utf8")); return connection.active; } catch { return false; } }, 30000, "bootstrap MCP callback wiring");
    assert.equal(new URL(connection.url).hostname, "127.0.0.1");
    return { child, send, evaluate, invoke, stop, connection, connectionFile };
  } catch (error) {
    await stop();
    throw new Error(`${String(error)}\nDesktop startup output (tail):\n${outputTail || "(none)"}`, { cause: error });
  }
}
