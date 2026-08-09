import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  isDelegationActivityItem,
  subagentOutcome,
  summarizeSubagentActivity,
} = await import("../src/lib/subagent-topology.ts");

function task(id, toolStatus, resultStatus) {
  const message = {
    id,
    role: "tool",
    content: "",
    createdAt: "2026-08-10T00:00:00.000Z",
    toolName: "Task",
    toolCallId: id,
    toolStatus,
    toolArgs: { agent: "reviewer", description: `Task ${id}` },
    ...(resultStatus
      ? { toolResult: { details: { status: resultStatus } } }
      : {}),
  };
  return { kind: "tool", message };
}

test("detects exact delegation activities without absorbing ordinary tools", () => {
  assert.equal(isDelegationActivityItem(task("one", "running")), true);
  assert.equal(
    isDelegationActivityItem({
      kind: "tool",
      message: { ...task("read", "success").message, toolName: "Read" },
    }),
    false,
  );
  assert.equal(
    isDelegationActivityItem({
      kind: "thinking",
      message: { ...task("thought", "success").message, role: "assistant" },
    }),
    false,
  );
});

test("prefers the structured delegate outcome over the transport status", () => {
  assert.equal(subagentOutcome(task("running", "running").message), "running");
  assert.equal(
    subagentOutcome(task("done", "success", "completed").message),
    "completed",
  );
  assert.equal(
    subagentOutcome(task("cap", "success", "truncated").message),
    "truncated",
  );
  assert.equal(
    subagentOutcome(task("stop", "success", "aborted").message),
    "aborted",
  );
  assert.equal(
    subagentOutcome(task("fail", "success", "failed").message),
    "failed",
  );
  assert.equal(subagentOutcome(task("denied", "denied").message), "denied");
});

test("summarizes partial fan-out without deduplicating repeated agent names", () => {
  assert.deepEqual(
    summarizeSubagentActivity([
      task("one", "running"),
      task("two", "success", "completed"),
      task("three", "success", "truncated"),
      task("four", "success", "aborted"),
      task("five", "error", "failed"),
      task("six", "denied"),
    ]),
    {
      total: 6,
      finished: 5,
      running: 1,
      issues: 2,
      warnings: 2,
    },
  );
  assert.deepEqual(summarizeSubagentActivity([]), {
    total: 0,
    finished: 0,
    running: 0,
    issues: 0,
    warnings: 0,
  });
});
