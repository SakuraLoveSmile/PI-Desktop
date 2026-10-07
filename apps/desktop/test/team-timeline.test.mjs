import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { projectTeamTimeline } = await import("../src/lib/team-timeline.ts");
const { buildTeamDispatchIndex } = await import("../src/lib/team-dispatch.ts");

function message(id, extra = {}) {
  return { id, role: "assistant", content: id, createdAt: `2026-10-07T00:00:00.${id.length}00Z`, ...extra };
}
function item(kind, id, extra = {}) {
  return { kind, message: message(id, extra), ...(kind === "hostedSearch" ? { round: {} } : {}) };
}
function create(id, taskId = id, extra = {}) {
  return item("tool", id, {
    role: "tool", toolName: "task_create", toolStatus: "success",
    toolArgs: { subject: id }, toolResult: { taskId, status: "pending" }, ...extra,
  });
}
function narration(id) { return { kind: "message", message: message(id) }; }
function activity(items, endedAt = "2026-10-07T01:00:00Z") {
  return { kind: "activity", items, endedAt };
}
function indexFor(sections) {
  return buildTeamDispatchIndex(sections.flatMap(({ parts }) => parts.flatMap((part) =>
    part.kind === "message" ? [part.message] : part.items.map((row) => row.message)
  )), "team");
}
function project(sections, opts = {}, index = indexFor(sections)) {
  return projectTeamTimeline(sections, index, { active: false, joining: false, ...opts });
}
function kinds(timeline, section = 0) { return timeline.sections[section].map((segment) => segment.kind); }
function rows(timeline) {
  return timeline.parts.flatMap((part) => part.kind === "message" ? [part.message.id] : part.items.map((row) => row.message.id));
}
function cards(timeline) {
  return timeline.sections.flat().flatMap((segment) => segment.kind === "cards" ? segment.cards : []);
}

test("turns without anchors, including empty turns, keep the legacy path", () => {
  assert.equal(project([]), null);
  assert.equal(project([{ parts: [] }]), null);
  assert.equal(project([{ parts: [narration("plain"), activity([item("thinking", "thought")])] }], { joining: true }), null);
  const thought = item("thinking", "not-a-tool");
  const index = { cardsByMessageId: new Map([[thought.message.id, []]]), cardsByTaskId: new Map() };
  assert.equal(project([{ parts: [activity([thought])] }], {}, index), null);
});

test("reference timeline preserves narration, three cards and consecutive thinking rows", () => {
  const before = narration("before");
  const after = narration("after");
  const source = activity([
    item("thinking", "think-1"), create("a"), create("b"), create("c"),
    item("thinking", "think-2"), item("thinking", "think-3"),
  ]);
  const timeline = project([{ parts: [before, source, after] }]);
  assert.deepEqual(kinds(timeline), ["parts", "cards", "parts"]);
  assert.equal(timeline.sections[0][0].parts[0], before);
  assert.equal(timeline.sections[0][2].parts[1], after);
  assert.deepEqual(rows(timeline), ["before", "think-1", "think-2", "think-3", "after"]);
  assert.deepEqual(cards(timeline).map((card) => card.taskId), ["a", "b", "c"]);
});

test("failed and unparsed creates remain visible without a card", () => {
  const failed = create("failed", "bad", { toolStatus: "error", isError: true });
  const unparsed = create("unparsed", "bad", { toolResult: "not-json" });
  assert.equal(project([{ parts: [activity([failed, unparsed])] }]), null);
  const timeline = project([{ parts: [activity([failed, create("good"), unparsed])] }]);
  assert.deepEqual(rows(timeline), ["failed", "unparsed"]);
  assert.deepEqual(cards(timeline).map((card) => card.taskId), ["good"]);
});

test("updates preserve the first card, while an update seen first becomes the anchor", () => {
  const update = item("tool", "update", {
    role: "tool", toolName: "task_update", toolStatus: "success",
    toolResult: { task: { taskId: "task", subject: "Updated", status: "completed" } },
  });
  const timeline = project([{ parts: [activity([create("create", "task"), update])] }]);
  assert.deepEqual(rows(timeline), ["update"]);
  assert.equal(cards(timeline).length, 1);
  assert.equal(cards(timeline)[0].task.status, "completed");
  const isolated = project([{ parts: [activity([update])] }]);
  assert.deepEqual(rows(isolated), []);
  assert.equal(cards(isolated)[0].firstCreateMessageId, "update");
});

test("a tool batch emits one card group, then hoists ordinary tools in their order", () => {
  const send1 = item("tool", "send-1", { toolName: "send_message" });
  const send2 = item("tool", "send-2", { toolName: "send_message" });
  const timeline = project([{ parts: [activity([create("a"), send1, create("b"), send2])] }]);
  assert.deepEqual(kinds(timeline), ["cards", "parts"]);
  assert.deepEqual(cards(timeline).map((card) => card.taskId), ["a", "b"]);
  assert.deepEqual(rows(timeline), ["send-1", "send-2"]);
  for (const separator of ["thinking", "hostedSearch"]) {
    const split = project([{ parts: [activity([create("a"), item(separator, "middle"), create("b")])] }]);
    assert.deepEqual(kinds(split), ["cards", "parts", "cards"]);
    assert.deepEqual(rows(split), ["middle"]);
  }
});

test("card dedupe spans parts and sections and absorbs repeated anchor rows", () => {
  const first = create("first");
  const duplicate = create("duplicate");
  const sections = [
    { parts: [activity([first]), narration("one")] },
    { parts: [activity([duplicate]), narration("two")] },
  ];
  const index = indexFor(sections);
  index.cardsByMessageId.set("duplicate", index.cardsByMessageId.get("first"));
  const timeline = project(sections, {}, index);
  assert.deepEqual(kinds(timeline, 1), ["parts"]);
  assert.deepEqual(rows(timeline), ["one", "two"]);
  assert.deepEqual(cards(timeline).map((card) => card.taskId), ["first"]);
  // Delimiter-containing identifiers cannot collide across teams/tasks.
  const a = index.cardsByMessageId.get("first")[0];
  index.cardsByMessageId.set("first", [{ ...a, teamSessionId: "team", taskId: "a:b" }]);
  index.cardsByMessageId.set("duplicate", [{ ...a, teamSessionId: "team:a", taskId: "b" }]);
  assert.equal(cards(project(sections, {}, index)).length, 2);
});

test("joining attaches to cards last or gets a trailing empty cards segment", () => {
  const source = activity([create("a")]);
  const merged = project([{ parts: [source] }], { joining: true });
  assert.equal(merged.sections[0].length, 1);
  assert.equal(merged.sections[0][0].joining, true);
  const trailing = project([{ parts: [source, narration("tail")] }], { joining: true });
  assert.deepEqual(kinds(trailing), ["cards", "parts", "cards"]);
  assert.deepEqual(trailing.sections[0][2].cards, []);
  assert.equal(trailing.sections[0][2].joining, true);
  const emptySection = project([{ parts: [source] }, { parts: [] }], { joining: true });
  assert.deepEqual(kinds(emptySection, 1), ["cards"]);
});

test("only the true last part is active and cards or joining tails never animate earlier parts", () => {
  const source = activity([item("thinking", "head"), create("a")]);
  assert.equal(project([{ parts: [source] }], { active: true }).activePart, undefined);
  const tail = narration("tail");
  assert.equal(project([{ parts: [source, tail] }], { active: true }).activePart, tail);
  assert.equal(project([{ parts: [source, tail] }]).activePart, undefined);
  assert.equal(project([{ parts: [source, tail] }], { active: true, joining: true }).activePart, undefined);
  assert.equal(project([{ parts: [source, tail] }, { parts: [] }], { active: true }).activePart, undefined);
});

test("head pieces end at their next anchor and the last tail keeps the original end", () => {
  const a = create("a");
  const b = create("longer-anchor");
  const source = activity([item("thinking", "head"), a, item("thinking", "middle"), b, item("thinking", "tail")]);
  const timeline = project([{ parts: [source] }]);
  assert.deepEqual(timeline.parts.map((part) => part.endedAt), [a.message.createdAt, b.message.createdAt, source.endedAt]);
});

test("unchanged pieces retain identity and keys while tail items append", () => {
  const source = activity([item("thinking", "head"), create("a"), item("thinking", "tail")]);
  const untouched = activity([item("thinking", "other")]);
  const sections = [{ parts: [untouched, source] }];
  const first = project(sections);
  const second = project(sections);
  assert.equal(first.parts[0], untouched);
  first.parts.forEach((part, position) => assert.equal(part, second.parts[position]));
  source.items.push(item("tool", "append", { toolName: "Read" }));
  const third = project(sections);
  assert.equal(third.parts[0], first.parts[0]);
  assert.equal(third.parts[1], first.parts[1]);
  assert.notEqual(third.parts[2], first.parts[2]);
  assert.deepEqual(third.sections[0].map((segment) => segment.key), first.sections[0].map((segment) => segment.key));
});

test("plan sections stay aligned and flatten only projected parts in order", () => {
  const plain = narration("plain");
  const sections = [
    { parts: [plain, activity([create("a")])] },
    { parts: [] },
    { parts: [activity([create("b"), item("thinking", "tail")]), narration("answer")] },
  ];
  const timeline = project(sections, { active: true });
  assert.equal(timeline.sections.length, 3);
  assert.deepEqual(timeline.sections[1], []);
  assert.deepEqual(rows(timeline), ["plain", "tail", "answer"]);
  assert.deepEqual(timeline.parts, timeline.sections.flat().flatMap((segment) => segment.kind === "parts" ? segment.parts : []));
  assert.equal(timeline.activePart, sections[2].parts[1]);
});

test("generated batches preserve all non-anchor rows, unique cards and nonempty groups", () => {
  const alphabet = ["anchor", "tool", "thinking", "hostedSearch"];
  for (let length = 1; length <= 5; length++) {
    for (let encoded = 0; encoded < alphabet.length ** length; encoded++) {
      let value = encoded;
      const items = Array.from({ length }, (_, position) => {
        const kind = alphabet[value % alphabet.length];
        value = Math.floor(value / alphabet.length);
        return kind === "anchor" ? create(`anchor-${position}`) : item(kind, `${kind}-${position}`);
      });
      const source = activity(items);
      const sections = [{ parts: [source] }];
      const index = indexFor(sections);
      const timeline = project(sections, {}, index);
      if (!items.some((row) => index.cardsByMessageId.has(row.message.id))) {
        assert.equal(timeline, null);
        continue;
      }
      assert.deepEqual(rows(timeline), items.filter((row) => !index.cardsByMessageId.has(row.message.id)).map((row) => row.message.id));
      assert.deepEqual(cards(timeline).map((card) => card.taskId), items.filter((row) => index.cardsByMessageId.has(row.message.id)).map((row) => row.message.id));
      for (const segment of timeline.sections[0]) {
        if (segment.kind !== "parts") continue;
        assert.ok(segment.parts.length > 0);
        for (const part of segment.parts) assert.ok(part.kind !== "activity" || part.items.length > 0);
      }
      assert.equal(new Set(timeline.sections[0].map((segment) => segment.key)).size, timeline.sections[0].length);
    }
  }
});

test("defensive message anchors preserve the message and emit its cards immediately after it", () => {
  const anchored = { kind: "message", message: create("message-anchor").message };
  const after = narration("after");
  const timeline = project([{ parts: [anchored, after] }]);
  assert.deepEqual(kinds(timeline), ["parts", "cards", "parts"]);
  assert.equal(timeline.parts[0], anchored);
  assert.equal(timeline.parts[1], after);
  assert.equal(cards(timeline)[0].firstCreateMessageId, "message-anchor");
});
