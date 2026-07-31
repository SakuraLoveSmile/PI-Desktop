import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [protocol, types, main, api, store, runtime, commands, hostRpc] =
  await Promise.all([
    read("../../../packages/shared/src/protocol.ts"),
    read("../../../packages/shared/src/types.ts"),
    read("../electron/main/index.ts"),
    read("../src/lib/api.ts"),
    read("../src/stores/app-store.ts"),
    read("../../../packages/agent-runtime/src/runtime.ts"),
    read("../electron/main/builtin-commands.ts"),
    read("../../../crates/host-core/src/rpc/mod.rs"),
  ]);

test("context compaction is wired through protocol v9 and the manual IPC path", () => {
  assert.match(protocol, /PROTOCOL_VERSION = 9/);
  assert.match(protocol, /agentCompact:\s*"pi-desktop\/agent\/compact"/);
  assert.match(types, /type ContextCompactionRecord/);
  assert.match(types, /type: "compaction_start"/);
  assert.match(types, /type: "compaction_end"/);
  assert.match(main, /handle\(IPC\.invoke\.agentCompact/);
  assert.match(
    main,
    /handle\(IPC\.invoke\.agentCompact[\s\S]*activeTurns\.has\(req\.sessionId\)/,
  );
  assert.match(main, /sidecar\.call\("agent\.compact"/);
  assert.match(api, /compact:\s*\(req: AgentCompactRequest\)/);
  assert.match(commands, /slash:\s*"compact"/);
  assert.match(hostRpc, /"session\.appendCompaction"/);
});

test("turn_end remains a per-tool-turn boundary rather than a terminal run state", () => {
  assert.match(
    store,
    /event\.type === "agent_end" \|\|\s*event\.type === "error"/,
  );
  assert.doesNotMatch(
    store,
    /event\.type === "agent_end" \|\|\s*event\.type === "turn_end"/,
  );
  assert.match(store, /case "agent_end":[\s\S]*?set\(\{ isRunning: false \}\)/);
  assert.match(store, /case "turn_end":\s*break/);
});

test("per-turn protection nudges softly and blocks unsafe provider requests", () => {
  assert.match(runtime, /prepareNextTurnWithContext/);
  assert.match(runtime, /<context_management>/);
  assert.match(runtime, /CONTEXT_NUDGE_TURN_INTERVAL = 3/);
  assert.match(runtime, /budget\.tokens >= budget\.hardLimit/);
  assert.match(runtime, /CONTEXT_COMPACTION_FAILED: unable to create a checkpoint/);
  assert.match(runtime, /checkpoint truncated: tool result exceeded the retained context budget/);
  assert.match(runtime, /pendingOverflow/);
  assert.match(runtime, /runCompaction\("overflow", true\)/);
});

test("compaction lifecycle keeps the renderer busy until its actual terminal event", () => {
  assert.match(
    store,
    /event\.type === "turn_start" \|\|\s*event\.type === "compaction_start"/,
  );
  assert.match(
    store,
    /event\.type === "compaction_end" && event\.reason === "manual"/,
  );
  assert.match(store, /case "compaction_start":\s*set\(\{ isRunning: true \}\)/);
  assert.match(
    store,
    /case "compaction_end":[\s\S]*event\.reason === "manual"\) set\(\{ isRunning: false \}\)/,
  );
});
