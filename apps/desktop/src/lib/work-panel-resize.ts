export const WORK_PANEL_MIN_WIDTH = 320;
export const WORK_PANEL_DEFAULT_WIDTH = 420;
export const WORK_PANEL_MAX_WIDTH = 720;
export const WORK_PANEL_MAX_WIDTH_RATIO = 0.6;
export const MAIN_PANE_MIN_WIDTH = 360;

export type WorkPanelWidthContext = {
  viewportWidth: number;
  sidebarWidth: number;
};

export type WindowHorizontalGeometry = {
  x: number;
  width: number;
};

export function workPanelWidthLimits({
  viewportWidth,
  sidebarWidth,
}: WorkPanelWidthContext) {
  const mainPaneSafeMax = Math.floor(
    viewportWidth - sidebarWidth - MAIN_PANE_MIN_WIDTH,
  );
  return {
    min: WORK_PANEL_MIN_WIDTH,
    max: Math.max(
      WORK_PANEL_MIN_WIDTH,
      Math.min(
        WORK_PANEL_MAX_WIDTH,
        Math.floor(viewportWidth * WORK_PANEL_MAX_WIDTH_RATIO),
        mainPaneSafeMax,
      ),
    ),
  };
}

export function clampWorkPanelWidth(
  width: number,
  context: WorkPanelWidthContext,
) {
  const limits = workPanelWidthLimits(context);
  return Math.max(limits.min, Math.min(limits.max, width));
}

export function rightWindowEdgeDelta(
  previous: WindowHorizontalGeometry,
  next: WindowHorizontalGeometry,
) {
  return next.x + next.width - (previous.x + previous.width);
}

export function userRightEdgeDelta(
  viewportDelta: number,
  rightEdgeDelta: number,
  unattributedViewportDelta: number,
) {
  if (
    viewportDelta === 0 ||
    unattributedViewportDelta === 0 ||
    Math.sign(viewportDelta) !== Math.sign(unattributedViewportDelta)
  ) {
    return 0;
  }
  const userShare = Math.min(
    1,
    Math.abs(unattributedViewportDelta / viewportDelta),
  );
  return rightEdgeDelta * userShare;
}

type ResizeTicket = {
  requested: number;
  remaining: number;
  expiresAt: number;
};

export function createProgrammaticWindowResizeAttributor() {
  const pending: ResizeTicket[] = [];

  const purge = () => {
    const now = Date.now();
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].expiresAt <= now || pending[index].remaining === 0) {
        pending.splice(index, 1);
      }
    }
  };

  const begin = (requested: number) => {
    purge();
    const ticket: ResizeTicket = {
      requested,
      remaining: requested,
      expiresAt: Date.now() + 1000,
    };
    if (requested !== 0) pending.push(ticket);
    return ticket;
  };

  const settle = (ticket: ResizeTicket, applied: number) => {
    const index = pending.indexOf(ticket);
    if (index < 0) return;
    const consumed = ticket.requested - ticket.remaining;
    const remaining = applied - consumed;
    if (
      remaining === 0 ||
      Math.sign(remaining) !== Math.sign(ticket.requested)
    ) {
      pending.splice(index, 1);
      return;
    }
    ticket.remaining = remaining;
    ticket.expiresAt = Date.now() + 1000;
  };

  const consume = (viewportDelta: number) => {
    purge();
    let unclaimed = viewportDelta;
    for (const ticket of pending) {
      if (
        unclaimed === 0 ||
        Math.sign(unclaimed) !== Math.sign(ticket.remaining)
      ) {
        continue;
      }
      const claimed =
        Math.sign(unclaimed) *
        Math.min(Math.abs(unclaimed), Math.abs(ticket.remaining));
      ticket.remaining -= claimed;
      unclaimed -= claimed;
    }
    purge();
    return unclaimed;
  };

  return { begin, settle, consume };
}

export const workPanelWindowResizeAttributor =
  createProgrammaticWindowResizeAttributor();
