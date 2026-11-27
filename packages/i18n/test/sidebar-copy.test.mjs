import assert from "node:assert/strict";
import { test } from "vitest";
import { catalogs, en, flattenCatalog, zhCN } from "../src/index.ts";

const english = flattenCatalog(en);
const chinese = flattenCatalog(zhCN);

test("sidebar permission and update copy is translated, not an English fallback", () => {
  assert.equal(english["nav.sessionPermission"], "Permission required");
  assert.equal(chinese["nav.sessionPermission"], "等待授权");
  assert.equal(english["nav.updateReady"], "v{{version}} available");
  assert.equal(chinese["nav.updateReady"], "可更新到 v{{version}}");
});

test("every shipped catalog carries both sidebar keys", () => {
  for (const [id, catalog] of Object.entries(catalogs)) {
    const flat = flattenCatalog(catalog);
    assert.ok(flat["nav.sessionPermission"], `${id} nav.sessionPermission`);
    assert.ok(flat["nav.updateReady"], `${id} nav.updateReady`);
  }
});
