import assert from "node:assert/strict";
import test from "node:test";
import {
  baseWindowBounds,
  displayWorkAreaKey,
  emptyWorkPanelReservationState,
  planWorkPanelReservation,
} from "../electron/main/work-panel-window.ts";

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

test("display work-area keys change with display geometry", () => {
  assert.equal(displayWorkAreaKey(1, workArea), "1:0:0:1920:1080");
  assert.notEqual(
    displayWorkAreaKey(1, workArea),
    displayWorkAreaKey(1, { ...workArea, width: 1720 }),
  );
  assert.notEqual(displayWorkAreaKey(1, workArea), displayWorkAreaKey(2, workArea));
});

test("reserves the full panel width when the work area has room", () => {
  const base = { x: 100, y: 80, width: 1000, height: 800 };
  const plan = planWorkPanelReservation({
    bounds: base,
    workArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });

  assert.deepEqual(plan, {
    bounds: { x: 100, y: 80, width: 1420, height: 800 },
    reservation: { width: 420, xOffset: 0 },
  });
  assert.deepEqual(baseWindowBounds(plan.bounds, plan.reservation), base);
});

test("moves the window left when the right edge lacks room", () => {
  const base = { x: 700, y: 80, width: 1000, height: 800 };
  const plan = planWorkPanelReservation({
    bounds: base,
    workArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });

  assert.deepEqual(plan, {
    bounds: { x: 500, y: 80, width: 1420, height: 800 },
    reservation: { width: 420, xOffset: -200 },
  });
  assert.deepEqual(baseWindowBounds(plan.bounds, plan.reservation), base);
});

test("releasing a reservation restores the exact base bounds", () => {
  const base = { x: 700, y: 80, width: 1000, height: 800 };
  const opened = planWorkPanelReservation({
    bounds: base,
    workArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });
  const closed = planWorkPanelReservation({
    bounds: opened.bounds,
    workArea,
    reservation: opened.reservation,
    requestedWidth: 0,
  });

  assert.deepEqual(closed, {
    bounds: base,
    reservation: emptyWorkPanelReservationState(),
  });
});

test("native resizing changes the base chat width without changing the panel reservation", () => {
  const opened = planWorkPanelReservation({
    bounds: { x: 700, y: 80, width: 1000, height: 800 },
    workArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });
  const nativelyResizedBounds = {
    ...opened.bounds,
    width: opened.bounds.width + 150,
  };

  assert.deepEqual(
    baseWindowBounds(nativelyResizedBounds, opened.reservation),
    { x: 700, y: 80, width: 1150, height: 800 },
  );

  const replanned = planWorkPanelReservation({
    bounds: nativelyResizedBounds,
    workArea,
    reservation: opened.reservation,
    requestedWidth: 420,
  });

  assert.equal(replanned.reservation.width, 420);
  assert.deepEqual(baseWindowBounds(replanned.bounds, replanned.reservation), {
    x: 700,
    y: 80,
    width: 1150,
    height: 800,
  });
});

test("reserves only the available width when the work area is constrained", () => {
  const constrainedWorkArea = { x: 0, y: 0, width: 1100, height: 900 };
  const base = { x: 0, y: 40, width: 900, height: 800 };
  const plan = planWorkPanelReservation({
    bounds: base,
    workArea: constrainedWorkArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });

  assert.deepEqual(plan, {
    bounds: { x: 0, y: 40, width: 1100, height: 800 },
    reservation: { width: 200, xOffset: 0 },
  });
  assert.deepEqual(baseWindowBounds(plan.bounds, plan.reservation), base);
});

test("planning the current reservation is idempotent", () => {
  const opened = planWorkPanelReservation({
    bounds: { x: 700, y: 80, width: 1000, height: 800 },
    workArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });
  const repeated = planWorkPanelReservation({
    bounds: opened.bounds,
    workArea,
    reservation: opened.reservation,
    requestedWidth: 420,
  });

  assert.deepEqual(repeated, opened);
});

test("reconciling across constrained and roomy displays preserves base bounds", () => {
  const base = { x: 700, y: 80, width: 1000, height: 800 };
  const opened = planWorkPanelReservation({
    bounds: base,
    workArea,
    reservation: emptyWorkPanelReservationState(),
    requestedWidth: 420,
  });
  const constrained = planWorkPanelReservation({
    bounds: opened.bounds,
    workArea: { x: 0, y: 0, width: 1200, height: 900 },
    reservation: opened.reservation,
    requestedWidth: 420,
  });
  const restored = planWorkPanelReservation({
    bounds: constrained.bounds,
    workArea,
    reservation: constrained.reservation,
    requestedWidth: 420,
  });

  assert.equal(constrained.reservation.width, 200);
  assert.equal(restored.reservation.width, 420);
  assert.deepEqual(baseWindowBounds(constrained.bounds, constrained.reservation), base);
  assert.deepEqual(baseWindowBounds(restored.bounds, restored.reservation), base);
});
