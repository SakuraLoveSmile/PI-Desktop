/** Isolated real Desktop lifecycle shared by the Team closeout journeys. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectControl, connectRenderer } from "../../apps/desktop/test/e2e/plugin-ui-slots/clients.mjs";
export function createNativeHarness({ root, runRoot, dataDir, homeDir, results }) {
  let electron,
    renderer,
    cdp,
    stopSequence = 0;
  async function until(probe, label, timeoutMs = 45000) {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      try {
        const value = await probe();
        if (value) return value;
      } catch (e) {
        last = e;
      }
      await delay(100);
    }
    throw new Error(`Timeout ${label}: ${last?.message ?? ""}`);
  }
  async function freePort() {
    const s = createServer();
    await new Promise((done, reject) => {
      s.once("error", reject);
      s.listen(0, "127.0.0.1", done);
    });
    const p = s.address().port;
    await new Promise((done) => s.close(done));
    return p;
  }
  function launch(electronBinary, hostBin, mcpPort, cdpPort) {
    const env = {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: join(homeDir, ".config"),
      XDG_CACHE_HOME: join(homeDir, ".cache"),
      PI_DESKTOP_DATA_DIR: dataDir,
      PI_CODING_AGENT_DIR: join(homeDir, ".pi", "agent"),
      PI_DESKTOP_HOST_BIN: hostBin,
      PI_DESKTOP_MCP_CONTROL: "1",
      PI_DESKTOP_MCP_PORT: String(mcpPort),
      ELECTRON_RENDERER_URL: "",
      PI_DESKTOP_START_MAXIMIZED: "0",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      electronBinary,
      [`--user-data-dir=${join(runRoot, "profile")}`, `--remote-debugging-port=${cdpPort}`, "."],
      {
        cwd: join(root, "apps", "desktop"),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    const instance = { child, output: "" };
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        instance.output = `${instance.output}${chunk}`.slice(-18000);
      });
    return instance;
  }

  async function stop() {
    renderer?.close();
    renderer = undefined;
    cdp?.close();
    cdp = undefined;
    if (!electron) return;
    const child = electron.child;
    const owned = ownedDescendants(child.pid);
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((done) => child.once("close", done));
      const kill = (signal) => {
        try {
          if (process.platform === "win32")
            execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
          else process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      kill("SIGTERM");
      if (await Promise.race([closed.then(() => false), delay(3000).then(() => true)])) {
        kill("SIGKILL");
        await closed;
      }
    }
    const sanitized = electron.output.replaceAll("sk-closeout-fixture-only", "[fixture credential]");
    writeFileSync(join(runRoot, `electron-${++stopSequence}.log`), sanitized);
    writeFileSync(join(runRoot, "electron.log"), sanitized);
    await until(() => owned.every((pid) => !processAlive(pid)), "owned Electron/Host/sidecar cleanup", 8000);
    results.push({
      name: "isolated owned processes cleaned",
      passed: true,
      pids: owned,
      restartKind: "process-group SIGTERM recovery",
    });
    electron = undefined;
  }

  async function connectCdp(port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(
      (entry) => entry.type === "page" && entry.url.includes("index.html") && entry.webSocketDebuggerUrl,
    );
    assert(target, "desktop renderer target");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, reject) => {
      socket.addEventListener("open", done, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const reply = JSON.parse(String(data));
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      clearTimeout(entry.timer);
      if (reply.error) entry.reject(new Error(reply.error.message));
      else entry.done(reply.result);
    });
    return {
      call(method, params = {}) {
        return new Promise((done, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`${method} timeout`));
          }, 15000);
          pending.set(id, { done, reject, timer });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close: () => socket.close(),
    };
  }

  async function boot(electronBinary, hostBin) {
    const mcpPort = await freePort();
    const cdpPort = await freePort();
    electron = launch(electronBinary, hostBin, mcpPort, cdpPort);
    await until(
      () => {
        if (!existsSync(join(dataDir, "mcp-control.json"))) return false;
        const info = JSON.parse(readFileSync(join(dataDir, "mcp-control.json"), "utf8"));
        return info.active === true && new URL(info.url).port === String(mcpPort);
      },
      "isolated control plane",
      90000,
    );
    await until(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      return targets.some((target) => target.type === "page" && target.url.includes("index.html"));
    }, "renderer target");
    renderer = await connectRenderer(cdpPort);
    cdp = await connectCdp(cdpPort);
    // Retain awaited values while Chromium performs navigation/GC (the same
    // ownership pattern as e2e-provider-recovery.mjs). Synchronous DOM polling
    // and pointer input continue to use the existing renderer client.
    renderer.run = async (fn, arg) => {
      const reply = await cdp.call("Runtime.evaluate", {
        expression: `globalThis.__closeoutCdpPromise = Promise.resolve((${fn})(${JSON.stringify(arg ?? null)}))`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (reply.exceptionDetails)
        throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
      return reply.result?.value;
    };
    await renderer.until(
      () =>
        Boolean(
          window.__PI_DESKTOP__ && window.piDesktop && !document.querySelector(".app-shell.is-booting"),
        ),
      null,
      "native app ready",
      45000,
    );
    return connectControl(dataDir);
  }

  async function ipc(name, input) {
    const result = await renderer.run(
      async ({ name, input }) =>
        window.piDesktop.invoke(
          window.piDesktop.channels.invoke[name],
          ...(input === undefined ? [] : [input]),
        ),
      { name, input },
    );
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    return result.data;
  }

  function processAlive(pid) {
    try {
      const status = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return Boolean(status && !status.startsWith("Z"));
    } catch {
      return false;
    }
  }
  function ownedDescendants(pid) {
    const rows = execFileSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((row) => row.trim().split(/\s+/).map(Number));
    const owned = new Set([pid]);
    let added = true;
    while (added) {
      added = false;
      for (const [id, parent] of rows)
        if (owned.has(parent) && !owned.has(id)) {
          owned.add(id);
          added = true;
        }
    }
    return [...owned];
  }

  return {
    boot,
    stop,
    ipc,
    get renderer() {
      return renderer;
    },
    get cdp() {
      return cdp;
    },
  };
}
