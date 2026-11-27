import assert from "node:assert/strict";
import test from "node:test";
import { collapsedProjectStatus } from "../src/lib/sidebar-session-status.ts";

const ids = ["a", "b", "c"];

test("a folded project with quiet children shows no hint", () => {
  assert.equal(
    collapsedProjectStatus(ids, () => false, () => false),
    null,
  );
});

test("one running child raises the running hint", () => {
  assert.equal(
    collapsedProjectStatus(ids, (id) => id === "b", () => false),
    "running",
  );
});

test("one pending approval raises the permission hint", () => {
  assert.equal(
    collapsedProjectStatus(ids, () => false, (id) => id === "c"),
    "permission",
  );
});

test("a pending approval outranks running work", () => {
  assert.equal(
    collapsedProjectStatus(ids, () => true, (id) => id === "c"),
    "permission",
  );
});

test("an empty project stays quiet", () => {
  assert.equal(collapsedProjectStatus([], () => true, () => true), null);
});
