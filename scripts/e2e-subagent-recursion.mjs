#!/usr/bin/env node
/** Real sidecar + isolated Host + deterministic loopback SSE provider.
 * Exercises the runtime launch/proxy boundary, not Electron launch resolution or UI.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";
import { PROTOCOL_VERSION } from "../packages/shared/dist/protocol.js";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

if (process.platform === "win32") {
  throw new Error("Recursive delegation E2E requires macOS/Linux HOME isolation; no Windows user profile was accessed.");
}
const scratch = await mkdtemp(join(tmpdir(), "pi-recursion-e2e-"));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
await mkdir(workspace); await mkdir(home);
const previousHome = process.env.HOME;
process.env.HOME = home;
const requests = [];
const events = [];
const scenarios = new Map();
const held = new Map();
let fixtureError;
let stderr = "";
let sidecar;
const host = new Host(resolveHostBinary(), join(scratch, "data"));

async function until(predicate, label) {
  const deadline = Date.now() + 20_000;
  while (!await predicate()) {
    if (fixtureError) throw fixtureError;
    assert.ok(Date.now() < deadline, `${label} timed out\n${stderr}\n${JSON.stringify(events.filter(e => e.event.type === "error"))}`);
    await delay(10);
  }
}
const task = (scenario, node) => ({ name: "Task", args: { agent: "fixture-worker", task: `[fixture:${scenario}:${node}] Complete your assigned fixture and report its result.` } });
const toolsOf = request => (request.tools ?? []).map(tool => tool.function?.name);
const resultText = messages => messages.filter(message => message.role === "tool").map(message => String(message.content ?? "")).join("\n");
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST", "Only local completion requests are expected");
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const messages = request.messages ?? [];
    const markerIndex = messages.findLastIndex(message => message.role === "user" && /^\[fixture:/.test(typeof message.content === "string" ? message.content : message.content?.[0]?.text ?? ""));
    const markerText = typeof messages[markerIndex]?.content === "string" ? messages[markerIndex].content : messages[markerIndex]?.content?.[0]?.text;
    const [, scenarioId, node] = /^\[fixture:([\w-]+):([\w-]+)\]/.exec(markerText ?? "") ?? [];
    assert.ok(scenarioId && node, "Completion request must carry its isolated fixture marker");
    const scenario = scenarios.get(scenarioId);
    assert.ok(scenario, `Unknown fixture ${scenarioId}`);
    const active = messages.slice(markerIndex + 1);
    const called = active.filter(message => message.role === "assistant").flatMap(message => message.tool_calls ?? []).map(call => call.function.name);
    const captured = { scenarioId, node, request, called, toolText: resultText(active) };
    requests.push(captured);
    let calls = [];
    let text = `RESULT_${node}`;
    if (node === "held") {
      await new Promise(resolve => {
        held.set(scenarioId, { release: resolve, closed: false });
        res.once("close", () => { held.get(scenarioId).closed = true; resolve(); });
      });
      if (res.destroyed) return;
    } else if (scenario.kind === "denied") {
      if (!called.includes("Task")) calls = [task(scenarioId, "unexpected")];
      else {
        text = "RESULT_denied";
        if (scenarioId === "lead-denied") {
          // Keep the next Lead completion at the transport edge until the
          // harness cancels; Team approval is outside this denial probe.
          await new Promise(resolve => { held.set(scenarioId, { release: resolve, closed: false });
            res.once("close", () => { held.get(scenarioId).closed = true; resolve(); }); });
          if (res.destroyed) return;
        }
      }
    } else if (node === "root" || node === "branch" || (scenario.kind === "waiting-capacity" && node === "grandchild")) {
      if (!called.includes("Task")) {
        if (scenario.kind === "waiting-capacity" && node === "grandchild") {
          await until(() => events.some(envelope => envelope.sessionId === scenario.sessionId && envelope.parentToolCallId && envelope.event.type === "tool_start" && envelope.event.toolName === "TaskWait"), "branch entered TaskWait");
        }
        if (scenario.kind === "capacity" && node === "branch") {
          // Both root siblings must occupy their shared slots before the
          // branch tries to spawn. This is an explicit transport gate.
          await until(() => held.has(scenarioId), "capacity sibling entered");
        }
        calls = node === "root"
          ? [task(scenarioId, "branch"), ...(scenario.kind === "capacity" ? [task(scenarioId, "held")] : [])]
          : [task(scenarioId, node === "grandchild" ? "unexpected" : ["abort", "task-stop"].includes(scenario.kind) ? "held" : "grandchild")];
      } else if (scenario.kind === "task-stop" && node === "root" && !called.includes("TaskStop")) {
        await until(() => held.has(scenarioId), "grandchild entered before TaskStop");
        calls = [{ name: "TaskStop", args: {} }];
      } else if (!called.includes("TaskWait") && /Delegation [\w-]+ started:/.test(resultText(active))) {
        const ids = [...resultText(active).matchAll(/Delegation ([\w-]+) started:/g)].map(match => match[1]);
        calls = [{ name: "TaskWait", args: { delegationIds: [...new Set(ids)] } }];
      }
    }
    const delta = calls.length ? { role: "assistant", tool_calls: calls.map((call, index) => ({ index, id: randomUUID(), type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { role: "assistant", content: text };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [value, finish] of [[delta, null], [{}, calls.length ? "tool_calls" : "stop"]]) {
      res.write(`data: ${JSON.stringify({ id: randomUUID(), model: "recursion-fixture", choices: [{ index: 0, delta: value, finish_reason: finish }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  } catch (error) {
    fixtureError ??= error;
    if (!res.headersSent) res.writeHead(500);
    res.end("Isolated fixture failed");
  }
});
const shell = { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true };
const definitions = [{ name: "fixture-worker", description: "A scoped deterministic worker", source: "user", tools: ["Read", "Write"],
  prompt: "Complete the assigned fixture. Delegate independent work when within the configured bounds; converge before reporting." }];
let provider;

async function createSession(mode = "agent", executionProfile = "standard") {
  return (await host.call("session.create", { title: "Isolated recursive delegation", projectPath: workspace, mode, executionProfile,
    providerId: provider.id, modelId: "recursion-fixture", permissionMode: "auto" })).session;
}
async function begin(session, id, kind, limits = {}, context) {
  scenarios.set(id, { kind, sessionId: session.id });
  const { turnId } = await host.call("session.beginTurn", { sessionId: session.id });
  const content = `[fixture:${id}:root] Delegate the independent work and integrate the reports.`;
  const userMessageId = randomUUID();
  await host.call("session.appendMessage", { sessionId: session.id, turnId, message: {
    id: userMessageId, role: "user", content, createdAt: new Date().toISOString(),
  } });
  await sidecar.call("agent.prompt", { sessionId: session.id, turnId, userMessageId, content, mode: session.mode,
    executionProfile: session.executionProfile, teamContext: context,
    provider: { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, modelId: "recursion-fixture", apiKey: "", authKind: "none",
      apiStyle: "openai-chat", supportsReasoning: false, supportedThinkingLevels: ["off"] },
    commandShell: shell, thinkingLevel: "off", projectPath: workspace, scratchDir: join(scratch, "reports", session.id),
    subagents: definitions, subagentMaxDepth: 2, subagentMaxConcurrency: 10, ...limits,
  });
  return { session, id, turnId };
}
async function finish(run, status = "completed") {
  await until(() => events.some(envelope => envelope.sessionId === run.session.id && envelope.turnId === run.turnId && !envelope.parentToolCallId && envelope.event.type === "agent_end"), `${run.id} root finished`);
  await until(async () => !(await sidecar.call("agent.getStatus", { sessionId: run.session.id })).status.isRunning, `${run.id} descendants settled`);
  assert.deepEqual(events.filter(envelope => envelope.sessionId === run.session.id && envelope.event.type === "error"), [], "Unexpected runtime error");
  await host.call("session.endTurn", { turnId: run.turnId, status, createNotification: false });
  return requests.filter(request => request.scenarioId === run.id);
}
function assertCollected(captured, node, report) {
  assert.ok(captured.some(request => request.node === node && request.called.includes("TaskWait") && request.toolText.includes(report)), `${node} must collect ${report} through TaskWait`);
}
async function createExpert(mode = "agent") {
  const lead = await createSession(mode, "team");
  const { turnId } = await host.call("session.beginTurn", { sessionId: lead.id });
  const declared = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: turnId,
    strategy: "delegate", reason: "Independent bounded implementation", members: [{ name: "fixture-expert", contextKind: "fresh", presetId: "fullstack" }] });
  const decision = mode === "plan" ? declared.decision : (await host.call("team.confirmLaunchReview", {
    teamSessionId: lead.id, reviewId: declared.review.reviewId, expectedRevision: declared.review.revision,
  })).decision;
  await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
  const expert = (await host.call("session.get", { id: decision.memberSessionIds[0] })).session;
  return { lead, expert, context: await host.call("team.getRuntimeContext", { sessionId: expert.id }) };
}

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await host.start(PROTOCOL_VERSION);
  await host.call("workspace.set", { path: workspace });
  ({ provider } = await host.call("providers.create", { name: "Recursive delegation fixture", vendorKey: "custom", type: "openai_compatible",
    protocol: "openai_compatible", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, authKind: "none", apiStyle: "chat_completions",
    defaultModelId: "recursion-fixture", models: [{ id: "recursion-fixture" }] }));
  await host.call("settings.set", { defaultProviderId: provider.id, defaultModelId: "recursion-fixture", defaultPermissionMode: "auto" });
  sidecar = new AgentSidecar({ launch: { command: process.execPath,
    args: [fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))], cwd: workspace,
    env: { ...process.env, HOME: home, PI_DESKTOP_DATA_DIR: join(scratch, "data") } }, onStderr: chunk => { stderr += chunk; } });
  sidecar.setHost({ call: host.call.bind(host), onNotification: () => () => {}, onExit: () => () => {} });
  sidecar.onNotification((method, envelope) => { if (method === "agent.event") events.push(envelope); });

  const chain = await finish(await begin(await createSession(), "chain", "chain"));
  assert.ok(chain.some(request => request.node === "grandchild"), "Grandchild must reach the real provider transport");
  assertCollected(chain, "branch", "RESULT_grandchild"); assertCollected(chain, "root", "RESULT_branch");
  assert.ok(chain.filter(request => request.node === "branch").every(request => toolsOf(request.request).includes("Task")), "Child keeps recursive Task control");
  console.log("PASS standard root -> child -> grandchild, with both parent reports collected");

  const depth = await finish(await begin(await createSession(), "depth", "chain", { subagentMaxDepth: 1 }));
  assert.equal(depth.some(request => request.node === "grandchild"), false, "Depth limit must prevent a provider request");
  assert.ok(depth.some(request => request.node === "branch" && /depth|recurs|not found|unknown|unavailable/i.test(request.toolText)), "Child observes depth denial");
  assert.equal(toolsOf(depth.find(request => request.node === "branch").request).includes("Task"), false, "Depth ceiling removes recursive declarations");
  console.log("PASS maxDepth=1 refuses grandson execution");

  const capacityRun = await begin(await createSession(), "capacity", "capacity", { subagentMaxConcurrency: 2 });
  await until(() => requests.some(request => request.scenarioId === "capacity" && request.node === "branch" && /concurren|already running|limit|capacity/i.test(request.toolText)), "shared tree capacity denial");
  assert.equal(requests.some(request => request.scenarioId === "capacity" && request.node === "grandchild"), false);
  held.get("capacity").release();
  await finish(capacityRun);
  console.log("PASS shared maxConcurrency=2 includes the branch waiting to delegate and its sibling");

  const waiting = await finish(await begin(await createSession(), "waiting-capacity", "waiting-capacity", { subagentMaxDepth: 3, subagentMaxConcurrency: 2 }));
  assert.ok(waiting.some(request => request.node === "grandchild" && /already running/i.test(request.toolText)), "A parent waiting in TaskWait still occupies its tree slot");
  assert.equal(waiting.some(request => request.node === "unexpected"), false);
  assertCollected(waiting, "branch", "RESULT_grandchild");
  console.log("PASS ancestors waiting in TaskWait remain counted against the shared tree cap");

  for (const kind of ["task-stop", "abort"]) {
    const run = await begin(await createSession(), kind, kind);
    await until(() => held.has(kind), `${kind} grandchild entered`);
    if (kind === "abort") await sidecar.call("agent.abort", { sessionId: run.session.id, turnId: run.turnId });
    await finish(run, kind === "abort" ? "interrupted" : "completed");
    await until(() => held.get(kind).closed, `${kind} grandchild HTTP connection cancelled`);
    assert.equal(requests.some(request => request.scenarioId === kind && request.node === "held" && request.called.length), false);
    console.log(`PASS ${kind} settles root and aborts its grandchild provider stream`);
  }

  const { lead, expert, context } = await createExpert();
  assert.equal(context.isLead, false); assert.equal(context.workPurpose, "execute");
  const expertRequests = await finish(await begin(expert, "expert", "chain", {}, context));
  assert.ok(expertRequests.some(request => request.node === "grandchild"));
  assertCollected(expertRequests, "root", "RESULT_branch");
  assert.ok(toolsOf(expertRequests[0].request).includes("send_message"), "Expert keeps Team result channel");
  assert.equal(toolsOf(expertRequests.find(request => request.node === "branch").request).includes("send_message"), false, "Ordinary child cannot inherit Team identity");
  console.log("PASS Host-confirmed Team executor launches Task recursion without leaking Team controls to children");

  const leadContext = await host.call("team.getRuntimeContext", { sessionId: lead.id });
  const leadRun = await begin(lead, "lead-denied", "denied", {}, leadContext);
  // Lead completion has an independent mandatory-expert barrier. Inspect the
  // rejected forged call, then cancel rather than fulfilling an unrelated Team journey.
  await until(() => requests.some(request => request.scenarioId === "lead-denied" && request.toolText.length), "Lead Task rejection");
  await sidecar.call("agent.abort", { sessionId: lead.id, turnId: leadRun.turnId });
  const leadRequests = await finish(leadRun, "interrupted");
  assert.equal(leadRequests.some(request => request.node === "unexpected"), false);
  assert.equal(toolsOf(leadRequests[0].request).includes("Task"), false);
  const research = await createExpert("plan");
  assert.equal(research.context.workPurpose, "plan_research");
  const researchRequests = await finish(await begin(research.expert, "research-denied", "denied", {}, research.context));
  assert.equal(researchRequests.some(request => request.node === "unexpected"), false);
  assert.equal(toolsOf(researchRequests[0].request).includes("Task"), false);
  console.log("PASS Team Lead and Plan researcher reject forged Task calls");
  if (fixtureError) throw fixtureError;
  console.log("SUBAGENT_RECURSION " + JSON.stringify({ ok: true, environment: "isolated Host + real sidecar + loopback SSE", requests: requests.length,
    coverage: ["recursive-report-convergence", "depth-ceiling", "shared-tree-concurrency", "waiting-parent-capacity", "TaskStop-descendants", "user-abort-descendants", "confirmed-expert-Task", "Lead-and-research-denial"],
    notCovered: ["Electron launch resolver", "renderer UI", "paid providers"] }));
} finally {
  for (const gate of held.values()) gate.release();
  await sidecar?.dispose();
  await host.stop();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  await rm(scratch, { recursive: true, force: true });
}
