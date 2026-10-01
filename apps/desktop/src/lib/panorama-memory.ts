import type { PanoramaViewport } from "../components/workpanel/agent-panorama-viewport";

// Session UI state only. Scope keys include the source/Host identity, never title.
const viewports = new Map<string, PanoramaViewport>();
export function getPanoramaViewport(scopeKey: string): PanoramaViewport | undefined {
  return viewports.get(scopeKey);
}
export function savePanoramaViewport(scopeKey: string, viewport: PanoramaViewport): void {
  viewports.set(scopeKey, viewport);
}
export function clearPanoramaViewport(scopeKey: string): void {
  viewports.delete(scopeKey);
}
