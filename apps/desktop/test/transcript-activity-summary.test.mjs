import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { cachedActivitySummary } = await import("../src/lib/transcript-activity-summary.ts");
const { activitySummary } = await import("../src/lib/activity-summary.ts");

const message = (id, extra = {}) => ({
  id, role: "assistant", content: "", createdAt: "2026-10-09T00:00:00.000Z", ...extra,
});
const tool = (id, toolName, extra = {}) => ({
  kind: "tool", message: message(id, { role: "tool", toolName, ...extra }),
});
const thinking = (id) => ({ kind: "thinking", message: message(id, { thinking: "reasoning" }) });
const hostedSearch = (id, status = "completed") => ({
  kind: "hostedSearch", message: message(id), round: { id, status, sources: [] },
});

test("mixed activity counts actual calls in first category occurrence order", () => {
  const items = [
    thinking("thinking-start"),
    tool("run", "Bash"),
    tool("read", "Read", { toolArgs: { path: "src/main.ts" } }),
    hostedSearch("hosted-search"),
    tool("edit", "Edit", { toolArgs: { path: "src/main.ts" } }),
    tool("other", "plugin.example.inspect"),
    tool("read-again", "Read", { toolArgs: { path: "src/main.ts" } }),
    tool("list", "Glob"),
    tool("write", "Write"),
    tool("search", "Grep"),
    tool("fetch", "WebFetch"),
    tool("failed-command", "Bash", { toolResult: { details: { exitCode: 1 } } }),
    thinking("thinking-end"),
  ];
  const summary = cachedActivitySummary(items);
  assert.deepEqual(summary.segments, [
    { label: "chat.activityCommands", count: 2 },
    { label: "chat.activityReads", count: 3 },
    { label: "chat.activitySearches", count: 2 },
    { label: "chat.activityEdits", count: 2 },
    { label: "chat.activityTools", count: 2 },
  ]);
  assert.equal(summary.segments.reduce((count, segment) => count + segment.count, 0), summary.tools);
  assert.equal(summary.tools, 11);
  assert.equal(summary.thinking, 2);
  assert.equal(summary.issues, 1);
});

test("empty and thinking-only groups have no tool category segments", () => {
  for (const items of [[], [thinking("reason-1"), thinking("reason-2")]]) {
    const { segments, ...legacy } = cachedActivitySummary(items);
    assert.deepEqual(segments, []);
    assert.deepEqual(legacy, activitySummary(items));
  }
});

test("category counts preserve legacy homogeneous and mixed issue summaries", () => {
  const deniedRead = tool("denied-read", "Read", { toolStatus: "denied" });
  const failedEdit = tool("failed-edit", "Edit", { isError: true });
  const failedRun = tool("failed-run", "Bash", { toolResult: { details: { exitCode: 1 } } });
  const failedSearch = hostedSearch("failed-search", "failed");
  for (const items of [
    [tool("run-1", "Bash"), failedRun],
    [hostedSearch("search-1"), failedSearch, tool("grep", "Grep")],
    [deniedRead, failedEdit, failedRun, failedSearch, thinking("reason")],
  ]) {
    const { segments, ...legacy } = cachedActivitySummary(items);
    assert.deepEqual(legacy, activitySummary(items));
    assert.equal(segments.reduce((count, segment) => count + segment.count, 0), legacy.tools);
  }
  assert.equal(cachedActivitySummary([deniedRead, failedEdit, failedRun, failedSearch]).issues, 4);
});

test("delegation status changes keep category counts and update issues", () => {
  const items = [tool("task", "Task", {
    toolResult: { details: { delegationId: "child", status: "running" } },
  })];
  for (const status of ["running", "completed", "failed", "denied"]) {
    const statuses = new Map([["child", status]]);
    const { segments, ...legacy } = cachedActivitySummary(items, statuses);
    assert.deepEqual(segments, [{ label: "chat.activityTools", count: 1 }]);
    assert.deepEqual(legacy, activitySummary(items, statuses));
    assert.equal(legacy.issues, status === "failed" || status === "denied" ? 1 : 0);
  }
});
