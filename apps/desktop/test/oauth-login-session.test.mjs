import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The module imports shared types the bundler way.
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { beginOAuthLogin } = await import("../src/lib/oauth-login-session.ts");

/**
 * The preload API, with the start call held open so a test can emit events
 * while the renderer still does not know the login id — the window in which
 * OpenAI Codex asks its browser-or-device-code question.
 */
function fakeApi({ loginId = "login-1" } = {}) {
  const listeners = new Set();
  const calls = [];
  let settle;
  const started = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  return {
    calls,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    /** Let `startOauthLogin` resolve, as the IPC reply eventually would. */
    finishStart: async () => {
      settle.resolve({ loginId });
      await started.catch(() => undefined);
      // Give the `.then` continuation that flushes held events a turn to run.
      await Promise.resolve();
      await Promise.resolve();
    },
    failStart: async (error) => {
      settle.reject(error);
      await started.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    },
    listenerCount: () => listeners.size,
    api: {
      onOauthLogin: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      startOauthLogin: (vendorId) => {
        calls.push({ method: "start", vendorId });
        return started;
      },
      respondOauthLogin: async (input) => {
        calls.push({ method: "respond", ...input });
        return { ok: true };
      },
      cancelOauthLogin: async (id) => {
        calls.push({ method: "cancel", loginId: id });
        return { ok: true };
      },
    },
  };
}

test("a prompt raised before the login id is known still reaches the dialog", async () => {
  const fake = fakeApi();
  const events = [];
  const session = beginOAuthLogin({
    api: fake.api,
    vendorId: "openai-codex",
    onEvent: (event) => events.push(event),
    onError: (message) => events.push({ kind: "onError", message }),
  });

  // pi-ai's Codex flow asks its first question in the same tick the login
  // begins, long before the start reply carries the id back.
  fake.emit({
    kind: "prompt",
    loginId: "login-1",
    request: { promptId: "p1", type: "select", message: "How do you want to sign in?" },
  });
  assert.deepEqual(events, [], "held until the id is known");

  await fake.finishStart();

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "prompt");
  assert.equal(events[0].request.promptId, "p1");
  session.dispose();
});

test("held events are released in order, and later ones flow straight through", async () => {
  const fake = fakeApi();
  const events = [];
  const session = beginOAuthLogin({
    api: fake.api,
    vendorId: "openai-codex",
    onEvent: (event) => events.push(event),
    onError: () => {},
  });

  fake.emit({ kind: "info", loginId: "login-1", message: "one" });
  fake.emit({ kind: "progress", loginId: "login-1", message: "two" });
  await fake.finishStart();
  fake.emit({ kind: "progress", loginId: "login-1", message: "three" });

  assert.deepEqual(
    events.map((event) => event.message),
    ["one", "two", "three"],
  );
  session.dispose();
});

test("another attempt's events are dropped, held or live", async () => {
  const fake = fakeApi();
  const events = [];
  const session = beginOAuthLogin({
    api: fake.api,
    vendorId: "openai-codex",
    onEvent: (event) => events.push(event),
    onError: () => {},
  });

  fake.emit({ kind: "info", loginId: "other", message: "held-stranger" });
  await fake.finishStart();
  fake.emit({ kind: "info", loginId: "other", message: "live-stranger" });
  fake.emit({ kind: "info", loginId: "login-1", message: "mine" });

  assert.deepEqual(
    events.map((event) => event.message),
    ["mine"],
  );
  session.dispose();
});

test("respond and cancel wait for the id rather than racing it", async () => {
  const fake = fakeApi();
  const session = beginOAuthLogin({
    api: fake.api,
    vendorId: "openai-codex",
    onEvent: () => {},
    onError: () => {},
  });

  const responded = session.respond("p1", "browser");
  const cancelled = session.cancel();
  assert.deepEqual(
    fake.calls.map((call) => call.method),
    ["start"],
    "nothing is sent before the id arrives",
  );

  await fake.finishStart();
  await responded;
  assert.equal(await cancelled, true);
  assert.deepEqual(fake.calls, [
    { method: "start", vendorId: "openai-codex" },
    { method: "respond", loginId: "login-1", promptId: "p1", value: "browser" },
    { method: "cancel", loginId: "login-1" },
  ]);
  session.dispose();
});

test("a start that fails reports once and answers nothing afterwards", async () => {
  const fake = fakeApi();
  const errors = [];
  const session = beginOAuthLogin({
    api: fake.api,
    vendorId: "openai-codex",
    onEvent: () => {},
    onError: (message) => errors.push(message),
  });

  await fake.failStart(new Error("no flow registered"));

  assert.deepEqual(errors, ["no flow registered"]);
  await session.respond("p1", "browser");
  assert.equal(await session.cancel(), false, "cancel closes the dialog directly");
  assert.deepEqual(
    fake.calls.map((call) => call.method),
    ["start"],
  );
  session.dispose();
});

test("disposing stops delivery and unsubscribes", async () => {
  const fake = fakeApi();
  const events = [];
  const session = beginOAuthLogin({
    api: fake.api,
    vendorId: "openai-codex",
    onEvent: (event) => events.push(event),
    onError: () => {},
  });

  fake.emit({ kind: "info", loginId: "login-1", message: "held" });
  session.dispose();
  assert.equal(fake.listenerCount(), 0);

  await fake.finishStart();
  fake.emit({ kind: "info", loginId: "login-1", message: "live" });
  assert.deepEqual(events, [], "a closed dialog never sees state updates");
});
