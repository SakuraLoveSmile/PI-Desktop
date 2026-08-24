import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  collectDelegationStatuses,
  collectDelegationTimings,
  isDelegationActivityItem,
  subagentOutcome,
  summarizeSubagentActivity,
} = await import("../src/lib/subagent-topology.ts");

function task(id, toolStatus, resultStatus, timing = {}) {
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
      ? {
          toolResult: {
            details: {
              delegationId: id,
              status: resultStatus,
              ...timing,
            },
          },
        }
      : {}),
  };
  return { kind: "tool", message };
}

function lifecycle(toolName, details) {
  return {
    kind: "tool",
    message: {
      id: toolName,
      role: "tool",
      content: "",
      createdAt: "2026-08-10T00:00:00.000Z",
      toolName,
      toolCallId: toolName,
      toolStatus: "success",
      toolResult: { details },
    },
  };
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
  // The lifecycle tools of ADR 0087 drive an existing delegation and must not
  // inflate the topology's subagent counts.
  for (const toolName of ["TaskWait", "TaskList", "TaskStop"]) {
    assert.equal(
      isDelegationActivityItem({
        kind: "tool",
        message: { ...task("lifecycle", "success").message, toolName },
      }),
      false,
      `${toolName} is not a delegation activity item`,
    );
  }
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
    subagentOutcome(task("stopped", "success", "stopped").message),
    "stopped",
  );
  assert.equal(
    subagentOutcome(task("fail", "success", "failed").message),
    "failed",
  );
  assert.equal(subagentOutcome(task("denied", "denied").message), "denied");
});

test("uses delegation lifecycle timestamps instead of the immediate Task duration", () => {
  const timings = collectDelegationTimings([
    task("running", "success", "running", { startedAt: 1_000 }),
    lifecycle("TaskWait", {
      status: "completed",
      delegations: [
        {
          delegationId: "running",
          agent: "reviewer",
          status: "completed",
          startedAt: 1_000,
          completedAt: 4_250,
        },
      ],
    }),
  ]);

  assert.deepEqual(timings.get("running"), {
    startedAt: 1_000,
    completedAt: 4_250,
  });
});

test("reads settled delegation status from a persisted TaskWait result", () => {
  const statuses = collectDelegationStatuses([
    task("running", "success", "running"),
    lifecycle("TaskWait", {
      delegations: [
        {
          delegationId: "running",
          status: "completed",
          startedAt: 1_000,
          completedAt: 4_250,
        },
      ],
    }),
  ]);

  assert.equal(statuses.get("running"), "completed");
  assert.equal(
    subagentOutcome(task("running", "success", "running").message, statuses),
    "completed",
  );
});

test("summarizes partial fan-out without deduplicating repeated agent names", () => {
  assert.deepEqual(
    summarizeSubagentActivity([
      task("one", "running"),
      task("two", "success", "completed"),
      task("three", "success", "truncated"),
      task("four", "success", "aborted"),
      task("five", "success", "stopped"),
      task("six", "error", "failed"),
      task("seven", "denied"),
    ]),
    {
      total: 7,
      finished: 6,
      running: 1,
      issues: 2,
      warnings: 3,
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
