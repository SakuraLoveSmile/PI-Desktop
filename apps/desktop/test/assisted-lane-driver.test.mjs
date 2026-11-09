import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { AssistedLaneDriver } = await import("../electron/main/assisted-update/lane-driver.ts");
const { AssistedUpdateError } = await import("../electron/main/assisted-update/errors.ts");

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup({ mode = "in-app", failed = [] } = {}) {
  const states = [];
  const log = [];
  let current = { mode, status: "checking", currentVersion: "0.16.0" };
  let disposed = false;
  const prepares = [];
  const lane = {
    recover: async () => ({ confirmed: false }),
    prepare: (offer, hooks) => {
      const run = deferred();
      prepares.push({ version: offer.version, hooks, run });
      return run.promise;
    },
    discardPrepared: async () => log.push("discard"),
    install: async () => {},
    commitPendingInstall: async () => {},
    hasPendingInstall: () => false,
    skipsAutoInstall: (version) => failed.includes(version),
  };
  const driver = new AssistedLaneDriver(lane, {
    state: () => current,
    setState: (patch) => {
      current = { ...current, ...patch };
      states.push({ ...patch });
    },
    isDismissed: () => false,
    releaseNotes: () => undefined,
    manualReminder: () => true,
    isDisposed: () => disposed,
    log: (level, message) => log.push(`${level}:${message}`),
  });
  return {
    driver,
    prepares,
    log,
    states,
    state: () => current,
    dispose: () => {
      disposed = true;
      driver.dispose();
    },
  };
}

test("a newer offer cancels the running download and only its result counts", async () => {
  const t = setup();
  t.driver.onOffer({ version: "0.16.1" });
  await settle();
  t.driver.onOffer({ version: "0.16.2" });
  await settle();
  assert.equal(t.prepares.length, 2);
  assert.equal(t.prepares[0].hooks.signal.aborted, true, "the old download is cancelled");
  assert.equal(t.prepares[1].hooks.signal.aborted, false);

  t.prepares[1].run.resolve({ version: "0.16.2" });
  await settle();
  assert.equal(t.state().status, "downloaded");
  assert.equal(t.state().availableVersion, "0.16.2");

  // The cancelled download finishing late must not overwrite the newer result.
  t.prepares[0].run.resolve({ version: "0.16.1" });
  await settle();
  assert.equal(t.state().availableVersion, "0.16.2");
  assert.ok(t.log.includes("discard"), "its staged copy is discarded");
});

test("progress from a superseded download is ignored", async () => {
  const t = setup();
  t.driver.onOffer({ version: "0.16.1" });
  await settle();
  t.driver.onOffer({ version: "0.16.2" });
  await settle();
  t.prepares[0].hooks.onProgress(77);
  t.prepares[1].hooks.onProgress(12);
  assert.equal(t.state().progressPercent, 12);
});

test("an aborted lane error is not reported as a failure", async () => {
  const t = setup();
  t.driver.onOffer({ version: "0.16.1" });
  await settle();
  t.driver.dispose();
  t.prepares[0].run.reject(new AssistedUpdateError("aborted", "download cancelled"));
  await settle();
  assert.notEqual(t.state().status, "error");
});

test("manual mode only announces the offer", async () => {
  const t = setup({ mode: "manual" });
  t.driver.onOffer({ version: "0.16.1" });
  await settle();
  assert.equal(t.prepares.length, 0);
  assert.equal(t.state().status, "available");
  assert.equal(t.state().manualReminder, true);
});

test("downloading an offer that was never made is refused", async () => {
  const t = setup();
  await assert.rejects(() => t.driver.download("0.16.1"), /no update has been offered/);
  t.driver.onOffer({ version: "0.16.1" });
  await settle();
  await assert.rejects(() => t.driver.download("0.99.0"), /no update has been offered/);
});

test("results arriving after dispose never change the state", async () => {
  const t = setup();
  t.driver.onOffer({ version: "0.16.1" });
  await settle();
  const before = t.states.length;
  t.dispose();
  t.prepares[0].run.resolve({ version: "0.16.1" });
  await settle();
  assert.equal(t.states.length, before);
  assert.ok(t.log.includes("discard"));
});
