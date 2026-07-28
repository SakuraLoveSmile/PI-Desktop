export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkPanelReservationState = {
  width: number;
  xOffset: number;
};

export const WORK_PANEL_MIN_WIDTH = 364;
export const WORK_PANEL_MAX_WIDTH = 720;

export const emptyWorkPanelReservationState = (): WorkPanelReservationState => ({
  width: 0,
  xOffset: 0,
});

export function displayWorkAreaKey(
  displayId: string | number,
  workArea: WindowBounds,
): string {
  return [
    displayId,
    workArea.x,
    workArea.y,
    workArea.width,
    workArea.height,
  ].join(":");
}

export function baseWindowBounds(
  bounds: WindowBounds,
  reservation: WorkPanelReservationState,
): WindowBounds {
  return {
    ...bounds,
    x: bounds.x - reservation.xOffset,
    width: bounds.width - reservation.width,
  };
}

export function reconcileBaseWindowBounds({
  baseBounds,
  lastAppliedBounds,
  currentBounds,
  displayChanged,
}: {
  baseBounds: WindowBounds;
  lastAppliedBounds: WindowBounds;
  currentBounds: WindowBounds;
  displayChanged: boolean;
}): WindowBounds {
  if (displayChanged) return { ...baseBounds };

  return {
    x: baseBounds.x + currentBounds.x - lastAppliedBounds.x,
    y: baseBounds.y + currentBounds.y - lastAppliedBounds.y,
    width: Math.max(
      0,
      baseBounds.width + currentBounds.width - lastAppliedBounds.width,
    ),
    height: Math.max(
      0,
      baseBounds.height + currentBounds.height - lastAppliedBounds.height,
    ),
  };
}

export function planWorkPanelReservation({
  baseBounds,
  workArea,
  requestedWidth,
}: {
  baseBounds: WindowBounds;
  workArea: WindowBounds;
  requestedWidth: number;
}): { bounds: WindowBounds; reservation: WorkPanelReservationState } {
  const base = { ...baseBounds };
  const availableWidth = Math.max(0, workArea.width - base.width);
  const reservedWidth = Math.min(requestedWidth, availableWidth);
  const width = base.width + reservedWidth;
  const workAreaRight = workArea.x + workArea.width;
  const maximumX = workAreaRight - width;
  const x =
    width <= workArea.width
      ? Math.max(workArea.x, Math.min(base.x, maximumX))
      : base.x;

  return {
    bounds: { ...base, x, width },
    reservation: {
      width: reservedWidth,
      xOffset: x - base.x,
    },
  };
}

export function parseWorkPanelReservationWidth(input: unknown): number | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const width = (input as { width?: unknown }).width;
  if (
    typeof width !== "number" ||
    !Number.isInteger(width) ||
    (width !== 0 &&
      (width < WORK_PANEL_MIN_WIDTH || width > WORK_PANEL_MAX_WIDTH))
  ) {
    return null;
  }
  return width;
}
