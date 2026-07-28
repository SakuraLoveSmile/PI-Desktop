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

export function planWorkPanelReservation({
  bounds,
  workArea,
  reservation,
  requestedWidth,
}: {
  bounds: WindowBounds;
  workArea: WindowBounds;
  reservation: WorkPanelReservationState;
  requestedWidth: number;
}): { bounds: WindowBounds; reservation: WorkPanelReservationState } {
  const base = baseWindowBounds(bounds, reservation);
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
