#!/usr/bin/env node
// Real Host stdio and runtime status; all Git mutations stay in a disposable workspace.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTeamTools } from "../packages/agent-runtime/dist/team/team-tools.js";
import { withScenario } from "./e2e/fixture.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-team-shared-git-"));
try {
  await withScenario("E2E-TEAM-shared-git-warning", async ({host, workspace}) => {
    const git = (...args) => execFileSync("git", args, {
      cwd: workspace, encoding: "utf8",
      env: {...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1"},
    }).trim();
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgSign", "false");
    git("config", "core.hooksPath", process.platform === "win32" ? "NUL" : "/dev/null");
    await writeFile(join(workspace, "builder.txt"), "base\n");
    git("add", "builder.txt");
    git("commit", "-qm", "Fixture base");
    const {provider} = await host.call("providers.create", {name: "Git fixture", vendorKey: "custom", authKind: "none", apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture", models: [{id: "fixture"}]});
    const {session: lead} = await host.call("session.create", {title: "Git warning fixture", mode: "agent", executionProfile: "team", projectPath: workspace, providerId: provider.id, modelId: "fixture"});
    await host.call("session.configure", {id: lead.id, mode: "agent", permissionMode: "auto"});
    const {turnId: leadTurn} = await host.call("session.beginTurn", {sessionId: lead.id});
    const {review} = await host.call("team.declareStrategy", {teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: leadTurn, strategy: "delegate", reason: "Replay shared Git warning", members: [{name: "builder", contextKind: "fresh"}]});
    const {decision} = await host.call("team.confirmLaunchReview", {teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision});
    const memberId = decision.memberSessionIds[0];
    const {task} = await host.call("team.createTask", {teamSessionId: lead.id, callerSessionId: lead.id, subject: "Build owned source", ownerMemberName: "builder", writeScopes: ["builder.txt"]});
    const {message} = await host.call("team.sendMessage", {teamSessionId: lead.id, callerSessionId: lead.id, target: "builder", content: "Start your assigned source task"});
    const {turnId: memberTurn} = await host.call("session.beginTurn", {sessionId: memberId, sessionMessageId: message.id});
    const {task: active} = await host.call("team.updateTask", {teamSessionId: lead.id, callerSessionId: memberId, callerTurnId: memberTurn, taskId: task.taskId, expectedRevision: task.revision, status: "in_progress"});
    const catalog = await host.call("commandShells.list", {});
    assert.ok(catalog.effective, "A configured fixture command shell is required");
    const bash = (sessionId, turnId, toolCallId, command) => host.call("tools.execute", {sessionId, turnId, toolCallId, toolName: "Bash", mode: "agent", expectedCommandShellId: catalog.effective.id, expectedCommandShellDialect: catalog.effective.dialect, args: {command}});
    await writeFile(join(workspace, "builder.txt"), "expert work\n");
    await writeFile(join(workspace, "lead.txt"), "lead work\n");
    const mixed = await bash(lead.id, leadTurn, "mixed", "git add -A && git commit -m 'mixed fixture'");
    assert.equal(mixed.ok, true);
    assert.equal(mixed.content.exitCode, 0);
    assert.equal(mixed.content.gitWarning.code, "TEAM_SHARED_GIT_WARNING");
    assert.equal(mixed.content.gitWarning.conflictingTasks[0].taskId, task.taskId);
    assert.ok(git("show", "--format=", "--name-only", "HEAD").includes("lead.txt"));
    await writeFile(join(workspace, "builder.txt"), "later expert work\n");
    const stash = await bash(lead.id, leadTurn, "stash", "git stash");
    assert.equal(stash.ok, true);
    assert.equal(stash.content.gitWarning.code, "TEAM_SHARED_GIT_WARNING");
    assert.ok(git("stash", "list"), "Warning does not block the actual stash");
    const failed = await bash(lead.id, leadTurn, "failed", "git reset --hard missing-fixture-revision");
    assert.equal(failed.ok, false);
    assert.equal(failed.content.exitCode, 128);
    assert.equal(failed.content.gitWarning.code, "TEAM_SHARED_GIT_WARNING");
    const tools = createTeamTools({teamSessionId: lead.id, callerSessionId: lead.id, isLead: true, host, getTurnId: () => leadTurn});
    const status = await tools.find(tool => tool.name === "team_status").execute("status", {});
    const visible = JSON.parse(status.content[0].text);
    assert.equal(visible.sharedGitWarningCount, 3);
    assert.deepEqual(visible.sharedGitWarnings, [{memberSessionId: lead.id, memberName: "Lead", count: 3}]);
    assert.equal(visible.outOfScopeWriteCount, 0);
    const own = await bash(memberId, memberTurn, "only-writer", "git add --all");
    assert.equal(own.ok, true);
    assert.equal(own.content.gitWarning, undefined);
    await host.call("team.updateTask", {teamSessionId: lead.id, callerSessionId: memberId, callerTurnId: memberTurn, taskId: task.taskId, expectedRevision: active.revision, status: "completed"});
    // WP3a completion claims settle only with the owning successful turn.
    await host.call("session.endTurn", {turnId: memberTurn, status: "completed", createNotification: false});
    const complete = await bash(lead.id, leadTurn, "completed", "git stash");
    assert.equal(complete.content.gitWarning, undefined);
    const board = await host.call("team.getBoard", {teamSessionId: lead.id, callerSessionId: lead.id});
    assert.equal(board.sharedGitWarningCount, 3);
    await host.call("session.endTurn", {turnId: leadTurn, status: "completed", createNotification: false});
    console.log("PASS E2E-TEAM-shared-git-warning: real mixed commit/stash, failed exit unchanged, visible per-caller counts, single writer and settled task excluded");
  }, resolveHostBinary(), temporaryRoot);
} finally {
  await rm(temporaryRoot, {recursive: true, force: true});
}
