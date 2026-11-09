import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
register(pathToFileURL(join(here, "helpers/shutdown-module-stubs.mjs")));

const { registerShutdownHandlers } = await import("../electron/main/bootstrap/shutdown.ts");
const { app } = await import("./helpers/shutdown-electron-stub.mjs");

/** Registers the handlers against recording fakes and returns what happened. */
function arrange({ installing, commit, flushFails = false, confirm = async () => true } = {}) {
  app.reset();
  const order = [];
  const warnings = [];
  const state = {
    shutdownComplete: false,
    shutdownPromise: null,
    quitting: false,
    quitConfirmed: false,
    closeBehavior: "quit",
    tray: null,
    pluginLauncherAccelerator: null,
    toggleWindowAccelerator: null,
  };
  // A step is only finished once its ":done" entry exists, so the order proves
  // completion and not just the moment a step was started.
  const record = (name) => async () => {
    order.push(name);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(`${name}:done`);
  };
  registerShutdownHandlers({
    hasSingleInstanceLock: true,
    state,
    getHost: () => ({ dispose: record("host") }),
    getSidecar: () => ({ dispose: record("sidecar") }),
    getMcpControl: () => ({ stop: record("mcp-control") }),
    activeTurns: new Map(),
    persistenceOutbox: { flush: async () => undefined, size: () => 0 },
    inflightCheckpointer: {
      flushAll: async () => {
        if (flushFails) throw new Error("checkpoint failed");
      },
      dispose: () => order.push("checkpointer"),
    },
    pluginPanels: { closeAll: record("panels") },
    plugins: { disposeAll: record("plugins") },
    userMcp: { disposeAll: () => order.push("user-mcp") },
    browserHost: { dispose: () => order.push("browser") },
    pluginViews: { dispose: record("views") },
    updater: {
      dispose: () => order.push("updater"),
      isInstallingUpdate: () => installing ?? false,
      ...(commit
        ? {
            commitPendingInstall: async () => {
              order.push("commit");
              await commit();
            },
          }
        : {}),
    },
    logger: { app: (_area, level, message) => level === "warn" && warnings.push(message) },
    confirmQuitDialog: async () => {
      order.push("confirm");
      return confirm();
    },
    disposePowerSaveBlockers: () => order.push("power"),
    stopPlanSchedulePoller: () => order.push("poller"),
  });
  return { state, order, warnings };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("an update restart skips the confirmation and commits only after everything stopped", async () => {
  const t = arrange({ installing: true, commit: async () => undefined });
  app.quit();
  await t.state.shutdownPromise;
  await settle();
  assert.equal(t.order.includes("confirm"), false, "the user already chose to restart");
  assert.equal(t.order.at(-1), "commit", "the commit is the last step before Main exits");
  for (const step of ["panels", "views", "host", "mcp-control", "plugins", "sidecar"]) {
    const done = t.order.indexOf(`${step}:done`);
    assert.ok(done !== -1 && done < t.order.indexOf("commit"), `${step} must finish before the commit`);
  }
  assert.ok(t.order.indexOf("updater") < t.order.indexOf("commit"));
  assert.equal(app.exited, true);
});

test("an ordinary quit still asks first, and a refusal commits nothing", async () => {
  const t = arrange({ installing: false, commit: async () => undefined, confirm: async () => false });
  app.quit();
  await settle();
  assert.deepEqual(t.order, ["confirm"]);
  assert.equal(app.exited, false);
  assert.equal(t.state.quitConfirmed, false, "the next quit asks again");
});

test("a commit that fails is reported and the app still exits", async () => {
  const t = arrange({
    installing: true,
    commit: async () => {
      throw new Error("disk full");
    },
  });
  app.quit();
  await t.state.shutdownPromise;
  await settle();
  assert.deepEqual(t.warnings, ["update commit failed"]);
  assert.equal(app.exited, true);
});

test("a shutdown that fails before the end writes no commit and still exits", async () => {
  const t = arrange({ installing: true, commit: async () => undefined, flushFails: true });
  app.quit();
  await t.state.shutdownPromise.catch(() => undefined);
  await settle();
  assert.equal(t.order.includes("commit"), false, "the helper must not swap a half-stopped app");
  assert.equal(app.exited, true);
});

test("builds whose updater has no assisted lane quit as before", async () => {
  const t = arrange({ installing: false, confirm: async () => true });
  app.quit();
  await settle();
  await t.state.shutdownPromise;
  await settle();
  assert.equal(t.order.includes("commit"), false);
  assert.equal(app.exited, true);
});
