import assert from "node:assert/strict";
import test from "node:test";
import { capSidebarEntries } from "../src/features/sidebar/sidebar-list-cap.ts";

const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));

test("project history shows ten top-level rows and counts the rest", () => {
  const entries = rows(12);
  const page = capSidebarEntries(entries, 10, false);
  assert.deepEqual(page.visible.map((entry) => entry.id), entries.slice(0, 10).map((entry) => entry.id));
  assert.equal(page.hiddenCount, 2);
});

test("standalone history shows five top-level rows and counts the rest", () => {
  const entries = rows(7);
  const page = capSidebarEntries(entries, 5, false);
  assert.equal(page.visible.length, 5);
  assert.equal(page.hiddenCount, 2);
});

test("expanded history shows every row and hides none", () => {
  const entries = rows(12);
  const page = capSidebarEntries(entries, 10, true);
  assert.equal(page.visible.length, 12);
  assert.equal(page.hiddenCount, 0);
});

test("a list shorter than the cap hides nothing", () => {
  const entries = rows(3);
  const page = capSidebarEntries(entries, 10, false);
  assert.equal(page.visible.length, 3);
  assert.equal(page.hiddenCount, 0);
});
