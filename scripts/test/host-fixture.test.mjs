import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

import { Host } from "../e2e/host.mjs";

function controlledShutdown(t) {
  const waits = [];
  const signals = [];
  let readerCloses = 0;
  let resolveExit;
  t.mock.method(globalThis, "setTimeout", (callback, ms) => {
    const timer = { callback, ms };
    waits.push(timer);
    return timer;
  });
  const host = new Host("/unused/host", "/unused/data");
  host.child = {
    pid: 42,
    kill(signal = "SIGTERM") {
      signals.push(signal);
      return true;
    },
  };
  host.stdoutReader = { close() { readerCloses++; } };
  host.exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  const stopped = host.stop().then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );
  const exit = () => {
    host.exited = true;
    resolveExit({ code: 0, signal: "SIGTERM" });
  };
  t.after(async () => {
    exit();
    await stopped;
  });
  return { host, waits, signals, stopped, exit, readerCloses: () => readerCloses };
}

test("fixture shutdown uses the embedder timer and preserves both escalation budgets", async (t) => {
  const probe = controlledShutdown(t);
  assert.deepEqual(probe.signals, ["SIGTERM"]);
  assert.deepEqual(probe.waits.map(({ ms }) => ms), [3_000]);

  probe.waits.shift().callback();
  await setImmediate();
  assert.deepEqual(probe.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(probe.waits.map(({ ms }) => ms), [3_000]);

  probe.waits.shift().callback();
  const result = await probe.stopped;
  assert.equal(result.ok, false);
  assert.equal(result.error.message, "host did not exit during cleanup");
  assert.equal(probe.readerCloses(), 1);
  assert.equal(probe.host.child, null);
});

test("fixture shutdown observes graceful exit without escalation", async (t) => {
  const probe = controlledShutdown(t);
  assert.deepEqual(probe.waits.map(({ ms }) => ms), [3_000]);
  probe.exit();
  assert.deepEqual(await probe.stopped, { ok: true });
  assert.deepEqual(probe.signals, ["SIGTERM"]);
  assert.equal(probe.readerCloses(), 1);
  assert.equal(probe.host.child, null);
});
