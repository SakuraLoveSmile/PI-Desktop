import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
register(pathToFileURL(join(here, "helpers/updater-module-stubs.mjs")));

const { AppUpdaterController } = await import("../electron/main/updater.ts");
const { app } = await import("./helpers/updater-electron-stub.mjs");

const ELIGIBLE = {
  eligible: true,
  bundlePath: "/Applications/Pi-Desktop-Plus.app",
  installDir: "/Applications",
};

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  logger = null;
  nextVersion = "0.16.1";
  downloadUpdateCalls = 0;
  quitAndInstallCalls = 0;
  flagsEverEnabled = false;

  async checkForUpdates() {
    this.emit("checking-for-update");
    const info = {
      version: this.nextVersion,
      files: [{ url: `Pi-Desktop-Plus-${this.nextVersion}-arm64-mac.zip`, sha512: "x", size: 1 }],
      path: "",
      sha512: "",
      releaseDate: "2026-11-09T00:00:00.000Z",
    };
    this.emit("update-available", info);
    return { updateInfo: info, cancellationToken: { cancel() {} }, downloadPromise: null };
  }

  async downloadUpdate() {
    this.downloadUpdateCalls += 1;
    return [];
  }

  quitAndInstall() {
    this.quitAndInstallCalls += 1;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeLane {
  calls = [];
  failed = new Set();
  pending = false;
  prepareImpl = async (offer) => ({ version: offer.version });
  recoverImpl = async () => ({ confirmed: false });
  installImpl = async () => {};
  hooks = [];

  recover() {
    this.calls.push("recover");
    return this.recoverImpl();
  }

  prepare(offer, hooks) {
    this.calls.push(`prepare:${offer.version}`);
    this.hooks.push(hooks);
    return this.prepareImpl(offer, hooks);
  }

  async discardPrepared() {
    this.calls.push("discard");
  }

  async install() {
    this.calls.push("install");
    await this.installImpl();
    this.pending = true;
  }

  async commitPendingInstall() {
    this.calls.push("commit");
    this.pending = false;
  }

  hasPendingInstall() {
    return this.pending;
  }

  skipsAutoInstall(version) {
    return this.failed.has(version);
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function createController({ updater, lane, settings = {}, eligibility = ELIGIBLE, persist }) {
  const warnings = [];
  const controller = new AppUpdaterController({
    logger: { app: (_c, level, message) => level === "warn" && warnings.push(message) },
    send: () => {},
    currentVersion: "0.16.0",
    platform: "darwin",
    isPackaged: true,
    autoUpdater: updater,
    readUpdateSettings: async () => settings,
    persistDismissedVersion: persist ?? (async () => {}),
    macSigning: "adhoc",
    assistedEligibility: eligibility,
    assistedLane: lane,
  });
  return { controller, warnings };
}

function guardFlags(updater) {
  // Squirrel.Mac must never see an ad-hoc bundle: the two flags that make
  // electron-updater download and install on its own stay off, always.
  for (const key of ["autoDownload", "autoInstallOnAppQuit"]) {
    let value = updater[key];
    Object.defineProperty(updater, key, {
      get: () => value,
      set: (next) => {
        if (next) updater.flagsEverEnabled = true;
        value = next;
      },
    });
  }
}

test("an eligible ad-hoc install reports the assisted lane and keeps Manual as the default", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  const { controller } = createController({ updater, lane });

  const state = controller.getState();
  assert.equal(state.delivery, "assisted");
  assert.equal(state.automaticSupported, true);
  assert.equal(state.defaultPreference, "manual");
  assert.equal(state.preference, "manual");
  assert.equal(state.mode, "manual");
  assert.equal(state.assistedBlockedReason, undefined);

  await controller.check();
  await settle();
  assert.equal(controller.getState().status, "available");
  assert.equal(controller.getState().manualReminder, true);
  assert.deepEqual(lane.calls.filter((c) => c.startsWith("prepare")), []);
  controller.dispose();
});

test("an ineligible ad-hoc install stays notify-and-link and says why", async () => {
  const updater = new FakeUpdater();
  const { controller } = createController({
    updater,
    lane: undefined,
    settings: { updatePreference: "automatic" },
    eligibility: { eligible: false, reason: "translocated" },
  });
  const state = controller.getState();
  assert.equal(state.delivery, undefined);
  assert.equal(state.assistedBlockedReason, "translocated");
  assert.equal(state.automaticSupported, false);
  await controller.check();
  assert.equal(controller.getState().mode, "manual");
  assert.equal(controller.getState().preference, "manual");
  controller.dispose();
});

test("Automatic downloads through the lane, never through electron-updater, and waits for the restart click", async () => {
  const updater = new FakeUpdater();
  guardFlags(updater);
  const lane = new FakeLane();
  const finish = deferred();
  lane.prepareImpl = async (offer, hooks) => {
    hooks.onProgress(40);
    await finish.promise;
    return { version: offer.version };
  };
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });

  await controller.check();
  await settle();
  assert.equal(controller.getState().mode, "in-app");
  assert.equal(controller.getState().delivery, "assisted");
  assert.equal(controller.getState().status, "downloading");
  assert.equal(controller.getState().progressPercent, 40);
  assert.deepEqual(lane.calls.filter((c) => c.startsWith("prepare")), ["prepare:0.16.1"]);

  finish.resolve();
  await settle();
  assert.equal(controller.getState().status, "downloaded");
  assert.equal(controller.getState().progressPercent, 100);
  assert.equal(app.quitCalls, 0, "a downloaded update never installs on its own");
  assert.equal(lane.calls.includes("install"), false);

  assert.equal(updater.downloadUpdateCalls, 0);
  assert.equal(updater.quitAndInstallCalls, 0);
  assert.equal(updater.flagsEverEnabled, false);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  controller.dispose();
});

test("restart starts the helper first, then quits; the commit is forwarded at shutdown", async () => {
  const updater = new FakeUpdater();
  guardFlags(updater);
  const lane = new FakeLane();
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  assert.equal(controller.getState().status, "downloaded");

  const quitsBefore = app.quitCalls;
  assert.equal(controller.isInstallingUpdate(), false);
  await controller.install();
  assert.deepEqual(lane.calls.slice(-1), ["install"]);
  assert.equal(controller.isInstallingUpdate(), true, "the quit that follows skips the confirmation");
  assert.equal(app.quitCalls, quitsBefore + 1);
  await controller.install();
  assert.equal(app.quitCalls, quitsBefore + 1, "a second restart click is ignored");

  await controller.commitPendingInstall();
  assert.deepEqual(lane.calls.slice(-1), ["commit"]);
  assert.equal(updater.quitAndInstallCalls, 0);
  assert.equal(updater.flagsEverEnabled, false);
  controller.dispose();
});

test("a helper that cannot start leaves the app running", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  lane.installImpl = async () => {
    throw new Error("cannot start the update helper");
  };
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  const quitsBefore = app.quitCalls;
  await assert.rejects(() => Promise.resolve(controller.install()), /cannot start the update helper/);
  assert.equal(controller.isInstallingUpdate(), false);
  assert.equal(app.quitCalls, quitsBefore);
  assert.equal(controller.getState().status, "downloaded");
  controller.dispose();
});

test("install is refused before the update is downloaded", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  lane.prepareImpl = () => new Promise(() => {});
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  assert.equal(controller.getState().status, "downloading");
  assert.throws(() => controller.install(), /no downloaded update/);
  assert.equal(lane.calls.includes("install"), false);
  controller.dispose();
});

test("dismissing while the lane downloads cancels it, discards the copy and ignores its late result", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  const finish = deferred();
  lane.prepareImpl = async (offer) => {
    await finish.promise;
    return { version: offer.version };
  };
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  const signal = lane.hooks[0].signal;
  assert.equal(signal.aborted, false);

  await controller.dismiss();
  assert.equal(signal.aborted, true);
  assert.equal(controller.getState().status, "available");
  assert.equal(controller.getState().dismissed, true);
  assert.ok(lane.calls.includes("discard"));

  finish.resolve();
  await settle();
  assert.equal(controller.getState().status, "available", "a late result must not mark it downloaded");
  controller.dispose();
});

test("a failed download surfaces the error and an explicit download retries through the lane", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  let attempt = 0;
  lane.prepareImpl = async (offer) => {
    attempt += 1;
    if (attempt === 1) throw new Error("the download does not match the release SHA-512");
    return { version: offer.version };
  };
  const { controller, warnings } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  assert.equal(controller.getState().status, "error");
  assert.match(controller.getState().error, /SHA-512/);
  assert.ok(warnings.includes("assisted update failed"));

  await controller.download();
  assert.equal(controller.getState().status, "downloaded");
  assert.equal(updater.downloadUpdateCalls, 0, "retries never use electron-updater's download");
  controller.dispose();
});

test("a version whose in-place install failed is not installed again on its own", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  lane.failed.add("0.16.1");
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  assert.equal(controller.getState().status, "available");
  assert.equal(controller.getState().assistedInstallFailed, true);
  assert.deepEqual(lane.calls.filter((c) => c.startsWith("prepare")), []);

  await controller.download();
  assert.deepEqual(lane.calls.filter((c) => c.startsWith("prepare")), ["prepare:0.16.1"]);
  assert.equal(controller.getState().status, "downloaded");

  updater.nextVersion = "0.16.2";
  lane.failed.clear();
  controller.dispose();
});

test("nothing downloads until the previous run's leftovers are settled", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  const recovered = deferred();
  lane.recoverImpl = () => recovered.promise.then(() => ({ confirmed: true }));
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  assert.deepEqual(lane.calls.filter((c) => c.startsWith("prepare")), []);

  recovered.resolve();
  await settle();
  assert.deepEqual(lane.calls.filter((c) => c.startsWith("prepare")), ["prepare:0.16.1"]);
  controller.dispose();
});

test("a recovery failure does not block updates", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  lane.recoverImpl = async () => {
    throw new Error("disk unavailable");
  };
  const { controller, warnings } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  assert.ok(warnings.includes("assisted update recovery failed"));
  assert.equal(controller.getState().status, "downloaded");
  controller.dispose();
});

test("disposing the controller cancels the running download", async () => {
  const updater = new FakeUpdater();
  const lane = new FakeLane();
  lane.prepareImpl = () => new Promise(() => {});
  const { controller } = createController({
    updater,
    lane,
    settings: { updatePreference: "automatic" },
  });
  await controller.check();
  await settle();
  controller.dispose();
  assert.equal(lane.hooks[0].signal.aborted, true);
});
