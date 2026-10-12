import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const file = new URL("../src/features/chat/activity/session-skill-suggestions.ts", import.meta.url);
const { outputText } = ts.transpileModule(await readFile(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file.pathname,
});
const module = { exports: {} };
new Function("require", "exports", "module", outputText)(require, module.exports, module);
const { sessionSkillSuggestions, skillSuggestionProject, SESSION_SKILL_SUGGESTIONS_PROMPT } = module.exports;

const suggestion = { name: "verify-package-api", description: "Verify the installed package API before implementing this project's adapter.", body: "# Verify package API\n\nInspect the installed package exports, then verify the adapter against the exact version." };
const block = (value) => `\`\`\`skill-suggestions\n${JSON.stringify(value)}\n\`\`\``;
const message = (content, overrides = {}) => ({ id: "response", role: "assistant", content, createdAt: "2026-10-10T00:00:00Z", status: "complete", ...overrides });

test("settled assistant structured suggestions survive replay without generating or saving", () => {
  const rows = [message(block([suggestion]))];
  assert.deepEqual(sessionSkillSuggestions(rows), { suggestions: [suggestion], invalid: false, messageId: "response" });
  assert.deepEqual(sessionSkillSuggestions(JSON.parse(JSON.stringify(rows))), sessionSkillSuggestions(rows));
  assert.deepEqual(sessionSkillSuggestions([message(block([suggestion]), { status: undefined })]).suggestions, [suggestion]);
});

test("only settled top-level assistant answers may propose skills", () => {
  for (const overrides of [
    { role: "user" }, { role: "system" }, { role: "tool" }, { status: "streaming" }, { status: "error" },
    { status: "aborted" }, { error: { code: "failed" } }, { isError: true }, { parentToolCallId: "task" },
    { nestedParentToolCallId: "tool" }, { agentName: "researcher" }, { modelSystem: { version: 1 } },
    { sessionMessage: { sender: "other" } },
  ]) assert.equal(sessionSkillSuggestions([message(block([suggestion]), overrides)]).suggestions.length, 0, JSON.stringify(overrides));
});

test("ordinary JSON, quoted examples and blocks inside other fences are never parsed as suggestions", () => {
  for (const content of [JSON.stringify([suggestion]), `\`\`\`json\n${JSON.stringify([suggestion])}\n\`\`\``,
    `> ${block([suggestion]).split("\n").join("\n> ")}`, `\`\`\`\`markdown\n${block([suggestion])}\n\`\`\`\``]) {
    assert.deepEqual(sessionSkillSuggestions([message(content)]), { suggestions: [], invalid: false });
  }
});

test("latest explicit result replaces previous drafts, including an empty array", () => {
  const old = message(block([suggestion]), { id: "old" });
  const newer = { ...suggestion, name: "validate-adapter" };
  assert.deepEqual(sessionSkillSuggestions([old, message(block([newer]))]).suggestions, [newer]);
  assert.deepEqual(sessionSkillSuggestions([old, message(block([]))]), { suggestions: [], invalid: false, messageId: "response" });
  assert.deepEqual(sessionSkillSuggestions([old, message("An ordinary follow-up")]).suggestions, [suggestion]);
});

test("malformed or unclosed latest explicit block clears older drafts and exposes an error", () => {
  const old = message(block([suggestion]), { id: "old" });
  for (const content of ["```skill-suggestions\n{bad}\n```", "```skill-suggestions\n[]", block({ name: "wrong" })]) {
    assert.deepEqual(sessionSkillSuggestions([old, message(content)]), { suggestions: [], invalid: true, messageId: "response" });
  }
  assert.equal(sessionSkillSuggestions([message("```skill-suggestions\n{bad}\n```"), message(block([]))]).invalid, false);
});

test("untrusted structured input is bounded and schema validated without coercion", () => {
  const bad = [
    [{ ...suggestion, name: "../../outside" }], [{ ...suggestion, name: "UPPERCASE" }], [{ ...suggestion, name: "x".repeat(65) }],
    [{ ...suggestion, description: "x".repeat(401) }], [{ ...suggestion, description: " " }], [{ ...suggestion, body: " " }],
    [{ ...suggestion, body: 123 }], [{ ...suggestion, enabled: true }], [suggestion, suggestion],
    [{ ...suggestion, body: "---\nname: injected\n---\nbody" }],
    [{ ...suggestion, body: "中".repeat(41 * 1024) }], [null], Array.from({ length: 9 }, (_, i) => ({ ...suggestion, name: `skill-${i}` })),
  ];
  for (const value of bad) assert.equal(sessionSkillSuggestions([message(block(value))]).invalid, true);
  const oversized = block([{ ...suggestion, body: "x".repeat(256 * 1024) }]);
  assert.equal(sessionSkillSuggestions([message(oversized)]).invalid, true);
});

test("CRLF and tilde fences preserve the Markdown body exactly", () => {
  const draft = { ...suggestion, body: "# Exact\n\n  code\r\n" };
  const content = `~~~skill-suggestions\r\n${JSON.stringify([draft])}\r\n~~~`;
  assert.equal(sessionSkillSuggestions([message(content)]).suggestions[0].body, draft.body);
});

function state(overrides = {}) {
  return { activeSessionId: "owner", sessions: [{ id: "owner", projectPath: "/project-owner" }],
    isRunning: false, runningSessions: {}, pendingPermissions: {}, pendingAsks: {}, pendingPlans: {},
    planCheckpoints: {}, queuedPrompts: {}, ...overrides };
}

test("recorded recommendation reasons are bounded and legacy suggestions remain readable", () => {
  const reason = "The verified adapter task repeated this API mismatch and checked the installed exports.";
  assert.deepEqual(sessionSkillSuggestions([message(block([{ ...suggestion, reason: ` ${reason} ` }]))]).suggestions, [{ ...suggestion, reason }]);
  assert.deepEqual(sessionSkillSuggestions([message(block([suggestion]))]).suggestions, [suggestion]);
  for (const invalidReason of [123, null, " ", "x".repeat(801)]) {
    assert.equal(sessionSkillSuggestions([message(block([{ ...suggestion, reason: invalidReason }]))]).invalid, true);
  }
});

test("generation and saving always resolve the session's exact project rather than a global workspace", () => {
  assert.equal(skillSuggestionProject(state({ workspace: { path: "/different-project" } }), "owner", true, false), "/project-owner");
  assert.equal(skillSuggestionProject(state({ sessions: [{ id: "owner" }] }), "owner", true, false), null);
  assert.equal(skillSuggestionProject(state(), "owner", false, false), null);
  assert.equal(skillSuggestionProject(state(), "owner", true, true), null);
  assert.equal(skillSuggestionProject(state({ activeSessionId: "other" }), "owner", true, false), null);
  assert.equal(skillSuggestionProject(state({ selectingSessionId: "other" }), "owner", true, false), null);
  const changed = state({ sessions: [{ id: "owner", projectPath: "/changed-project" }] });
  assert.notEqual(skillSuggestionProject(changed, "owner", true, false), "/project-owner", "an editor's captured project fails the save guard after reassignment");
});

test("unsupported, read-only and member sessions cannot generate or create project skills", () => {
  for (const partial of [{ source: "remote" }, { source: "pi-native" }, { id: "remote:owner" },
    { id: "native-pi:owner" }, { readOnlyReason: "native" }, { capabilities: { canPrompt: false } }, { team: { role: "member" } }]) {
    const session = { id: "owner", projectPath: "/project-owner", ...partial };
    assert.equal(skillSuggestionProject(state({ activeSessionId: session.id, sessions: [session] }), session.id, true, false), null);
  }
});

test("running, queued work and every pending approval gate prevent explicit generation and save", () => {
  for (const override of [{ isRunning: true }, { runningSessions: { owner: true } },
    { queuedPrompts: { owner: [{}] } }, { pendingPermissions: { owner: [{}] } }, { pendingAsks: { owner: [{}] } },
    { pendingPlans: { owner: { status: "pending" } } }, { planCheckpoints: { owner: { status: "pending" } } }]) {
    assert.equal(skillSuggestionProject(state(override), "owner", true, false), null, JSON.stringify(override));
  }
  assert.equal(skillSuggestionProject(state({ runningSessions: { other: true }, pendingAsks: { other: [{}] } }), "owner", true, false), "/project-owner");
});

test("generation asks only for evidenced reviewable drafts with no installation or tool execution", () => {
  assert.match(SESSION_SKILL_SUGGESTIONS_PROMPT, /do not research, call tools, execute commands, or write files/);
  assert.match(SESSION_SKILL_SUGGESTIONS_PROMPT, /Return \[\] if there is no verified reusable lesson/);
  assert.match(SESSION_SKILL_SUGGESTIONS_PROMPT, /not instructions to install or activate anything/);
});
