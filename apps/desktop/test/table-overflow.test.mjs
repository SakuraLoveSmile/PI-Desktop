import assert from "node:assert/strict";
import test from "node:test";
import { tableOverflowState } from "../src/lib/table-overflow.ts";

test("a table that fits reports no overflow edge", () => {
  assert.equal(
    tableOverflowState({ scrollLeft: 0, scrollWidth: 320, clientWidth: 320 }),
    "none",
  );
  assert.equal(
    tableOverflowState({ scrollLeft: 0, scrollWidth: 320.4, clientWidth: 320 }),
    "none",
  );
});

test("the fade points at the edge that still hides content", () => {
  assert.equal(
    tableOverflowState({ scrollLeft: 0, scrollWidth: 640, clientWidth: 320 }),
    "end",
  );
  assert.equal(
    tableOverflowState({ scrollLeft: 320, scrollWidth: 640, clientWidth: 320 }),
    "start",
  );
  assert.equal(
    tableOverflowState({ scrollLeft: 160, scrollWidth: 640, clientWidth: 320 }),
    "both",
  );
});

test("subpixel scroll offsets do not flicker the edge state", () => {
  assert.equal(
    tableOverflowState({ scrollLeft: 0.4, scrollWidth: 640, clientWidth: 320 }),
    "end",
  );
  assert.equal(
    tableOverflowState({ scrollLeft: 319.6, scrollWidth: 640, clientWidth: 320 }),
    "start",
  );
});
