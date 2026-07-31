import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_PANEL_DEFAULT_WIDTH,
  WORK_PANEL_MAX_WIDTH,
  WORK_PANEL_MIN_WIDTH,
  clampWorkPanelWidth,
  committedWorkPanelWidth,
  workPanelWidthFromPointer,
  workPanelWidthLimits,
} from "../src/lib/work-panel-resize.ts";

test("clamps the work panel to its fixed width range", () => {
  assert.deepEqual(workPanelWidthLimits(), {
    min: WORK_PANEL_MIN_WIDTH,
    max: WORK_PANEL_MAX_WIDTH,
  });
  assert.equal(clampWorkPanelWidth(900), WORK_PANEL_MAX_WIDTH);
  assert.equal(clampWorkPanelWidth(500), 500);
  assert.equal(clampWorkPanelWidth(200), WORK_PANEL_MIN_WIDTH);
});

test("anchors pointer resizing to the width at gesture start", () => {
  const gesture = { startClientX: 800, startWidth: WORK_PANEL_DEFAULT_WIDTH };

  assert.equal(
    workPanelWidthFromPointer(gesture, 800),
    WORK_PANEL_DEFAULT_WIDTH,
  );
  assert.equal(
    workPanelWidthFromPointer(gesture, 720),
    WORK_PANEL_DEFAULT_WIDTH + 80,
  );
  assert.equal(
    workPanelWidthFromPointer(gesture, 900),
    WORK_PANEL_MIN_WIDTH,
  );
});

test("pointer resizing respects the fixed panel limits", () => {
  const gesture = { startClientX: 800, startWidth: WORK_PANEL_DEFAULT_WIDTH };

  assert.equal(workPanelWidthFromPointer(gesture, 300), WORK_PANEL_MAX_WIDTH);
  assert.equal(workPanelWidthFromPointer(gesture, 900), WORK_PANEL_MIN_WIDTH);
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
