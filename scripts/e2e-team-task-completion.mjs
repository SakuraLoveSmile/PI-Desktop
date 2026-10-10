#!/usr/bin/env node
// Real Host RPC and runtime tool boundary; isolated state, no model calls.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, expectRpcError, shortJson } from "./e2e/assert.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { beginTurn, endTurn } from "./e2e/session.mjs";
import { createTeamTools } from "../packages/agent-runtime/dist/team/team-tools.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-team-task-completion-"));
try {
  await withScenario("E2E-TEAM-task-completion", async ({ host, workspace }) => {
    const { provider } = await host.call("providers.create", {
      name: "Task completion fixture", vendorKey: "custom", authKind: "none",
      apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1",
      defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }],
    });
    const { session: lead } = await host.call("session.create", {
      title: "Task completion fixture", mode: "agent", executionProfile: "team",
      projectPath: workspace, providerId: provider.id, modelId: "fixture", permissionMode: "auto",
    });
    const declarationTurn = await beginTurn(host, lead.id);
    const declaration = await host.call("team.declareStrategy", {
      teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: declarationTurn,
      strategy: "delegate", reason: "Verify explicit task completion against execution outcomes.",
      members: [{ name: "writer", contextKind: "fresh" }],
    });
    await endTurn(host, declarationTurn);
    const approval = await host.call("team.confirmLaunchReview", {
      teamSessionId: lead.id, reviewId: declaration.review.reviewId,
      expectedRevision: declaration.review.revision,
    });
    const memberId = approval.decision.memberSessionIds[0];
    const { turnId: leadTurn } = await host.call("session.beginTurn", {
      sessionId: lead.id, sessionMessageId: approval.decision.messageIds[0],
    });
    const leadTools = createTeamTools({ teamSessionId: lead.id, callerSessionId: lead.id,
      isLead: true, host, getTurnId: () => leadTurn });
    const tool = (tools, name) => {
      const selected = tools.find((item) => item.name === name);
      assert(selected, `Missing ${name}`);
      return selected;
    };
    const update = async (tools, task, status) => {
      const result = await tool(tools, "task_update").execute(`update-${task.taskId}`, {
        taskId: task.taskId, expectedRevision: task.revision, status,
      });
      assert(result.content[0].type === "text", shortJson(result));
      return JSON.parse(result.content[0].text);
    };
    const createOwned = async (id) => {
      const { task } = await host.call("team.createTask", {
        teamSessionId: lead.id, callerSessionId: lead.id, taskId: id, subject: id,
      });
      return (await host.call("team.updateTask", {
        teamSessionId: lead.id, callerSessionId: lead.id, taskId: id,
        expectedRevision: task.revision, ownerMemberName: "writer",
      })).task;
    };
    let activeTask = await createOwned("Phase 1 rewrite");
    let historicalTask = await createOwned("Earlier accepted work");
    const untouchedTask = await createOwned("Not started");
    historicalTask = (await update(leadTools, historicalTask, "completed")).task;
    const firstMessage = await host.call("team.sendMessage", {
      teamSessionId: lead.id, callerSessionId: lead.id, target: "writer", content: "Perform the rewrite.",
    });
    const retryMessage = await host.call("team.sendMessage", {
      teamSessionId: lead.id, callerSessionId: lead.id, target: "writer", content: "Retry the rewrite after fixing the edit payload.",
    });
    await endTurn(host, leadTurn);
    const firstTurn = (await host.call("session.beginTurn", {
      sessionId: memberId, sessionMessageId: firstMessage.message.id,
    })).turnId;
    let currentTurn = firstTurn;
    const memberTools = createTeamTools({ teamSessionId: lead.id, callerSessionId: memberId,
      isLead: false, host, getTurnId: () => currentTurn });
    activeTask = (await update(memberTools, activeTask, "in_progress")).task;
    const claim = await update(memberTools, activeTask, "completed");
    activeTask = claim.task;
    assert(activeTask.status === "in_progress", "A running completion claim must stay in progress");
    assert(claim.nextStep?.includes("Do not repeat"), "The agent needs pending-claim guidance");
    host.clearNotifications();
    await host.call("session.endTurn", { turnId: firstTurn, status: "error",
      errorCode: "MUTATION_RETRY_BUDGET_EXHAUSTED", createNotification: false });
    const readBoard = () => host.call("team.getBoard", { teamSessionId: lead.id, callerSessionId: lead.id });
    let board = await readBoard();
    const find = (id) => board.tasks.find((task) => task.taskId === id);
    activeTask = find(activeTask.taskId);
    assert(activeTask.status === "failed", shortJson(board));
    assert(find(historicalTask.taskId).status === "completed", "Failure changed historical work");
    assert(find(untouchedTask.taskId).status === "pending", "Failure changed unstarted work");
    assert(host.matchingNotifications("team.changed").some((note) => note.params.teamSessionId === lead.id),
      "Turn settlement did not publish the updated task snapshot");
    currentTurn = (await host.call("session.beginTurn", {
      sessionId: memberId, sessionMessageId: retryMessage.message.id,
    })).turnId;
    await expectRpcError(() => host.call("team.updateTask", {
      teamSessionId: lead.id, callerSessionId: memberId, taskId: activeTask.taskId,
      expectedRevision: activeTask.revision, status: "completed", expectedCallerTurnId: firstTurn,
    }), ["TEAM_TURN_INVALID"]);
    activeTask = (await update(memberTools, activeTask, "in_progress")).task;
    activeTask = (await update(memberTools, activeTask, "completed")).task;
    await endTurn(host, firstTurn, "completed");
    board = await readBoard();
    assert(find(activeTask.taskId).status === "in_progress", "An old terminal changed the retry");
    await endTurn(host, currentTurn);
    board = await readBoard();
    assert(find(activeTask.taskId).status === "completed", shortJson(board));
    const revision = find(activeTask.taskId).revision;
    await endTurn(host, currentTurn, "error");
    board = await readBoard();
    assert(find(activeTask.taskId).revision === revision, "Duplicate terminal changed the task");
    console.log("PASS E2E-TEAM-task-completion: provisional claim, mutation failure, scoped history, retry, stale RPC/terminal, notification");
  }, resolveHostBinary(), temporaryRoot);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
