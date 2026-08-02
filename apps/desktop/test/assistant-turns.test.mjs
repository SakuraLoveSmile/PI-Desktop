import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantTurnResponseDuration,
  assistantTurnStreamingMessage,
  assistantTurnContent,
  assistantTurnUsage,
  buildTranscriptEntries,
} from "../src/lib/assistant-turns.ts";

function message(id, role, content, extra = {}) {
  return {
    id,
    role,
    content,
    createdAt: `2026-07-28T00:00:0${id.length}.000Z`,
    ...extra,
  };
}

test("groups assistant fragments and tools into one conversational turn", () => {
  const { entries } = buildTranscriptEntries([
    message("user", "user", "Fix the issue"),
    message("intro", "assistant", "I will inspect the code."),
    message("read", "tool", "result", {
      toolName: "Read",
      toolCallId: "read",
    }),
    message("followup", "assistant", "The problem is in the renderer."),
    message("edit", "tool", "done", {
      toolName: "Edit",
      toolCallId: "edit",
    }),
    message("final", "assistant", "Fixed and verified."),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "message");
  assert.equal(entries[1].kind, "assistant-turn");
  assert.deepEqual(
    entries[1].parts.map((part) => part.kind),
    ["message", "activity", "message", "activity", "message"],
  );
  assert.equal(entries[1].anchorId, "intro");
  assert.equal(
    assistantTurnContent(entries[1]),
    "I will inspect the code.\n\nThe problem is in the renderer.\n\nFixed and verified.",
  );
});

test("starts a new assistant turn only after the next user message", () => {
  const { entries } = buildTranscriptEntries([
    message("user-1", "user", "First"),
    message("assistant-1", "assistant", "First response"),
    message("user-2", "user", "Second"),
    message("assistant-2", "assistant", "Second response"),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["message", "assistant-turn", "message", "assistant-turn"],
  );
});

test("keeps thinking and tool-only activity in the assistant turn", () => {
  const { entries } = buildTranscriptEntries([
    message("user", "user", "Inspect"),
    message("thinking", "assistant", "", { thinking: "Planning" }),
    message("tool", "tool", "result", {
      toolName: "Read",
      toolCallId: "tool",
    }),
    message("answer", "assistant", "Done"),
  ]);

  const turn = entries[1];
  assert.equal(turn.kind, "assistant-turn");
  assert.equal(turn.parts[0].kind, "activity");
  assert.deepEqual(
    turn.parts[0].items.map((item) => item.kind),
    ["thinking", "tool"],
  );
  assert.equal(turn.parts[0].endedAt, "2026-07-28T00:00:06.000Z");
});

test("aggregates provider usage across response fragments", () => {
  const usage = {
    inputTokens: 10,
    outputTokens: 4,
    cacheReadTokens: 2,
    totalTokens: 14,
  };
  const { entries } = buildTranscriptEntries([
    message("user", "user", "Count"),
    message("first", "assistant", "One", { usage }),
    message("tool", "tool", "result", { toolCallId: "tool" }),
    message("second", "assistant", "Two", { usage }),
  ]);
  const turn = entries[1];

  assert.equal(turn.kind, "assistant-turn");
  assert.deepEqual(assistantTurnUsage(turn), {
    inputTokens: 20,
    outputTokens: 8,
    cacheReadTokens: 4,
    totalTokens: 28,
  });
});

test("tracks the active streamed assistant and its duration snapshot", () => {
  const { entries } = buildTranscriptEntries([
    message("user", "user", "Count"),
    message("streaming", "assistant", "Partial", {
      thinking: "Plan",
      status: "streaming",
      responseDurationMs: 120,
    }),
  ]);
  const turn = entries[1];

  assert.equal(turn.kind, "assistant-turn");
  assert.equal(assistantTurnStreamingMessage(turn)?.id, "streaming");
  assert.equal(assistantTurnResponseDuration(turn), 120);
});
