#!/usr/bin/env node
// Real Host and Team tool wiring, deterministic fake provider, isolated data.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createTeamTools } from "../packages/agent-runtime/dist/team/team-tools.js";
import { withScenario } from "./e2e/fixture.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = await mkdtemp(join(tmpdir(), "pi-member-activity-"));
try {
  await withScenario("E2E-TEAM-member-activity-interrupt-guard", async ({ host, workspace }) => {
    const { provider } = await host.call("providers.create", {
      name: "Activity fixture", vendorKey: "custom", authKind: "none", apiStyle: "chat_completions",
      baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }],
    });
    const { session: lead } = await host.call("session.create", {
      title: "Activity fixture", mode: "agent", executionProfile: "team", projectPath: workspace,
      permissionMode: "auto", thinkingLevel: "off", providerId: provider.id, modelId: "fixture",
    });
    await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto" });
    const { turnId: declarationTurn } = await host.call("session.beginTurn", { sessionId: lead.id });
    const { review } = await host.call("team.declareStrategy", {
      teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: declarationTurn, strategy: "delegate",
      reason: "Replay a Lead mistaking quiet test work for a dead expert", members: [{ name: "tester", contextKind: "fresh" }],
    });
    await host.call("session.endTurn", { turnId: declarationTurn, status: "completed", createNotification: false });
    const { decision } = await host.call("team.confirmLaunchReview", {
      teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision,
    });
    const { turnId: leadTurn } = await host.call("session.beginTurn", { sessionId: lead.id, sessionMessageId: decision.messageIds[0] });
    const member = decision.memberSessionIds[0];
    const { message } = await host.call("team.sendMessage", {
      teamSessionId: lead.id, callerSessionId: lead.id, target: "tester", content: "Run the quiet background test without Git activity",
    });
    const { turnId: memberTurn } = await host.call("session.beginTurn", { sessionId: member, sessionMessageId: message.id });
    const shell = (await host.call("commandShells.list")).effective;
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const running = await host.call("tools.execute", {
      sessionId: member, turnId: memberTurn, toolCallId: "background-test", toolName: "Bash", mode: "agent",
      expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect,
      args: { command: `${quote(process.execPath)} -e 'setInterval(()=>{},1000)'`, run_in_background: true }, timeoutMs: 30000,
    });
    assert.equal(running.ok, true);
    const processId = running.content.backgroundProcessId;
    const usageReceipt = { sessionId: member, turnId: memberTurn,
      usage: { operationId: "fixture-request", operations: [], inputTokens: 12, outputTokens: 5, totalTokens: 17 } };
    await host.call("session.recordUsage", usageReceipt);
    await host.call("session.recordUsage", usageReceipt);
    const tools = createTeamTools({ teamSessionId: lead.id, callerSessionId: lead.id, isLead: true, host, getTurnId: () => leadTurn });
    const calls = [
      { name: "team_status", arguments: {} },
      { name: "interrupt_agent", arguments: { memberName: "tester" } },
      { name: "interrupt_agent", arguments: { memberName: "tester", force: true } },
      { name: "interrupt_agent", arguments: { memberName: "tester", force: true, reason: "User superseded this fixture test" } },
    ];
    const results = [];
    let step = 0;
    const model = { id: "fixture", provider: "fixture", api: "openai-completions", name: "Fixture", reasoning: false,
      input: ["text"], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const agent = new Agent({ initialState: { tools, model }, streamFn: () => {
      const call = calls[step++];
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: model.cost },
        stopReason: call ? "toolUse" : "stop", content: call ? [{ type: "toolCall", id: `activity-${step}`, ...call }] : [{ type: "text", text: "Fixture complete" }] };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: call ? "toolUse" : "stop", message }); stream.end(message); });
      return stream;
    } });
    agent.subscribe(event => { if (event.type === "tool_execution_end") results.push(event.result); });
    try {
      await agent.prompt("Inspect the tester before interrupting it.");
      assert.match(results[1].content[0].text, /TEAM_MEMBER_ACTIVE/);
      assert.match(results[2].content[0].text, /TEAM_INTERRUPT_REASON_REQUIRED/);
      const status = JSON.parse(results[0].content[0].text);
      const evidence = status.memberActivity.find(item => item.memberSessionId === member);
      assert.equal(evidence.runningBackgroundProcesses[0].id, processId);
      assert.equal(evidence.turn.status, "running");
      assert.equal(evidence.requiresForce, true);
      assert.equal(evidence.recentUsage.completedCallCount, 1);
      assert.equal(evidence.recentUsage.totalTokens, 17);
      assert.equal(JSON.parse(results[3].content[0].text).interrupted, true);
      const interrupts = host.matchingNotifications("team.interruptRequested", note => note.params.sessionId === member);
      assert.equal(interrupts.length, 1, "only the justified force request can reach the dispatcher");
      assert.equal(interrupts[0].params.turnId, memberTurn);
      console.log(JSON.stringify({ evidence, refusal: results[1].content[0].text, forceMissingReason: results[2].content[0].text, interruptCount: interrupts.length }));
    } finally {
      await host.call("backgroundProcesses.stop", { sessionId: member, id: processId });
      await host.call("session.endTurn", { turnId: memberTurn, status: "aborted", createNotification: false });
      await host.call("session.endTurn", { turnId: leadTurn, status: "completed", createNotification: false });
    }
  }, resolveHostBinary(), root);
  console.log("PASS E2E-TEAM-member-activity-interrupt-guard - fake provider sees Host evidence; unforced interruption denied; force requires reason");
} finally {
  await rm(root, { recursive: true, force: true });
}
