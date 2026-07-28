// Preserve the original 320px tool-content minimum beside the 44px activity rail.
export const WORK_PANEL_MIN_WIDTH = 364;
export const WORK_PANEL_DEFAULT_WIDTH = 420;
export const WORK_PANEL_MAX_WIDTH = 720;
export const WORK_PANEL_MAX_WIDTH_RATIO = 0.6;
export const MAIN_PANE_MIN_WIDTH = 360;

export type WorkPanelWidthContext = {
  viewportWidth: number;
  sidebarWidth: number;
};

export type WorkPanelResizeGesture = {
  startClientX: number;
  startWidth: number;
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

export function workPanelWidthFromPointer(
  gesture: WorkPanelResizeGesture,
  clientX: number,
  context: WorkPanelWidthContext,
) {
  return clampWorkPanelWidth(
    gesture.startWidth + gesture.startClientX - clientX,
    context,
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
