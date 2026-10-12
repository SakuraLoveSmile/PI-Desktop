import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createGoalActivityReader } = await import("../src/stores/runtime/goal-activity-runtime.ts");
const { shouldShowGoalProgressBar } = await import("../src/lib/goal-progress-presentation.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const progress = (revision, statuses = ["completed", "pending"], executionId = "execution") => ({
  sessionId: "session", executionId, proposalId: "proposal", revision, schemaVersion: 1, updatedAt: revision,
  items: statuses.map((status, index) => ({ id: `T${index}`, label: `Task ${index}`, status })),
});
const report = (kind = "structured", executionId = "execution") => ({
  state: "ready", report: { sessionId: "session", executionId, integrity: { kind } },
});
async function settle() { await Promise.resolve(); await Promise.resolve(); }
function fixture() {
  const progressReads = [];
  const reportReads = [];
  const events = {};
  const removals = [];
  const edge = (name) => (listener) => { events[name] = listener; return () => { removals.push(name); delete events[name]; }; };
  const reader = createGoalActivityReader("session", "execution", {
    readProgress: (identity) => { const request = deferred(); progressReads.push({ ...request, identity }); return request.promise; },
    readReport: (identity) => { const request = deferred(); reportReads.push({ ...request, identity }); return request.promise; },
    onProgress: edge("progress"), onReport: edge("report"), onHostRestart: edge("restart"), onFocus: edge("focus"),
  });
  return { reader, events, progressReads, reportReads, removals };
}

test("capsule and Overview share the same progress flow and actual ready/fallback report state", async () => {
  const f = fixture();
  const capsuleStates = [], overviewStates = [];
  const stopCapsule = f.reader.subscribe(() => capsuleStates.push(f.reader.getState()));
  const stopOverview = f.reader.subscribe(() => overviewStates.push(f.reader.getState()));
  assert.equal(f.progressReads.length, 1);
  f.progressReads[0].resolve({ progress: progress(1) });
  f.reportReads[0].resolve({ state: "draft", report: null });
  await settle();
  assert.equal(f.reader.getState().reportState, "generating");
  assert.equal(f.reader.getState().progress.items.filter((item) => item.status === "completed").length, 1);
  f.events.progress({ sessionId: "session", executionId: "execution", revision: 2 });
  f.events.report({ sessionId: "session", executionId: "execution", status: "ready" });
  f.progressReads[1].resolve({ progress: progress(2, ["completed", "completed"]) });
  f.reportReads[1].resolve(report("fallback"));
  await settle();
  assert.equal(f.reader.getState().reportState, "fallback");
  assert.equal(capsuleStates.at(-1), overviewStates.at(-1));
  assert.equal(shouldShowGoalProgressBar({ proposal: { kind: "goal", executionId: "execution", executionState: "completed" }, reportReady: true }), false);
  stopCapsule();
  assert.equal(f.removals.length, 0);
  stopOverview();
  assert.deepEqual(f.removals.sort(), ["focus", "progress", "report", "restart"]);
});

test("late reads and lower revisions cannot overwrite the newest authoritative progress", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.events.progress({ sessionId: "session", executionId: "execution", revision: 4 });
  f.progressReads[1].resolve({ progress: progress(4) });
  await settle();
  f.progressReads[0].resolve({ progress: progress(1) });
  await settle();
  assert.equal(f.reader.getState().progress.revision, 4);
  const refreshing = f.reader.refresh();
  f.progressReads[2].resolve({ progress: progress(3) });
  f.reportReads[1].resolve({ state: "not_found", report: null });
  await refreshing;
  assert.equal(f.reader.getState().progress.revision, 4);
  stop();
});

test("wrong session/execution events and response identities never become visible", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.events.progress({ sessionId: "other", executionId: "execution", revision: 2 });
  f.events.report({ sessionId: "session", executionId: "other", status: "ready" });
  assert.equal(f.progressReads.length, 1);
  assert.equal(f.reportReads.length, 1);
  f.progressReads[0].resolve({ progress: progress(1, undefined, "other") });
  f.reportReads[0].resolve(report("structured", "other"));
  await settle();
  assert.equal(f.reader.getState().progress, null);
  assert.equal(f.reader.getState().reportState, "none");
  assert.equal(f.reader.getState().error, "GOAL_PROGRESS_SCOPE_MISMATCH");
  assert.equal(f.reader.getState().reportError, "GOAL_REPORT_SCOPE_MISMATCH");
  stop();
});

test("hiding the final consumer discards requests and subscriptions; reactivation gets fresh state", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  const lateProgress = f.events.progress;
  const lateReport = f.events.report;
  stop();
  lateProgress({ sessionId: "session", executionId: "execution", revision: 8 });
  lateReport({ sessionId: "session", executionId: "execution", status: "ready" });
  assert.equal(f.progressReads.length, 1);
  assert.equal(f.reportReads.length, 1);
  f.progressReads[0].resolve({ progress: progress(8) });
  f.reportReads[0].resolve(report());
  await settle();
  assert.equal(f.reader.getState().progress, null);
  assert.equal(f.reader.getState().reportState, "none");
  const stopAgain = f.reader.subscribe(() => {});
  f.progressReads[1].resolve({ progress: progress(9) });
  f.reportReads[1].resolve({ state: "failed", report: null, detail: "Publication failed" });
  await settle();
  assert.equal(f.reader.getState().progress.revision, 9);
  assert.equal(f.reader.getState().reportState, "failed");
  assert.equal(f.reader.getState().reportError, "Publication failed");
  stopAgain();
});

test("Host restart invalidates in-flight reads without allowing a persisted revision to regress", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.progressReads[0].resolve({ progress: progress(6) });
  f.reportReads[0].resolve(report());
  await settle();
  void f.reader.refresh();
  f.events.restart();
  f.progressReads[2].resolve({ progress: progress(5) });
  f.reportReads[2].resolve({ state: "pending", report: null });
  await settle();
  f.progressReads[1].resolve({ progress: progress(10) });
  f.reportReads[1].resolve(report("fallback"));
  await settle();
  assert.equal(f.reader.getState().progress.revision, 6);
  assert.equal(f.reader.getState().reportState, "generating");
  stop();
});

test("report read failures are separate from publication failure and do not lose progress", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.progressReads[0].resolve({ progress: progress(1) });
  f.reportReads[0].reject(new Error("Host disconnected"));
  await settle();
  assert.equal(f.reader.getState().progress.revision, 1);
  assert.equal(f.reader.getState().error, null);
  assert.equal(f.reader.getState().reportState, "none");
  assert.equal(f.reader.getState().reportError, "Host disconnected");
  f.events.report({ sessionId: "session", executionId: "execution", status: "pending" });
  f.reportReads[1].resolve({ state: "pending", report: null });
  await settle();
  assert.equal(f.reader.getState().reportState, "generating");
  assert.equal(f.reader.getState().reportError, null);
  stop();
});

test("a previously ready report can become corrupt and an invalid integrity never becomes ready", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.progressReads[0].resolve({ progress: progress(1) });
  f.reportReads[0].resolve(report());
  await settle();
  assert.equal(f.reader.getState().reportState, "ready");
  f.events.report({ sessionId: "session", executionId: "execution", status: "ready" });
  f.reportReads[1].resolve({ state: "corrupt", report: null, detail: "Hash mismatch" });
  await settle();
  assert.equal(f.reader.getState().reportState, "failed");
  assert.equal(f.reader.getState().reportError, "Hash mismatch");
  f.events.report({ sessionId: "session", executionId: "execution", status: "ready" });
  f.reportReads[2].resolve(report("unknown"));
  await settle();
  assert.equal(f.reader.getState().reportState, "failed");
  assert.equal(f.reader.getState().reportError, "GOAL_REPORT_INVALID_INTEGRITY");
  stop();
});
