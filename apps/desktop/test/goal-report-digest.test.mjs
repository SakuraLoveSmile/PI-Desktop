import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  FIRST_SCREEN_METRICS, FIRST_SCREEN_NEXT_STEPS,
  checkContradicts, evidenceDisplay, goalReportTiming, hostLine, summarizeChecks,
} = await import("../src/lib/goal-report-digest.ts");

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

const base = (patch = {}) => ({
  goal: { title: "Synthetic goal" },
  execution: { status: "completed", startedAt: T0, completedAt: T0 + 10 * MINUTE, timingSource: "turn" },
  integrity: { kind: "structured" },
  verdict: "met",
  metrics: [], steps: [], files: [], criteria: [], checks: [], checkObservations: [],
  evidences: [], evidenceResolution: [], limitations: [], nextSteps: [],
  ...patch,
});
const check = (id, result = "passed", disposition) => ({ id, command: `run ${id}`, result, ...(disposition ? { disposition } : {}) });
const observation = (checkId, result = "passed") => ({ checkId, result, evidenceIds: [] });
const kinds = (items) => items.map((item) => item.kind);

test("the first screen budget is three metrics and three next steps", () => {
  assert.equal(FIRST_SCREEN_METRICS, 3);
  assert.equal(FIRST_SCREEN_NEXT_STEPS, 3);
});

test("active time sums the segments and an open last segment ends at completion", () => {
  const resumedAt = T0 + 3 * 60 * MINUTE;
  const timing = goalReportTiming(base({
    execution: { status: "completed", startedAt: T0, completedAt: resumedAt + 6 * MINUTE, timingSource: "turn" },
    segments: [{ turnId: "a", startedAt: T0, endedAt: T0 + 20 * MINUTE }, { turnId: "b", startedAt: resumedAt }],
  }));
  assert.deepEqual(timing, { activeMs: 26 * MINUTE, spanMs: 186 * MINUTE, waitMs: 160 * MINUTE });
});

test("a closed last segment uses its own end and a report without segments falls back to the span", () => {
  const closed = goalReportTiming(base({
    execution: { status: "completed", startedAt: T0, completedAt: T0 + 60 * MINUTE, timingSource: "turn" },
    segments: [{ turnId: "a", startedAt: T0, endedAt: T0 + 20 * MINUTE }],
  }));
  assert.deepEqual(closed, { activeMs: 20 * MINUTE, spanMs: 60 * MINUTE, waitMs: 40 * MINUTE });
  assert.deepEqual(goalReportTiming(base()), { activeMs: 10 * MINUTE, spanMs: 10 * MINUTE, waitMs: 0 });
});

test("timing is withheld without a turn source and never guesses that a wait was work", () => {
  assert.equal(goalReportTiming(base({ execution: { status: "completed", startedAt: T0, completedAt: T0 + MINUTE, timingSource: "unavailable" } })), null);
  assert.equal(goalReportTiming(base({ execution: { status: "completed", startedAt: T0, completedAt: T0 + MINUTE } })), null);
  // A non-final segment with no recorded end adds nothing instead of the whole wait.
  const unclosed = goalReportTiming(base({
    execution: { status: "completed", startedAt: T0, completedAt: T0 + 100 * MINUTE, timingSource: "turn" },
    segments: [{ turnId: "a", startedAt: T0 }, { turnId: "b", startedAt: T0 + 90 * MINUTE }],
  }));
  assert.equal(unclosed.activeMs, 10 * MINUTE);
  // Overlapping segments cannot add up to more than the span.
  const overlapping = goalReportTiming(base({
    execution: { status: "completed", startedAt: T0, completedAt: T0 + 10 * MINUTE, timingSource: "turn" },
    segments: [{ turnId: "a", startedAt: T0, endedAt: T0 + 9 * MINUTE }, { turnId: "b", startedAt: T0 + MINUTE, endedAt: T0 + 10 * MINUTE }],
  }));
  assert.equal(overlapping.activeMs, 10 * MINUTE);
});

test("check ratios count executed checks only and Host figures need a real check id", () => {
  const digest = summarizeChecks(base({
    checks: [check("a"), check("b", "failed"), check("c", "inconclusive", "not_run"), check("d", "inconclusive", "blocked"), check("e", "passed", "executed")],
    checkObservations: [observation("a"), observation("b", "failed"), observation("ghost"), observation("c")],
  }));
  assert.deepEqual(digest, { executed: 3, passed: 2, skipped: 2, hostObserved: 2, hostPassed: 1, conflicts: 0 });
});

test("a conflict needs two conclusive and different verdicts", () => {
  assert.equal(checkContradicts(check("a", "passed"), observation("a", "failed")), true);
  assert.equal(checkContradicts(check("a", "passed"), observation("a", "inconclusive")), false);
  assert.equal(checkContradicts(check("a", "inconclusive"), observation("a", "failed")), false);
  assert.equal(checkContradicts(check("a", "passed"), observation("a", "passed")), false);
  assert.equal(checkContradicts(check("a", "passed"), undefined), false);
  assert.equal(summarizeChecks(base({ checks: [check("a")], checkObservations: [observation("a", "failed")] })).conflicts, 1);
});

test("the host line puts Host-backed facts first and flags every gap", () => {
  const clean = hostLine(base({
    checks: [check("a"), check("b")], checkObservations: [observation("a"), observation("b")],
    criteria: [{ id: "c1", text: "x", verdict: "met" }, { id: "c2", text: "y", verdict: "met" }],
  }));
  assert.deepEqual(kinds(clean), ["checks", "hostVerified", "criteria", "active"]);
  assert.ok(clean.every((item) => item.tone === "neutral"));

  const gaps = hostLine(base({
    checks: [check("a"), check("b", "failed"), check("c", "inconclusive", "not_run")],
    checkObservations: [observation("a"), observation("b", "passed")],
    criteria: [{ id: "c1", text: "x", verdict: "met" }, { id: "c2", text: "y", verdict: "partial" }],
  }));
  assert.deepEqual(kinds(gaps), ["checks", "notRun", "hostVerified", "hostConflict", "criteria", "active"]);
  assert.deepEqual(gaps.find((item) => item.kind === "checks"), { kind: "checks", tone: "warn", passed: 1, total: 2 });
  assert.deepEqual(gaps.find((item) => item.kind === "notRun"), { kind: "notRun", tone: "warn", n: 1 });
  assert.equal(gaps.find((item) => item.kind === "hostConflict").tone, "error");
  assert.equal(gaps.find((item) => item.kind === "criteria").tone, "warn");
});

test("checks the Host never observed are reported as not observed, not as verified", () => {
  const items = hostLine(base({ checks: [check("a")], checkObservations: [] }));
  assert.deepEqual(kinds(items), ["checks", "hostNotObserved", "active"]);
  assert.equal(items.find((item) => item.kind === "hostNotObserved").tone, "warn");
});

test("blocks read as resumed only when the run actually continued", () => {
  const blocks = [{ at: T0, reasons: [{ code: "verdict_partial" }] }];
  assert.deepEqual(hostLine(base({ blocks })).find((item) => item.kind === "blocks"), { kind: "blocks", tone: "neutral", n: 1, resumed: true });
  assert.equal(hostLine(base({ blocks, closure: "user_accepted" })).find((item) => item.kind === "blocks").resumed, false);
});

test("limitations reach the host line only when no next steps block carries the pointer", () => {
  assert.ok(kinds(hostLine(base({ limitations: ["a", "b"], nextSteps: [] }))).includes("limitations"));
  assert.ok(!kinds(hostLine(base({ limitations: ["a", "b"], nextSteps: ["go"] }))).includes("limitations"));
  assert.ok(!kinds(hostLine(base({ limitations: [], nextSteps: [] }))).includes("limitations"));
});

test("only an unresolved file reference is shown neutrally", () => {
  const file = { id: "1", kind: "file", refId: "src/a.ts", summary: "s" };
  const tool = { id: "2", kind: "tool_result", refId: "call-1", summary: "s" };
  assert.deepEqual(evidenceDisplay(file, { evidenceId: "1", state: "unresolved" }), { state: "unresolved", untracked: true });
  assert.deepEqual(evidenceDisplay(tool, { evidenceId: "2", state: "unresolved" }), { state: "unresolved", untracked: false });
  // A missing resolution is unknown, never silently neutral or recorded.
  assert.deepEqual(evidenceDisplay(file, undefined), { state: "unknown", untracked: false });
  assert.deepEqual(evidenceDisplay(file, { evidenceId: "1", state: "recorded" }), { state: "recorded", untracked: false });
});
