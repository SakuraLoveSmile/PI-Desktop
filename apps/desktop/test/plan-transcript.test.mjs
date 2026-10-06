import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { buildTranscriptEntries } = await import("../src/lib/assistant-turns.ts");
const { buildPlanTranscriptIndex, planTranscriptEntryKey, splitPlanTurn } = await import("../src/lib/plan-transcript.ts");
const { projectTurnProcess } = await import("../src/lib/turn-process.ts");
const at = (second) => new Date(Date.UTC(2026, 9, 6, 0, 0, second)).toISOString();
const msg = (id, role, second, extra = {}) => ({ id, role, content: id, createdAt: at(second), status: "complete", ...extra });
const proposal = (id, second, extra = {}) => ({ id, sessionId: "session", toolCallId: id, createdAt: at(second), status: "pending", ...extra });
const entries = (rows) => buildTranscriptEntries(rows).entries;
const ids = (parts) => parts.flatMap((part) => part.kind === "message" ? [part.message.id] : part.items.map((item) => item.message.id));

test("handled plan and goal cards divide a contiguous turn before continuation", () => {
  for (const kind of ["plan", "goal"]) {
    const p = proposal("submit", 2, { kind });
    const list = entries([msg("user", "user", 0), msg("intro", "assistant", 1),
      msg("submit", "tool", 2, { toolName: kind === "plan" ? "SubmitPlan" : "SubmitGoal", toolCallId: "submit" }),
      msg("continued", "assistant", 3), msg("read", "tool", 4, { toolName: "Read" }), msg("answer", "assistant", 5)]);
    const turn = list.find((entry) => entry.kind === "assistant-turn");
    for (const status of ["pending", "approved", "rejected", "interrupted"]) {
      const sections = splitPlanTurn(turn, [{ ...p, status }]);
      assert.deepEqual(sections.map((s) => ids(s.parts)), [["intro", "submit"], ["continued", "read", "answer"]]);
      assert.equal(sections[0].proposal.status, status);
      assert.deepEqual(projectTurnProcess({ ...turn, parts: sections[1].parts }).responses.map((part) => part.message.id), ["answer"]);
    }
  }
});

test("missing submit tool is placed inside an activity group at its timestamp", () => {
  const turn = entries([msg("read", "tool", 1, { toolName: "Read" }), msg("bash", "tool", 5, { toolName: "Bash" }), msg("answer", "assistant", 6)])[0];
  const p = proposal("missing", 3);
  const index = buildPlanTranscriptIndex([turn], [p], "session");
  const sections = splitPlanTurn(turn, index.byEntry.get(planTranscriptEntryKey(turn)));
  assert.deepEqual(sections.map((section) => ids(section.parts)), [["read"], ["bash", "answer"]]);
  assert.equal(sections[0].proposal, p);
});

test("index is session-scoped, deduplicates current checkpoint and keeps status replacement", () => {
  const list = entries([msg("user", "user", 0), msg("submit", "tool", 2, { toolName: "SubmitPlan", toolCallId: "submit" })]);
  const p = proposal("submit", 2);
  const updated = { ...p, status: "approved" };
  const index = buildPlanTranscriptIndex(list, [p, proposal("foreign", 1, { sessionId: "other", toolCallId: "submit" }), updated], "session");
  assert.deepEqual([...index.byEntry.values()].flat(), [updated]);
  assert.deepEqual(buildPlanTranscriptIndex(list, [p], undefined).beforeEntries, []);
  assert.equal(buildPlanTranscriptIndex(list, [updated], "session", index).byEntry.values().next().value, index.byEntry.values().next().value);
});

test("old and future orphaned proposals keep their chronological boundaries", () => {
  const list = entries([msg("user", "user", 4), msg("answer", "assistant", 8), msg("later-user", "user", 10)]);
  const old = proposal("old", 2), middle = proposal("middle", 6), future = proposal("future", 12);
  const index = buildPlanTranscriptIndex(list, [future, old, middle], "session");
  assert.deepEqual(index.beforeEntries, [old]);
  assert.deepEqual(index.byEntry.get("user"), [middle]);
  assert.deepEqual(index.byEntry.get("later-user"), [future]);
});

test("multiple checkpoints and child tool ids do not duplicate or move parent cards", () => {
  const turn = entries([msg("first", "tool", 1, { toolName: "SubmitPlan", toolCallId: "first" }),
    msg("between", "assistant", 2), msg("second", "tool", 3, { toolName: "SubmitGoal", toolCallId: "second" }), msg("final", "assistant", 4)])[0];
  const sections = splitPlanTurn(turn, [proposal("first", 1), proposal("second", 3)]);
  assert.deepEqual(sections.map((section) => section.proposal?.id), ["first", "second", undefined]);
  assert.deepEqual(sections.flatMap((section) => ids(section.parts)), ["first", "between", "second", "final"]);
  assert.equal(splitPlanTurn(turn, [])[0].parts, turn.parts);
});

test("a child tool sharing the parent call id cannot close the parent section", () => {
  const entry = { kind: "assistant-turn", id: "turn", parts: [
    { kind: "activity", items: [
      { kind: "tool", message: msg("child", "tool", 1, { toolCallId: "submit", parentToolCallId: "delegate" }) },
      { kind: "tool", message: msg("parent", "tool", 3, { toolName: "SubmitPlan", toolCallId: "submit" }) },
    ] },
    { kind: "message", message: msg("continuation", "assistant", 4) },
  ] };
  const p = proposal("submit", 3);
  const index = buildPlanTranscriptIndex([entry], [p], "session");
  const sections = splitPlanTurn(entry, index.byEntry.get("turn"));
  assert.deepEqual(sections.map((section) => ids(section.parts)), [["child", "parent"], ["continuation"]]);
  assert.equal(sections[0].proposal, p);
});
