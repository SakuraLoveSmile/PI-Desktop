import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { readNdjsonLines } from "../../packages/shared/dist/ndjson.js";
import { assert, shortJson } from "./assert.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function hostBinaryCandidates() {
  const names =
    process.platform === "win32"
      ? ["pi-desktop-host-core.exe", "pi-desktop-host-core"]
      : ["pi-desktop-host-core"];
  const candidates = [];
  const configured = process.env.PI_DESKTOP_HOST_BIN;
  if (configured) {
    const configuredPath = resolve(configured);
    candidates.push(configuredPath);
    if (
      process.platform === "win32" &&
      !configuredPath.toLowerCase().endsWith(".exe")
    ) {
      candidates.push(configuredPath + ".exe");
    }
  }
  for (const name of names) {
    candidates.push(join(root, "target", "debug", name));
    candidates.push(join(root, "..", "..", "..", "target", "debug", name));
  }
  return candidates;
}

export function resolveHostBinary() {
  const candidates = hostBinaryCandidates();
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error(
      "host binary missing; set PI_DESKTOP_HOST_BIN. Tried: " + candidates.join(", "),
    );
  }
  return resolve(binary);
}

function rpcErrorFromWire(wire, method) {
  const error = new Error(method + ": " + (wire?.message || shortJson(wire)));
  error.errorCode = wire?.data?.errorCode;
  error.rpc = wire;
  return error;
}

function failPending(pending, error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

export class Host {
  constructor(binary, dataDir, lifecycle = () => {}) {
    this.binary = binary;
    this.dataDir = dataDir;
    this.lifecycle = lifecycle;
    this.child = null;
    this.stdoutReader = null;
    this.pending = new Map();
    this.notifications = [];
    this.stderr = "";
    this.exited = false;
    this.exitPromise = Promise.resolve();
  }

  async start(protocolVersion = 11) {
    if (this.child) throw new Error("host is already running");
    this.pending = new Map();
    this.notifications = [];
    this.stderr = "";
    this.exited = false;
    const child = spawn(this.binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PI_DESKTOP_DATA_DIR: this.dataDir },
    });
    this.child = child;
    this.lifecycle("child-spawned", { pid: child.pid });
    this.exitPromise = new Promise((resolveExit) => {
      child.once("exit", (code, signal) => {
        this.exited = true;
        this.lifecycle("child-exit", { pid: child.pid, code, signal });
        const suffix = this.stderr.trim()
          ? " stderr=" + this.stderr.trim().slice(-500)
          : "";
        failPending(
          this.pending,
          new Error(
            "host exited code=" + code + " signal=" + (signal || "none") + suffix,
          ),
        );
        resolveExit({ code, signal });
      });
    });
    child.on("error", (error) => {
      this.lifecycle("child-error", { pid: child.pid, errorName: error.name, code: error.code });
      failPending(this.pending, error);
    });
    child.once("close", (code, signal) => {
      this.lifecycle("child-close", { pid: child.pid, code, signal });
    });
    child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk);
      if (process.env.DEBUG_HOST) process.stderr.write(chunk);
    });
    this.stdoutReader = readNdjsonLines(child.stdout, (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        if (process.env.DEBUG_HOST) console.error("host non-JSON stdout: " + line);
        return;
      }
      if (message.id !== undefined && message.id !== null) {
        const entry = this.pending.get(String(message.id));
        if (!entry) return;
        this.pending.delete(String(message.id));
        clearTimeout(entry.timer);
        if (message.error) entry.reject(rpcErrorFromWire(message.error, entry.method));
        else entry.resolve(message.result);
        return;
      }
      if (message.method) {
        this.notifications.push(message);
        if (this.notifications.length > 2_000) this.notifications.shift();
      }
    });

    const handshake = await this.call(
      "app.handshake",
      { protocolVersion },
      45_000,
    );
    assert(
      handshake?.protocolVersion === protocolVersion,
      "handshake protocol mismatch: " + shortJson(handshake),
    );
    return handshake;
  }

  call(method, params = {}, timeoutMs = 30_000) {
    if (!this.child || this.exited) {
      return Promise.reject(new Error("host is not running for " + method));
    }
    const id = randomUUID();
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        rejectResult(new Error("timeout " + method + " after " + timeoutMs + "ms"));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolveResult,
        reject: rejectResult,
        timer,
      });
      try {
        this.child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectResult(error);
      }
    });
  }

  clearNotifications() {
    this.notifications = [];
  }

  matchingNotifications(method, predicate = () => true) {
    return this.notifications.filter(
      (note) => note.method === method && predicate(note),
    );
  }

  async stop() {
    const child = this.child;
    this.lifecycle("stop-begin", { pid: child?.pid, exited: this.exited, pendingCount: this.pending.size });
    if (!child) {
      this.lifecycle("stop-complete", { childPresent: false });
      return;
    }
    failPending(this.pending, new Error("host stopped by harness"));
    this.lifecycle("stop-pending-failed", { pid: child.pid, pendingCount: this.pending.size });
    this.lifecycle("signal-start", { pid: child.pid, signal: "SIGTERM" });
    let termSent = null;
    try {
      termSent = child.kill();
    } catch (error) {
      // The exit event below is the authoritative cleanup signal.
      this.lifecycle("signal-error", { pid: child.pid, signal: "SIGTERM", errorName: error.name, code: error.code });
    }
    this.lifecycle("signal-end", { pid: child.pid, signal: "SIGTERM", sent: termSent });
    this.lifecycle("exit-wait-start", { pid: child.pid, signal: "SIGTERM", budgetMs: 3_000 });
    await Promise.race([this.exitPromise, delay(3_000)]);
    this.lifecycle("exit-wait-end", { pid: child.pid, signal: "SIGTERM", exited: this.exited });
    if (!this.exited) {
      this.lifecycle("signal-start", { pid: child.pid, signal: "SIGKILL" });
      let killSent = null;
      try {
        killSent = child.kill("SIGKILL");
      } catch (error) {
        // Best effort on platforms without SIGKILL semantics.
        this.lifecycle("signal-error", { pid: child.pid, signal: "SIGKILL", errorName: error.name, code: error.code });
      }
      this.lifecycle("signal-end", { pid: child.pid, signal: "SIGKILL", sent: killSent });
      this.lifecycle("exit-wait-start", { pid: child.pid, signal: "SIGKILL", budgetMs: 3_000 });
      await Promise.race([this.exitPromise, delay(3_000)]);
      this.lifecycle("exit-wait-end", { pid: child.pid, signal: "SIGKILL", exited: this.exited });
    }
    this.lifecycle("reader-close-start", { pid: child.pid, readerPresent: Boolean(this.stdoutReader) });
    this.stdoutReader?.close();
    this.lifecycle("reader-close-end", { pid: child.pid });
    this.stdoutReader = null;
    this.child = null;
    if (!this.exited) throw new Error("host did not exit during cleanup");
    this.lifecycle("stop-complete", { pid: child.pid, exited: this.exited });
  }

  async restart(protocolVersion = 11) {
    await this.stop();
    await this.start(protocolVersion);
  }
}
