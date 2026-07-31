import assert from "node:assert/strict";
import test from "node:test";
import {
  baseWindowBounds,
  displayWorkAreaKey,
  emptyWorkPanelReservationState,
  parseWorkPanelReservationWidth,
  planWorkPanelReservation,
  reconcileBaseWindowBounds,
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
    baseBounds: base,
    workArea,
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
    baseBounds: base,
    workArea,
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
  const closed = planWorkPanelReservation({
    baseBounds: base,
    workArea,
    requestedWidth: 0,
  });

  assert.deepEqual(closed, {
    bounds: base,
    reservation: emptyWorkPanelReservationState(),
  });
});

test("native resizing changes the base chat width without changing the panel reservation", () => {
  const base = { x: 700, y: 80, width: 1000, height: 800 };
  const opened = planWorkPanelReservation({
    baseBounds: base,
    workArea,
    requestedWidth: 420,
  });
  const nativelyResizedBounds = {
    ...opened.bounds,
    width: opened.bounds.width + 150,
  };

  const resizedBase = reconcileBaseWindowBounds({
    baseBounds: base,
    lastAppliedBounds: opened.bounds,
    currentBounds: nativelyResizedBounds,
    displayChanged: false,
  });
  assert.deepEqual(resizedBase, { x: 700, y: 80, width: 1150, height: 800 });

  const replanned = planWorkPanelReservation({
    baseBounds: resizedBase,
    workArea,
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
    baseBounds: base,
    workArea: constrainedWorkArea,
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
    baseBounds: { x: 700, y: 80, width: 1000, height: 800 },
    workArea,
    requestedWidth: 420,
  });
  const repeated = planWorkPanelReservation({
    baseBounds: baseWindowBounds(opened.bounds, opened.reservation),
    workArea,
    requestedWidth: 420,
  });

  assert.deepEqual(repeated, opened);
});

test("display reconciliation preserves base bounds after the OS adjusts outer bounds", () => {
  const base = { x: 100, y: 80, width: 1200, height: 800 };
  const opened = planWorkPanelReservation({
    baseBounds: base,
    workArea,
    requestedWidth: 420,
  });
  const osAdjustedBounds = { x: 0, y: 40, width: 1440, height: 760 };
  const preservedBase = reconcileBaseWindowBounds({
    baseBounds: base,
    lastAppliedBounds: opened.bounds,
    currentBounds: osAdjustedBounds,
    displayChanged: true,
  });
  const constrained = planWorkPanelReservation({
    baseBounds: preservedBase,
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
    requestedWidth: 420,
  });
  const restored = planWorkPanelReservation({
    baseBounds: preservedBase,
    workArea,
    requestedWidth: 420,
  });

  assert.deepEqual(preservedBase, base);
  assert.equal(constrained.reservation.width, 240);
  assert.equal(restored.reservation.width, 420);
  assert.deepEqual(baseWindowBounds(constrained.bounds, constrained.reservation), base);
  assert.deepEqual(baseWindowBounds(restored.bounds, restored.reservation), base);
});

test("same-display native move and left-edge resize update persistent base bounds", () => {
  const base = { x: 100, y: 80, width: 1000, height: 800 };
  const opened = planWorkPanelReservation({
    baseBounds: base,
    workArea,
    requestedWidth: 420,
  });
  const movedAndResized = {
    x: opened.bounds.x + 50,
    y: opened.bounds.y + 20,
    width: opened.bounds.width - 50,
    height: opened.bounds.height + 40,
  };

  assert.deepEqual(
    reconcileBaseWindowBounds({
      baseBounds: base,
      lastAppliedBounds: opened.bounds,
      currentBounds: movedAndResized,
      displayChanged: false,
    }),
    { x: 150, y: 100, width: 950, height: 840 },
  );
});

test("same-display observation uses the last actual outer bounds as its baseline", () => {
  const base = { x: 100, y: 80, width: 1200, height: 800 };
  const constrainedActual = { x: 0, y: 40, width: 1440, height: 760 };
  const userResized = { ...constrainedActual, width: 1490 };

  assert.deepEqual(
    reconcileBaseWindowBounds({
      baseBounds: base,
      lastAppliedBounds: constrainedActual,
      currentBounds: userResized,
      displayChanged: false,
    }),
    { x: 100, y: 80, width: 1250, height: 800 },
  );
});

test("reservation width parsing rejects coerced and malformed IPC input", () => {
  assert.equal(parseWorkPanelReservationWidth({ width: 0 }), 0);
  assert.equal(parseWorkPanelReservationWidth({ width: 244 }), 244);
  assert.equal(parseWorkPanelReservationWidth({ width: 720 }), 720);

  for (const input of [
    null,
    undefined,
    false,
    [],
    {},
    { width: "420" },
    { width: false },
    { width: 243 },
    { width: 720.5 },
    { width: 721 },
    { width: Number.NaN },
    { width: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(parseWorkPanelReservationWidth(input), null);
  }
});
