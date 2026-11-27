import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createSessionSummaryController } = await import("../src/stores/runtime/session-summary-runtime.ts");

const note = (patch = {}) => ({
  sessionId: "s1", text: "Working on the importer.", revision: 1, basedOnMessageCount: 4,
  updatedAt: "2026-11-22T06:05:00.000Z", behind: 0, diverged: false, ...patch,
});
const stored = (summary, messageCount = 4) => ({ summary, messageCount });
const updated = (summary) => ({ outcome: "updated", summary });
const skipped = (reason, summary) => ({ outcome: "skipped", reason, summary });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
const unsupportedError = () => Object.assign(new Error("not here"), { code: "SESSION_SUMMARY_UNSUPPORTED" });

function fixture() {
  const reads = [], refreshes = [], failures = [];
  const controller = createSessionSummaryController("s1", {
    read: (sessionId) => { const call = deferred(); reads.push({ ...call, sessionId }); return call.promise; },
    refresh: (sessionId, force) => { const call = deferred(); refreshes.push({ ...call, sessionId, force }); return call.promise; },
    onManualFailure: (error) => failures.push(error),
  });
  return { controller, reads, refreshes, failures, text: () => controller.getState().note?.text ?? null };
}
/** An active pane that has already read its stored note. */
async function shown(summary = note()) {
  const f = fixture();
  f.controller.setActive(true);
  f.reads[0].resolve(stored(summary)); await settle();
  return f;
}
const endTurn = (f) => { f.controller.observeRunning(true); f.controller.observeRunning(false); };

test("showing the pane reads the stored note and never asks a model", async () => {
  const f = fixture();
  f.controller.observeRunning(false);
  f.controller.setActive(true);
  assert.deepEqual(f.reads.map((read) => read.sessionId), ["s1"]);
  f.reads[0].resolve(stored(note())); await settle();
  assert.equal(f.text(), "Working on the importer.");
  assert.equal(f.refreshes.length, 0);
  assert.equal(f.controller.getState().refreshing, false);
});

test("only running going from true to false of an active pane asks, without forcing", async () => {
  const f = await shown();
  f.controller.observeRunning(false);
  f.controller.observeRunning(false);
  f.controller.observeRunning(true);
  assert.equal(f.refreshes.length, 0);
  f.controller.observeRunning(false);
  assert.deepEqual(f.refreshes.map((call) => [call.sessionId, call.force]), [["s1", false]]);
  assert.equal(f.controller.getState().refreshing, true);
  f.refreshes[0].resolve(updated(note({ revision: 2, text: "Importer tests pass." }))); await settle();
  assert.equal(f.text(), "Importer tests pass.");
  assert.equal(f.controller.getState().refreshing, false);
});

test("a turn that ends while the pane is hidden asks nothing, and the next one does", async () => {
  const f = fixture();
  endTurn(f);
  assert.equal(f.reads.length + f.refreshes.length, 0);
  f.controller.setActive(true);
  f.reads[0].resolve(stored(null, 0)); await settle();
  assert.equal(f.refreshes.length, 0);
  endTurn(f);
  assert.equal(f.refreshes.length, 1);
});

test("a turn that was under way when the pane opened still ends into a refresh", async () => {
  const f = fixture();
  f.controller.observeRunning(true);
  f.controller.setActive(true);
  f.reads[0].resolve(stored(null, 2)); await settle();
  f.controller.observeRunning(false);
  assert.equal(f.refreshes.length, 1);
});

test("the refresh control forces a run and a second press while it runs does nothing", async () => {
  const f = await shown();
  const first = f.controller.refresh();
  void f.controller.refresh();
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.refreshes[0].force, true);
  assert.equal(f.controller.getState().refreshing, true);
  f.refreshes[0].resolve(updated(note({ revision: 2, text: "Done." }))); await first;
  assert.equal(f.controller.getState().refreshing, false);
  assert.equal(f.text(), "Done.");
  void f.controller.refresh();
  assert.equal(f.refreshes.length, 2);
});

test("a turn end during a run joins it instead of asking again", async () => {
  const f = await shown();
  void f.controller.refresh();
  endTurn(f);
  assert.equal(f.refreshes.length, 1);
});

test("the control does nothing while the pane is hidden", async () => {
  const f = await shown();
  f.controller.setActive(false);
  await f.controller.refresh();
  assert.equal(f.refreshes.length, 0);
});

test("an answer that arrives after the pane left reaches nothing, not even an error", async () => {
  const f = await shown();
  const run = f.controller.refresh();
  f.controller.setActive(false);
  assert.equal(f.controller.getState().refreshing, false);
  f.refreshes[0].resolve(updated(note({ revision: 2, text: "Too late." }))); await run;
  assert.equal(f.text(), "Working on the importer.");
  // A failure that arrives late is just as quiet.
  f.controller.setActive(true);
  f.reads[1].resolve(stored(note())); await settle();
  const second = f.controller.refresh();
  f.controller.setActive(false);
  f.refreshes[1].reject(new Error("provider down")); await second;
  assert.deepEqual(f.failures, []);
});

test("a stored note read after the pane left is dropped", async () => {
  const f = fixture();
  f.controller.setActive(true);
  f.controller.setActive(false);
  f.reads[0].resolve(stored(note({ text: "Late read." }))); await settle();
  assert.equal(f.text(), null);
});

test("the last note stays while the pane is hidden and showing it again asks no model", async () => {
  const f = await shown();
  f.controller.setActive(false);
  assert.equal(f.text(), "Working on the importer.");
  f.controller.setActive(true);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(stored(note({ revision: 2, text: "Edited elsewhere.", behind: 3 }), 7)); await settle();
  assert.equal(f.text(), "Edited elsewhere.");
  assert.equal(f.refreshes.length, 0);
});

test("a failed manual refresh says so once and keeps the text; a failed automatic one stays quiet", async () => {
  const f = await shown();
  const manual = f.controller.refresh();
  f.refreshes[0].reject(new Error("provider down")); await manual;
  assert.equal(f.failures.length, 1);
  assert.equal(f.text(), "Working on the importer.");
  assert.equal(f.controller.getState().refreshing, false);
  endTurn(f);
  f.refreshes[1].reject(new Error("provider down")); await settle();
  assert.equal(f.failures.length, 1);
  assert.equal(f.controller.getState().refreshing, false);
});

test("a read that fails leaves the card as it was and says nothing", async () => {
  const f = fixture();
  f.controller.setActive(true);
  f.reads[0].reject(new Error("host restarting")); await settle();
  assert.equal(f.text(), null);
  assert.deepEqual(f.failures, []);
  assert.equal(f.controller.getState().unsupported, false);
});

test("a session or Host that cannot hold a summary hides the card for good", async () => {
  for (const error of [unsupportedError(), new Error("METHOD_NOT_FOUND: sessionSummary.get")]) {
    const f = fixture();
    f.controller.setActive(true);
    f.reads[0].reject(error); await settle();
    assert.equal(f.controller.getState().unsupported, true);
    f.controller.setActive(false); f.controller.setActive(true);
    endTurn(f);
    await f.controller.refresh();
    assert.equal(f.reads.length, 1);
    assert.equal(f.refreshes.length, 0);
    assert.deepEqual(f.failures, []);
  }
  const f = await shown();
  const run = f.controller.refresh();
  f.refreshes[0].reject(unsupportedError()); await run;
  assert.deepEqual(f.controller.getState(), { note: null, refreshing: false, unsupported: true });
  assert.deepEqual(f.failures, []);
});

test("a note of another session, an older revision or a wrong shape never replaces the shown one", async () => {
  const f = await shown(note({ revision: 3, text: "Revision three." }));
  const answer = async (value) => { const run = f.controller.refresh(); f.refreshes.at(-1).resolve(value); await run; };
  await answer(skipped("conflict", note({ revision: 2, text: "Older." })));
  await answer(skipped("too-soon", note({ sessionId: "other", revision: 9, text: "Foreign." })));
  assert.equal(f.text(), "Revision three.");
  assert.equal(f.failures.length, 0);
  await answer({ outcome: "updated", summary: { text: "<b>no shape</b>" } });
  assert.equal(f.failures.length, 1);
  assert.equal(f.text(), "Revision three.");
  await answer(skipped("disabled", null));
  assert.equal(f.text(), "Revision three.");
});

test("a skipped answer shows the latest note the Host holds", async () => {
  const f = await shown();
  await (async () => {
    const run = f.controller.refresh();
    f.refreshes[0].resolve(skipped("conflict", note({ revision: 2, text: "Another window wrote this." }))); await run;
  })();
  assert.equal(f.text(), "Another window wrote this.");
});

test("a note the transcript has moved past is not shown until a new one replaces it", async () => {
  const f = fixture();
  f.controller.setActive(true);
  f.reads[0].resolve(stored(note({ diverged: true, behind: 0 }), 2)); await settle();
  assert.equal(f.text(), null);
  endTurn(f);
  f.refreshes[0].resolve(updated(note({ revision: 2, text: "After the rewind." }))); await settle();
  assert.equal(f.text(), "After the rewind.");
});

test("the state object is stable between changes and subscribers hear each change", async () => {
  const f = fixture();
  let heard = 0;
  const stop = f.controller.subscribe(() => { heard += 1; });
  assert.equal(f.controller.getState(), f.controller.getState());
  f.controller.setActive(true);
  f.reads[0].resolve(stored(note())); await settle();
  assert.equal(heard, 1);
  stop();
  void f.controller.refresh();
  assert.equal(heard, 1);
});
