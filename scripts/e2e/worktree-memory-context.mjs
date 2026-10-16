/** Real Git worktrees, Host, launch resolver and Sidecar; no external provider. */
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
  legacy: "OWNER_LEGACY_MEMORY_V1",
  memory: "OWNER_GROUP_MEMORY_V2",
  updated: "OWNER_GROUP_MEMORY_V3",
  instructions: "OWNER_GROUP_INSTRUCTIONS_V2",
  instructionsUpdated: "OWNER_GROUP_INSTRUCTIONS_V3",
  slotMemory: "STALE_SLOT_MEMORY_MUST_NOT_OVERRIDE_ALIAS",
  slotInstructions: "TRACKED_SLOT_INSTRUCTION_CHAIN",
  ownerFile: "UNTRACKED_OWNER_AGENTS_MUST_NOT_LEAK",
};

export async function runWorktreeMemoryContext(root) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "pi-worktree-memory-")));
  const home = join(scratch, "home");
  const dataDir = join(scratch, "data");
  const repository = join(scratch, "repository");
  const additional = join(scratch, "additional-root");
  const pool = join(scratch, "worktrees");
  const projection = join(home, "Library/Application Support/KaneoPilot/worktree-slots.json");
  const originalHome = process.env.HOME;
  let host;
  let sidecar;
  let server;
  let serverError;
  let expectation;
  const captures = [];
  const identities = new Map();
  const checks = [];
  const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = async (...args) => (await execute("git", ["-c", "commit.gpgsign=false", "-c",
    "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
  { cwd: repository, env: gitEnv, timeout: 10000 })).stdout.trim();
  try {
    await Promise.all([home, repository, additional].map(path => mkdir(path, { recursive: true })));
    process.env.HOME = home;
    // Import after HOME is isolated: instruction modules capture the global path.
    const { createHeadlessLaunchResolver } = await import("../../packages/host-runtime/dist/launch-resolver.js");
    const { loadInstructionChain } = await import("../../packages/agent-runtime/dist/project-instructions.js");
    await git("init", "-q");
    await writeFile(join(repository, "AGENTS.md"), markers.slotInstructions + "\n");
    await git("add", "AGENTS.md");
    await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
    const common = await realpath(join(repository, ".git"));
    const repoKey = createHash("sha256").update(common).digest("hex").slice(0, 16);
    const slots = [1, 2].map(number => join(pool, "pool", repoKey, `slot-${number}`));
    for (const slot of slots) await git("worktree", "add", "--detach", "-q", slot);
    // An untracked owner override must never replace the committed slot chain.
    await writeFile(join(repository, "AGENTS.override.md"), markers.ownerFile + "\n");
    await mkdir(join(home, "Library/Application Support/KaneoPilot"), { recursive: true });
    const registration = { schema_version: 1, updated_at: "2026-10-16T00:00:00Z", worktrees_root: pool,
      slots: slots.map((path, index) => ({ slot_id: `fixture-${index + 1}`, path, repository,
        git_common_dir: common, repo_key: repoKey, state: "leased" })) };
    const saveProjection = () => writeFile(projection, JSON.stringify(registration));

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
        assert(!system.includes(repository), `${expectation.label}: owner root leaked`);
        assert(!system.includes(additional), `${expectation.label}: additional root leaked`);
        assert(!system.includes("Primary root:"), "owner primary-root guide leaked");
        assert(!system.includes("Additional root:"), "owner additional-root guide leaked");
        assert(!tools.includes("ProjectMemory"), "read-only slot exposed a memory write tool");
        captures.push({ label: expectation.label, systemSha256: createHash("sha256").update(system).digest("hex"), tools, system });
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const base = { id: randomUUID(), object: "chat.completion.chunk", created: 1, model: payload.model };
        for (const [delta, finish_reason] of [[{ role: "assistant", content: "Fixture verified." }, null], [{}, "stop"]]) {
          response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        }
        response.end("data: [DONE]\n\n");
      } catch (error) {
        serverError = error;
        if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    host = new Host(resolveHostBinary(), dataDir);
    await host.start();
    await host.call("workspace.set", { path: slots[0] });
    // Seed stale notes before registration; a valid alias must hide them.
    for (const slot of slots) await host.call("project.memory.set", { path: slot, content: markers.slotMemory });
    await host.call("project.memory.set", { path: repository, content: markers.legacy });
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const { provider } = await host.call("providers.create", { name: "Local worktree memory fixture", vendorKey: "custom",
      type: "openai_compatible", protocol: "openai_compatible", baseUrl, authKind: "none", apiStyle: "chat_completions",
      defaultModelId: "context-fixture", models: [{ id: "context-fixture" }] });
    const create = async (path, mode) => (await host.call("session.create", { projectPath: path, title: "Worktree context fixture",
      mode, providerId: provider.id, modelId: "context-fixture", thinkingLevel: "off", permissionMode: "auto" })).session;
    const agent = await create(slots[0], "agent");
    const plan = await create(slots[1], "plan");
    const goal = await create(slots[1], "goal");
    await saveProjection();
    // Read the entire table, including exact stored JSON bytes and timestamps.
    // This subprocess only opens our isolated DB with SQLite's read-only flag.
    const kv = async () => (await execute("sqlite3", ["-readonly", join(dataDir, "pi.sqlite"),
      "SELECT hex(CAST(ns AS BLOB)),hex(CAST(key AS BLOB)),hex(CAST(value_json AS BLOB)),updated_at FROM kv ORDER BY ns,key;"],
    { timeout: 10000, maxBuffer: 4 * 1024 * 1024 })).stdout;
    const unchanged = async (label, action) => {
      const before = await kv();
      await action();
      assert.equal(await kv(), before, `${label}: project reads or rejected writes mutated kv`);
      checks.push(label);
    };
    const resolver = createHeadlessLaunchResolver({ getHost: () => host, dataDir,
      log: (level, message, data) => { if (process.env.DEBUG_CONTEXT) console.error(level, message, data); } });
    const launches = new Map();
    const resolve = async session => {
      const launch = await resolver.resolve(session.id, session, {});
      assert.equal(launch.projectPath, session.projectPath);
      assert.equal(launch.sidecarParams.projectPath, session.projectPath);
      assert(launch.sidecarParams.projectMemoryAlias, "real resolver did not resolve the slot alias");
      assert(!JSON.stringify(launch.sidecarParams.projectMemoryAlias).includes(repository));
      assert(!JSON.stringify(launch.sidecarParams.projectInstructions).includes(markers.ownerFile));
      launches.set(session.id, launch.sidecarParams);
    };
    await unchanged("headless-launch-read-only", () => resolve(agent));
    sidecar = new AgentSidecar({ launch: { command: process.execPath,
      args: [join(root, "packages/agent-runtime/dist/sidecar.js")], cwd: scratch,
      env: { ...process.env, HOME: home, PI_DESKTOP_DATA_DIR: dataDir, PI_DESKTOP_PLAN_UI_PROBE: "1" } },
      onStderr: text => { if (process.env.DEBUG_CONTEXT) process.stderr.write(text); } });
    sidecar.setHost({ call: (method, params) => host.call(method, params), onNotification: () => () => {}, onExit: () => () => {} });
    sidecar.setProjectInstructionResolver(({ projectPath }) => loadInstructionChain(projectPath));
    const prompt = async (session, label, present, absent) => {
      expectation = { label, present: [markers.slotInstructions, ...present], absent: [markers.ownerFile, ...absent] };
      sidecar.setProjectInstructionRoot(session.id, session.projectPath);
      const turnId = randomUUID();
      let unsubscribe;
      let timer;
      const done = new Promise((resolveDone, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: turn did not finish`)), 25000);
        unsubscribe = sidecar.onNotification((method, payload) => {
          if (method !== "agent.event" || payload.sessionId !== session.id || payload.turnId !== turnId) return;
          if (payload.event.type === "error") reject(serverError ?? new Error(JSON.stringify(payload.event.error)));
          if (payload.event.type === "agent_end") resolveDone();
        });
      });
      try {
        const count = captures.length;
        // Reuse the original launch parameters so only real per-turn refresh can
        // observe changes; re-resolving launch would otherwise recreate runtime.
        await sidecar.call("agent.prompt", { ...launches.get(session.id), turnId, content: `FIXTURE_${label}` });
        await done;
        if (serverError) throw serverError;
        assert.equal(captures.length, count + 1, `${label}: unexpected provider call count`);
        const { runtimeId } = await sidecar.call("agent.testRuntimeIdentity", { sessionId: session.id });
        if (identities.has(session.id)) assert.equal(runtimeId, identities.get(session.id), `${label}: runtime was replaced`);
        identities.set(session.id, runtimeId);
      } finally { clearTimeout(timer); unsubscribe?.(); expectation = undefined; }
    };
    await unchanged("single-root-first-launch", async () => {
      const result = await host.call("project.group.context", { path: slots[0] });
      assert.equal(result.context, null);
      assert.equal(result.memoryAlias.memory.content, markers.legacy);
      await prompt(agent, "single-root", [markers.legacy], [markers.slotMemory]);
    });
    const { group } = await host.call("project.group.create", { name: "Owner multi-root fixture", folders: [repository, additional] });
    const setMemory = content => host.call("project.group.memory.set", { groupId: group.id,
      entries: content ? [{ id: "fixture-owner-note", title: "Fixture", content }] : [] });
    const setInstructions = content => host.call("project.group.instructions.set", { groupId: group.id, content });
    await setMemory(markers.memory);
    await setInstructions(markers.instructions);
    await unchanged("plan-goal-headless-launch-read-only", async () => { await resolve(plan); await resolve(goal); });
    await unchanged("multi-root-same-runtime-refresh-and-two-slots", async () => {
      for (const slot of slots) {
        const result = await host.call("project.group.context", { path: slot });
        assert.equal(result.context, null, "slot group context inherited owner roots");
        assert.equal(result.memoryAlias.instructions, markers.instructions);
      }
      await prompt(agent, "group-refresh", [markers.memory, markers.instructions], [markers.legacy, markers.slotMemory]);
      await prompt(plan, "plan-second-slot", [markers.memory, markers.instructions], [markers.slotMemory]);
      await prompt(goal, "goal-second-slot", [markers.memory, markers.instructions], [markers.slotMemory]);
      for (const session of [agent, plan, goal]) {
        const list = await host.call("project.autoMemory.agentList", { sessionId: session.id, boundPath: session.projectPath });
        assert.equal(list.autoRecordEnabled, false);
        assert.equal(list.memoryAlias.instructions, markers.instructions);
        for (const method of ["project.autoMemory.agentUpsert", "project.autoMemory.agentDelete"]) {
          await assert.rejects(host.call(method, { sessionId: session.id, boundPath: session.projectPath, content: "not allowed" }),
            error => error.errorCode === (session.mode === "agent" ? "MEMORY_ALIAS_READ_ONLY" : "TOOL_DISABLED_IN_PLAN"));
        }
      }
      await assert.rejects(host.call("project.autoMemory.agentList", { sessionId: agent.id, boundPath: repository }),
        error => error.errorCode === "SESSION_PROJECT_CHANGED");
      for (const method of ["project.memory.set", "project.memory.editor.save", "project.autoMemory.setEnabled"]) {
        await assert.rejects(host.call(method, { path: slots[0], content: "not allowed", entries: [], enabled: true }),
          error => error.errorCode === "MEMORY_ALIAS_READ_ONLY");
      }
    });
    await setMemory(markers.updated);
    await setInstructions(markers.instructionsUpdated);
    await unchanged("updated-bodies-next-turn", () => prompt(agent, "updated", [markers.updated, markers.instructionsUpdated],
      [markers.memory, markers.instructions, markers.slotMemory]));
    await setMemory("");
    await setInstructions("");
    await unchanged("empty-alias-clears-bodies-without-slot-fallback", async () => {
      const result = await host.call("project.memory.get", { path: slots[0] });
      assert.equal(result.memory.content, "");
      const emptyLaunch = await resolver.resolve(agent.id, agent, {});
      assert.equal(emptyLaunch.sidecarParams.projectMemoryAlias.memory.content, "");
      assert.equal(emptyLaunch.sidecarParams.projectMemory, undefined);
      await prompt(agent, "empty", [], [markers.legacy, markers.memory, markers.updated,
        markers.instructions, markers.instructionsUpdated, markers.slotMemory]);
    });
    await setMemory(markers.updated);
    await setInstructions(markers.instructionsUpdated);
    await unchanged("restored-alias-next-turn", () => prompt(agent, "restored", [markers.updated, markers.instructionsUpdated], [markers.slotMemory]));
    registration.slots[0].repo_key = "invalid-registration";
    await saveProjection();
    await unchanged("invalid-mapping-clears-old-alias", async () => {
      const result = await host.call("project.group.context", { path: slots[0] });
      assert.equal(result.memoryAlias, undefined);
      await prompt(agent, "invalid", [markers.slotMemory], [markers.updated, markers.instructionsUpdated]);
    });
    assert.equal(captures.length, 8, "no background model calls beyond requested turns");
    const summary = { ok: true, model: "local deterministic HTTP",
      state: "isolated HOME/data; real Git/Host/SQLite/headless launch/Sidecar", checks,
      requestedTurns: captures.length, sameRuntimeTurns: 6,
      captures: captures.map(({ system: _system, ...capture }) => capture),
      scope: "protocol E2E; does not claim Electron UI, installed build or paid-model validation" };
    if (process.env.PI_CONTEXT_EVIDENCE_DIR) {
      await mkdir(process.env.PI_CONTEXT_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(process.env.PI_CONTEXT_EVIDENCE_DIR, "worktree-memory-context.json"),
        JSON.stringify({ ...summary, captures }, null, 2) + "\n");
    }
    console.log("WORKTREE_MEMORY_CONTEXT " + JSON.stringify(summary));
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
