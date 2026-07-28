import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_PANE_MIN_WIDTH,
  WORK_PANEL_MAX_WIDTH,
  WORK_PANEL_MIN_WIDTH,
  clampWorkPanelWidth,
  createProgrammaticWindowResizeAttributor,
  rightWindowEdgeDelta,
  userRightEdgeDelta,
  workPanelWidthLimits,
} from "../src/lib/work-panel-resize.ts";

test("clamps the work panel against its cap and the readable main pane", () => {
  assert.deepEqual(
    workPanelWidthLimits({ viewportWidth: 1200, sidebarWidth: 240 }),
    { min: WORK_PANEL_MIN_WIDTH, max: 600 },
  );
  assert.equal(
    clampWorkPanelWidth(900, { viewportWidth: 1600, sidebarWidth: 240 }),
    WORK_PANEL_MAX_WIDTH,
  );
  assert.equal(
    clampWorkPanelWidth(500, {
      viewportWidth: 1100,
      sidebarWidth: 320,
    }),
    1100 - 320 - MAIN_PANE_MIN_WIDTH,
  );
  assert.equal(
    clampWorkPanelWidth(500, {
      viewportWidth: 1000,
      sidebarWidth: 320,
    }),
    WORK_PANEL_MIN_WIDTH,
  );
});

test("attributes only right-edge movement to the right work panel", () => {
  const initial = { x: 100, width: 1200 };
  const rightExpanded = { x: 100, width: 1320 };
  const leftExpanded = { x: -20, width: 1320 };

  assert.equal(rightWindowEdgeDelta(initial, rightExpanded), 120);
  assert.equal(rightWindowEdgeDelta(initial, leftExpanded), 0);
  assert.equal(userRightEdgeDelta(120, 120, 120), 120);
  assert.equal(userRightEdgeDelta(120, 0, 120), 0);
});

test("removes programmatic window growth before allocating user drag delta", () => {
  const attribution = createProgrammaticWindowResizeAttributor();
  const ticket = attribution.begin(100);
  attribution.settle(ticket, 100);

  const userDelta = attribution.consume(140);
  assert.equal(userDelta, 40);
  assert.equal(userRightEdgeDelta(140, 140, userDelta), 40);
});

test("handles resize events that arrive before the IPC result", () => {
  const attribution = createProgrammaticWindowResizeAttributor();
  const ticket = attribution.begin(120);

  assert.equal(attribution.consume(80), 0);
  attribution.settle(ticket, 80);
  assert.equal(attribution.consume(20), 20);
});

test("attributes programmatic window shrink in the negative direction", () => {
  const attribution = createProgrammaticWindowResizeAttributor();
  const ticket = attribution.begin(-100);
  attribution.settle(ticket, -60);

  assert.equal(attribution.consume(-60), 0);
  assert.equal(attribution.consume(-20), -20);
});
