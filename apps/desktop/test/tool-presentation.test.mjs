import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The module imports its siblings the bundler way (`./tool-display`).
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  buildDiffLines,
  buildToolPresentation,
  hasToolDetails,
  langForPath,
  toolResultChips,
  toolResultPayload,
} = await import("../src/lib/tool-presentation.ts");

/** A host tool result as pi-ai delivers it: structured details plus text echo. */
function envelope(details) {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

const roles = (blocks) => blocks.map((block) => block.role);
const byRole = (blocks, role) => blocks.find((block) => block.role === role);

test("unwraps the pi-ai envelope exactly once", () => {
  const details = { path: "a.ts", content: "line\n", root: "workspace" };
  assert.deepEqual(toolResultPayload({ toolResult: envelope(details) }), details);
  // No details: the joined content text is the payload, not the wrapper.
  assert.equal(
    toolResultPayload({
      toolResult: { content: [{ type: "text", text: "plain" }] },
    }),
    "plain",
  );
  // Imported sessions store the result as a plain string.
  assert.equal(toolResultPayload({ toolResult: "raw output" }), "raw output");
  // Nothing but the plain-text mirror.
  assert.equal(toolResultPayload({ content: "mirror" }), "mirror");
  assert.equal(toolResultPayload({}), undefined);
});

test("Read renders file content as code with a path-derived language", () => {
  const blocks = buildToolPresentation(
    {
      toolName: "Read",
      toolArgs: { path: "src/App.tsx" },
      toolResult: envelope({
        path: "src/App.tsx",
        root: "workspace",
        content: "export const App = () => null;\n",
        truncated: false,
      }),
    },
    { hideSummaryArg: true },
  );
  assert.deepEqual(roles(blocks), ["content"]);
  const content = blocks[0];
  assert.equal(content.kind, "code");
  assert.equal(content.lang, "tsx");
  assert.equal(content.highlight, true);
  assert.equal(content.text, "export const App = () => null;\n");
});

test("Write shows the written content and a size chip", () => {
  const message = {
    toolName: "Write",
    toolArgs: { path: "notes.md", content: "# Title\n" },
    toolResult: envelope({ path: "notes.md", root: "workspace", bytes: 2048 }),
  };
  const blocks = buildToolPresentation(message, { hideSummaryArg: true });
  assert.deepEqual(roles(blocks), ["written"]);
  assert.equal(blocks[0].lang, "md");
  assert.deepEqual(toolResultChips(message), [
    { role: "size", text: "2.0 KB" },
  ]);
});

test("Edit diffs the replacement only when no review card owns it", () => {
  const args = {
    path: "src/main.ts",
    old_string: "const a = 1;\nconst b = 2;",
    new_string: "const a = 1;\nconst b = 3;",
  };
  const scratch = buildToolPresentation({
    toolName: "Edit",
    toolArgs: args,
    toolResult: envelope({ path: "src/main.ts", root: "scratch", replacements: 1 }),
  });
  const diff = byRole(scratch, "diff");
  assert.ok(diff, "scratch edits render their own diff");
  assert.deepEqual(
    diff.lines.map((line) => `${line.type}:${line.text}`),
    ["context:const a = 1;", "del:const b = 2;", "add:const b = 3;"],
  );
  assert.equal(diff.hidden, 0);
  assert.equal(diff.copy, " const a = 1;\n-const b = 2;\n+const b = 3;");

  // A workspace edit with a review snapshot: ReviewChangeCard owns the diff.
  const reviewed = buildToolPresentation({
    role: "tool",
    toolName: "Edit",
    toolStatus: "success",
    toolArgs: args,
    toolResult: envelope({
      path: "src/main.ts",
      root: "workspace",
      replacements: 1,
      review: {
        version: 1,
        snapshotId: "snap-1",
        messageId: "msg-1",
        path: "src/main.ts",
        status: "modified",
        operation: "edit",
        state: "active",
        additions: 1,
        deletions: 1,
        hunks: [],
      },
    }),
  });
  assert.equal(byRole(reviewed, "diff"), undefined);
});

test("Bash keeps command, stdout and stderr apart and badges the exit code", () => {
  const message = {
    toolName: "Bash",
    toolArgs: { command: "pnpm test" },
    toolResult: envelope({
      exitCode: 1,
      stdout: "3 passing\n",
      stderr: "1 failing\n",
      truncated: true,
    }),
  };
  const blocks = buildToolPresentation(message, { hideSummaryArg: true });
  assert.deepEqual(roles(blocks), ["command", "stdout", "stderr"]);
  assert.equal(byRole(blocks, "command").lang, "bash");
  assert.equal(byRole(blocks, "stderr").tone, "error");
  assert.equal(byRole(blocks, "stdout").tone, undefined);
  assert.deepEqual(toolResultChips(message), [
    { role: "exit", count: 1 },
    { role: "truncated" },
  ]);
});

test("a clean run omits empty channels and the exit chip", () => {
  const message = {
    toolName: "Bash",
    toolArgs: { command: "true" },
    toolResult: envelope({ exitCode: 0, stdout: "", stderr: "" }),
  };
  assert.deepEqual(roles(buildToolPresentation(message)), ["command"]);
  assert.deepEqual(toolResultChips(message), []);
});

test("Glob lists files and Grep groups hits by path", () => {
  const glob = {
    toolName: "Glob",
    toolArgs: { pattern: "src/**/*.ts" },
    toolResult: envelope({ matches: ["src/a.ts", "src/b.ts"], count: 2 }),
  };
  const globBlocks = buildToolPresentation(glob, { hideSummaryArg: true });
  assert.deepEqual(roles(globBlocks), ["files"]);
  assert.deepEqual(globBlocks[0].paths, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(toolResultChips(glob), [{ role: "files", count: 2 }]);

  const grep = {
    toolName: "Grep",
    toolArgs: { pattern: "TODO" },
    toolResult: envelope({
      matches: [
        { path: "src/a.ts", line: 4, text: "// TODO one" },
        { path: "src/a.ts", line: 9, text: "// TODO two" },
        { path: "src/b.ts", line: 1, text: "// TODO three" },
      ],
      count: 3,
    }),
  };
  const grepBlocks = buildToolPresentation(grep, { hideSummaryArg: true });
  assert.deepEqual(roles(grepBlocks), ["matches"]);
  assert.deepEqual(
    grepBlocks[0].groups.map((group) => [group.path, group.lines.length]),
    [
      ["src/a.ts", 2],
      ["src/b.ts", 1],
    ],
  );
  assert.deepEqual(toolResultChips(grep), [{ role: "matches", count: 3 }]);
});

test("a failed tool leads with the error note and keeps the arguments", () => {
  const blocks = buildToolPresentation(
    {
      toolName: "Read",
      toolStatus: "error",
      toolArgs: { path: "missing.ts", limit: 20 },
      toolResult: envelope({ error: "no such file", code: "ENOENT" }),
    },
    { hideSummaryArg: true },
  );
  assert.deepEqual(roles(blocks), ["error", "input"]);
  assert.deepEqual(blocks[0], {
    kind: "note",
    role: "error",
    text: "no such file",
    code: "ENOENT",
  });
  // The path is already the row summary; only the rest is repeated.
  assert.deepEqual(blocks[1].rows, [{ label: "limit", value: "20" }]);
});

test("unknown plugin payloads degrade to fields and labeled blocks, not a blob", () => {
  const blocks = buildToolPresentation({
    toolName: "plugin_issue_tracker_create",
    toolArgs: { title: "Bug" },
    toolResult: envelope({
      id: 41,
      url: "https://example.test/41",
      ok: true,
      body: "line one\nline two",
      nested: { retries: 2 },
    }),
  });
  const fields = byRole(blocks, "details");
  assert.equal(fields.kind, "fields");
  assert.deepEqual(fields.rows, [
    { label: "id", value: "41" },
    { label: "url", value: "https://example.test/41" },
    { label: "ok", value: "true" },
  ]);
  const labeled = blocks.filter((block) => block.label);
  assert.deepEqual(
    labeled.map((block) => [block.label, block.kind, block.lang]),
    [
      ["body", "code", ""],
      ["nested", "code", "json"],
    ],
  );
  // Opaque tools still show what they were called with.
  assert.deepEqual(byRole(blocks, "input").rows, [
    { label: "title", value: "Bug" },
  ]);
});

test("a string result becomes a single output block", () => {
  const blocks = buildToolPresentation({
    toolName: "Skill",
    toolArgs: { skill: "review" },
    toolResult: "loaded review skill",
  });
  const output = byRole(blocks, "output");
  assert.equal(output.kind, "code");
  assert.equal(output.text, "loaded review skill");
  assert.equal(output.highlight, false);
});

test("no known-tool block ever contains pretty-printed JSON of its payload", () => {
  const messages = [
    {
      toolName: "Read",
      toolArgs: { path: "a.ts" },
      toolResult: envelope({ path: "a.ts", content: "x\n", root: "workspace" }),
    },
    {
      toolName: "Bash",
      toolArgs: { command: "ls" },
      toolResult: envelope({ exitCode: 0, stdout: "a\nb\n", stderr: "" }),
    },
    {
      toolName: "Grep",
      toolArgs: { pattern: "x" },
      toolResult: envelope({ matches: [{ path: "a.ts", line: 1, text: "x" }], count: 1 }),
    },
  ];
  for (const message of messages) {
    for (const block of buildToolPresentation(message, { hideSummaryArg: true })) {
      if (block.kind !== "code") continue;
      assert.notEqual(block.lang, "json", `${message.toolName} fell back to JSON`);
      assert.ok(
        !block.text.includes('"content"') && !block.text.includes('"exitCode"'),
        `${message.toolName} leaked the raw payload into a block`,
      );
    }
  }
});

test("lists and diffs report what they hid instead of dropping it", () => {
  const paths = Array.from({ length: 250 }, (_, i) => `src/f${i}.ts`);
  const blocks = buildToolPresentation({
    toolName: "Glob",
    toolArgs: { pattern: "src/**" },
    toolResult: envelope({ matches: paths, count: paths.length }),
  });
  assert.equal(blocks[0].paths.length, 200);
  assert.equal(blocks[0].hidden, 50);

  const oldLines = Array.from({ length: 250 }, (_, i) => `old ${i}`).join("\n");
  const newLines = Array.from({ length: 250 }, (_, i) => `new ${i}`).join("\n");
  const diff = buildToolPresentation({
    toolName: "Edit",
    toolArgs: { path: "big.txt", old_string: oldLines, new_string: newLines },
    toolResult: envelope({ path: "big.txt", root: "scratch", replacements: 1 }),
  })[0];
  assert.equal(diff.lines.length, 400);
  assert.equal(diff.hidden, 100);
  // The copy payload keeps every line, so nothing is lost on copy.
  assert.equal(diff.copy.split("\n").length, 500);
});

test("huge payloads skip syntax highlighting", () => {
  const blocks = buildToolPresentation({
    toolName: "Read",
    toolArgs: { path: "huge.ts" },
    toolResult: envelope({
      path: "huge.ts",
      root: "workspace",
      content: "a".repeat(100_001),
    }),
  });
  assert.equal(blocks[0].highlight, false);
});

test("scratch root is badged so the sandboxed target is visible", () => {
  assert.deepEqual(
    toolResultChips({
      toolName: "Edit",
      toolResult: envelope({ path: "t.txt", root: "scratch", replacements: 2 }),
    }),
    [{ role: "replacements", count: 2 }, { role: "scratch" }],
  );
});

test("hasToolDetails only reports rows that can actually expand", () => {
  assert.equal(hasToolDetails({}), false);
  assert.equal(hasToolDetails({ toolArgs: {} }), false);
  assert.equal(hasToolDetails({ toolResult: envelope({}) }), false);
  assert.equal(hasToolDetails({ toolArgs: { path: "a.ts" } }), true);
  assert.equal(hasToolDetails({ toolResult: "text" }), true);
  assert.equal(hasToolDetails({ content: "mirror" }), true);
});

test("language tags come from the file name, not the payload", () => {
  assert.equal(langForPath("src/App.tsx"), "tsx");
  assert.equal(langForPath("crates/host/src/main.rs"), "rs");
  assert.equal(langForPath("Dockerfile"), "dockerfile");
  assert.equal(langForPath("Makefile"), "makefile");
  assert.equal(langForPath("LICENSE"), "");
  assert.equal(langForPath(null), "");
});

test("diff trims shared context down to the replacement", () => {
  // Identical text carries no add/del line, so the row renders no diff at all.
  assert.ok(
    buildDiffLines("same", "same").every((line) => line.type === "context"),
  );
  assert.deepEqual(
    buildDiffLines("a\nb\nc\nd\ne", "a\nb\nX\nd\ne").map((l) => l.type),
    ["context", "context", "del", "add", "context", "context"],
  );
  assert.equal(
    buildToolPresentation({
      toolName: "Edit",
      toolArgs: { path: "a.ts", old_string: "same", new_string: "same" },
      toolResult: envelope({ path: "a.ts", root: "scratch", replacements: 0 }),
    }).some((block) => block.kind === "diff"),
    false,
  );
});
