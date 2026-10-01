/**
 * Contract tests for the machine-local MCP control-plane preference and its
 * lifecycle: default off, immediate discovery on enable, `active: false` on
 * disable, idempotent clicks, environment precedence, a busy port, a failed
 * preference write, restart persistence, and no token in a status or a log.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  MCP_CONTROL_CONNECTION_FILE,
  MCP_CONTROL_ENV,
  MCP_CONTROL_PORT_ENV,
  MCP_CONTROL_SETTINGS_FILE,
  environmentMcpControlOverride,
  mcpControlConnectionFile,
  readMcpControlPreference,
  resolveMcpControlEffective,
  writeMcpControlPreference,
} = await import("../electron/main/mcp-control-settings.ts");
const { createMcpControlLifecycle } = await import("../electron/main/mcp-control-lifecycle.ts");

function newDataDir() {
  return mkdtempSync(join(tmpdir(), "pi-mcp-control-settings-"));
}

function settingsPath(dataDir) {
  return join(dataDir, MCP_CONTROL_SETTINGS_FILE);
}

function manifestPath(dataDir) {
  return join(dataDir, MCP_CONTROL_CONNECTION_FILE);
}

function connectionRecord(dataDir) {
  return JSON.parse(readFileSync(manifestPath(dataDir), "utf8"));
}

/** The status of a fresh profile: nothing saved, so off with no error. */
function offStatus(dataDir) {
  return {
    enabled: false,
    running: false,
    source: "preference",
    connectionFile: mcpControlConnectionFile(dataDir),
    error: null,
  };
}

/** The status is a status: neither the token nor the manifest may appear. */
function assertNoToken(status, logs, dataDir) {
  const secret = readFileSync(join(dataDir, "mcp-control.token"), "utf8").trim();
  assert.match(secret, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(JSON.stringify(logs).includes(secret), false);
  assert.equal(Object.hasOwn(status, "token"), false);
  assert.equal(Object.hasOwn(status, "url"), false);
  return secret;
}

/** Occupy a loopback port so the control plane cannot bind it. */
async function busyPort(t) {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  return blocker.address().port;
}

/**
 * One lifecycle over a throwaway profile, with its server slot observed the
 * way the composition root owns it. The invoke stub records every dispatch, so
 * a test can prove the control plane never drives an Agent turn.
 */
function fixture(t, { dataDir = newDataDir(), env = {} } = {}) {
  const opened = [];
  const logs = [];
  const calls = [];
  let server = null;
  const lifecycle = createMcpControlLifecycle({
    dataDir,
    env: { [MCP_CONTROL_PORT_ENV]: "0", ...env },
    getServer: () => server,
    setServer: (value) => {
      server = value;
      if (value) opened.push(value);
    },
    log: (level, message, data) => logs.push({ level, message, data }),
  });
  t.after(async () => {
    if (server) await server.stop();
  });
  return {
    dataDir,
    lifecycle,
    logs,
    opened,
    calls,
    get server() {
      return server;
    },
    attach: () =>
      lifecycle.startFromPreference({
        invoke: async (channel, args) => {
          calls.push({ channel, args });
          return { ok: true };
        },
        channels: {},
      }),
  };
}

test("the saved preference defaults to off and round-trips atomically", () => {
  const dataDir = newDataDir();
  assert.equal(readMcpControlPreference(dataDir), undefined);
  assert.deepEqual(resolveMcpControlEffective({ dataDir, env: {} }), {
    enabled: false,
    source: "preference",
  });

  writeMcpControlPreference(dataDir, true);
  assert.equal(readMcpControlPreference(dataDir), true);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath(dataDir), "utf8")), { enabled: true });
  assert.equal(statSync(settingsPath(dataDir)).mode & 0o777, 0o600);
  // One file, no half-written temporary, no token, no connection record.
  assert.deepEqual(readdirSync(dataDir), [MCP_CONTROL_SETTINGS_FILE]);

  writeMcpControlPreference(dataDir, false);
  assert.equal(readMcpControlPreference(dataDir), false);
  assert.equal(readdirSync(dataDir).length, 1);

  writeFileSync(settingsPath(dataDir), "{ not json");
  assert.equal(readMcpControlPreference(dataDir), undefined);
  assert.equal(resolveMcpControlEffective({ dataDir, env: {} }).enabled, false);
});

test("only an explicit 0 or 1 in the launch environment overrides the saved value", () => {
  assert.equal(environmentMcpControlOverride({ [MCP_CONTROL_ENV]: "1" }), true);
  assert.equal(environmentMcpControlOverride({ [MCP_CONTROL_ENV]: "0" }), false);
  for (const value of ["", "true", "yes", "2", "01", "off"]) {
    assert.equal(environmentMcpControlOverride({ [MCP_CONTROL_ENV]: value }), undefined);
  }

  const dataDir = newDataDir();
  writeMcpControlPreference(dataDir, true);
  assert.deepEqual(
    resolveMcpControlEffective({ dataDir, env: { [MCP_CONTROL_ENV]: "0" } }),
    { enabled: false, source: "environment" },
  );
  assert.deepEqual(
    resolveMcpControlEffective({ dataDir, env: { [MCP_CONTROL_ENV]: "1" } }),
    { enabled: true, source: "environment" },
  );
  assert.deepEqual(
    resolveMcpControlEffective({ dataDir, env: { [MCP_CONTROL_ENV]: "yes" } }),
    { enabled: true, source: "preference" },
  );
});

test("a profile with no saved preference boots without a listener or a manifest", async (t) => {
  const app = fixture(t);
  const status = await app.attach();
  assert.deepEqual(status, offStatus(app.dataDir));
  assert.equal(app.server, null);
  assert.equal(app.opened.length, 0);
  assert.deepEqual(readdirSync(app.dataDir), []);
  assert.deepEqual(app.calls, []);
});

test("enabling listens immediately, records the choice, and never leaks the token", async (t) => {
  const app = fixture(t);
  await app.attach();
  const status = await app.lifecycle.setEnabled(true);

  assert.deepEqual(status, {
    enabled: true,
    running: true,
    source: "preference",
    connectionFile: manifestPath(app.dataDir),
    error: null,
  });
  assert.equal(readMcpControlPreference(app.dataDir), true);

  const record = connectionRecord(app.dataDir);
  assert.equal(record.active, true);
  assert.match(record.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const secret = assertNoToken(status, app.logs, app.dataDir);
  // The manifest is the only place the token lives.
  assert.equal(record.token, secret);
  assert.equal(app.calls.length, 0);
});

test("repeated and concurrent enable requests open exactly one listener", async (t) => {
  const app = fixture(t);
  await app.attach();
  const first = await app.lifecycle.setEnabled(true);
  const second = await app.lifecycle.setEnabled(true);
  const [third, fourth] = await Promise.all([
    app.lifecycle.setEnabled(true),
    app.lifecycle.setEnabled(true),
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.deepEqual(fourth, first);
  assert.equal(app.opened.length, 1);
  assert.equal(app.lifecycle.status().running, true);
});

test("disabling stops only the control plane and never drives an Agent turn", async (t) => {
  const app = fixture(t);
  await app.attach();
  await app.lifecycle.setEnabled(true);
  const status = await app.lifecycle.setEnabled(false);

  assert.deepEqual(status, offStatus(app.dataDir));
  assert.equal(readMcpControlPreference(app.dataDir), false);
  assert.equal(connectionRecord(app.dataDir).active, false);
  assert.equal(app.server, null);
  assert.equal(existsSync(manifestPath(app.dataDir)), true);
  assert.deepEqual(app.calls, []);
});

test("a saved choice whose startup start fails reports the reason and stays retryable", async (t) => {
  const dataDir = newDataDir();
  writeMcpControlPreference(dataDir, true);
  const port = await busyPort(t);
  const app = fixture(t, { dataDir, env: { [MCP_CONTROL_PORT_ENV]: String(port) } });

  const status = await app.attach();
  assert.equal(status.enabled, true);
  assert.equal(status.running, false);
  assert.equal(status.source, "preference");
  assert.match(status.error, /EADDRINUSE/);
  assert.equal(app.server, null);
  assert.equal(app.opened.length, 0);
  // The desktop keeps opening, the saved choice is not flipped, and the single
  // boot attempt is reported once instead of retried in a loop.
  assert.equal(
    app.logs.filter((entry) => entry.level === "warn").length,
    1,
    JSON.stringify(app.logs),
  );

  // A retry is an ordinary enable request: it fails the same way while the
  // port is still taken, and the saved preference is untouched by either.
  const retry = await app.lifecycle.setEnabled(true);
  assert.equal(retry.running, false);
  assert.match(retry.error, /EADDRINUSE/);
  assert.equal(readMcpControlPreference(dataDir), true);
  assert.equal(app.opened.length, 0);
});

test("a busy control port fails the start without writing a preference", async (t) => {
  const app = fixture(t, {
    env: { [MCP_CONTROL_PORT_ENV]: String(await busyPort(t)) },
  });
  await app.attach();
  const status = await app.lifecycle.setEnabled(true);

  assert.equal(status.enabled, false);
  assert.equal(status.running, false);
  assert.equal(status.error?.includes("EADDRINUSE"), true);
  assert.equal(app.server, null);
  assert.equal(app.opened.length, 0);
  assert.equal(existsSync(settingsPath(app.dataDir)), false);
});

test("a failed preference save rolls the new server back and keeps the old value", async (t) => {
  const dataDir = newDataDir();
  const app = fixture(t, { dataDir });
  await app.attach();
  // A non-empty directory at the destination path fails the atomic rename
  // while every other write into the profile still succeeds.
  mkdirSync(settingsPath(dataDir));
  writeFileSync(join(settingsPath(dataDir), "keep.txt"), "previous configuration\n");

  const status = await app.lifecycle.setEnabled(true);
  assert.equal(status.enabled, false);
  assert.equal(status.running, false);
  assert.match(status.error, /could not be saved/);
  assert.equal(app.server, null);
  assert.equal(readdirSync(settingsPath(dataDir)).includes("keep.txt"), true);
  // The rolled-back listener is closed and its manifest is marked inactive.
  assert.equal(connectionRecord(dataDir).active, false);
});

test("an explicit environment decides the runtime without touching the saved value", async (t) => {
  const forcedOff = newDataDir();
  writeMcpControlPreference(forcedOff, true);
  const off = fixture(t, { dataDir: forcedOff, env: { [MCP_CONTROL_ENV]: "0" } });
  const booted = await off.attach();
  assert.deepEqual(booted, {
    enabled: false,
    running: false,
    source: "environment",
    connectionFile: manifestPath(forcedOff),
    error: null,
  });
  const refused = await off.lifecycle.setEnabled(true);
  assert.equal(refused.enabled, false);
  assert.equal(refused.running, false);
  assert.equal(refused.source, "environment");
  assert.match(refused.error, new RegExp(`${MCP_CONTROL_ENV}=0`));
  assert.equal(readMcpControlPreference(forcedOff), true);
  assert.equal(off.server, null);

  const forcedOnDir = newDataDir();
  writeMcpControlPreference(forcedOnDir, false);
  const forcedOn = fixture(t, { dataDir: forcedOnDir, env: { [MCP_CONTROL_ENV]: "1" } });
  const started = await forcedOn.attach();
  assert.equal(started.enabled, true);
  assert.equal(started.running, true);
  assert.equal(started.source, "environment");
  const stillRunning = await forcedOn.lifecycle.setEnabled(false);
  assert.equal(stillRunning.enabled, true);
  assert.equal(stillRunning.running, true);
  assert.equal(stillRunning.source, "environment");
  assert.match(stillRunning.error, new RegExp(`${MCP_CONTROL_ENV}=1`));
  assert.equal(readMcpControlPreference(forcedOnDir), false);
});

test("the enabled choice survives a restart and comes back without a click", async (t) => {
  const dataDir = newDataDir();
  const first = fixture(t, { dataDir });
  await first.attach();
  await first.lifecycle.setEnabled(true);
  // What `bootstrap/shutdown.ts` does on quit: close the same server slot.
  await first.server.stop();

  const second = fixture(t, { dataDir });
  const status = await second.attach();
  assert.deepEqual(status, {
    enabled: true,
    running: true,
    source: "preference",
    connectionFile: manifestPath(dataDir),
    error: null,
  });
  assert.equal(second.opened.length, 1);
  assert.equal(connectionRecord(dataDir).active, true);

  // A different profile is still off: the choice is machine-local, not global.
  const third = fixture(t);
  assert.deepEqual(await third.attach(), offStatus(third.dataDir));
});

test("the settings surface reports instead of starting before IPC registration", async (t) => {
  const app = fixture(t);
  const status = await app.lifecycle.setEnabled(true);
  assert.equal(status.running, false);
  assert.equal(status.enabled, false);
  assert.match(status.error, /before IPC registration/);
  assert.equal(app.opened.length, 0);
});

test("a start failure under an explicit environment is still retryable", async (t) => {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const app = fixture(t, {
    env: {
      [MCP_CONTROL_ENV]: "1",
      [MCP_CONTROL_PORT_ENV]: String(blocker.address().port),
    },
  });
  const failed = await app.attach();
  assert.equal(failed.enabled, true);
  assert.equal(failed.running, false);
  assert.equal(failed.source, "environment");
  assert.match(failed.error, /EADDRINUSE/);

  // The environment only refuses the *contradicting* direction: a request that
  // matches the effective value is applied, so the settings surface can retry
  // a start the environment asked for and boot could not complete.
  await new Promise((resolve) => blocker.close(resolve));
  const retried = await app.lifecycle.setEnabled(true);
  assert.deepEqual(retried, {
    enabled: true,
    running: true,
    source: "environment",
    connectionFile: manifestPath(app.dataDir),
    error: null,
  });
  assert.equal(app.opened.length, 1);

  // The contradicting direction stays reported, not applied.
  const refused = await app.lifecycle.setEnabled(false);
  assert.equal(refused.enabled, true);
  assert.equal(refused.running, true);
  assert.equal(refused.source, "environment");
  assert.match(refused.error, new RegExp(`${MCP_CONTROL_ENV}=1`));
});
