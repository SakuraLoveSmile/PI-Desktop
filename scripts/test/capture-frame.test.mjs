import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { captureFrameAfterRepaint } from "../e2e/capture-frame.mjs";

const target = { width: 420, height: 700 };
const dirtyRect = { x: 0, y: 0, ...target };

function fixture(t, invalidate = () => {}) {
  const timers = [], cleared = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (...args) => {
    const timer = originalSetTimeout(...args);
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", timer => {
    cleared.push(timer);
    return originalClearTimeout(timer);
  });
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  let invalidations = 0;
  contents.invalidate = () => {
    invalidations++;
    assert.equal(contents.listenerCount("paint"), 1);
    assert.equal(contents.listenerCount("destroyed"), 1);
    assert.equal(timers.length, 1);
    invalidate(contents);
  };
  const paint = (size = target, empty = false) => contents.emit("paint", {}, dirtyRect, {
    isEmpty: () => empty,
    getSize: () => size,
  });
  const assertClean = (count = 1) => {
    assert.equal(invalidations, count);
    assert.equal(contents.listenerCount("paint"), 0);
    assert.equal(contents.listenerCount("destroyed"), 0);
    assert.equal(timers.length, 1);
    assert.deepEqual(cleared, timers);
  };
  t.after(() => timers.forEach(originalClearTimeout));
  return { contents, paint, assertClean };
}

test("accepts a synchronous matching paint from exactly one invalidation", async t => {
  const { contents, assertClean } = fixture(t, contents => contents.emit("paint", {}, dirtyRect, {
    isEmpty: () => false, getSize: () => target,
  }));
  assert.deepEqual(await captureFrameAfterRepaint(contents, target), { size: target, dirtyRect, empty: false });
  assertClean();
});

test("ignores earlier, wrong-size and empty frames until an asynchronous matching paint", async t => {
  const { contents, paint, assertClean } = fixture(t);
  paint();
  let completed = false;
  const result = captureFrameAfterRepaint(contents, target).then(frame => { completed = true; return frame; });
  paint({ width: 1000, height: 700 });
  paint(target, true);
  await setImmediate();
  assert.equal(completed, false);
  paint();
  assert.deepEqual(await result, { size: target, dirtyRect, empty: false });
  assertClean();
});

test("rejects already destroyed contents without invalidating", async t => {
  const { contents, assertClean } = fixture(t);
  contents.isDestroyed = () => true;
  await assert.rejects(captureFrameAfterRepaint(contents, target), /destroyed/);
  assertClean(0);
});

test("rejects destruction while waiting and removes both listeners", async t => {
  const { contents, assertClean } = fixture(t);
  const result = captureFrameAfterRepaint(contents, target);
  contents.emit("destroyed");
  await assert.rejects(result, /destroyed/);
  assertClean();
});

test("times out within the original window despite mismatched and empty paints", async t => {
  const { contents, paint, assertClean } = fixture(t);
  const result = captureFrameAfterRepaint(contents, target, { timeoutMs: 10 });
  paint({ width: 1000, height: 700 });
  paint(target, true);
  await assert.rejects(result, /Timed out after 10ms.*420x700/);
  assertClean();
});

test("cleans up after invalidate throws even after a synchronous matching paint", async t => {
  const failure = new Error("invalidation failed");
  const { contents, assertClean } = fixture(t, contents => {
    contents.emit("paint", {}, dirtyRect, { isEmpty: () => false, getSize: () => target });
    throw failure;
  });
  await assert.rejects(captureFrameAfterRepaint(contents, target), error => error === failure);
  assertClean();
});

test("rejects destruction during invalidation even after a synchronous matching paint", async t => {
  const { contents, assertClean } = fixture(t, contents => {
    contents.emit("paint", {}, dirtyRect, { isEmpty: () => false, getSize: () => target });
    contents.emit("destroyed");
  });
  await assert.rejects(captureFrameAfterRepaint(contents, target), /destroyed/);
  assertClean();
});

test("rejects frame inspection failures and cleans resources", async t => {
  const { contents, assertClean } = fixture(t);
  const result = captureFrameAfterRepaint(contents, target);
  const failure = new Error("frame inspection failed");
  contents.emit("paint", {}, dirtyRect, { isEmpty: () => false, getSize: () => { throw failure; } });
  await assert.rejects(result, error => error === failure);
  assertClean();
});
