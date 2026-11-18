import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { composeBreakdown, selectLatestMainRequest } = await import(
  "../src/features/context-insights/composition.ts"
);

const entry = (category, estimatedTokens) => ({
  id: `${category}-${estimatedTokens}`,
  category,
  label: category,
  content: "",
  estimatedTokens,
  originalChars: estimatedTokens * 4,
  truncated: false,
});

const request = (overrides = {}) => ({
  id: "request-1",
  step: 1,
  startedAt: 10,
  status: "completed",
  providerId: "provider",
  modelId: "model",
  mode: "agent",
  contextWindow: 1_000_000,
  estimatedTokens: 0,
  estimateSource: "runtime-usage-anchor",
  entries: [],
  contentTruncated: false,
  ...overrides,
});

test("every capture category lands in one of the three composer buckets", () => {
  const composition = composeBreakdown(
    request({
      entries: [
        entry("system", 12_000),
        entry("tools", 819),
        entry("user", 40_000),
        entry("assistant", 60_000),
        entry("toolResult", 50_000),
        entry("injected", 10_000),
        entry("skill", 7_000),
      ],
    }),
    0.23,
  );
  assert.deepEqual(
    composition.segments.map((segment) => [segment.bucket, segment.tokens]),
    [["system", 12_000], ["tools", 819], ["messages", 167_000]],
  );
  assert.equal(composition.totalEstimate, 179_819);
});

test("segment widths compose the provider-reported occupancy, not the estimate", () => {
  const composition = composeBreakdown(
    request({ entries: [entry("system", 100), entry("tools", 100), entry("user", 200)] }),
    0.5,
  );
  const filled = composition.segments.reduce((total, segment) => total + segment.percent, 0);
  assert.ok(Math.abs(filled - 50) < 1e-9);
  assert.equal(composition.segments[0].percent, 12.5);
  assert.equal(composition.segments[2].percent, 25);
});

test("an empty or unbilled capture falls back instead of drawing an empty bar", () => {
  assert.equal(composeBreakdown(request(), 0.4), undefined);
  assert.equal(
    composeBreakdown(request({ entries: [entry("system", 0)] }), 0.4),
    undefined,
  );
  assert.equal(
    composeBreakdown(request({ entries: [entry("system", 500)] }), 0),
    undefined,
  );
});

test("the composer describes the newest main-agent request, not a subagent or compaction", () => {
  const older = request({ id: "older", startedAt: 5 });
  const newest = request({ id: "newest", startedAt: 30 });
  const subagent = request({ id: "subagent", startedAt: 90, parentToolCallId: "call-1" });
  const compaction = request({ id: "compaction", startedAt: 95, purpose: "compaction" });
  assert.equal(
    selectLatestMainRequest([older, subagent, compaction, newest]).id,
    "newest",
  );
  assert.equal(selectLatestMainRequest([subagent, compaction]), undefined);
  assert.equal(selectLatestMainRequest([]), undefined);
});