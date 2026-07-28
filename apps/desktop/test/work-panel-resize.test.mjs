import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_PANE_MIN_WIDTH,
  WORK_PANEL_MAX_WIDTH,
  WORK_PANEL_MIN_WIDTH,
  clampWorkPanelWidth,
  committedWorkPanelWidth,
  workPanelWidthFromPointer,
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

test("anchors pointer resizing to the width at gesture start", () => {
  const gesture = { startClientX: 800, startWidth: 420 };
  const context = { viewportWidth: 1600, sidebarWidth: 240 };

  assert.equal(workPanelWidthFromPointer(gesture, 800, context), 420);
  assert.equal(workPanelWidthFromPointer(gesture, 720, context), 500);
  assert.equal(
    workPanelWidthFromPointer(gesture, 900, context),
    WORK_PANEL_MIN_WIDTH,
  );
});

test("pointer resizing respects the current layout limits", () => {
  const gesture = { startClientX: 800, startWidth: 420 };
  const context = { viewportWidth: 1200, sidebarWidth: 240 };

  assert.equal(workPanelWidthFromPointer(gesture, 500, context), 600);
  assert.equal(workPanelWidthFromPointer(gesture, 900, context), 364);
});

test("temporary viewport clamping does not overwrite the preferred width", () => {
  const preferredWidth = 700;
  const narrow = { viewportWidth: 1000, sidebarWidth: 320 };
  const restored = { viewportWidth: 1600, sidebarWidth: 240 };

  assert.equal(clampWorkPanelWidth(preferredWidth, narrow), WORK_PANEL_MIN_WIDTH);
  assert.equal(clampWorkPanelWidth(preferredWidth, restored), preferredWidth);
});

test("commits only a changed preview after a completed gesture", () => {
  const gesture = { startClientX: 800, startWidth: WORK_PANEL_MIN_WIDTH };

  assert.equal(
    committedWorkPanelWidth(gesture, WORK_PANEL_MIN_WIDTH, true),
    null,
  );
  assert.equal(committedWorkPanelWidth(gesture, 500, false), null);
  assert.equal(committedWorkPanelWidth(gesture, 500, true), 500);
});
