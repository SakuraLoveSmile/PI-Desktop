import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [protocol, types, main, api, store, runtime, commands, hostRpc, transcript, enLocale] =
  await Promise.all([
    read("../../../packages/shared/src/protocol.ts"),
    read("../../../packages/shared/src/types.ts"),
    read("../electron/main/index.ts"),
    read("../src/lib/api.ts"),
    read("../src/stores/app-store.ts"),
    read("../../../packages/agent-runtime/src/runtime.ts"),
    read("../electron/main/builtin-commands.ts"),
    read("../../../crates/host-core/src/rpc/mod.rs"),
    read("../src/components/ChatTranscript.tsx"),
    read("../../../packages/i18n/src/locales/en/index.ts"),
  ]);

test("context compaction is wired through protocol v9 and the manual IPC path", () => {
  assert.match(protocol, /PROTOCOL_VERSION = 9/);
  assert.match(protocol, /agentCompact:\s*"pi-desktop\/agent\/compact"/);
  assert.match(types, /type ContextCompactionRecord/);
  assert.match(types, /type: "compaction_start"/);
  assert.match(types, /type: "compaction_end"/);
  assert.match(types, /fallback\?: ContextCompactionFallback/);
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

test("host-driven protection blocks unsafe provider requests with no model-facing tool", () => {
  assert.match(runtime, /prepareNextTurnWithContext/);
  // Triggering is deterministic and host-owned: no compaction tool, no prompt
  // nudge, so a long session never spends a turn asking the model to compact.
  assert.doesNotMatch(runtime, /CompactContext/);
  assert.doesNotMatch(runtime, /<context_management>/);
  assert.match(runtime, /budget\.tokens >= budget\.hardLimit/);
  assert.match(runtime, /CONTEXT_COMPACTION_FAILED: unable to create a checkpoint/);
  assert.match(runtime, /checkpoint truncated: this message crossed the retained context budget/);
  assert.match(runtime, /pendingOverflow/);
  assert.match(runtime, /runCompaction\("overflow", true\)/);
  assert.match(runtime, /fallback: "retained_tail"/);
});

test("a checkpoint carries only recent user messages past the boundary", () => {
  // Codex's shape: the summary covers the whole boundary range and the only
  // messages that survive it are user messages, capped at 20k tokens.
  assert.match(runtime, /COMPACTION_RETAINED_USER_MESSAGE_MAX_TOKENS = 20_000/);
  assert.match(runtime, /private codexShapedPreparation\(/);
  assert.match(
    runtime,
    /const messagesToSummarize = \[\s*\.\.\.preparation\.messagesToSummarize,\s*\.\.\.preparation\.turnPrefixMessages,\s*\.\.\.preparation\.retainedTail,\s*\]/,
  );
  assert.match(runtime, /turnPrefixMessages: \[\],\s*isSplitTurn: false/);
  assert.match(
    runtime,
    /\(message\): message is UserMessage => message\.role === "user"/,
  );
  // Newest-first selection with the boundary message truncated, not dropped.
  assert.match(runtime, /function selectRetainedUserMessages\(/);
  assert.match(runtime, /truncateUserMessageForCheckpoint\(message, remaining\)/);
  assert.match(runtime, /return selected\.reverse\(\)/);
  // Full tool-result batches are no longer retained, so nothing bounds them.
  assert.doesNotMatch(runtime, /fairToolResultTokenBudgets/);
  assert.doesNotMatch(runtime, /CHECKPOINT_TAIL_SAFETY_TOKENS/);
});

test("compaction runs inline at the hard boundary, never ahead of it", () => {
  // Codex has no off-critical-path compaction: the summary is paid for at the
  // turn boundary the user is already waiting on.
  assert.doesNotMatch(runtime, /maybeStartBackgroundCompaction/);
  assert.doesNotMatch(runtime, /pendingBackgroundCheckpoint/);
  assert.doesNotMatch(runtime, /BACKGROUND_COMPACTION_LIMIT_RATIO/);
  assert.doesNotMatch(runtime, /phase: "background"/);
  assert.match(
    runtime,
    /const budget = this\.contextBudget\(context\.messages\);\s*if \(budget\.tokens < budget\.hardLimit\) return \{ context \};/,
  );
  // Generation stays separate from installation so a failed build can still
  // fall through to the retained-tail recovery path.
  assert.match(runtime, /private async buildCheckpoint\(signal: AbortSignal\)/);
  assert.match(runtime, /private async installCheckpoint\(/);
});

test("compaction lifecycle keeps the renderer busy until its actual terminal event", () => {
  assert.doesNotMatch(types, /ContextCompactionPhase/);
  assert.match(
    store,
    /event\.type === "compaction_start"\s*\)/,
  );
  assert.match(
    store,
    /event\.type === "compaction_end" && event\.reason === "manual"/,
  );
  assert.match(
    store,
    /case "compaction_start":\s*set\(\{ isRunning: true \}\)/,
  );
  assert.match(
    store,
    /case "compaction_end":[\s\S]*event\.reason === "manual"\) set\(\{ isRunning: false \}\)/,
  );
  assert.match(store, /contextCompaction\.recovered/);
});

test("a successful automatic compaction notifies nobody", () => {
  const compactionEnd =
    store.match(/case "compaction_end":[\s\S]*?\n      case "agent_end":/)?.[0] ??
    "";
  assert.ok(compactionEnd.length > 0, "compaction_end handler not found");
  // Only three toasts survive, and each follows something the user already saw:
  // a degraded checkpoint, the request that overflowed, and a manual command.
  assert.match(
    compactionEnd,
    /if \(event\.fallback\) \{\s*get\(\)\.showToast\(i18n\.t\("contextCompaction\.recovered"\)/,
  );
  assert.match(
    compactionEnd,
    /else if \(event\.reason === "overflow"\) \{\s*get\(\)\.showToast\(\s*i18n\.t\("contextCompaction\.retrying"\)/,
  );
  assert.match(
    compactionEnd,
    /else if \(event\.reason === "manual"\) \{\s*get\(\)\.showToast\(i18n\.t\("contextCompaction\.completed"\)/,
  );
  // A threshold compaction reaches no showToast call of its own.
  assert.equal(
    compactionEnd.match(/showToast/g)?.length,
    4,
    "unexpected number of compaction toasts",
  );
});

test("the context inspector is the only place a checkpoint is visible", () => {
  assert.match(types, /type ContextCompactionStatus/);
  assert.match(types, /status\?: ContextCompactionStatus/);
  // The generation counter rides inside the opaque details value, so the host
  // persists it without a record schema change.
  assert.match(runtime, /checkpointDetailsWithGeneration/);
  assert.match(runtime, /status: contextCompactionStatus\(checkpoint\)/);
  // Both the durable record and the live event feed the same store map.
  assert.match(store, /sessionCompactions: Record<string, ContextCompactionStatus>/);
  assert.match(
    store,
    /rememberSessionCompaction\(id, detail\.session\?\.compaction\)/,
  );
  assert.match(
    store,
    /event\.type === "compaction_end" && event\.ok && event\.status/,
  );
  assert.match(store, /withoutRecordKey\(state\.sessionCompactions, id\)/);
  assert.match(transcript, /state\.sessionCompactions\[state\.activeSessionId\]/);
  assert.match(transcript, /chat\.usageCompaction/);
  assert.match(enLocale, /usageCompaction:/);
});

