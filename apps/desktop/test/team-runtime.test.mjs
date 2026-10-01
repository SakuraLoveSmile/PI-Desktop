import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
    get pending() { return timers.size; },
  };
}

function snapshot(teamSessionId, revision) {
  return {
    teamSessionId, revision, paused: false, members: [], tasks: [],
    readiness: [], scopeOverlaps: [], leadPhase: "idle",
    queuedMessageCount: 0, review: null, decision: null,
  };
}

async function loadRuntime() {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return { server, runtime: await server.ssrLoadModule("/src/stores/runtime/team-runtime.ts") };
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("snapshot reader coalesces events, recovers, and rejects lower revisions in the same Host generation", async () => {
  const { server, runtime } = await loadRuntime();
  try {
    const clock = makeClock();
    const pending = [];
    let eventListener;
    let reads = 0;
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: () => { reads += 1; const request = deferred(); pending.push(request); return request.promise; },
      subscribe: (listener) => { eventListener = listener; return () => { eventListener = undefined; }; },
    }, clock);
    const unsubscribe = reader.subscribe(() => {});
    assert.equal(reads, 1, "the initial read starts immediately after event subscription");
    eventListener({ teamSessionId: "team-a", revision: 1, reason: "task" });
    eventListener({ teamSessionId: "team-a", revision: 2, reason: "task" });
    pending[0].resolve(snapshot("team-a", 5));
    await flushAsync();
    assert.equal(reads, 2, "in-flight events cause one follow-up read");
    pending[1].resolve(snapshot("team-a", 4));
    await flushAsync();
    assert.equal(reader.getState().snapshot.revision, 5, "an older revision cannot replace the current snapshot");

    eventListener({ teamSessionId: "other-team", revision: 1, reason: "task" });
    clock.advance(200);
    assert.equal(reads, 2, "events for another scope are ignored");
    eventListener({ teamSessionId: "team-a", revision: 6, reason: "task" });
    clock.advance(199);
    assert.equal(reads, 2);
    clock.advance(1);
    assert.equal(reads, 3, "the first invalidation starts after the bounded 200ms window");
    pending[2].resolve(snapshot("team-a", 6));
    await flushAsync();
    clock.advance(2599);
    assert.equal(reads, 3);
    clock.advance(1);
    assert.equal(reads, 4, "the recovery read runs every three seconds");
    pending[3].resolve(snapshot("team-a", 7));
    await flushAsync();
    unsubscribe();
    assert.equal(reader.getState().snapshot, null, "unsubscribing releases the retained snapshot");
    assert.equal(clock.pending, 0, "unsubscribing clears all timers");
  } finally {
    await server.close();
  }
});

test("focus preserves revision ordering while Host restart accepts the restored lower revision", async () => {
  const { server, runtime } = await loadRuntime();
  try {
    const clock = makeClock();
    let eventListener;
    let focusListener;
    let restartListener;
    const pending = [];
    let reads = 0;
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: () => { reads += 1; const request = deferred(); pending.push(request); return request.promise; },
      subscribe: (listener) => { eventListener = listener; return () => {}; },
      onFocus: (listener) => { focusListener = listener; return () => {}; },
      onHostRestart: (listener) => { restartListener = listener; return () => {}; },
    }, clock);
    reader.subscribe(() => {});
    pending[0].resolve(snapshot("team-a", 10));
    await flushAsync();

    focusListener();
    assert.equal(reads, 2);
    pending[1].resolve(snapshot("team-a", 3));
    await flushAsync();
    assert.equal(reader.getState().snapshot.revision, 10, "focus does not reset the revision baseline");

    restartListener();
    assert.equal(reads, 3);
    assert.equal(reader.getState().snapshot, null, "Host restart clears state from the old process generation");
    pending[2].resolve(snapshot("team-a", 1));
    await flushAsync();
    assert.equal(reader.getState().snapshot.revision, 1, "a restored Host may start with a lower revision");

    eventListener({ teamSessionId: "team-a", revision: 2, reason: "dissolved" });
    assert.equal(reader.getState().snapshot, null);
  } finally {
    await server.close();
  }
});

test("dissolution invalidates pending reads and leaves the reader terminal until it becomes idle", async () => {
  const { server, runtime } = await loadRuntime();
  try {
    const clock = makeClock();
    const first = deferred();
    let eventListener;
    let reads = 0;
    let idle = false;
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: () => { reads += 1; return first.promise; },
      subscribe: (listener) => { eventListener = listener; return () => {}; },
      onIdle: (isIdle) => { idle = isIdle(); },
    }, clock);
    const unsubscribe = reader.subscribe(() => {});
    eventListener({ teamSessionId: "team-a", revision: 1, reason: "dissolved" });
    assert.equal(reader.getState().error, "TEAM_DISSOLVED");
    first.resolve(snapshot("team-a", 20));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(reader.getState().snapshot, null, "a late response cannot resurrect a dissolved Team");
    clock.advance(10_000);
    assert.equal(reads, 1, "dissolved readers stop polling");
    unsubscribe();
    assert.equal(idle, true);
    assert.equal(reader.getState().error, null, "idle readers release error state too");
    assert.equal(clock.pending, 0);
  } finally {
    await server.close();
  }
});

test("Host restart after dissolution restores periodic recovery", async () => {
  const { server, runtime } = await loadRuntime();
  try {
    const clock = makeClock();
    let eventListener;
    let restartListener;
    let reads = 0;
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: async () => snapshot("team-a", ++reads),
      subscribe: (listener) => { eventListener = listener; return () => {}; },
      onHostRestart: (listener) => { restartListener = listener; return () => {}; },
    }, clock);
    const unsubscribe = reader.subscribe(() => {});
    await flushAsync();
    assert.equal(reads, 1);

    eventListener({ teamSessionId: "team-a", revision: 2, reason: "dissolved" });
    assert.equal(clock.pending, 0, "dissolution stops the recovery timer");
    restartListener();
    await flushAsync();
    assert.equal(reads, 2, "restart performs an immediate read");
    assert.equal(clock.pending, 1, "restart restores one recovery timer");

    clock.advance(3000);
    await flushAsync();
    assert.equal(reads, 3, "periodic recovery continues after the restart read");
    assert.equal(clock.pending, 1, "only one recovery timer remains scheduled");
    unsubscribe();
    assert.equal(clock.pending, 0);
  } finally {
    await server.close();
  }
});

test("an idle reader can be subscribed again with a fresh recovery lifecycle", async () => {
  const { server, runtime } = await loadRuntime();
  try {
    const clock = makeClock();
    let reads = 0;
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: async () => snapshot("team-a", ++reads),
      subscribe: () => () => {},
    }, clock);
    const first = reader.subscribe(() => {});
    await flushAsync();
    first();
    assert.equal(clock.pending, 0);
    assert.equal(reader.getState().snapshot, null, "idle readers release their cached snapshot");

    const second = reader.subscribe(() => {});
    await flushAsync();
    assert.equal(reads, 2, "resubscription performs a fresh initial read");
    assert.equal(reader.getState().snapshot.revision, 2);
    assert.equal(clock.pending, 1, "resubscription restores periodic recovery");
    second();
    assert.equal(clock.pending, 0);
  } finally {
    await server.close();
  }
});

test("a response from the wrong Team scope is surfaced as a stable error code", async () => {
  const { server, runtime } = await loadRuntime();
  try {
    const clock = makeClock();
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: async () => snapshot("team-b", 1),
      subscribe: () => () => {},
    }, clock);
    const unsubscribe = reader.subscribe(() => {});
    await flushAsync();
    assert.equal(reader.getState().error, "TEAM_SCOPE_MISMATCH");
    unsubscribe();
  } finally {
    await server.close();
  }
});

test("the default reader clock supports browser timer invocation receivers", async () => {
  const { server, runtime } = await loadRuntime();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let unsubscribe;
  try {
    globalThis.setTimeout = function (callback, delay) {
      assert.ok(this === undefined || this === globalThis, "browser timers reject a clock object receiver");
      return originalSetTimeout(callback, delay);
    };
    globalThis.clearTimeout = function (handle) {
      assert.ok(this === undefined || this === globalThis, "browser timer cleanup rejects a clock object receiver");
      return originalClearTimeout(handle);
    };
    const reader = runtime.createTeamSnapshotReader("team-a", {
      read: async () => snapshot("team-a", 1), subscribe: () => () => {},
    });
    unsubscribe = reader.subscribe(() => {});
    await flushAsync();
    assert.equal(reader.getState().snapshot?.teamSessionId, "team-a");
    unsubscribe();
    unsubscribe = undefined;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    unsubscribe?.();
    await server.close();
  }
});
