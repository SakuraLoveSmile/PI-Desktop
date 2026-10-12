#!/usr/bin/env node
// Real production Host + runner, disposable data/workspaces, no model requests.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "scripts/e2e/fixtures/managed-service-tree.mjs");
const exec = promisify(execFile);
const active = new Set(["starting", "running", "stopping"]);
const trees = [];
const evidence = { scenario: "E2E-TEAM-managed-service-lifecycle", timeline: [], passed: [], limitations: [] };
const quick = process.argv.includes("--quick");
let temporary, host, stdioHost, appHost, shell, provider;
function record(stage, detail = {}) {
  evidence.timeline.push({ at: new Date().toISOString(), stage, ...detail });
}
function pass(id, detail) {
  evidence.passed.push(id);
  record(id, detail);
  console.log(`PASS ${id} ${JSON.stringify(detail)}`);
}
async function bounded(promise, label, ms = 15_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(label, condition, ms = 15_000) {
  const deadline = Date.now() + ms;
  do {
    const value = await condition();
    if (value) return value;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`${label} did not become true within ${ms} ms`);
}
async function optionalFile(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
async function processRows(pids) {
  if (pids.length === 0) return new Map();
  let stdout;
  try {
    ({ stdout } = await exec("ps", ["-p", pids.join(","), "-o", "pid=,ppid=,stat=,command="],
      { timeout: 5_000, maxBuffer: 256 * 1024 }));
  } catch (error) {
    if (error.code === 1 && !error.stdout?.trim()) return new Map();
    throw error;
  }
  return new Map(stdout.split("\n").flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return match ? [[Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]),
      status: match[3], command: match[4] }]] : [];
  }));
}
const live = row => row && !row.status.startsWith("Z");
async function capture(tree) {
  await until("fixture PID markers", async () => {
    tree.nodes = [];
    for (const role of ["parent", "child", "grandchild"]) {
      const raw = await optionalFile(join(tree.directory, `${role}.json`));
      if (!raw) return false;
      const node = JSON.parse(raw);
      assert.equal(node.token, tree.token);
      assert.equal(node.role, role);
      assert.ok(Number.isSafeInteger(node.pid) && node.pid > 0);
      tree.nodes.push(node);
    }
    return true;
  });
  const rows = await processRows(tree.nodes.map(node => node.pid));
  for (const node of tree.nodes) {
    const row = rows.get(node.pid);
    assert.ok(live(row) && row.command.includes(fixture) && row.command.includes(tree.token), "fixture identity");
  }
  assert.equal(rows.get(tree.nodes[1].pid).ppid, tree.nodes[0].pid);
  assert.equal(rows.get(tree.nodes[2].pid).ppid, tree.nodes[1].pid);
  const hostPid = host === stdioHost ? stdioHost.child.pid : undefined;
  let ancestor = rows.get(tree.nodes[0].pid);
  let productionRunner = false;
  for (let depth = 0; depth < 12; depth++) {
    ancestor = (await processRows([ancestor.ppid])).get(ancestor.ppid);
    assert.ok(ancestor, "fixture must descend from the isolated Host");
    productionRunner ||= ancestor.command.includes("--internal-tool-runner");
    if (ancestor.pid === hostPid || (hostPid === undefined && productionRunner && ancestor.command === evidence.binary)) break;
    tree.ancestors.push({ pid: ancestor.pid, command: ancestor.command });
  }
  if (hostPid === undefined) assert.equal(ancestor.command, evidence.binary, "production transport owns this Host");
  else assert.equal(ancestor.pid, hostPid);
  assert.equal(productionRunner, true, "must exercise the real production runner");
  record("owned-process-tree", { processId: tree.id, sessionId: tree.sessionId,
    nodes: tree.nodes, runnerAncestors: tree.ancestors, hostPid: ancestor.pid });
  await until("fixture stdout", async () =>
    (await detail(tree)).stdout.includes(`SERVICE_READY:${tree.token}`));
  return tree;
}
async function gone(tree) {
  await until("owned descendants and runner exit", async () => {
    const nodes = [...tree.nodes, ...tree.ancestors];
    const rows = await processRows(nodes.map(node => node.pid));
    return nodes.every(node => !live(rows.get(node.pid)));
  });
}
async function beating(tree) {
  const file = join(tree.directory, "grandchild.heartbeat");
  const before = await readFile(file, "utf8");
  await until("owned grandchild still running", async () => (await optionalFile(file)) !== before);
  assert.equal((await detail(tree)).process.status, "running");
}
async function detail(tree) {
  return host.call("backgroundProcesses.read", { sessionId: tree.sessionId, id: tree.id }, 5_000);
}
async function terminal(tree, expected, reason) {
  const result = await until(`${tree.id} becomes ${expected}`, async () => {
    const value = await detail(tree);
    if (active.has(value.process.status)) return false;
    assert.equal(value.process.status, expected);
    if (reason) assert.equal(value.process.stopReason, reason);
    assert.ok(Number.isFinite(Date.parse(value.process.endedAt)));
    return value;
  });
  await gone(tree);
  record("terminal", { process: result.process, result: result.result });
  return result;
}
async function budget(expected) {
  return until(`Host owns ${expected} shell permits`, async () => {
    const value = (await host.call("app.health", {}, 5_000)).toolBudget;
    if (value.active !== expected || value.shell !== expected || value.queued !== 0) return false;
    record("host-tool-budget", value);
    return value;
  });
}
async function team(label, count = 1) {
  const workspace = join(temporary, label);
  await mkdir(workspace);
  const { session: lead } = await host.call("session.create", { title: label, mode: "agent",
    executionProfile: "team", projectPath: workspace, providerId: provider.id, modelId: "fixture", permissionMode: "auto" });
  await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto" });
  const { turnId: seedTurnId } = await host.call("session.beginTurn", { sessionId: lead.id });
  const members = Array.from({ length: count }, (_, i) => ({ name: `expert${i}`, contextKind: "fresh" }));
  const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id,
    leadTurnId: seedTurnId, strategy: "delegate", reason: "Run only isolated managed service fixtures.", members });
  await endAndSettle(seedTurnId);
  const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id,
    reviewId: review.reviewId, expectedRevision: review.revision });
  assert.equal(decision.leadTurnId, seedTurnId);
  assert.equal(decision.messageIds.length, 1, "consume the canonical confirmation instead of leaving queued Lead mail");
  const confirmationId = decision.messageIds[0];
  const { turnId } = await host.call("session.beginTurn", { sessionId: lead.id, sessionMessageId: confirmationId });
  record("lead-confirmation-admitted", { sessionId: lead.id, runId: seedTurnId, turnId, confirmationId });
  const owners = [];
  for (const [index, sessionId] of decision.memberSessionIds.entries()) {
    await host.call("session.configure", { id: sessionId, mode: "agent", permissionMode: "auto" });
    const { message } = await host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: lead.id,
      target: `expert${index}`, content: "Start the owned fixture, without retries." });
    const { turnId: ownerTurn } = await host.call("session.beginTurn", { sessionId, sessionMessageId: message.id });
    owners.push({ sessionId, turnId: ownerTurn });
  }
  return { lead, turnId, owners, workspace, runId: decision.leadTurnId };
}
async function execute(owner, command, service, timeoutMs) {
  return host.call("tools.execute", { sessionId: owner.sessionId, turnId: owner.turnId,
    toolCallId: randomUUID(), toolName: "Bash", mode: "agent",
    args: { command, run_in_background: true, ...(service ? { backgroundKind: "service" } : {}) },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect }, 10_000);
}
async function launch(scope, label, behavior = "friendly", service = true, ownerIndex = 0, timeoutMs) {
  const owner = scope.owners[ownerIndex];
  const directory = join(temporary, `${label}-${randomUUID()}`);
  await mkdir(directory);
  const token = randomUUID();
  // exec preserves the signal-ignoring process group until the 5-second grace
  // expires, instead of letting an intermediate shell exit on TERM first.
  const command = `exec ${[process.execPath, fixture, directory, token, behavior].map(quote).join(" ")}`;
  const tree = { directory, token, sessionId: owner.sessionId, nodes: [], ancestors: [], command };
  trees.push(tree);
  const value = await execute(owner, command, service, timeoutMs);
  assert.equal(value.ok, true);
  assert.equal(value.denied, false);
  tree.id = value.content.backgroundProcessId;
  tree.toolCallId = value.toolCallId;
  assert.equal(typeof tree.id, "string");
  await capture(tree);
  const stored = (await detail(tree)).process;
  if (service) {
    assert.equal(stored.backgroundKind, "service");
    assert.equal(stored.teamSessionId, scope.lead.id);
    assert.equal(stored.teamRunId, scope.runId);
    const ttl = Date.parse(stored.deadlineAt) - Date.parse(stored.startedAt);
    assert.ok(Math.abs(ttl - 6 * 60 * 60 * 1000) < 1_000, "unchanged Host-owned 6-hour TTL");
    assert.equal(stored.stopMode, "unix-term-then-kill");
  }
  record("launched", { service, process: stored });
  return tree;
}
async function stop(tree, escalated) {
  const started = Date.now();
  await host.call("backgroundProcesses.stop", { sessionId: tree.sessionId, id: tree.id });
  const result = await terminal(tree, "stopped", "explicit_stop");
  const elapsedMs = Date.now() - started;
  assert.equal(result.process.serviceStopEscalated, escalated);
  if (escalated) assert.ok(elapsedMs >= 4_900 && elapsedMs < 9_000, "bounded 5-second Unix TERM grace");
  else assert.ok(elapsedMs < 4_000, "TERM-friendly service exits before escalation");
  const signals = await readFile(join(tree.directory, "signals"), "utf8");
  for (const role of ["parent", "child", "grandchild"]) assert.ok(signals.includes(`${role}:TERM:`));
  await host.call("backgroundProcesses.stop", { sessionId: tree.sessionId, id: tree.id });
  return elapsedMs;
}
async function endOwner(scope, index = 0) {
  const owner = scope.owners[index];
  await endAndSettle(owner.turnId);
}
async function endAndSettle(turnId, status = "completed") {
  assert.ok(["completed", "error", "aborted"].includes(status), "use the Host's persisted turn status contract");
  const result = await host.call("session.endTurn", { turnId, status, createNotification: false });
  assert.equal(result.ok, true, "settle the actual active turn before settling its mail");
  await host.call("session.collaboration.settle", { turnId });
  record("turn-ended-and-mail-settled", { turnId, status });
}
async function endLead(scope) {
  await endAndSettle(scope.turnId);
}
async function setRunLimits(runLimits) {
  const settings = await host.call("settings.get");
  const previous = settings.expertTeam ?? null;
  const expertTeam = { ...(previous ?? { schemaVersion: 1, userDefaults: {}, projectOverrides: {} }), runLimits };
  await host.call("settings.set", { expertTeam, expertTeamExpected: previous });
  const stored = (await host.call("settings.get")).expertTeam;
  assert.deepEqual(stored, expertTeam, "public settings CAS preserves role and project configuration");
  record("public-run-limits-configured", { runLimits });
}
async function fingerprint(binary) {
  const { stdout: revision } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  const { stdout: paths } = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "crates/host-core"], { cwd: root });
  const hash = createHash("sha256");
  for (const path of [...new Set(paths.trim().split("\n"))].sort()) {
    hash.update(path).update("\0").update(await readFile(join(root, path))).update("\0");
  }
  return { baseRevision: revision.trim(), hostSourceSha256: hash.digest("hex"),
    hostBinarySha256: createHash("sha256").update(await readFile(binary)).digest("hex") };
}

async function main() {
  assert.notEqual(process.platform, "win32", "POSIX harness cannot claim Windows JobObject acceptance");
  const binary = resolveHostBinary();
  Object.assign(evidence, await fingerprint(binary), { binary, platform: process.platform, quick });
  temporary = await realpath(await mkdtemp(join(tmpdir(), "pi-managed-service-")));
  stdioHost = new Host(binary, join(temporary, "profile"));
  host = stdioHost;
  await host.start();
  shell = (await host.call("commandShells.list")).effective;
  assert.ok(shell?.available);
  assert.equal(shell.dialect, "posix");
  ({ provider } = await host.call("providers.create", { name: "Unreachable service fixture", vendorKey: "custom",
    authKind: "none", apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture",
    models: [{ id: "fixture", thinkingLevels: ["off"] }] }));
  const a = await team("soak-and-pause", 2), b = await team("second-host-service"), c = await team("third-host-service");
  const service = await launch(a, "soak-service");
  const ordinary = await launch(a, "ordinary-default", "friendly", false);
  await budget(2);
  // Test Team/session limits before filling the Host cap, so a missing Team
  // restriction cannot be hidden by the independent Host-wide limit.
  for (const owner of a.owners) {
    await assert.rejects(execute(owner, "exit 0", true), error => error.errorCode === "TEAM_SERVICE_LIMIT_REACHED");
    await budget(2);
  }
  const second = await launch(b, "second-service");
  await budget(3);
  await assert.rejects(execute(c.owners[0], "exit 0", true), error => error.errorCode === "TEAM_SERVICE_LIMIT_REACHED");
  await budget(3);
  for (const scope of [a, b]) {
    const listed = (await host.call("backgroundProcesses.list", { sessionId: scope.owners[0].sessionId })).processes;
    assert.equal(listed.filter(row => row.backgroundKind === "service" && active.has(row.status)).length, 1);
  }
  pass("E2E-TEAM-service-caps-and-permits", { hostServices: 2, perTeam: 1, perSession: 1, activeShellPermits: 3 });
  if (quick) {
    evidence.limitations.push("--quick skips the real >60-second service/default-command comparison");
    await host.call("backgroundProcesses.stop", { sessionId: ordinary.sessionId, id: ordinary.id });
    await terminal(ordinary, "stopped");
  } else {
    const timedOut = await until("ordinary background default expires while service keeps running", async () => {
      const value = await detail(ordinary);
      if (active.has(value.process.status)) {
        assert.equal((await detail(service)).process.status, "running");
        return false;
      }
      assert.equal(value.process.status, "timed_out");
      return value;
    }, 70_000);
    await gone(ordinary);
    await until("service lifetime exceeds 60 seconds", async () =>
      Date.now() - Date.parse((await detail(service)).process.startedAt) > 60_100, 5_000);
    await beating(service);
    assert.ok(Date.parse(timedOut.process.endedAt) - Date.parse(timedOut.process.startedAt) >= 59_500);
    await budget(2);
    pass("E2E-TEAM-service-survives-default-timeout", { ordinary: timedOut.process, service: (await detail(service)).process });
  }
  const friendlyMs = await stop(second, false);
  const preserved = await launch(a, "ordinary-pause", "friendly", false, 0, 120_000);
  await host.call("team.pause", { teamSessionId: a.lead.id, callerSessionId: a.lead.id });
  await terminal(service, "stopped", "team_paused");
  await beating(preserved);
  await host.call("backgroundProcesses.stop", { sessionId: preserved.sessionId, id: preserved.id });
  await terminal(preserved, "stopped");
  pass("E2E-TEAM-service-manual-pause", { ordinaryPreserved: true });
  const ignoring = await launch(b, "ignore-term", "ignore");
  const ignoringMs = await stop(ignoring, true);
  await budget(0);
  pass("E2E-TEAM-service-unix-stop", { friendlyMs, ignoringMs, allDescendantsStopped: true });

  const finished = await team("team-finish");
  const finishService = await launch(finished, "team-finish-service");
  await endOwner(finished);
  await beating(finishService); // Member completion alone is not Team completion.
  await endLead(finished);
  await terminal(finishService, "stopped", "team_ended");
  pass("E2E-TEAM-service-team-end", { memberCompletionPreservesService: true });

  const replaced = await team("new-user-run");
  const replacedService = await launch(replaced, "old-run-service");
  await endLead(replaced);
  await host.call("session.beginTurn", { sessionId: replaced.lead.id });
  await terminal(replacedService, "stopped", "run_replaced");
  pass("E2E-TEAM-service-run-replacement", { oldServiceStopped: true });

  const cancelled = await team("owner-tool-cancel");
  const cancelledService = await launch(cancelled, "cancelled-service");
  const abort = await host.call("tools.abort", { sessionId: cancelledService.sessionId,
    toolCallId: cancelledService.toolCallId });
  assert.equal(abort.found, true);
  await terminal(cancelledService, "stopped", "owner_cancelled");
  pass("E2E-TEAM-service-owner-cancel", { exactOwnedToolStopped: true });

  const interrupted = await team("owner-turn-interrupted");
  const interruptedService = await launch(interrupted, "interrupted-service");
  await endAndSettle(interrupted.owners[0].turnId, "aborted");
  await terminal(interruptedService, "stopped", "owner_cancelled");
  pass("E2E-TEAM-service-owner-turn-cancel", { abortedLaunchTurnStopsService: true });

  const moved = await team("owner-workspace-move");
  const movedService = await launch(moved, "workspace-service");
  await endOwner(moved);
  await beating(movedService);
  const destination = join(temporary, "new-owner-project");
  await mkdir(destination);
  const sentinel = join(moved.workspace, "preserved-project.txt");
  await writeFile(sentinel, "Existing project data must survive moving its conversation.\n");
  const move = await host.call("session.moveProject", { sessionId: movedService.sessionId, projectPath: destination });
  assert.equal(move.session.projectPath, destination);
  await terminal(movedService, "stopped", "owner_workspace_changed");
  assert.equal(await readFile(sentinel, "utf8"), "Existing project data must survive moving its conversation.\n");
  pass("E2E-TEAM-service-owner-workspace", { newWorkspace: destination, oldProjectPreserved: true });

  const deleted = await team("delete-team-owner");
  const deletedService = await launch(deleted, "delete-team-service");
  // An open task keeps the Team alive after its turns settle, making deletion
  // itself (rather than prior Team completion) the service stop trigger.
  await host.call("team.createTask", { teamSessionId: deleted.lead.id, callerSessionId: deleted.lead.id,
    subject: "Hold the owned Team until explicit deletion", ownerMemberName: "expert0" });
  await endOwner(deleted);
  await endLead(deleted);
  await beating(deletedService);
  const removal = await host.call("session.delete", { id: deleted.lead.id });
  assert.equal(removal.ok, true);
  await terminal(deletedService, "stopped", "session_deleted");
  assert.equal((await host.call("session.get", { id: deleted.lead.id })).session, null);
  assert.equal((await host.call("session.get", { id: deletedService.sessionId })).session.executionProfile, "standard");
  pass("E2E-TEAM-service-team-owner-delete", { serviceStoppedBeforeDetach: true, memberHistoryPreserved: true });

  const hard = await team("automatic-hard-pause");
  const hardService = await launch(hard, "hard-pause-service");
  const hardOrdinary = await launch(hard, "hard-pause-ordinary", "friendly", false, 0, 120_000);
  await setRunLimits({ enabled: true, softMs: 500, hardMs: 1_500 });
  await until("Host scheduler persists hard pause", async () => {
    const value = await host.call("team.getRoster", { teamSessionId: hard.lead.id, callerSessionId: hard.lead.id });
    return value.paused && value.runLimits.hardReachedAt;
  });
  await terminal(hardService, "stopped", "team_paused");
  await beating(hardOrdinary);
  await host.call("backgroundProcesses.stop", { sessionId: hardOrdinary.sessionId, id: hardOrdinary.id });
  await terminal(hardOrdinary, "stopped");
  await setRunLimits({ enabled: false, softMs: 21_600_000, hardMs: 36_000_000 });
  pass("E2E-TEAM-service-hard-pause", { publicConfiguredLimitMs: 1500, ordinaryPreserved: true });

  await stdioHost.stop();
  // This is the transport used by Electron Main, including its real dispose
  // deadline. A shorter transport deadline would kill Host before it could
  // persist the service's five-second TERM escalation and terminal output.
  const { HostProcess } = await import("../packages/host-runtime/dist/host-process.js");
  evidence.hostTransportSha256 = createHash("sha256")
    .update(await readFile(join(root, "packages/host-runtime/dist/host-process.js"))).digest("hex");
  appHost = new HostProcess({ binaryPath: binary, dataDir: stdioHost.dataDir, onStderr: () => {} });
  const appExit = new Promise(resolveExit => appHost.onExit(resolveExit));
  await appHost.handshake();
  host = appHost;
  const shutdown = await team("host-shutdown");
  const shutdownService = await launch(shutdown, "shutdown-service", "ignore");
  const starts = await readFile(join(shutdownService.directory, "starts"), "utf8");
  const output = (await detail(shutdownService)).stdout;
  const disposeStarted = Date.now();
  await bounded(appHost.dispose(), "production Host transport dispose", 10_000);
  const disposeMs = Date.now() - disposeStarted;
  const exit = await bounded(appExit, "disposed Host exits", 2_000);
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
  assert.equal(exit.intentional, true);
  assert.ok(disposeMs >= 4_900 && disposeMs < 9_000, "production dispose allows five-second service escalation");
  await gone(shutdownService);
  appHost = null;
  host = stdioHost;
  await stdioHost.start();
  const recovered = await detail(shutdownService);
  assert.equal(recovered.process.status, "interrupted");
  assert.equal(recovered.process.stopReason, "host_shutdown");
  assert.equal(recovered.process.serviceStopEscalated, true);
  assert.ok(Number.isFinite(Date.parse(recovered.process.endedAt)));
  assert.equal(recovered.stdout, output, "production dispose persists service output before Host exits");
  const termSignals = await readFile(join(shutdownService.directory, "signals"), "utf8");
  for (const role of ["parent", "child", "grandchild"]) assert.ok(termSignals.includes(`${role}:TERM:`));
  assert.equal(await readFile(join(shutdownService.directory, "starts"), "utf8"), starts, "restart never replays service");
  await budget(0);
  pass("E2E-TEAM-service-shutdown-no-restart", { process: recovered.process, startsUnchanged: true,
    productionTransport: "HostProcess.dispose", disposeMs, terminalOutputPreserved: true });

  const crashed = await team("host-crash");
  const crashedService = await launch(crashed, "crash-service");
  const crashStarts = await readFile(join(crashedService.directory, "starts"), "utf8");
  assert.equal(host.child.kill("SIGKILL"), true, "only kill the exact harness-owned Host");
  assert.equal((await bounded(host.exitPromise, "forced Host crash")).signal, "SIGKILL");
  await gone(crashedService);
  await host.stop();
  await host.start();
  const crashRecovery = await detail(crashedService);
  assert.equal(crashRecovery.process.status, "interrupted");
  assert.equal(crashRecovery.process.stopReason, "host_restart");
  assert.equal(await readFile(join(crashedService.directory, "starts"), "utf8"), crashStarts);
  await budget(0);
  pass("E2E-TEAM-service-crash-no-restart", { process: crashRecovery.process, startsUnchanged: true });
  evidence.limitations.push("Default TTL expiry uses Host controlled-clock domain tests; this harness checks unchanged six-hour metadata, not a six-hour soak.");
  evidence.limitations.push("Windows JobObject force-stop requires Windows acceptance; this POSIX harness does not cover it.");
  assert.equal((await fingerprint(binary)).hostBinarySha256, evidence.hostBinarySha256, "binary stays frozen during run");
  evidence.ok = true;
}

try {
  await bounded(main(), "complete managed-service acceptance", 240_000);
} catch (error) {
  evidence.ok = false;
  evidence.error = { message: error.message, stack: error.stack };
  throw error;
} finally {
  try {
    await appHost?.dispose();
    if (stdioHost?.child && !stdioHost.exited) {
      stdioHost.child.stdin.end();
      await bounded(stdioHost.exitPromise, "cleanup Host EOF", 10_000).catch(() => stdioHost.stop());
    }
    await stdioHost?.stop();
    for (const tree of trees) {
      const rows = await processRows(tree.nodes.map(node => node.pid));
      for (const node of tree.nodes) {
        const row = rows.get(node.pid);
        if (live(row) && row.command.includes(fixture) && row.command.includes(tree.token)) {
          try { process.kill(node.pid, "SIGKILL"); }
          catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      }
      await gone(tree);
    }
    record("cleanup-complete", { fixtureTrees: trees.length, isolatedHostExited: true });
  } catch (error) {
    evidence.ok = false;
    evidence.cleanupError = error.message;
    throw error;
  } finally {
    if (process.env.PI_SERVICE_EVIDENCE_DIR) {
      const directory = resolve(process.env.PI_SERVICE_EVIDENCE_DIR);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "managed-service-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    }
    if (temporary) await rm(temporary, { recursive: true, force: true });
    console.log(`Summary: ${evidence.passed.length} scenarios passed; ok=${evidence.ok === true}; quick=${quick}`);
  }
}
