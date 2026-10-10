#!/usr/bin/env node
/** Real production Host and runner; isolated profiles, no providers or user data. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as pollInterval } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Host } from "./e2e/host.mjs";
import { configureSession, createSession } from "./e2e/session.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "scripts/e2e/session-activity/process-tree.mjs");
const execFileAsync = promisify(execFile);
const active = new Set(["starting", "running", "stopping"]);
const ownedTrees = [];
const hosts = [];
const results = [];
let appHost;
let temp;

function record(id, detail) {
  results.push(id);
  console.log(`PASS ${id} - ${detail}`);
}
async function deadline(promise, label, timeout = 15_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
// Poll only explicit RPC/file/process conditions, with bounded deadlines.
async function until(label, condition, timeout = 15_000) {
  const expires = Date.now() + timeout;
  do {
    const value = await condition();
    if (value) return value;
    await pollInterval(25);
  } while (Date.now() < expires);
  throw new Error(`${label} did not become true within ${timeout} ms`);
}
async function optionalFile(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function quote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function command(...arguments_) { return arguments_.map(quote).join(" "); }
async function rpcError(host, method, params, expected) {
  await assert.rejects(host.call(method, params), (error) => {
    assert.equal(error.errorCode, expected, `${method} error contract`);
    return true;
  });
}
async function table(pids) {
  if (pids.length === 0) return new Map();
  let stdout;
  try {
    ({ stdout } = await execFileAsync("ps", ["-p", pids.join(","), "-o", "pid=,ppid=,stat=,command="], {
      maxBuffer: 256 * 1024,
      timeout: 5_000,
    }));
  } catch (error) {
    // ps exits 1 when all requested, harness-owned PIDs have already exited.
    if (error.code === 1 && !error.stdout?.trim()) return new Map();
    throw error;
  }
  const rows = new Map();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (match) rows.set(Number(match[1]), {
      pid: Number(match[1]), parent: Number(match[2]), status: match[3], command: match[4],
    });
  }
  return rows;
}
function alive(row) { return row && !row.status.startsWith("Z"); }
async function captureTree(directory, token, hostPid, binary) {
  const tree = { directory, token, nodes: [], ancestors: [] };
  ownedTrees.push(tree);
  await until("fixture PID markers", async () => {
    tree.nodes = [];
    for (const role of ["parent", "child", "grandchild"]) {
      const raw = await optionalFile(join(directory, `${role}.json`));
      if (raw === null) return false;
      const node = JSON.parse(raw);
      assert.equal(node.token, token);
      assert.equal(node.role, role);
      assert.ok(Number.isSafeInteger(node.pid) && node.pid > 0);
      tree.nodes.push(node);
    }
    return true;
  });
  const rows = await table(tree.nodes.map(({ pid }) => pid));
  for (const node of tree.nodes) {
    const row = rows.get(node.pid);
    assert.ok(alive(row), `${node.role} must be live before testing termination`);
    assert.ok(row.command.includes(fixture) && row.command.includes(token), "owned fixture PID identity");
  }
  assert.equal(rows.get(tree.nodes[1].pid).parent, tree.nodes[0].pid);
  assert.equal(rows.get(tree.nodes[2].pid).parent, tree.nodes[1].pid);
  let ancestor = rows.get(tree.nodes[0].pid);
  let runner;
  for (let depth = 0; depth < 12; depth++) {
    const parentPid = ancestor.parent;
    ancestor = (await table([parentPid])).get(parentPid);
    assert.ok(ancestor, "fixture ancestry must reach its Host");
    if (ancestor.command.includes("--internal-tool-runner")) runner = ancestor;
    if (ancestor.pid === hostPid || (hostPid === undefined && runner && ancestor.command === binary)) break;
    tree.ancestors.push({ pid: ancestor.pid, command: ancestor.command });
  }
  assert.ok(runner, "must exercise the production --internal-tool-runner, not the cfg(test) direct shell");
  if (hostPid !== undefined) assert.equal(ancestor.pid, hostPid, "runner belongs to this isolated Host");
  else assert.equal(ancestor.command, binary, "app transport owns the fixture Host");
  // A changing heartbeat proves the descendants are running, not stale PID files.
  const initial = await readFile(join(directory, "grandchild.heartbeat"), "utf8");
  await until("grandchild heartbeat advances", async () =>
    (await optionalFile(join(directory, "grandchild.heartbeat"))) !== initial);
  return tree;
}
async function treeGone(tree) {
  await until("complete owned process tree stops", async () => {
    const rows = await table([...tree.nodes, ...tree.ancestors].map(({ pid }) => pid));
    return [...tree.nodes, ...tree.ancestors].every(({ pid }) => !alive(rows.get(pid)));
  });
}
async function terminal(host, sessionId, id, status) {
  return until(`process ${status}`, async () => {
    const detail = await host.call("backgroundProcesses.read", { sessionId, id });
    if (active.has(detail.process.status)) return false;
    assert.equal(detail.process.status, status);
    assert.ok(Number.isFinite(Date.parse(detail.process.endedAt)));
    return detail;
  });
}
async function launch(host, session, shell, command_, callId = randomUUID()) {
  const result = await host.call("tools.execute", {
    sessionId: session.id, toolCallId: callId, toolName: "Bash", mode: "agent",
    args: { command: command_, run_in_background: true }, timeoutMs: 60_000,
    expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect,
  });
  assert.equal(result.ok, true, "fixture Bash must be admitted normally");
  assert.equal(result.denied, false);
  assert.equal(result.content.status, "starting");
  assert.equal(typeof result.content.backgroundProcessId, "string");
  return result.content.backgroundProcessId;
}
async function launchTree(host, session, shell, label, binary, hostPid) {
  const directory = join(temp, label);
  await mkdir(directory);
  const token = randomUUID();
  const id = await launch(host, session, shell, command(process.execPath, fixture, directory, token));
  const tree = await captureTree(directory, token, hostPid, binary);
  await until("live stdout/stderr markers", async () => {
    const detail = await host.call("backgroundProcesses.read", { sessionId: session.id, id });
    if (!detail.stdout.includes(`TREE_READY:${token}`) || !detail.stderr.includes(`TREE_STDERR:${token}`)) return false;
    assert.equal(detail.process.status, "running");
    assert.equal(detail.stdout, `TREE_READY:${token}\n中🙂\u2028\u2029\n`);
    assert.equal(detail.stderr, `TREE_STDERR:${token}\n错误🙂\n`);
    assert.equal(detail.stdoutTruncated, false);
    assert.equal(detail.stderrTruncated, false);
    return true;
  });
  return { id, tree };
}
async function reopen(host) {
  await host.stop();
  await host.start();
}
async function unchanged(host, session, transcript, note, sentinel) {
  const stored = await host.call("session.get", { id: session.id });
  assert.deepEqual(stored.session.messages, transcript);
  assert.deepEqual((await host.call("sessionNotes.get", { sessionId: session.id })).note, note);
  assert.equal(await readFile(sentinel, "utf8"), "Owned project data must remain untouched.\n");
}

try {
  const { stdout: commonDirectory } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], { cwd: root });
  const primaryRoot = dirname(resolve(root, commonDirectory.trim()));
  const binary = resolve(process.env.PI_DESKTOP_HOST_BIN ||
    join(primaryRoot, "target/debug", `pi-desktop-host-core${process.platform === "win32" ? ".exe" : ""}`));
  assert.ok(existsSync(binary), "build the candidate Host first or set PI_DESKTOP_HOST_BIN");
  const binaryHash = createHash("sha256").update(await readFile(binary)).digest("hex");
  temp = await mkdtemp(join(tmpdir(), "pi-session-activity-"));
  const workspace = join(temp, "project");
  await mkdir(workspace);
  const sentinel = join(workspace, "existing.txt");
  await writeFile(sentinel, "Owned project data must remain untouched.\n");
  const host = new Host(binary, join(temp, "data"));
  hosts.push(host);
  await host.start();
  const session = await createSession(host, workspace, "Session activity E2E");
  await configureSession(host, session, "agent", "auto");
  await host.call("session.appendMessage", {
    sessionId: session.id,
    message: { id: "unchanged-history", role: "user", content: "Existing transcript 中🙂", createdAt: "2026-10-09T00:00:00.000Z", status: "complete" },
  });
  const transcript = (await host.call("session.get", { id: session.id })).session.messages;
  const params = { sessionId: session.id };
  assert.deepEqual((await host.call("sessionNotes.get", params)).note, {
    sessionId: session.id, content: "", revision: 0,
  });
  const content = "  # Local note\r\n\n中文 🙂 **markdown**\u2028\u2029\n trailing  \n";
  const { note } = await host.call("sessionNotes.set", { ...params, content, expectedRevision: 0 });
  assert.equal(note.content, content);
  assert.equal(note.revision, 1);
  assert.deepEqual((await host.call("sessionNotes.get", params)).note, note);
  await assert.rejects(host.call("sessionNotes.set", { ...params, content: "stale", expectedRevision: 0 }), (error) => {
    assert.equal(error.errorCode, "NOTE_CONFLICT");
    assert.deepEqual(error.rpc.data.note, note);
    return true;
  });
  for (const id of ["native-pi:fixture", "remote:fixture"]) {
    await rpcError(host, "sessionNotes.get", { sessionId: id }, "SESSION_NOTES_UNSUPPORTED");
  }
  await reopen(host);
  await unchanged(host, session, transcript, note, sentinel);
  record("E2E-ACTIVITY-NOTES", "exact UTF-8/whitespace, CAS conflict, restart, unchanged transcript/project");

  if (process.platform === "win32") {
    console.log("LIMITATION Windows production runner/process-tree lifecycle is not covered by this POSIX ps harness.");
  } else {
    const shell = (await host.call("commandShells.list")).effective;
    assert.ok(shell?.available);
    assert.equal(shell.dialect, "posix");
    const other = await createSession(host, workspace, "Other session");
    assert.deepEqual((await host.call("backgroundProcesses.list", params)).processes, []);
    const text = "stdout 中🙂\u2028\u2029\n";
    const errorText = "stderr 错误🙂\n";
    const code = `process.stdout.write(${JSON.stringify(text)});process.stderr.write(${JSON.stringify(errorText)});`;
    const completedId = await launch(host, session, shell, command(process.execPath, "-e", code));
    const completed = await terminal(host, session.id, completedId, "completed");
    assert.equal(completed.process.exitCode, 0);
    assert.equal(completed.stdout, text);
    assert.equal(completed.stderr, errorText);
    const failedId = await launch(host, session, shell, command(process.execPath, "-e", "process.stderr.write('fixture failure\\n');process.exitCode=7;"));
    const failed = await terminal(host, session.id, failedId, "failed");
    assert.equal(failed.process.exitCode, 7);
    assert.equal(failed.stderr, "fixture failure\n");
    const stopped = await launchTree(host, session, shell, "stop-tree", binary, host.child.pid);
    const listed = (await host.call("backgroundProcesses.list", params)).processes;
    assert.ok(listed.some((row) => row.id === stopped.id && row.status === "running"));
    for (const method of ["backgroundProcesses.read", "backgroundProcesses.stop"]) {
      await rpcError(host, method, { sessionId: other.id, id: stopped.id }, "BACKGROUND_PROCESS_NOT_FOUND");
      await rpcError(host, method, { sessionId: "missing-session", id: stopped.id }, "SESSION_NOT_FOUND");
    }
    const stopReply = await host.call("backgroundProcesses.stop", { ...params, id: stopped.id });
    assert.ok(["stopping", "stopped"].includes(stopReply.process.status));
    await terminal(host, session.id, stopped.id, "stopped");
    await treeGone(stopped.tree);
    await host.call("backgroundProcesses.stop", { ...params, id: stopped.id });
    record("E2E-ACTIVITY-PROCESSES", "list/live output, completion, nonzero exit, session isolation, idempotent stop kills descendants");

    const eof = await launchTree(host, session, shell, "eof-tree", binary, host.child.pid);
    host.child.stdin.end();
    const exit = await deadline(host.exitPromise, "Host EOF shutdown");
    assert.equal(exit.code, 0);
    await treeGone(eof.tree);
    await reopen(host);
    await terminal(host, session.id, eof.id, "interrupted");
    assert.equal((await host.call("backgroundProcesses.read", { ...params, id: completedId })).process.status, "completed");
    await unchanged(host, session, transcript, note, sentinel);
    record("E2E-ACTIVITY-EOF", "Host EOF drains owned runner tree and persists interrupted/terminal states");

    // Exercise the same shared transport dispose() Electron Main uses on app exit.
    const { HostProcess } = await import("../packages/host-runtime/dist/host-process.js");
    await host.stop();
    appHost = new HostProcess({ binaryPath: binary, dataDir: join(temp, "data"), onStderr: () => {} });
    const appExit = new Promise((resolveExit) => appHost.onExit(resolveExit));
    await appHost.handshake();
    const app = await launchTree(appHost, session, shell, "app-dispose-tree", binary);
    await deadline(appHost.dispose(), "app Host transport dispose");
    const disposedExit = await deadline(appExit, "disposed Host exits");
    assert.equal(disposedExit.code, 0, "app shutdown must complete the graceful EOF drain");
    assert.equal(disposedExit.intentional, true);
    appHost = null;
    await treeGone(app.tree);
    await host.start();
    await terminal(host, session.id, app.id, "interrupted");
    record("E2E-ACTIVITY-APP-EXIT", "production app transport dispose terminates full tree and preserves interrupted state");

    const crash = await launchTree(host, session, shell, "crash-tree", binary, host.child.pid);
    const starts = await readFile(join(crash.tree.directory, "starts"), "utf8");
    assert.equal(host.child.kill("SIGKILL"), true, "only the Host child owned by this harness is killed");
    const crashExit = await deadline(host.exitPromise, "forced Host crash");
    assert.equal(crashExit.signal, "SIGKILL");
    await treeGone(crash.tree);
    await reopen(host);
    await terminal(host, session.id, crash.id, "interrupted");
    assert.equal(await readFile(join(crash.tree.directory, "starts"), "utf8"), starts);
    const recovered = (await host.call("backgroundProcesses.list", params)).processes;
    assert.ok(recovered.length >= 6);
    assert.ok(recovered.every((row) => !active.has(row.status)), "restart never auto-resumes any background command");
    await unchanged(host, session, transcript, note, sentinel);
    record("E2E-ACTIVITY-CRASH", "production runner control-pipe EOF cleans descendants; restart marks interrupted without auto-resume");
  }
  assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"), binaryHash,
    "candidate Host binary must remain unchanged throughout E2E");
  console.log(`Summary: ${results.length}/${results.length} passed; binary SHA256=${binaryHash} (isolated Host, no provider calls)`);
} finally {
  await appHost?.dispose();
  for (const host of hosts) await host.stop();
  // On failed assertions, only verified fixture PID identities may be cleaned.
  for (const tree of ownedTrees) {
    const rows = await table(tree.nodes.map(({ pid }) => pid));
    for (const node of tree.nodes) {
      const row = rows.get(node.pid);
      if (alive(row) && row.command.includes(fixture) && row.command.includes(tree.token)) {
        try { process.kill(node.pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
  }
  if (temp) await rm(temp, { recursive: true, force: true });
}
