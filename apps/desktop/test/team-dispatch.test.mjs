import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  extractTaskFromToolMessage,
  buildTeamDispatchIndex,
  dispatchFallbackState,
  isTeammateJoining,
} = await import("../src/lib/team-dispatch.ts");

test("isTeammateJoining follows only running spawn tools", () => {
  assert.equal(isTeammateJoining([{ toolName: "spawn_teammate", toolStatus: "running" }]), true);
  for (const toolStatus of ["success", "error", "denied", undefined]) {
    assert.equal(isTeammateJoining([{ toolName: "spawn_teammate", toolStatus }]), false);
  }
  assert.equal(isTeammateJoining([{ toolName: "task_create", toolStatus: "running" }]), false);
  assert.equal(isTeammateJoining([]), false);
  assert.equal(isTeammateJoining([
    { toolName: "spawn_teammate", toolStatus: "success" },
    { toolName: "spawn_teammate", toolStatus: "running" },
  ]), true);
});

test("only the active assistant turn exposes expert joining feedback", () => {
  const source = readFileSync(join(here, "../src/features/chat/transcript/AssistantTurn.tsx"), "utf8");
  assert.match(source, /isActive && isTeammateJoining\(tools\)/);
  assert.match(source, /active: isActive, joining: teammateJoining/);
});

test("dispatchFallbackState accepts known states and defaults unsupported values to pending", () => {
  for (const state of ["pending", "in_progress", "completed", "failed", "cancelled"]) {
    assert.equal(dispatchFallbackState(state), state);
  }
  for (const state of [undefined, "unknown", "blocked", ""]) {
    assert.equal(dispatchFallbackState(state), "pending");
  }
});

test("dispatch cards use live task rows and a single task control", () => {
  const source = readFileSync(join(here, "../src/features/chat/transcript/TeamDispatchCard.tsx"), "utf8");
  assert.match(source, /buildTeamTaskRows\(/);
  assert.match(source, /team-dispatch-card-open/);
  assert.doesNotMatch(source, /team-dispatch-card-expert|team-dispatch-task-title-btn/);
});

test("extractTaskFromToolMessage extracts task details from task_create and task_update", () => {
  // Non-task tool
  const otherMsg = {
    id: "msg-0",
    role: "tool",
    toolName: "Bash",
    toolCallId: "call-0",
    toolArgs: { command: "ls" },
  };
  assert.deepEqual(extractTaskFromToolMessage(otherMsg), {
    action: null,
    taskId: null,
  });

  // task_create with args and result
  const createMsg = {
    id: "msg-1",
    role: "tool",
    toolName: "task_create",
    toolCallId: "call-1",
    toolArgs: {
      subject: "Analyze security vulnerabilities",
      description: "Perform static analysis",
      ownerMemberName: "security_expert",
    },
    toolResult: {
      taskId: "task-101",
      status: "pending",
    },
  };
  const extractedCreate = extractTaskFromToolMessage(createMsg);
  assert.equal(extractedCreate.action, "create");
  assert.equal(extractedCreate.taskId, "task-101");
  assert.equal(extractedCreate.subject, "Analyze security vulnerabilities");
  assert.equal(extractedCreate.status, "pending");
  assert.equal(extractedCreate.ownerMemberName, "security_expert");

  // task_update with status update
  const updateMsg = {
    id: "msg-2",
    role: "tool",
    toolName: "task_update",
    toolCallId: "call-2",
    toolArgs: {
      taskId: "task-101",
      status: "in_progress",
    },
    toolResult: {
      task: {
        taskId: "task-101",
        subject: "Analyze security vulnerabilities",
        status: "in_progress",
        ownerMemberName: "security_expert",
      },
    },
  };
  const extractedUpdate = extractTaskFromToolMessage(updateMsg);
  assert.equal(extractedUpdate.action, "update");
  assert.equal(extractedUpdate.taskId, "task-101");
  assert.equal(extractedUpdate.status, "in_progress");
});

test("buildTeamDispatchIndex anchors to first create message and updates in place without duplicate cards", () => {
  const teamSessionId = "team-sess-1";

  const msg1 = {
    id: "msg-create-1",
    role: "tool",
    toolName: "task_create",
    toolCallId: "call-c1",
    toolArgs: {
      subject: "Task One",
      ownerMemberName: "researcher",
    },
    toolResult: {
      taskId: "task-1",
      status: "pending",
    },
  };

  const msg2 = {
    id: "msg-create-2",
    role: "tool",
    toolName: "task_create",
    toolCallId: "call-c2",
    toolArgs: {
      subject: "Task Two",
      ownerMemberName: "reviewer",
    },
    toolResult: {
      taskId: "task-2",
      status: "pending",
    },
  };

  const msg3 = {
    id: "msg-update-1",
    role: "tool",
    toolName: "task_update",
    toolCallId: "call-u1",
    toolArgs: {
      taskId: "task-1",
      status: "in_progress",
    },
    toolResult: {
      task: { taskId: "task-1", status: "in_progress" },
    },
  };

  const msg4 = {
    id: "msg-update-1-done",
    role: "tool",
    toolName: "task_update",
    toolCallId: "call-u2",
    toolArgs: {
      taskId: "task-1",
      status: "completed",
    },
    toolResult: {
      task: { taskId: "task-1", status: "completed" },
    },
  };

  const index = buildTeamDispatchIndex([msg1, msg2, msg3, msg4], teamSessionId);

  // 1. Exactly 2 unique tasks
  assert.equal(index.cardsByTaskId.size, 2);
  const card1 = index.cardsByTaskId.get(`${teamSessionId}:task-1`);
  const card2 = index.cardsByTaskId.get(`${teamSessionId}:task-2`);
  assert.ok(card1);
  assert.ok(card2);

  // 2. Task 1 updated in place to completed
  assert.equal(card1.task.status, "completed");
  assert.equal(card1.firstCreateMessageId, "msg-create-1");
  assert.equal(card1.task.subject, "Task One");

  // 3. Task 2 remains pending
  assert.equal(card2.task.status, "pending");
  assert.equal(card2.firstCreateMessageId, "msg-create-2");

  // 4. cardsByMessageId: anchored strictly to create messages
  assert.equal(index.cardsByMessageId.get("msg-create-1")?.length, 1);
  assert.equal(index.cardsByMessageId.get("msg-create-1")[0].taskId, "task-1");

  assert.equal(index.cardsByMessageId.get("msg-create-2")?.length, 1);
  assert.equal(index.cardsByMessageId.get("msg-create-2")[0].taskId, "task-2");

  // Update messages must NOT produce duplicate cards
  assert.equal(index.cardsByMessageId.has("msg-update-1"), false);
  assert.equal(index.cardsByMessageId.has("msg-update-1-done"), false);
});

test("buildTeamDispatchIndex handles isolated task_update gracefully", () => {
  const teamSessionId = "team-sess-isolated";
  const orphanUpdate = {
    id: "msg-orphan",
    role: "tool",
    toolName: "task_update",
    toolCallId: "call-orphan",
    toolArgs: {
      taskId: "task-orphan",
      subject: "Orphaned Task",
      status: "in_progress",
    },
    toolResult: {
      task: { taskId: "task-orphan", status: "in_progress" },
    },
  };

  const index = buildTeamDispatchIndex([orphanUpdate], teamSessionId);
  assert.equal(index.cardsByTaskId.size, 1);
  const card = index.cardsByTaskId.get(`${teamSessionId}:task-orphan`);
  assert.ok(card);
  assert.equal(card.firstCreateMessageId, "msg-orphan");
  assert.equal(card.task.status, "in_progress");
  assert.equal(index.cardsByMessageId.get("msg-orphan")?.length, 1);
});

test("failed task tools never create or update dispatch cards", () => {
  const failedCreate = {
    id: "msg-failed-create",
    role: "tool",
    toolName: "task_create",
    toolCallId: "call-failed-create",
    toolArgs: { subject: "Not created" },
    toolResult: { error: "permission denied" },
    toolStatus: "error",
  };
  const failedUpdate = {
    id: "msg-failed-update",
    role: "tool",
    toolName: "task_update",
    toolArgs: { taskId: "task-1", status: "completed" },
    toolResult: { isError: true, message: "update rejected" },
  };

  assert.equal(extractTaskFromToolMessage(failedCreate).action, null);
  const index = buildTeamDispatchIndex([
    {
      id: "msg-create",
      role: "tool",
      toolName: "task_create",
      toolArgs: { subject: "Existing" },
      toolResult: { taskId: "task-1", status: "pending" },
    },
    failedCreate,
    failedUpdate,
  ], "team-session");

  assert.equal(index.cardsByTaskId.size, 1);
  assert.equal(index.cardsByTaskId.get("team-session:task-1")?.task.status, "pending");
  assert.equal(index.cardsByMessageId.has("msg-failed-create"), false);
});

test("task_create without a successful real task id is omitted", () => {
  const message = {
    id: "msg-no-id",
    role: "tool",
    toolName: "task_create",
    toolCallId: "call-no-id",
    toolArgs: { subject: "No identifier" },
  };
  assert.equal(extractTaskFromToolMessage(message).taskId, null);
  assert.equal(buildTeamDispatchIndex([message], "team-session").cardsByTaskId.size, 0);
});

test("a successful task_update may set the task status to failed", () => {
  const created = {
    id: "msg-create-failed-task",
    role: "tool",
    toolName: "task_create",
    toolArgs: { subject: "Needs review" },
    toolResult: { taskId: "task-failed", status: "pending" },
  };
  const updated = {
    id: "msg-task-failed",
    role: "tool",
    toolName: "task_update",
    toolArgs: { taskId: "task-failed", status: "failed" },
    toolResult: { task: { taskId: "task-failed", status: "failed" } },
  };
  const index = buildTeamDispatchIndex([created, updated], "team-session");
  assert.equal(index.cardsByTaskId.get("team-session:task-failed")?.task.status, "failed");
});

test("a running task_update without an authoritative result does not change or create a card", () => {
  const created = {
    id: "msg-create-running-update",
    role: "tool",
    toolName: "task_create",
    toolArgs: { subject: "Existing" },
    toolResult: { taskId: "task-1", status: "pending" },
  };
  const runningUpdate = {
    id: "msg-update-started",
    role: "tool",
    toolName: "task_update",
    toolStatus: "running",
    toolArgs: { taskId: "task-1", status: "completed" },
  };
  const runningOrphan = {
    ...runningUpdate,
    id: "msg-orphan-update-started",
    toolArgs: { taskId: "task-orphan", status: "completed" },
  };
  const index = buildTeamDispatchIndex([created, runningUpdate, runningOrphan], "team-session");
  assert.equal(index.cardsByTaskId.size, 1);
  assert.equal(index.cardsByTaskId.get("team-session:task-1")?.task.status, "pending");
  assert.equal(index.cardsByMessageId.has("msg-update-started"), false);
  assert.equal(index.cardsByMessageId.has("msg-orphan-update-started"), false);
});
