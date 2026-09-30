/**
 * Behavior tests for the supplemental macOS Local Network trigger.
 *
 * macOS 15+ gates local-network traffic behind a user alert, and Apple treats a
 * UDP `connect()` as an implicit trigger for that alert without sending traffic.
 * The trigger therefore exists for exactly one situation: the user asked for a
 * manual "Fetch list" against a LAN endpoint, and the app wants the alert raised
 * before the request that needs the permission. None of these verdicts means
 * "permission granted" — a callback is trigger evidence, not authorization.
 *
 * Every dependency is injected here (platform, proxy route, resolver, socket,
 * clock), so each phase is driven explicitly and nothing sleeps. The real
 * `classifyIpLiteral` / `classifyProxyRoute` policy from `@pi-desktop/shared` is
 * plugged in unchanged: the module must reuse that classification rather than
 * restate it, so these tests exercise the genuine address and route rules.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import {
  classifyIpLiteral,
  classifyProxyRoute,
} from "../../../packages/shared/src/public-network.ts";

const nodeRequire = createRequire(import.meta.url);

/**
 * The only Electron surface the lazy `await import("electron")` may reach, plus
 * a call record so a test can prove the default proxy lookup is wired to it.
 */
const electronStub = {
  calls: [],
  session: {
    defaultSession: {
      resolveProxy: async (url) => {
        electronStub.calls.push(url);
        return "DIRECT";
      },
    },
  },
};

/** Minimal CJS loader for the main-process module under test. */
function load(relative, imports = {}) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file.pathname,
  });
  const mapped = {
    "@pi-desktop/shared": { classifyIpLiteral, classifyProxyRoute },
    electron: electronStub,
    ...imports,
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      if (Object.hasOwn(mapped, id)) return mapped[id];
      assert.ok(id.startsWith("node:"), `unexpected main-process dependency: ${id}`);
      return nodeRequire(id);
    },
    module.exports,
    module,
  );
  return module.exports;
}

const localNetworkPermission = load("../electron/main/local-network-permission.ts");

/** A fake clock the test drives: nothing fires until `fire()` is called. */
function fakeClock() {
  const timers = [];
  return {
    timers,
    setTimer(callback, ms) {
      const handle = { callback, ms, cleared: false, fired: false };
      timers.push(handle);
      return handle;
    },
    clearTimer(handle) {
      if (handle && typeof handle === "object") handle.cleared = true;
    },
    fire(handle) {
      assert.ok(handle, "no budget timer was registered");
      handle.fired = true;
      handle.callback();
    },
  };
}

/**
 * A datagram socket stand-in that records every call. `send`, `write` and
 * `bind` exist only as tripwires: a trigger that wrote anything would fail a
 * test instead of passing silently.
 */
function makeSocket(family, record) {
  const socket = {
    family,
    connects: [],
    writes: [],
    binds: [],
    closeCalls: 0,
    errorListener: undefined,
    removedListeners: [],
    throwOnClose: false,
    connect(port, address, callback) {
      socket.connects.push({ port, address, callback });
      record.push(["connect", port, address]);
    },
    send(...args) {
      socket.writes.push(["send", ...args]);
      record.push(["send"]);
    },
    write(...args) {
      socket.writes.push(["write", ...args]);
      record.push(["write"]);
    },
    bind(...args) {
      socket.binds.push(args);
      record.push(["bind"]);
    },
    on(event, listener) {
      record.push(["on", event]);
      if (event === "error") socket.errorListener = listener;
    },
    removeAllListeners(event) {
      record.push(["removeAllListeners", event]);
      socket.removedListeners.push(event);
      if (event === undefined || event === "error") socket.errorListener = undefined;
    },
    close() {
      socket.closeCalls += 1;
      record.push(["close"]);
      if (socket.throwOnClose) throw new Error("ERR_SOCKET_DGRAM_NOT_RUNNING");
    },
  };
  return socket;
}

/** A controller wired to recording fakes, so a test can drive every phase. */
function harness(options = {}) {
  const record = [];
  const sockets = [];
  const clock = fakeClock();
  const lifecycle = options.lifecycle ?? { on: () => {}, removeListener: () => {} };
  const dependencies = {
    platform: options.platform ?? "darwin",
    resolveProxy: async (url) => {
      record.push(["resolveProxy", url]);
      if (options.resolveProxy) return options.resolveProxy(url);
      return options.proxyList ?? "DIRECT";
    },
    lookup: async (hostname, lookupOptions) => {
      record.push(["lookup", hostname, lookupOptions]);
      if (options.lookup) return options.lookup(hostname, lookupOptions);
      return options.records ?? [];
    },
    createSocket: (family) => {
      record.push(["createSocket", family]);
      const socket = makeSocket(family, record);
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, ms) => clock.setTimer(callback, ms),
    clearTimer: (handle) => clock.clearTimer(handle),
  };
  const controller = localNetworkPermission.createLocalNetworkPermissionController({
    dependencies,
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    lifecycle,
  });
  return {
    controller,
    clock,
    record,
    sockets,
    lifecycle,
    calls: (kind) => record.filter(([recorded]) => recorded === kind),
  };
}

/** Let one short promise chain finish; never a sleep. */
async function drain(turns = 20) {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

async function until(predicate, message) {
  for (let turn = 0; turn < 100 && !predicate(); turn += 1) await Promise.resolve();
  assert.ok(predicate(), message);
}

/** A tripwire: the proxy resolver, the resolver and the socket were untouched. */
function assertNoNetworkWork(h, message) {
  assert.deepEqual(h.calls("resolveProxy"), [], `${message}: proxy lookup`);
  assert.deepEqual(h.calls("lookup"), [], `${message}: DNS`);
  assert.deepEqual(h.calls("createSocket"), [], `${message}: socket`);
  assert.deepEqual(h.sockets, [], `${message}: sockets`);
}

/** The connect call the socket under test recorded. */
function connectOf(socket) {
  assert.equal(socket.connects.length, 1, "the trigger must issue exactly one connect");
  return socket.connects[0];
}

test("the module keeps Electron lazy so node --test can load it", () => {
  const source = fs.readFileSync(
    new URL("../electron/main/local-network-permission.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["']electron["']/, "no static electron import");
  assert.doesNotMatch(source, /require\(["']electron["']\)/, "no static electron require");
  assert.match(source, /await import\("electron"\)/, "Electron is resolved lazily");
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    specifiers.filter((id) => !id.startsWith("node:")),
    ["@pi-desktop/shared"],
    "the shared policy is the only non-builtin static import",
  );
});

test("a non-macOS host skips the trigger without touching the network", async () => {
  const h = harness({ platform: "linux" });
  const result = await h.controller.trigger("http://192.168.1.50:8080/v1");
  assert.deepEqual(result, { status: "skipped", stage: "platform", reason: "not-macos" });
  assertNoNetworkWork(h, "a non-macOS host");
  assert.ok(
    h.clock.timers.every((timer) => timer.cleared),
    "a skipped platform check must not leave a budget running",
  );
});

test("a literal outside the local classes never reaches a socket", async () => {
  const cases = [
    ["http://127.0.0.1:11434/v1", "loopback"],
    ["http://8.8.8.8/v1", "public"],
    ["http://198.18.0.1/v1", "benchmark fake-IP"],
    ["http://0.0.0.0/v1", "unspecified"],
    ["http://224.0.0.1/v1", "multicast"],
    ["http://192.0.2.10/v1", "documentation"],
    ["http://100.64.0.9/v1", "CGNAT"],
    ["http://240.0.0.1/v1", "reserved"],
    ["http://[2001:db8::1]/v1", "documentation IPv6"],
    ["http://[::]/v1", "unspecified IPv6"],
  ];
  for (const [url, label] of cases) {
    const h = harness();
    assert.deepEqual(
      await h.controller.trigger(url),
      { status: "skipped", stage: "hostname", reason: "address-not-local" },
      `${url} (${label})`,
    );
    // The route check runs before the address gate, so the resolver and the
    // socket are what must stay untouched for a refused address.
    assert.deepEqual(h.calls("resolveProxy").length, 1, url);
    assert.deepEqual(h.calls("lookup"), [], `${url}: DNS`);
    assert.deepEqual(h.calls("createSocket"), [], `${url}: socket`);
  }
});

test("an eligible literal is dialled on the effective port", async () => {
  const cases = [
    ["http://192.168.1.50:8080/v1", 4, "192.168.1.50", 8080],
    ["http://192.168.1.50/v1", 4, "192.168.1.50", 80],
    ["https://192.168.1.50/v1", 4, "192.168.1.50", 443],
    ["http://169.254.10.20/v1", 4, "169.254.10.20", 80],
    ["http://[fd00::5]:9000/v1", 6, "fd00::5", 9000],
    ["https://[fd00::5]/v1", 6, "fd00::5", 443],
    ["http://[fec0::1]/v1", 6, "fec0::1", 80],
  ];
  for (const [url, family, address, port] of cases) {
    const h = harness();
    const pending = h.controller.trigger(url);
    await until(() => h.sockets.length === 1, `no socket was created for ${url}`);
    const socket = h.sockets[0];
    assert.equal(socket.family, family, `${url}: socket family`);
    const connect = connectOf(socket);
    assert.equal(connect.address, address, `${url}: address`);
    assert.equal(connect.port, port, `${url}: effective port`);
    // The verdict arrives from the connect callback, never from the connect call.
    connect.callback();
    assert.deepEqual(
      await pending,
      { status: "attempted", stage: "connect", reason: "connect-established" },
      url,
    );
    assert.equal(socket.closeCalls, 1, `${url}: the socket is closed`);
    assert.equal(socket.errorListener, undefined, `${url}: the listener is removed`);
    assert.equal(h.clock.timers.length, 1, `${url}: exactly one budget`);
    assert.equal(h.clock.timers[0].ms, 1500, `${url}: the default budget is 1500 ms`);
    assert.equal(h.clock.timers[0].cleared, true, `${url}: the budget is cleared`);
  }
});

test("localhost names skip before any DNS or proxy work", async () => {
  const urls = [
    "http://localhost:8080/v1",
    "http://LOCALHOST/v1",
    "http://localhost./v1",
    "https://app.localhost/v1",
  ];
  for (const url of urls) {
    const h = harness();
    assert.deepEqual(
      await h.controller.trigger(url),
      { status: "skipped", stage: "hostname", reason: "loopback-name" },
      url,
    );
    assertNoNetworkWork(h, url);
  }
});

test("a direct hostname is resolved once and its first local address dialled", async () => {
  const h = harness({
    records: [
      { address: "8.8.8.8", family: 4 },
      { address: "198.18.0.1", family: 4 },
      { address: "10.0.0.7", family: 4 },
      { address: "192.168.4.4", family: 4 },
    ],
  });
  const pending = h.controller.trigger("http://lan-gateway.test:8080/v1");
  await until(() => h.sockets.length === 1, "no socket was created");
  assert.deepEqual(
    h.calls("lookup"),
    [["lookup", "lan-gateway.test", { all: true }]],
    "exactly one bounded lookup for the endpoint host",
  );
  const connect = connectOf(h.sockets[0]);
  assert.equal(connect.address, "10.0.0.7", "the first eligible address wins");
  assert.equal(connect.port, 8080);
  connect.callback();
  assert.deepEqual(await pending, {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });
  assert.equal(h.calls("lookup").length, 1, "no retry and no second lookup");
});

test("an answer with no local address is not dialled", async () => {
  const cases = [
    [
      [
        { address: "8.8.8.8", family: 4 },
        { address: "192.0.2.5", family: 4 },
        { address: "not-an-address", family: 4 },
      ],
      "public, documentation and unparsable answers",
    ],
    [[{ address: "198.18.0.1", family: 4 }], "a lone fake-IP answer"],
    [[], "an empty answer"],
  ];
  for (const [records, label] of cases) {
    const h = harness({ records });
    assert.deepEqual(
      await h.controller.trigger("http://lan-gateway.test/v1"),
      { status: "skipped", stage: "hostname", reason: "no-local-address" },
      label,
    );
    assert.equal(h.calls("lookup").length, 1, label);
    assert.deepEqual(h.calls("createSocket"), [], label);
  }
});

test("a scope-less IPv6 link-local is refused as its own reason", async () => {
  const asLiteral = harness();
  assert.deepEqual(
    await asLiteral.controller.trigger("http://[fe80::1]/v1"),
    { status: "skipped", stage: "hostname", reason: "link-local-without-scope" },
  );
  assert.deepEqual(asLiteral.calls("createSocket"), []);

  const asAnswer = harness({ records: [{ address: "fe80::1", family: 6 }] });
  assert.deepEqual(
    await asAnswer.controller.trigger("http://lan-gateway.test/v1"),
    { status: "skipped", stage: "hostname", reason: "link-local-without-scope" },
  );
  assert.deepEqual(asAnswer.calls("createSocket"), []);

  // The specific reason only explains the outcome when every candidate had it.
  const mixed = harness({
    records: [
      { address: "fe80::1", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ],
  });
  assert.deepEqual(
    await mixed.controller.trigger("http://lan-gateway.test/v1"),
    { status: "skipped", stage: "hostname", reason: "no-local-address" },
  );

  // A scope-qualified link-local names the interface to route through, so it is
  // dialable exactly as the resolver reported it.
  const scoped = harness({ records: [{ address: "fe80::1%en0", family: 6 }] });
  const pending = scoped.controller.trigger("http://lan-gateway.test/v1");
  await until(() => scoped.sockets.length === 1, "a scoped link-local must be dialled");
  const connect = connectOf(scoped.sockets[0]);
  assert.equal(connect.address, "fe80::1%en0");
  assert.equal(scoped.sockets[0].family, 6);
  connect.callback();
  assert.deepEqual(await pending, {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });
});

test("a proxied or unreadable route never probes the local network", async () => {
  const skipped = [
    ["PROXY 127.0.0.1:7890", "proxied-route"],
    ["DIRECT; PROXY 127.0.0.1:7890", "unknown-route"],
    ["", "unknown-route"],
    ["SOCKS5", "unknown-route"],
  ];
  for (const [proxyList, reason] of skipped) {
    const h = harness({ proxyList });
    assert.deepEqual(
      await h.controller.trigger("http://192.168.1.50:8080/v1"),
      { status: "skipped", stage: "proxy", reason },
      `route "${proxyList}"`,
    );
    assert.equal(h.calls("resolveProxy").length, 1);
    assert.deepEqual(h.calls("lookup"), [], proxyList);
    assert.deepEqual(h.calls("createSocket"), [], proxyList);
  }

  const failing = harness({
    resolveProxy: () => {
      const error = new Error("resolveProxy exploded for 192.168.1.50");
      error.code = "ENOTFOUND";
      throw error;
    },
  });
  const failed = await failing.controller.trigger("http://192.168.1.50:8080/v1");
  assert.deepEqual(failed, {
    status: "failed",
    stage: "proxy",
    reason: "route-check-failed",
    code: "ENOTFOUND",
  });
  assert.ok(!JSON.stringify(failed).includes("192.168.1.50"), "no endpoint text in a verdict");
  assert.deepEqual(failing.calls("createSocket"), []);

  const direct = harness({ proxyList: "DIRECT" });
  const pending = direct.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => direct.sockets.length === 1, "a direct route must reach connect");
  connectOf(direct.sockets[0]).callback();
  assert.equal((await pending).status, "attempted");
});

test("only an absolute, credentials-free http(s) endpoint is triggered", async () => {
  const cases = [
    ["not a url", "invalid-url"],
    ["/v1/models", "invalid-url"],
    ["192.168.1.50:8080", "invalid-url"],
    ["ftp://192.168.1.50/v1", "unsupported-protocol"],
    ["file:///etc/hosts", "unsupported-protocol"],
    ["http://user:secret@192.168.1.50:8080/v1", "credentials-present"],
    ["https://token@192.168.1.50/v1", "credentials-present"],
  ];
  for (const [url, reason] of cases) {
    const h = harness();
    const result = await h.controller.trigger(url);
    assert.deepEqual(result, { status: "skipped", stage: "endpoint", reason }, url);
    assertNoNetworkWork(h, url);
    assert.ok(
      !JSON.stringify(result).match(/secret|token|192\.168\.1\.50/),
      `${url}: a verdict must not carry endpoint or credential text`,
    );
  }
});

test("the socket exists only for connect: no send, no write, no bind", async () => {
  const h = harness();
  const pending = h.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => h.sockets.length === 1, "no socket was created");
  const socket = h.sockets[0];
  const connect = connectOf(socket);
  assert.equal(connect.port, 8080);
  assert.equal(connect.address, "192.168.1.50");
  assert.ok(socket.errorListener, "the error listener is attached before connect");
  assert.deepEqual(socket.writes, [], "a trigger must never write");
  assert.deepEqual(socket.binds, [], "a trigger must never bind");
  connect.callback();
  assert.deepEqual(await pending, {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });
  assert.deepEqual(socket.writes, []);
  assert.deepEqual(socket.binds, []);
  assert.ok(socket.removedListeners.includes("error"), "the error listener is removed");
  assert.ok(
    !h.record.some(([kind]) => kind === "send" || kind === "bind"),
    "nothing but connect was ever issued on the socket",
  );
});

test("a budget that expires before connect skips with the phase it cut", async () => {
  let releaseProxy;
  const proxyGate = new Promise((resolve) => {
    releaseProxy = resolve;
  });
  const proxyCase = harness({ resolveProxy: () => proxyGate });
  const pendingProxy = proxyCase.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => proxyCase.calls("resolveProxy").length === 1, "the proxy phase never started");
  assert.equal(proxyCase.clock.timers.length, 1);
  assert.equal(proxyCase.clock.timers[0].ms, 1500, "the default budget is 1500 ms");
  proxyCase.clock.fire(proxyCase.clock.timers[0]);
  assert.deepEqual(await pendingProxy, { status: "skipped", stage: "proxy", reason: "deadline" });
  assert.equal(proxyCase.clock.timers[0].cleared, true);
  assert.deepEqual(proxyCase.calls("lookup"), []);
  assert.deepEqual(proxyCase.calls("createSocket"), []);
  releaseProxy("DIRECT");
  await drain();
  assert.deepEqual(
    proxyCase.calls("createSocket"),
    [],
    "a proxy answer that arrives after the budget must not create a socket",
  );

  let releaseLookup;
  const lookupGate = new Promise((resolve) => {
    releaseLookup = resolve;
  });
  const resolveCase = harness({ lookup: () => lookupGate, budgetMs: 25 });
  const pendingLookup = resolveCase.controller.trigger("http://lan-gateway.test/v1");
  await until(() => resolveCase.calls("lookup").length === 1, "the resolve phase never started");
  assert.equal(resolveCase.clock.timers[0].ms, 25, "an explicit budget is honoured");
  resolveCase.clock.fire(resolveCase.clock.timers[0]);
  assert.deepEqual(await pendingLookup, { status: "skipped", stage: "resolve", reason: "deadline" });
  assert.equal(resolveCase.clock.timers[0].cleared, true);
  releaseLookup([{ address: "192.168.1.9", family: 4 }]);
  await drain();
  assert.deepEqual(
    resolveCase.calls("createSocket"),
    [],
    "a resolver answer that arrives after the budget must not create a socket",
  );
});

test("a budget that expires after connect reports an unconfirmed attempt", async () => {
  const h = harness();
  const pending = h.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => h.sockets.length === 1, "no socket was created");
  const socket = h.sockets[0];
  const timer = h.clock.timers[0];
  h.clock.fire(timer);
  const result = await pending;
  assert.deepEqual(result, {
    status: "attempted",
    stage: "connect",
    reason: "connect-unconfirmed",
  });
  assert.equal(timer.cleared, true, "the budget is cleared");
  assert.equal(socket.closeCalls, 1, "the socket is closed");
  assert.equal(socket.errorListener, undefined, "the error listener is removed");
  connectOf(socket).callback();
  await drain();
  assert.equal(await pending, result, "a late connect callback must not change the verdict");
  assert.equal(socket.closeCalls, 1, "nor close the socket twice");
});

test("a socket error fails the connect with its code and no endpoint text", async () => {
  const h = harness();
  const pending = h.controller.trigger("http://10.0.0.5:8080/v1/models?token=abc123");
  await until(() => h.sockets.length === 1, "no socket was created");
  const socket = h.sockets[0];
  const error = new Error("connect EACCES 10.0.0.5:8080 /v1/models?token=abc123");
  error.code = "EACCES";
  socket.errorListener(error);
  const result = await pending;
  assert.deepEqual(result, {
    status: "failed",
    stage: "connect",
    reason: "connect-error",
    code: "EACCES",
  });
  const text = JSON.stringify(result);
  for (const leaked of ["10.0.0.5", "8080", "/v1/models", "token", "abc123", "connect EACCES"]) {
    assert.ok(!text.includes(leaked), `the verdict must not carry "${leaked}"`);
  }
  assert.equal(socket.closeCalls, 1);
  assert.equal(socket.errorListener, undefined);

  // An error without a code carries no `code` key at all, and text dressed up as
  // a code is not a code.
  for (const code of [undefined, "not a code", "lowercase", "A".repeat(40)]) {
    const bare = harness();
    const barePending = bare.controller.trigger("http://192.168.1.50:8080/v1");
    await until(() => bare.sockets.length === 1, "no socket was created");
    const failure = new Error("boom");
    if (code !== undefined) failure.code = code;
    bare.sockets[0].errorListener(failure);
    assert.deepEqual(await barePending, {
      status: "failed",
      stage: "connect",
      reason: "connect-error",
    });
  }
});

test("concurrent calls for one endpoint share one probe, others never wait", async () => {
  const h = harness();
  const first = h.controller.trigger("http://192.168.1.50:8080/v1");
  const second = h.controller.trigger("HTTP://192.168.1.50:8080/v1");
  await until(() => h.sockets.length === 1, "no socket was created");
  assert.equal(h.calls("resolveProxy").length, 1, "one probe serves both callers");
  assert.equal(h.calls("createSocket").length, 1, "and one socket");
  connectOf(h.sockets[0]).callback();
  const settled = [await first, await second];
  assert.equal(settled[0], settled[1], "both callers see the same verdict");
  assert.deepEqual(settled[0], {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });

  // A pending endpoint must not hold up a different one.
  const held = h.controller.trigger("http://192.168.1.60:8080/v1");
  await until(() => h.sockets.length === 2, "the held endpoint never started");
  const other = h.controller.trigger("http://192.168.1.60:9090/v1");
  await until(() => h.sockets.length === 3, "a different endpoint must not wait");
  connectOf(h.sockets[2]).callback();
  assert.deepEqual(await other, {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });
  let heldSettled = false;
  void held.then(() => {
    heldSettled = true;
  });
  await drain();
  assert.equal(heldSettled, false, "the held endpoint is independent");
  connectOf(h.sockets[1]).callback();
  assert.equal((await held).status, "attempted");

  // Nothing is memoized: the same endpoint probes again after settling.
  const again = h.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => h.sockets.length === 4, "a settled endpoint must be probed again");
  connectOf(h.sockets[3]).callback();
  assert.deepEqual(await again, {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });
  assert.equal(h.calls("resolveProxy").length, 4, "every settled call probes afresh");
});

test("dispose settles pending work and stops the trigger for good", async () => {
  const events = [];
  const lifecycle = {
    on: (event, listener) => {
      events.push(["on", event, listener]);
      return lifecycle;
    },
    removeListener: (event, listener) => {
      events.push(["removeListener", event, listener]);
      return lifecycle;
    },
  };
  const h = harness({ lifecycle });
  assert.deepEqual(
    events.map(([kind, event]) => [kind, event]),
    [["on", "will-quit"]],
    "the controller registers its shutdown listener once",
  );

  const pending = h.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => h.sockets.length === 1, "no socket was created");
  const socket = h.sockets[0];
  const timer = h.clock.timers[0];
  h.controller.dispose();
  assert.deepEqual(await pending, { status: "skipped", stage: "lifecycle", reason: "disposed" });
  assert.equal(timer.cleared, true, "the budget is cleared");
  assert.equal(socket.closeCalls, 1, "the socket is closed");
  assert.equal(socket.errorListener, undefined, "the error listener is removed");
  assert.deepEqual(
    events.filter(([kind]) => kind === "removeListener").map(([, event]) => event),
    ["will-quit"],
    "the shutdown listener is removed again",
  );

  connectOf(socket).callback();
  await drain();
  assert.equal(socket.closeCalls, 1, "a late callback cannot reopen the socket");

  h.controller.dispose();
  assert.equal(
    events.filter(([kind]) => kind === "removeListener").length,
    1,
    "dispose is idempotent",
  );
  assert.deepEqual(
    await h.controller.trigger("http://192.168.1.50:8080/v1"),
    { status: "skipped", stage: "lifecycle", reason: "disposed" },
  );
  assert.deepEqual(
    await h.controller.trigger("not a url"),
    { status: "skipped", stage: "lifecycle", reason: "disposed" },
  );
  assert.equal(h.calls("resolveProxy").length, 1, "a disposed controller starts no probe");
  assert.equal(h.calls("createSocket").length, 1, "and creates no socket");

  // The registered listener is what shuts the controller down at quit.
  const [onEvent, onListener] = events[0].slice(1);
  assert.equal(onEvent, "will-quit");
  onListener();
  assert.deepEqual(
    await h.controller.trigger("http://192.168.1.50:8080/v1"),
    { status: "skipped", stage: "lifecycle", reason: "disposed" },
  );
});

test("dispose before any trigger is safe and still permanent", async () => {
  const h = harness();
  h.controller.dispose();
  h.controller.dispose();
  assert.deepEqual(
    await h.controller.trigger("http://192.168.1.50:8080/v1"),
    { status: "skipped", stage: "lifecycle", reason: "disposed" },
  );
  assertNoNetworkWork(h, "a controller disposed before use");
  assert.deepEqual(h.clock.timers, [], "no budget was ever started");
});

test("a socket that cannot be closed is still settled", async () => {
  const h = harness();
  const pending = h.controller.trigger("http://192.168.1.50:8080/v1");
  await until(() => h.sockets.length === 1, "no socket was created");
  const socket = h.sockets[0];
  socket.throwOnClose = true;
  connectOf(socket).callback();
  assert.deepEqual(await pending, {
    status: "attempted",
    stage: "connect",
    reason: "connect-established",
  });
  assert.equal(socket.closeCalls, 1, "close was attempted");
});

test("the module-level instance is created lazily and disposed for good", async () => {
  const base = "http://127.0.0.1:8080/v1";
  const created = await localNetworkPermission.trigger(base);
  assert.deepEqual(
    created,
    process.platform === "darwin"
      ? { status: "skipped", stage: "hostname", reason: "address-not-local" }
      : { status: "skipped", stage: "platform", reason: "not-macos" },
    "the default instance runs the real gates",
  );
  assert.deepEqual(
    electronStub.calls,
    process.platform === "darwin" ? [base] : [],
    "the default proxy lookup goes through the lazily imported session",
  );

  localNetworkPermission.dispose();
  localNetworkPermission.dispose();
  assert.deepEqual(
    await localNetworkPermission.trigger(base),
    { status: "skipped", stage: "lifecycle", reason: "disposed" },
  );
  assert.deepEqual(electronStub.calls.length, process.platform === "darwin" ? 1 : 0);
});
