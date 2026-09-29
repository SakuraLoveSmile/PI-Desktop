export type PluginViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Convert renderer CSS pixels to the DIPs expected by WebContentsView. */
export function scaleBoundsToDip(
  bounds: PluginViewBounds,
  zoomFactor: number,
): PluginViewBounds {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: Math.max(0, Math.round((Number(bounds.x) || 0) * zoom)),
    y: Math.max(0, Math.round((Number(bounds.y) || 0) * zoom)),
    width: Math.max(0, Math.round((Number(bounds.width) || 0) * zoom)),
    height: Math.max(0, Math.round((Number(bounds.height) || 0) * zoom)),
  };
}
