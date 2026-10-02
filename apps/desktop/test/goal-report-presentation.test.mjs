import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  shouldPresentGoalReportInTranscript,
  shouldAutoOpenGoalReportWorkPanel,
} = await import("../src/lib/goal-report-presentation.ts");

test("transcript presents only ready reports with terminal execution status", () => {
  // Ready + completed -> true
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "ready",
      executionStatus: "completed",
    }),
    true,
  );

  // Ready + interrupted -> true
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "ready",
      executionStatus: "interrupted",
    }),
    true,
  );

  // Ready but executionStatus is null or non-terminal -> false
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "ready",
      executionStatus: null,
    }),
    false,
  );

  // In-flight drafts or pending -> false
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "draft",
      executionStatus: "completed",
    }),
    false,
  );
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "pending",
      executionStatus: "running",
    }),
    false,
  );
  // Failed + terminal allows presenting card for retry
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "failed",
      executionStatus: "completed",
    }),
    true,
  );
  // Failed but running -> false
  assert.equal(
    shouldPresentGoalReportInTranscript({
      status: "failed",
      executionStatus: "running",
    }),
    false,
  );
  assert.equal(shouldPresentGoalReportInTranscript(null), false);
  assert.equal(shouldPresentGoalReportInTranscript(undefined), false);
});

test("auto-opening panel requires matching active session, ready status, and opens at most once per execution", () => {
  const activeSessionId = "session-active";
  const executionId = "exec-1";
  const openedSet = new Set();

  const readyEvent = {
    sessionId: activeSessionId,
    executionId,
    reportId: "rep-1",
    status: "ready",
  };

  // 1. First ready event for active session -> true
  assert.equal(
    shouldAutoOpenGoalReportWorkPanel({
      event: readyEvent,
      activeSessionId,
      openedExecutionIds: openedSet,
    }),
    true,
  );

  // Record open
  openedSet.add(executionId);

  // 2. Duplicate ready event for same execution -> false
  assert.equal(
    shouldAutoOpenGoalReportWorkPanel({
      event: readyEvent,
      activeSessionId,
      openedExecutionIds: openedSet,
    }),
    false,
  );

  // 3. Different session -> false
  assert.equal(
    shouldAutoOpenGoalReportWorkPanel({
      event: readyEvent,
      activeSessionId: "session-other",
      openedExecutionIds: new Set(),
    }),
    false,
  );

  // 4. Non-ready status (draft, pending, failed) -> false
  for (const status of ["draft", "pending", "failed"]) {
    assert.equal(
      shouldAutoOpenGoalReportWorkPanel({
        event: { ...readyEvent, status },
        activeSessionId,
        openedExecutionIds: new Set(),
      }),
      false,
    );
  }
});
