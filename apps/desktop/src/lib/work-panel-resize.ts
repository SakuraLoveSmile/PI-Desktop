// Preserve the original 320px tool-content minimum beside the 44px activity rail.
export const WORK_PANEL_MIN_WIDTH = 364;
export const WORK_PANEL_DEFAULT_WIDTH = 420;
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
