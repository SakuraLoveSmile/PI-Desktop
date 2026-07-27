import assert from "node:assert/strict";
import test from "node:test";
import {
  formatToolValue,
  formatToolDuration,
  getToolAction,
  getToolDisplayName,
  getToolSections,
  getToolSummary,
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

test("keeps arguments and output as separate inspectable sections", () => {
  assert.deepEqual(
    getToolSections({
      content: "fallback",
      toolArgs: { path: "README.md" },
      toolResult: { ok: true },
    }),
    {
      input: '{\n  "path": "README.md"\n}',
      output: '{\n  "ok": true\n}',
    },
  );
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
