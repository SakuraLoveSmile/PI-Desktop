import assert from "node:assert/strict";
import test from "node:test";
import { auditRows } from "../audit-test-maintenance.mjs";

const since = "2026-07-01T00:00:00Z";
const until = "2026-10-01T00:00:00Z";
const churn = { "apps/desktop/test/hot.test.mjs": 10, "packages/shared/src/cool.test.ts": 1 };
test("missing and incomplete regression evidence remain unknown", () => {
  for (const evidence of [undefined, { coverage: { from: since, to: until, complete: false }, regressions: [] }, { coverage: { from: "2026-09-01", to: until, complete: true }, regressions: [] }]) {
    const rows = auditRows(churn, evidence, since, until);
    assert.equal(rows[0].regressionSignal, "unknown");
    assert.equal(rows[0].action, "review-for-behavior-coverage-or-retirement");
    assert.equal(rows[1].action, "monitor");
  }
});
test("complete evidence distinguishes observed catches from no recorded catches", () => {
  const rows = auditRows(churn, { coverage: { from: since, to: until, complete: true }, regressions: [
    { path: "apps/desktop/test/hot.test.mjs", caughtAt: "2026-09-01", evidence: "CI run 123, confirmed regression" },
  ] }, since, until);
  assert.equal(rows[0].regressionSignal, "observed");
  assert.equal(rows[0].recordedCatches, 1);
  assert.deepEqual(rows[0].evidence, ["CI run 123, confirmed regression"]);
  assert.equal(rows[1].regressionSignal, "none-recorded");
});
test("malformed evidence cannot imply that a test caught no regression", () => {
  assert.throws(() => auditRows(churn, { coverage: { from: since, to: until, complete: true }, regressions: [{ path: "x", caughtAt: "bad", evidence: "" }] }, since, until), /Each regression/);
});
