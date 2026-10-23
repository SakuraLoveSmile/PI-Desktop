/** Real Git worktrees, Host, launch resolver and Sidecar; only the provider is a local fixture. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Host, resolveHostBinary } from "./host.mjs";
import { AgentSidecar } from "../../packages/host-runtime/dist/agent-sidecar.js";

const execute = promisify(execFile);
const markers = {
  legacy: "OWNER_PATH_SOURCE_PRESERVED",
  memory: "OWNER_GROUP_MEMORY_V1",
  branch: "BRANCH_CONFLICT_MEMORY_V1",
  slot: "SLOT_LEGACY_MEMORY_V1",
  remembered: "VERIFIED_PROJECT_DECISION_V2",
  updated: "SHARED_PROJECT_MEMORY_V3",
  instructions: "OWNER_GROUP_INSTRUCTIONS_V1",
  instructionsUpdated: "OWNER_GROUP_INSTRUCTIONS_V2",
  fileInstructions: "TRACKED_CHECKOUT_INSTRUCTION_CHAIN",
  ownerFile: "UNTRACKED_OWNER_AGENTS_MUST_NOT_LEAK",
  additionalFile: "ADDITIONAL_ROOT_FILE_MUST_NOT_LEAK",
  history: "WORKTREE_HISTORY_DECISION_MARKER",
  foreign: "UNRELATED_MUSIC_PROJECT_PRIVATE_MEMORY",
};

export async function runWorktreeMemoryContext(root) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "pi-worktree-memory-")));
  const home = join(scratch, "home");
  const dataDir = join(scratch, "data");
  const repository = join(scratch, "repository", "Music");
  const foreignRepository = join(scratch, "unrelated", "Music");
  const additional = join(scratch, "additional-root");
  const branch = join(scratch, "worktrees", "release-verify");
  const repositoryKey = createHash("sha256").update(join(repository, ".git")).digest("hex").slice(0, 16);
  const slots = [1, 2].map(number => join(scratch, "worktrees", "pool", repositoryKey, `slot-${number}`));
  const originalHome = process.env.HOME;
  const captures = [];
  const identities = new Map();
  const launches = new Map();
  const checks = [];
  const turns = [];
  const diagnostics = [];
  const events = [];
  let expectedRequests = 0;
  let host;
  let sidecar;
  let server;
  let serverError;
  let expectation;
  let rejectTurn;
  const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const gitAt = async (cwd, ...args) => (await execute("git", ["-c", "commit.gpgsign=false", "-c",
    "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
  { cwd, env: gitEnv, timeout: 10000 })).stdout.trim();
  const git = (...args) => gitAt(repository, ...args);
  const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
  const sqlite = async (sql, readonly = true) => (await execute("sqlite3",
    [...(readonly ? ["-readonly"] : []), join(dataDir, "pi.sqlite"), sql],
    { timeout: 10000, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const kv = () => sqlite("SELECT hex(CAST(ns AS BLOB)),hex(CAST(key AS BLOB)),hex(CAST(value_json AS BLOB)),updated_at FROM kv ORDER BY ns,key;");
  const sources = () => sqlite("SELECT hex(CAST(ns AS BLOB)),hex(CAST(key AS BLOB)),hex(CAST(value_json AS BLOB)),updated_at FROM kv WHERE ns IN ('projectMemory','projectGroupMemory','projectAutoMemory') ORDER BY ns,key;");
  const unchanged = async (label, action) => {
    const before = await kv();
    await action();
    assert.equal(await kv(), before, `${label}: a steady-state read or rejected write rewrote kv`);
    checks.push(label);
  };
  try {
    await Promise.all([home, repository, foreignRepository, additional].map(path => mkdir(path, { recursive: true })));
    process.env.HOME = home;
    // Import after HOME is isolated: instruction modules capture the global path.
    const { createHeadlessLaunchResolver } = await import("../../packages/host-runtime/dist/launch-resolver.js");
    const { loadInstructionChain } = await import("../../packages/agent-runtime/dist/project-instructions.js");
    for (const path of [repository, foreignRepository]) {
      await gitAt(path, "init", "-q", "-b", "main");
      await writeFile(join(path, "AGENTS.md"), markers.fileInstructions + "\n");
      await gitAt(path, "add", "AGENTS.md");
      await gitAt(path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
    }
    await git("worktree", "add", "-q", "-b", "release-verify", branch);
    for (const slot of slots) await git("worktree", "add", "--detach", "-q", slot);
    const projectionDirectory = join(home, "Library", "Application Support", "KaneoPilot");
    await mkdir(projectionDirectory, { recursive: true });
    await writeFile(join(projectionDirectory, "worktree-slots.json"), JSON.stringify({
      schema_version: 1, updated_at: "2026-10-23T00:00:00Z", worktrees_root: join(scratch, "worktrees"),
      slots: [{ slot_id: "memory-slot-1", path: slots[0], repository,
        git_common_dir: join(repository, ".git"), repo_key: repositoryKey, state: "idle" }],
    }));
    await writeFile(join(repository, "AGENTS.override.md"), markers.ownerFile + "\n");
    await writeFile(join(repository, "owner-only.txt"), markers.ownerFile + "\n");
    await writeFile(join(additional, "additional-only.txt"), markers.additionalFile + "\n");

    server = createServer(async (request, response) => {
      try {
        let body = "";
        for await (const part of request) body += part;
        const payload = JSON.parse(body);
        assert(expectation, "unexpected background model request");
        const system = JSON.stringify(payload.messages.filter(message => message.role === "system"));
        const tools = (payload.tools ?? []).map(tool => tool.function?.name ?? tool.name);
        for (const text of expectation.present) assert(system.includes(text), `${expectation.label}: missing ${text}`);
        for (const text of expectation.absent) assert(!system.includes(text), `${expectation.label}: leaked ${text}`);
        for (const text of [markers.ownerFile, markers.additionalFile, repository, additional, "Primary root:", "Additional root:"]) {
          assert(!system.includes(text), `${expectation.label}: owner workspace guide or untracked content leaked: ${text}`);
        }
        assert.equal(tools.includes("ProjectMemory"), expectation.memoryTool, `${expectation.label}: incorrect memory write availability`);
        const lastUser = payload.messages.findLastIndex(message => message.role === "user");
        const outputs = payload.messages.slice(lastUser + 1).filter(message => message.role === "tool");
        const steps = expectation.steps ?? [];
        captures.push({ label: expectation.label, continuation: outputs.length,
          systemSha256: createHash("sha256").update(system).digest("hex"), tools, system, messages: payload.messages });
        assert(++expectation.requests <= steps.length + 1, `${expectation.label}: repeated or unexpected provider request`);
        for (let index = 0; index < outputs.length; index++) steps[index]?.check?.(outputs[index].content);
        const step = steps[outputs.length];
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const base = { id: randomUUID(), object: "chat.completion.chunk", created: 1, model: payload.model };
        const emit = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ ...base,
          choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        if (step) {
          assert(tools.includes(step.name), `${expectation.label}: missing tool ${step.name}`);
          emit({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
            function: { name: step.name, arguments: JSON.stringify(step.args) } }] });
          emit({}, "tool_calls");
        } else { emit({ role: "assistant", content: "Fixture verified." }); emit({}, "stop"); }
        response.end("data: [DONE]\n\n");
      } catch (error) {
        serverError = error;
        rejectTurn?.(error);
        if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    host = new Host(resolveHostBinary(), dataDir);
    await host.start();
    await host.call("workspace.set", { path: branch });
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const { provider } = await host.call("providers.create", { name: "Local worktree memory fixture", vendorKey: "custom",
      type: "openai_compatible", protocol: "openai_compatible", baseUrl, authKind: "none", apiStyle: "chat_completions",
      defaultModelId: "context-fixture", models: [{ id: "context-fixture" }] });
    const create = async (path, mode = "agent") => (await host.call("session.create", { projectPath: path,
      title: "Worktree context fixture", mode, providerId: provider.id, modelId: "context-fixture",
      thinkingLevel: "off", permissionMode: "auto" })).session;
    const { group } = await host.call("project.group.create", { name: "Music", folders: [repository, additional] });
    // Fixture-only upgrade setup. Legacy rows are seeded in this temporary DB
    // before session creation performs its first ownership association.
    const seed = (namespace, key, value) => sqlite(`INSERT OR REPLACE INTO kv(ns,key,value_json,updated_at) VALUES(${sqlText(namespace)},${sqlText(key)},${sqlText(JSON.stringify(value))},1);`, false);
    await seed("projectMemory", repository, { content: markers.legacy, updatedAt: 1 });
    await seed("projectGroupMemory", group.id, { content: markers.memory, entries: [{ id: "package-manager", title: "Package manager", content: markers.memory }], updatedAt: 1 });
    await seed("projectMemory", branch, { content: markers.branch, entries: [{ id: "package-manager", title: "Package manager", content: markers.branch }], updatedAt: 1 });
    await seed("projectMemory", slots[0], { content: markers.slot, updatedAt: 1 });
    await host.call("project.group.instructions.set", { groupId: group.id, content: markers.instructions });
    const sourceBytes = await sources();
    const sourceSession = await create(repository);
    const agent = await create(branch);
    const plan = await create(slots[0], "plan");
    const goal = await create(slots[1], "goal");
    const foreign = await create(foreignRepository);
    const append = (session, id, content) => host.call("session.appendMessage", { sessionId: session.id,
      message: { id, role: "user", content, createdAt: "2026-10-23T00:00:00Z" } });
    await append(sourceSession, "main-history", `${markers.history}: package manager decision from the main checkout.`);
    await append(plan, "slot-history", `${markers.history}: verification evidence from the disposable slot.`);
    await append(foreign, "foreign-history", `${markers.history}: ${markers.foreign}`);
    const editor = path => host.call("project.memory.editor.get", { path }).then(result => result.editor);
    const initial = await editor(branch);
    assert.match(initial.owner, /^memory:/, "the shared owner needs a stable identity");
    for (const text of [markers.memory, markers.branch, markers.slot]) assert(initial.memory.content.includes(text), `migration dropped ${text}`);
    assert(initial.memory.entries.some(entry => entry.content === markers.branch && entry.title.includes(branch)), "conflicting branch memory lost its source");
    for (const path of [repository, ...slots]) assert.equal((await editor(path)).owner, initial.owner);
    assert.equal(await sources(), sourceBytes, "migration changed original collection bytes or timestamps");
    checks.push("legacy-path-group-conflicts-preserve-sources", "main-branch-detached-share-stable-owner");

    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir,
      log: (level, message, data) => { if (process.env.DEBUG_CONTEXT) console.error(level, message, data); } });
    const resolve = async session => {
      const launch = await resolver.resolve(session.id, session, {});
      assert.equal(launch.projectPath, session.projectPath);
      assert.equal(launch.sidecarParams.projectPath, session.projectPath);
      if (session.id === plan.id) {
        assert(launch.sidecarParams.projectMemoryAlias?.memory.content.includes(markers.memory),
          "the registered KaneoPilot slot did not retain shared alias memory");
      } else if (session.id === agent.id || session.id === goal.id) {
        assert.equal(launch.sidecarParams.projectMemoryAlias, undefined,
          "a generic checkout adopted the owner instruction alias");
        assert(launch.sidecarParams.projectMemory.includes(markers.memory),
          "the launch resolver did not resolve shared project memory");
      }
      assert(!JSON.stringify(launch.sidecarParams.projectInstructions).includes(markers.ownerFile));
      launches.set(session.id, launch.sidecarParams);
    };
    // First binding is a legitimate persisted association; subsequent reads are stable.
    for (const session of [agent, plan, goal, sourceSession]) {
      await host.call("project.autoMemory.agentList", { sessionId: session.id, boundPath: session.projectPath });
    }
    await resolve(agent);
    await unchanged("steady-launch-and-editor-reads", async () => {
      await resolve(agent);
      assert.deepEqual(await editor(branch), initial);
      assert.deepEqual(await editor(repository), initial);
    });
    const groups = (await host.call("project.groups.list", {})).groups;
    const rootGroup = groups.find(candidate => candidate.id === group.id);
    assert.deepEqual(rootGroup.roots.map(item => item.path), [repository, additional], "memory association rewrote filesystem roots");
    assert(groups.filter(candidate => candidate.memoryProject?.id === initial.owner.slice("memory:".length)).length >= 2,
      "duplicate project rows lack a common memory projection");
    checks.push("logical-project-projection-without-root-membership-change");
    sidecar = new AgentSidecar({ launch: { command: process.execPath,
      args: [join(root, "packages/agent-runtime/dist/sidecar.js")], cwd: scratch,
      env: { ...process.env, HOME: home, PI_DESKTOP_DATA_DIR: dataDir, PI_DESKTOP_PLAN_UI_PROBE: "1" } },
      onStderr: text => {
        diagnostics.push(text);
        if (process.env.DEBUG_CONTEXT) process.stderr.write(text);
      } });
    sidecar.setHost({ call: (method, params) => host.call(method, params), onNotification: () => () => {}, onExit: () => () => {} });
    sidecar.setProjectInstructionResolver(({ projectPath }) => loadInstructionChain(projectPath));
    const prompt = async (session, label, options = {}) => {
      expectation = { label, present: [markers.fileInstructions, ...(options.present ?? [])], absent: options.absent ?? [],
        memoryTool: options.memoryTool ?? false, steps: options.steps ?? [], requests: 0 };
      if (session.id !== plan.id) expectation.absent.push(markers.instructions, markers.instructionsUpdated);
      sidecar.setProjectInstructionRoot(session.id, session.projectPath);
      const turnId = randomUUID();
      let unsubscribe;
      let timer;
      const done = new Promise((resolveDone, reject) => {
        rejectTurn = reject;
        timer = setTimeout(() => reject(serverError ?? new Error(`${label}: turn did not finish`)), 25000);
        unsubscribe = sidecar.onNotification((method, payload) => {
          if (method !== "agent.event" || payload.sessionId !== session.id || payload.turnId !== turnId) return;
          events.push(payload);
          if (events.length > 100) events.shift();
          if (payload.event.type === "error") reject(serverError ?? new Error(JSON.stringify(payload.event.error)));
          if (payload.event.type === "agent_end") resolveDone();
        });
      });
      try {
        const count = captures.length;
        // Keep the original launch snapshot so updates require a real per-turn refresh.
        await Promise.all([sidecar.call("agent.prompt", { ...launches.get(session.id), turnId, content: `FIXTURE_${label}` }), done]);
        if (serverError) throw serverError;
        assert.equal(captures.length - count, expectation.steps.length + 1, `${label}: unexpected provider call count`);
        expectedRequests += expectation.steps.length + 1;
        turns.push({ label, sessionId: session.id });
        const { runtimeId } = await sidecar.call("agent.testRuntimeIdentity", { sessionId: session.id });
        if (identities.has(session.id)) assert.equal(runtimeId, identities.get(session.id), `${label}: runtime was replaced`);
        identities.set(session.id, runtimeId);
      } finally { clearTimeout(timer); unsubscribe?.(); expectation = undefined; rejectTurn = undefined; }
    };
    await unchanged("default-off-reads-all-migrated-notes", () => prompt(agent, "recording-off", {
      present: [markers.memory, markers.branch, markers.slot], absent: [markers.foreign] }));
    await assert.rejects(host.call("project.autoMemory.agentUpsert", { sessionId: agent.id, boundPath: branch, content: "not opted in" }));
    await host.call("project.autoMemory.setEnabled", { path: repository, expectedOwner: initial.owner, enabled: true });
    const commit = await git("rev-parse", "HEAD");
    const remembered = `${markers.remembered}; source session ${agent.id}; verified committed baseline ${commit}.`;
    await prompt(agent, "remember-shared-decision", { memoryTool: true, present: [markers.memory], steps: [
      { name: "ProjectMemory", args: { action: "upsert", title: "Verified decision", content: remembered },
        check: content => assert(content.includes(markers.remembered), "write result omitted the shared entry") },
    ] });
    const recorded = await editor(repository);
    assert(recorded.memory.content.includes(remembered));
    await unchanged("stale-editor-snapshot-rejected", () => assert.rejects(host.call("project.memory.editor.save", {
      path: repository, expectedOwner: initial.owner, expectedMemory: initial.memory, entries: [] }), error => error.errorCode === "CONFLICT"));
    for (const session of [plan, goal]) {
      await resolve(session);
      await prompt(session, `${session.mode}-shared-recall`, {
        present: [markers.remembered, ...(session.id === plan.id ? [markers.instructions] : [])] });
      await assert.rejects(host.call("project.autoMemory.agentUpsert", { sessionId: session.id, boundPath: session.projectPath,
        title: "Not allowed", content: "Plan and Goal remain read-only." }), error => error.errorCode === "TOOL_DISABLED_IN_PLAN");
    }
    checks.push("opt-in-agent-write-across-checkouts", "plan-goal-read-without-write-tool",
      "generic-checkouts-keep-instructions-separate-and-registered-slot-retains-compatibility");
    const saveMemory = async content => {
      const current = await editor(repository);
      return host.call("project.memory.editor.save", { path: repository, expectedOwner: current.owner,
        expectedMemory: current.memory, entries: content ? [{ id: "stable-rule", title: "Verified project rule", content }] : [] });
    };
    const setInstructions = content => host.call("project.group.instructions.set", { groupId: group.id, content });
    await saveMemory(markers.updated);
    await setInstructions(markers.instructionsUpdated);
    await unchanged("updated-notes-next-turn-same-runtime", () => prompt(agent, "updated", { memoryTool: true,
      present: [markers.updated], absent: [markers.memory, markers.branch, markers.slot, markers.remembered] }));
    await saveMemory("");
    await setInstructions("");
    await unchanged("empty-shared-memory-clears-context-without-legacy-fallback", async () => {
      assert.equal((await editor(slots[0])).memory.content, "");
      await prompt(agent, "empty", { memoryTool: true, absent: [markers.legacy, markers.memory, markers.branch,
        markers.slot, markers.remembered, markers.updated, markers.instructions, markers.instructionsUpdated] });
    });
    await saveMemory(markers.updated);
    await setInstructions(markers.instructionsUpdated);
    await unchanged("restored-memory-next-turn", () => prompt(agent, "restored", { memoryTool: true,
      present: [markers.updated], absent: [markers.slot] }));
    await host.call("project.autoMemory.setEnabled", { path: slots[0], expectedOwner: initial.owner, enabled: false });
    await unchanged("recording-revoked-next-turn-with-reads-retained", async () => {
      await prompt(agent, "recording-revoked", { present: [markers.updated] });
      await assert.rejects(host.call("project.autoMemory.agentUpsert", { sessionId: agent.id, boundPath: branch, content: "revoked" }));
    });
    await unchanged("history-tools-cross-worktree-with-source-isolation", () => prompt(agent, "history", {
      present: [markers.updated], absent: [markers.foreign], steps: [
        { name: "ProjectHistory", args: { action: "search", query: markers.history }, check: content => {
          const results = JSON.parse(content);
          assert(results.hits.some(hit => hit.sessionId === sourceSession.id));
          assert(results.hits.some(hit => hit.sessionId === plan.id));
          assert(!results.hits.some(hit => hit.sessionId === foreign.id));
        } },
        { name: "ProjectHistory", args: { action: "read", targetSessionId: sourceSession.id, messageId: "main-history" },
          check: content => assert(content.includes("main checkout")) },
      ] }));
    await unchanged("relative-read-and-code-search-keep-checkout-scope", () => prompt(agent, "workspace-scope", {
      present: [markers.updated], steps: [
        { name: "Read", args: { path: "AGENTS.md" }, check: content => {
          assert(content.includes(markers.fileInstructions)); assert(!content.includes(markers.ownerFile));
        } },
        { name: "CodeSearch", args: { query: markers.ownerFile }, check: content => assert.equal(JSON.parse(content).hits.length, 0) },
      ] }));
    assert.equal(await sources(), sourceBytes, "shared edits or recall changed preserved source collections");

    const retainedMemory = (await editor(repository)).memory;
    await sidecar.dispose(); sidecar = undefined;
    await git("worktree", "remove", slots[0]);
    const afterRemoval = await editor(repository);
    assert.equal(afterRemoval.owner, initial.owner);
    assert.deepEqual(afterRemoval.memory, retainedMemory);
    const history = session => host.call("project.history.search", { sessionId: session.id,
      boundPath: session.projectPath, query: markers.history });
    assert((await history(sourceSession)).hits.some(hit => hit.sessionId === plan.id), "slot removal lost historical source recall");
    const foreignEditor = await editor(foreignRepository);
    const foreignSaved = await host.call("project.memory.editor.save", { path: foreignRepository, expectedOwner: foreignEditor.owner,
      expectedMemory: foreignEditor.memory, entries: [{ id: "private", title: "Independent project", content: markers.foreign }] });
    await gitAt(foreignRepository, "worktree", "add", "--detach", "-q", slots[0]);
    const reused = await create(slots[0]);
    const reusedEditor = await editor(slots[0]);
    assert.equal(reusedEditor.owner, foreignEditor.owner, "reused slot retained its old memory owner");
    assert.notEqual(reusedEditor.owner, initial.owner);
    assert.deepEqual(reusedEditor.memory, foreignSaved.editor.memory, "reused slot imported another project's preserved source records");
    const reusedHistory = await history(reused);
    assert(reusedHistory.hits.some(hit => hit.sessionId === foreign.id));
    assert(!reusedHistory.hits.some(hit => hit.sessionId === plan.id || hit.sessionId === sourceSession.id));
    assert((await history(sourceSession)).hits.some(hit => hit.sessionId === plan.id), "path reuse reassigned the archived slot's history");
    checks.push("slot-removal-retains-memory-and-history", "slot-reuse-by-other-repository-does-not-leak");
    await host.stop(); await host.start();
    const reopened = await editor(repository);
    assert.equal(reopened.owner, initial.owner);
    assert.deepEqual(reopened.memory, retainedMemory);
    assert.equal((await editor(slots[0])).owner, foreignEditor.owner);
    assert((await history(sourceSession)).hits.some(hit => hit.sessionId === plan.id));
    checks.push("restart-preserves-identities-memory-and-archived-history");
    assert.equal(captures.length, expectedRequests, "extra background provider requests");
    const summary = { ok: true, model: "local deterministic HTTP",
      state: "isolated HOME/data; real Git/Host/SQLite/headless launch/Sidecar", checks,
      requestedTurns: turns.length, providerRequests: captures.length,
      sameRuntimeTurns: turns.filter(turn => turn.sessionId === agent.id).length,
      captures: captures.map(({ system: _system, messages: _messages, ...capture }) => capture),
      scope: "protocol E2E; does not claim Electron UI, installed build, model obedience or paid-model validation" };
    if (process.env.PI_CONTEXT_EVIDENCE_DIR) {
      await mkdir(process.env.PI_CONTEXT_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(process.env.PI_CONTEXT_EVIDENCE_DIR, "worktree-memory-context.json"),
        JSON.stringify({ ...summary, turns, captures }, null, 2) + "\n");
    }
    console.log("WORKTREE_MEMORY_CONTEXT " + JSON.stringify(summary));
  } catch (error) {
    if (process.env.PI_CONTEXT_EVIDENCE_DIR) {
      await mkdir(process.env.PI_CONTEXT_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(process.env.PI_CONTEXT_EVIDENCE_DIR, "worktree-memory-context-failure.json"),
        JSON.stringify({ ok: false, error: String(serverError ?? error), turns, captures, events, diagnostics }, null, 2) + "\n");
    }
    throw serverError ?? error;
  } finally {
    try { await sidecar?.dispose(); } finally {
      try { await host?.stop(); } finally {
        if (server?.listening) {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }
}
