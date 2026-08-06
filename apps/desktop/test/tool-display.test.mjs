import assert from "node:assert/strict";
import test from "node:test";
import {
  formatToolValue,
  formatToolDuration,
  getToolAction,
  getToolDisplayName,
  getToolSummary,
  getToolSummaryKey,
} from "../src/lib/tool-display.ts";

test("maps built-in tools to concise Codex-style actions", () => {
  assert.equal(getToolAction("Read"), "read");
  assert.equal(getToolAction("list_files"), "list");
  assert.equal(getToolAction("Grep"), "search");
  assert.equal(getToolAction("apply_patch"), "edit");
  assert.equal(getToolAction("exec_command"), "run");
  assert.equal(getToolAction("functions.exec_command"), "run");
  assert.equal(getToolAction("web_search"), "fetch");
  assert.equal(getToolAction("fork"), "fork");
  assert.equal(getToolAction("functions.fork_agent"), "fork");
});

test("delegation is its own action, matched exactly", () => {
  assert.equal(getToolAction("Task"), "delegate");
  assert.equal(getToolAction("functions.subagent"), "delegate");
  // A plugin tool that merely mentions tasks keeps its generic presentation.
  assert.equal(getToolAction("CreateTask"), "use");
  assert.equal(getToolAction("plugin_tasks_list"), "list");
});

test("a delegation row shows its label, and the agent beside it", () => {
  assert.equal(
    getToolSummary("Task", {
      agent: "code-reviewer",
      description: "Review the store",
      task: "Read app-store.ts and report dead branches.",
    }),
    "Review the store",
  );
  assert.equal(
    getToolSummaryKey("Task", { agent: "code-reviewer", task: "..." }),
    "agent",
  );
});

test("builds a single-line bounded hint from the most useful argument", () => {
  assert.equal(
    getToolSummary("Bash", { command: "pnpm test\n  --filter desktop" }),
    "pnpm test --filter desktop",
  );
  assert.equal(
    getToolSummary("Read", { filePath: "/work/src/App.tsx", query: "ignored" }),
    "/work/src/App.tsx",
  );
  assert.ok(
    getToolSummary("custom", { prompt: "x".repeat(300) }).length <= 220,
  );
});

test("reports which argument the row summary already shows", () => {
  assert.equal(getToolSummaryKey("Bash", { command: "ls", timeout: 5 }), "command");
  assert.equal(getToolSummaryKey("Read", { filePath: "/a/b.ts" }), "filePath");
  assert.equal(getToolSummaryKey("Read", { limit: 20 }), null);
  assert.equal(getToolSummaryKey("Read", "not-a-record"), null);
});

test("formats cyclic values without throwing and humanizes plugin names", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(formatToolValue(cyclic), "[object Object]");
  assert.equal(getToolDisplayName("plugin_issue_tracker_create"), "Issue Tracker Create");
});

test("formats processing time in the compact transcript style", () => {
  assert.equal(formatToolDuration(0), "0s");
  assert.equal(formatToolDuration(59.9), "59s");
  assert.equal(formatToolDuration(65), "1m 5s");
});
