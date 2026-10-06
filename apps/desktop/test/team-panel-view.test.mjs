import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requestedView } from "../src/lib/team-panel-view.ts";

test("requested Team view preserves task/member precedence and aggregate fallback", () => {
  assert.deepEqual(requestedView({}), { kind: "aggregate" });
  assert.deepEqual(requestedView({ view: "aggregate" }), { kind: "aggregate" });
  assert.deepEqual(requestedView({ view: "board" }), { kind: "board" });
  assert.deepEqual(requestedView({ view: "task" }), { kind: "aggregate" });
  assert.deepEqual(requestedView({ taskId: "task-1" }), { kind: "task", taskId: "task-1" });
  assert.deepEqual(requestedView({ memberSessionId: "member-1" }), { kind: "member", memberSessionId: "member-1" });
  assert.deepEqual(requestedView({ taskId: "task-1", memberSessionId: "member-1", view: "board" }), { kind: "task", taskId: "task-1" });
  assert.deepEqual(requestedView({ memberSessionId: "member-1", view: "board" }), { kind: "member", memberSessionId: "member-1" });
});

test("TeamPanel uses the same named view input for first render and prop resets", async () => {
  const source = await readFile(new URL("../src/components/workpanel/TeamPanel.tsx", import.meta.url), "utf8");
  assert.equal(source.match(/requestedView\(\{/g)?.length, 2);
  assert.equal(source.match(/taskId: initialTaskId, memberSessionId: initialMemberSessionId, view: initialView/g)?.length, 2);
});
