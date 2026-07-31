// Narrower dock: the default opens a third slimmer than the original 420px, and
// the floor scales with it so that default stays reachable.
export const WORK_PANEL_MIN_WIDTH = 244;
export const WORK_PANEL_DEFAULT_WIDTH = 280;
export const WORK_PANEL_MAX_WIDTH = 720;
export const MAIN_PANE_MIN_WIDTH = 360;

export type WorkPanelResizeGesture = {
  startClientX: number;
  startWidth: number;
};

export function workPanelWidthLimits() {
  return {
    min: WORK_PANEL_MIN_WIDTH,
    max: WORK_PANEL_MAX_WIDTH,
  };
}

export function clampWorkPanelWidth(width: number) {
  const limits = workPanelWidthLimits();
  return Math.max(limits.min, Math.min(limits.max, width));
}

export function workPanelWidthFromPointer(
  gesture: WorkPanelResizeGesture,
  clientX: number,
) {
  return clampWorkPanelWidth(
    gesture.startWidth + gesture.startClientX - clientX,
  );
}

export function committedWorkPanelWidth(
  gesture: WorkPanelResizeGesture,
  previewWidth: number,
  commit: boolean,
) {
  if (!commit || previewWidth === gesture.startWidth) return null;
  return previewWidth;
}
