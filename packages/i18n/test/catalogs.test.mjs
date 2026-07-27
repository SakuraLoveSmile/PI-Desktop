import assert from "node:assert/strict";
import test from "node:test";
import {
  en,
  flattenCatalog,
  resolveLocale,
  zhCN,
} from "../dist/index.js";

function placeholders(value) {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();
}

test("shipped catalogs have identical keys and interpolation variables", () => {
  const english = flattenCatalog(en);
  const chinese = flattenCatalog(zhCN);

  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.deepEqual(placeholders(chinese[key]), placeholders(english[key]), key);
  }
});

test("import, project, and temporary-session copy is catalog-backed", () => {
  const english = flattenCatalog(en);
  for (const key of [
    "nav.temporarySessions",
    "nav.newTemporarySession",
    "settings.importGroupByPath",
    "settings.importNoProject",
    "settings.importSourceClaudeCode",
    "project.expandDetails",
    "project.openActions",
    "project.sessions",
  ]) {
    assert.equal(typeof english[key], "string", key);
    assert.notEqual(english[key], "");
  }
});

test("locale resolution maps Chinese variants and falls back to English", () => {
  assert.equal(resolveLocale("zh-CN"), "zh-CN");
  assert.equal(resolveLocale("zh-TW"), "zh-CN");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale(), "en");
});

test("review file counts use locale-aware plural keys", () => {
  const english = flattenCatalog(en);
  const chinese = flattenCatalog(zhCN);

  assert.equal(english["chat.reviewChangedFiles_one"], "1 file");
  assert.equal(english["chat.reviewChangedFiles_other"], "{{count}} files");
  assert.match(english["chat.reviewChangesAccessible_one"], /1 file changed/);
  assert.match(
    english["chat.reviewChangesAccessible_other"],
    /{{count}} files changed/,
  );
  assert.equal(english["panel.review.filesChanged_one"], "1 file changed");
  assert.equal(
    english["panel.review.filesChanged_other"],
    "{{count}} files changed",
  );
  assert.equal(chinese["chat.reviewChangedFiles_one"], "1 个文件");
  assert.equal(
    chinese["chat.reviewChangedFiles_other"],
    "{{count}} 个文件",
  );
});
