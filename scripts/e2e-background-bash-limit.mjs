#!/usr/bin/env node
/** Production Host, sidecar proxy and wait tool; isolated state and local commands, no provider calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostProcess } from "../packages/host-runtime/dist/host-process.js";
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";
import { resolveHostBinary } from "./e2e/host.mjs";

const temporary = await mkdtemp(join(tmpdir(), "pi-background-limit-"));
let host, sidecar;
try {
  const workspace = join(temporary, "workspace");
  await mkdir(workspace);
  host = new HostProcess({ binaryPath: resolveHostBinary(), dataDir: join(temporary, "data"), onStderr: text => process.stderr.write(text) });
  await host.call("app.handshake", { protocolVersion: 11 });
  const { provider } = await host.call("providers.create", {
    name: "No-call fixture", vendorKey: "custom", authKind: "none", apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }],
  });
  const { session } = await host.call("session.create", {
    title: "Background limit fixture", mode: "agent", executionProfile: "team", projectPath: workspace,
    permissionMode: "auto", providerId: provider.id, modelId: "fixture",
  });
  const configured = await host.call("session.configure", { id: session.id, mode: "agent", permissionMode: "auto" });
  assert.equal(configured.session.permissionMode, "auto");
  const { turnId } = await host.call("session.beginTurn", { sessionId: session.id });
  const declaration = await host.call("team.declareStrategy", {
    teamSessionId: session.id, callerSessionId: session.id, leadTurnId: turnId, strategy: "delegate",
    reason: "Verify managed command termination through the existing Team wait tool.", members: [{ name: "observer", contextKind: "fresh" }],
  });
  await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
  const approved = await host.call("team.confirmLaunchReview", {
    teamSessionId: session.id, reviewId: declaration.review.reviewId, expectedRevision: declaration.review.revision,
  });
  await host.call("session.beginTurn", {
    sessionId: session.id, sessionMessageId: approved.decision.messageIds[0],
  });
  const dispatch = await host.call("team.sendMessage", {
    teamSessionId: session.id, callerSessionId: session.id, target: "observer", content: "Observe the isolated command test.",
  });
  const expertTurn = await host.call("session.beginTurn", {
    sessionId: approved.decision.memberSessionIds[0], sessionMessageId: dispatch.message.id,
  });
  await host.call("session.endTurn", { turnId: expertTurn.turnId, status: "completed", createNotification: false });

  const proxyUrl = new URL("../packages/agent-runtime/dist/parent-host-proxy.js", import.meta.url).href;
  const bindingUrl = new URL("../packages/agent-runtime/dist/project-context-host.js", import.meta.url).href;
  const trackerUrl = new URL("../packages/agent-runtime/dist/team/background-process-updates.js", import.meta.url).href;
  const waitUrl = new URL("../packages/agent-runtime/dist/team/wait-for-updates.js", import.meta.url).href;
  const child = `import { createInterface } from 'node:readline';
    const { ParentHostProxy } = await import(${JSON.stringify(proxyUrl)});
    const { bindProjectContextHost } = await import(${JSON.stringify(bindingUrl)});
    const { createWaitForUpdatesTool } = await import(${JSON.stringify(waitUrl)});
    const { BackgroundProcessUpdates } = await import(${JSON.stringify(trackerUrl)});
    const proxy = new ParentHostProxy(); let wait, background;
    createInterface({input:process.stdin}).on('line', async line => {
      const message = JSON.parse(line); if (proxy.handleParentMessage(message)) return;
      try {
        if (message.method === 'agent.prompt') {
          const { sessionId, projectContextBindingId } = message.params;
          const host = bindProjectContextHost(proxy,sessionId,projectContextBindingId);
          background = new BackgroundProcessUpdates(host,sessionId);
          wait = createWaitForUpdatesTool({teamSessionId:sessionId, callerSessionId:sessionId,host,backgroundProcesses:background});
          console.log(JSON.stringify({id:message.id,result:{ready:true}}));
        } else if (message.method === 'fixture.accept') {
          background.captureReceipt()(message.params.receipt);
          console.log(JSON.stringify({id:message.id,result:{accepted:true}}));
        } else if (message.method === 'fixture.wait') {
          const pending = wait.execute(message.id,{timeoutSeconds:message.params.timeoutSeconds});
          console.log(JSON.stringify({method:"fixture.wait.started",params:{}}));
          const result = await pending;
          console.log(JSON.stringify({id:message.id,result}));
        }
      } catch(error) { console.log(JSON.stringify({id:message.id,error:{code:-32000,message:error.message}})); }
    });`;
  sidecar = new AgentSidecar({ launch: { command: process.execPath, args: ["--input-type=module", "-e", child] }, onStderr: text => process.stderr.write(text) });
  sidecar.setHost(host);
  sidecar.setProjectInstructionRoot(session.id, workspace);
  await sidecar.call("agent.prompt", { sessionId: session.id });
  const shell = (await host.call("commandShells.list")).effective;
  assert.ok(shell?.available);
  const { tools } = await host.call("tools.list");
  assert.ok(tools.find(tool => tool.name === "Bash").parameters.properties.run_in_background.description.includes("default 60 seconds"));
  const launch = async (command, timeoutMs) => {
    const result = await host.call("tools.execute", {
      sessionId: session.id, toolCallId: randomUUID(), toolName: "Bash", mode: "agent",
      args: { command, run_in_background: true }, expectedCommandShellId: shell.id,
      expectedCommandShellDialect: shell.dialect, ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    assert.equal(result.ok, true);
    await sidecar.call("fixture.accept", { receipt: result });
    return result.content.backgroundProcessId;
  };
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const nodeScript = source => `${quote(process.execPath)} -e ${quote(source)}`;
  const sleeping = nodeScript("setInterval(()=>{},1000)");
  const terminal = id => new Promise((resolve, reject) => {
    let checking = false, dirty = false, settled = false;
    const finish = (error, detail) => {
      if (settled) return;
      settled = true; clearTimeout(timer); unsubscribe();
      if (error) reject(error); else resolve(detail);
    };
    const check = async () => {
      if (checking || settled) { dirty = true; return; }
      checking = true; dirty = false;
      try {
        const detail = await host.call("backgroundProcesses.read", { sessionId: session.id, id });
        if (!["starting", "running", "stopping"].includes(detail.process.status)) finish(undefined, detail);
      } catch (error) { finish(error); }
      finally { checking = false; if (dirty && !settled) void check(); }
    };
    const unsubscribe = host.onNotification((method, params) => {
      if (method === "backgroundProcesses.changed" && params.sessionId === session.id && params.id === id) void check();
    });
    const timer = setTimeout(() => finish(new Error("Terminal read deadline exceeded")), 15000);
    void check();
  });
  const waiting = async timeoutSeconds => {
    let acknowledge;
    const ready = new Promise(resolve => { acknowledge = resolve; });
    const unsubscribe = sidecar.onNotification(method => { if (method === "fixture.wait.started") acknowledge(); });
    const pending = sidecar.call("fixture.wait", { timeoutSeconds });
    try { await Promise.race([ready, pending.then(() => { throw new Error("Wait ended before its start acknowledgement"); })]); }
    finally { unsubscribe(); }
    return { pending };
  };
  const { pending: explicitWait } = await waiting(60);
  const explicitId = await launch(sleeping, 1000);
  const explicit = (await explicitWait).details;
  assert.equal(explicit.reason, "background_process_completed");
  assert.equal(explicit.backgroundProcess.process.id, explicitId);
  assert.equal(explicit.backgroundProcess.process.status, "timed_out");
  assert.ok(explicit.backgroundProcess.errorMessage.includes("explicit 1 second"));
  assert.ok(explicit.backgroundProcess.errorMessage.includes("1-21600"));

  const completedId = await launch(nodeScript("process.stdout.write('completed')"), 5000);
  await terminal(completedId);
  const completed = (await sidecar.call("fixture.wait", { timeoutSeconds: 10 })).details;
  assert.equal(completed.backgroundProcess.process.id, completedId);
  assert.equal(completed.backgroundProcess.process.status, "completed");
  assert.equal(completed.backgroundProcess.stdout, "completed");

  const release = join(workspace, "release");
  const betweenId = await launch(nodeScript(`const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},25)`), 5000);
  const firstWait = (await sidecar.call("fixture.wait", { timeoutSeconds: 1 })).details;
  assert.equal(firstWait.reason, "timeout");
  await writeFile(release, "release");
  await terminal(betweenId);
  const between = (await sidecar.call("fixture.wait", { timeoutSeconds: 10 })).details;
  assert.equal(between.backgroundProcess.process.id, betweenId);
  assert.equal(between.backgroundProcess.process.status, "completed");

  const defaultId = await launch(sleeping);
  let defaultDetail;
  const deadline = Date.now() + 75000;
  while (Date.now() < deadline) {
    const update = (await sidecar.call("fixture.wait", { timeoutSeconds: 10 })).details;
    assert.equal(update.error, undefined);
    if (update.backgroundProcess?.process.id === defaultId) { defaultDetail = update.backgroundProcess; break; }
  }
  assert.equal(defaultDetail?.process.status, "timed_out");
  assert.ok(defaultDetail.errorMessage.includes("default 60 second"));
  const reopened = await host.call("backgroundProcesses.read", { sessionId: session.id, id: defaultId });
  assert.equal(reopened.errorMessage, defaultDetail.errorMessage);
  assert.ok(reopened.errorMessage.includes("timeout in seconds"));
  console.log("PASS E2E-RUNTIME-background-bash-timeout-is-visible - explicit/default limit, active wait wake and launch/between-wait gap recovery through production sidecar proxy");
  console.log(`Candidate Host: ${fileURLToPath(new URL("../", import.meta.url))} | ${host.binaryPath}`);
} finally {
  await sidecar?.dispose();
  await host?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
