import assert from "node:assert/strict";
import test from "node:test";

import { queueRowMenuActions, runQueueRowAction } from "../src/features/chat/composer/queue-row-actions.ts";

const byId = (actions) => Object.fromEntries(actions.map((action) => [action.id, action]));

test("a waiting row can edit, move and remove from its menu", () => {
  const actions = byId(queueRowMenuActions({ promoted: false, pending: false }));
  for (const id of ["edit", "moveUp", "moveDown", "remove"]) {
    assert.equal(actions[id].disabled, false, id);
  }
  assert.equal(actions.remove.danger, true);
});

test("a promoted head keeps only removal open, because the Host owns its place", () => {
  const actions = byId(queueRowMenuActions({ promoted: true, pending: false }));
  assert.equal(actions.edit.disabled, true);
  assert.equal(actions.moveUp.disabled, true);
  assert.equal(actions.moveDown.disabled, true);
  assert.equal(actions.remove.disabled, false);
});

test("a pending row locks every menu action until the Host acknowledges admission", () => {
  const actions = queueRowMenuActions({ promoted: false, pending: true });
  assert.ok(actions.every((action) => action.disabled), "every action is locked while saving");
});

test("removal alone starts a separated danger group", () => {
  const actions = queueRowMenuActions({ promoted: false, pending: false });
  assert.deepEqual(
    actions.filter((action) => action.separatorBefore).map((action) => action.id),
    ["remove"],
  );
});

test("each menu choice reaches the handler that owns it", () => {
  const calls = [];
  const handlers = {
    edit: (id) => calls.push(["edit", id]),
    remove: (id) => calls.push(["remove", id]),
    move: async (id, direction) => {
      calls.push([direction, id]);
    },
  };
  runQueueRowAction("edit", "a", handlers);
  runQueueRowAction("remove", "b", handlers);
  runQueueRowAction("moveUp", "c", handlers);
  runQueueRowAction("moveDown", "d", handlers);
  assert.deepEqual(calls, [
    ["edit", "a"],
    ["remove", "b"],
    ["up", "c"],
    ["down", "d"],
  ]);
});
