import { readComposerSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "node:module";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { resolveComposerPlaceholder } = await import("../src/features/chat/composer/model.ts");

const placeholderInput = {
  variant: "docked",
  index: 0,
  runActive: false,
  hasDraft: false,
  enterToSend: true,
  platform: "darwin",
};

test("idle placeholders keep each context's stable index and fallback", () => {
  for (const [variant, keys] of [
    ["home", ["chat.placeholderHome", "chat.placeholderHomeHint", "chat.placeholderShortcut"]],
    ["docked", ["chat.placeholder", "chat.placeholderHint", "chat.placeholderShortcut"]],
  ]) {
    for (const index of [0, 1, 2, 3, 7, -1]) {
      const input = { ...placeholderInput, variant, index };
      const expected = keys[index % keys.length] ?? keys[0];
      assert.equal(resolveComposerPlaceholder(input).key, expected);
      assert.deepEqual(resolveComposerPlaceholder(input), resolveComposerPlaceholder(input));
    }
  }
});

test("an active run with an empty draft teaches follow-up and immediate steering in both contexts", () => {
  for (const variant of ["home", "docked"]) {
    assert.deepEqual(resolveComposerPlaceholder({ ...placeholderInput, variant, index: 2, runActive: true }), {
      key: "chat.placeholderRunning",
      sendShortcut: "Enter",
      steerShortcut: "⌥Enter",
    });
  }
});

test("a running text or file-reference draft retains the selected idle guidance", () => {
  const reference = { id: "file-1", sessionId: "session-1", path: "/tmp/report.md", name: "report.md", kind: "file" };
  for (const draft of [
    { value: "continue", references: [] },
    { value: "", references: [reference] },
  ]) {
    const hasDraft = Boolean(draft.value.trim() || draft.references.length);
    assert.equal(resolveComposerPlaceholder({ ...placeholderInput, index: 1, runActive: true, hasDraft }).key, "chat.placeholderHint");
  }
});

test("running guidance follows the platform and Enter-to-send preference", () => {
  for (const [platform, sendShortcut, steerShortcut] of [
    ["darwin", "⌘Enter", "⌥Enter"],
    ["win32", "Ctrl+Enter", "Alt+Enter"],
    ["linux", "Ctrl+Enter", "Alt+Enter"],
  ]) {
    assert.deepEqual(resolveComposerPlaceholder({ ...placeholderInput, runActive: true, platform, enterToSend: false }), {
      key: "chat.placeholderRunning", sendShortcut, steerShortcut,
    });
    assert.deepEqual(resolveComposerPlaceholder({ ...placeholderInput, runActive: true, platform, enterToSend: true }), {
      key: "chat.placeholderRunning", sendShortcut: "Enter", steerShortcut,
    });
  }
});

test("clearing a running draft restores guidance without changing its idle index", () => {
  const input = { ...placeholderInput, variant: "home", index: 1, runActive: true };
  assert.equal(resolveComposerPlaceholder({ ...input, hasDraft: true }).key, "chat.placeholderHomeHint");
  assert.equal(resolveComposerPlaceholder(input).key, "chat.placeholderRunning");
  assert.equal(resolveComposerPlaceholder({ ...input, runActive: false }).key, "chat.placeholderHomeHint");
});

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [composer, composerStyles, english, chinese, builtinCommands] =
  await Promise.all([
    readComposerSource(),
    read("../src/styles/composer.css"),
    read("../../../packages/i18n/src/locales/en/index.ts"),
    read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
    read("../electron/main/builtin-commands.ts"),
  ]);

test("composer keeps placeholder guidance stable within a page and session", () => {
  assert.doesNotMatch(composer, /PLACEHOLDER_CAROUSEL_INTERVAL_MS/);
  assert.doesNotMatch(composer, /window\.setInterval/);
  assert.doesNotMatch(composer, /placeholderPaused|placeholderFocusPauseReleasedRef/);
  assert.match(composer, /PLACEHOLDER_KEYS =/);
  assert.match(composer, /chat\.placeholderShortcut/);
  assert.match(composer, /placeholderContextRef/);
  assert.match(composer, /activeSessionId \?\? HOME_DRAFT_KEY/);
  assert.match(composer, /setPlaceholderIndex/);
  assert.match(composer, /\}, \[activeSessionId, variant\]\);/);
  assert.match(composer, /placeholder=\{placeholderText\}/);
  assert.match(composer, /className="composer-placeholder"/);
});

test("placeholder changes fade without duplicating the native accessible value", () => {
  assert.match(composerStyles, /\.composer-input-stage\s*\{/);
  assert.match(composerStyles, /\.composer-placeholder\s*\{/);
  assert.match(composerStyles, /animation:\s*composer-placeholder-fade-in/);
  assert.match(composerStyles, /@keyframes composer-placeholder-fade-in/);
  assert.match(composerStyles, /opacity:\s*0\s*!important/);
});

test("both shipped locales provide welcome, command, file, and shortcut guidance", () => {
  assert.match(english, /placeholderHint:\s*"Type \/ for commands · @ for files"/);
  assert.match(english, /placeholderHomeHint:\s*"Type \/ for commands · @ for files"/);
  assert.match(english, /placeholderShortcut:\s*"Shift\+Enter for newline · Use Send to submit"/);
  assert.match(chinese, /placeholderHint:\s*"输入 \/ 使用命令 · @ 引用文件"/);
  assert.match(chinese, /placeholderHomeHint:\s*"输入 \/ 使用命令 · @ 引用文件"/);
  assert.match(chinese, /placeholderShortcut:\s*"Shift\+Enter 换行 · 点击发送提交"/);
});

test("the slash hint keeps the core session command aliases available", () => {
  for (const alias of ["new", "compact", "agent-mode", "plan-mode", "goal-mode"]) {
    assert.match(builtinCommands, new RegExp(`slash: "${alias}"`), alias);
  }
});
