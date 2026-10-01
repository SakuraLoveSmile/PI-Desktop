// Planning reference: integrate into AgentPanorama, with memory owned by its
// parent TeamPanel/OverviewTab. No persisted product data is written here.
import { useCallback, useEffect, useLayoutEffect, useRef, useState,
  type RefObject, type PointerEvent as ReactPointerEvent } from "react";

export type Viewport = { zoom: number; x: number; y: number; mode: "fit" | "manual" };
export type Geometry = { width: number; height: number };
const clampZoom = (value: number) => Math.max(0.5, Math.min(1.5, value));
export function fittedViewport(width: number, height: number, geometry: Geometry): Viewport {
  const zoom = clampZoom(Math.min((width - 48) / geometry.width, (height - 84) / geometry.height));
  return { zoom, x: (width - geometry.width * zoom) / 2,
    y: Math.max(64, (height - geometry.height * zoom) / 2), mode: "fit" };
}
export function zoomedViewport(value: Viewport, nextZoom: number, cx: number, cy: number): Viewport {
  const zoom = clampZoom(nextZoom);
  return { zoom, x: cx - (cx - value.x) * zoom / value.zoom,
    y: cy - (cy - value.y) * zoom / value.zoom, mode: "manual" };
}
export function usePanoramaViewport({ scopeKey, geometryKey, geometry, containerRef,
  savedViewport, onSave }: {
  scopeKey: string;
  geometryKey: string;
  geometry: Geometry;
  containerRef: RefObject<HTMLDivElement | null>;
  savedViewport?: Viewport;
  onSave: (scopeKey: string, value: Viewport) => void;
}) {
  const [viewport, setViewport] = useState<Viewport>(savedViewport ?? { zoom: 1, x: 0, y: 0, mode: "fit" });
  const [isPanning, setPanning] = useState(false);
  const current = useRef(viewport);
  const initializedScope = useRef<string | null>(null);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: Viewport } | null>(null);
  const commit = useCallback((value: Viewport) => {
    current.current = value;
    setViewport(value);
    onSave(scopeKey, value);
  }, [onSave, scopeKey]);
  const makeFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || container.clientWidth <= 0 || container.clientHeight <= 0) return undefined;
    return fittedViewport(container.clientWidth, container.clientHeight, geometry);
  }, [containerRef, geometry.width, geometry.height]);

  // Changing status, callback identity or the parent snapshot never resets a
  // scope already initialized. A saved manual view survives detail/back.
  useLayoutEffect(() => {
    if (initializedScope.current === scopeKey) return;
    const active = drag.current;
    drag.current = null;
    const container = containerRef.current;
    if (active && container?.hasPointerCapture(active.pointerId)) {
      container.releasePointerCapture(active.pointerId);
    }
    setPanning(false);
    const initial = savedViewport ?? makeFit();
    if (!initial) return;
    initializedScope.current = scopeKey;
    commit(initial);
  }, [scopeKey, savedViewport, makeFit, commit]);

  // geometryKey includes ordered node IDs and coordinates, never status text.
  // After manual zoom/pan, new nodes and container resizing preserve the view.
  useLayoutEffect(() => {
    if (current.current.mode !== "fit") return;
    const next = makeFit();
    if (next) commit(next);
  }, [geometryKey, makeFit, commit]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (current.current.mode !== "fit") return;
      const next = makeFit();
      if (next) commit(next);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, makeFit, commit]);
  // Observer reinstallation on a real geometry change must not cancel an
  // active drag. Only disposal or a different scope releases its capture.
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      const active = drag.current;
      drag.current = null;
      if (active && container?.hasPointerCapture(active.pointerId)) {
        container.releasePointerCapture(active.pointerId);
      }
    };
  }, [containerRef, scopeKey]);

  const fit = () => { const next = makeFit(); if (next) commit(next); };
  const reset = () => {
    const width = containerRef.current?.clientWidth ?? geometry.width;
    commit({ zoom: 1, x: (width - geometry.width) / 2, y: 64, mode: "manual" });
  };
  const zoomBy = (delta: number) => {
    const container = containerRef.current;
    if (!container) return;
    const next = Math.round((current.current.zoom + delta) * 100) / 100;
    commit(zoomedViewport(current.current, next, container.clientWidth / 2, container.clientHeight / 2));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element &&
      event.target.closest("[data-panorama-node], [data-panorama-toolbar]"))) return;
    const start = { ...current.current, mode: "manual" as const };
    commit(start);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    commit({ ...active.start, x: active.start.x + event.clientX - active.clientX,
      y: active.start.y + event.clientY - active.clientY });
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { viewport, isPanning, fit, reset, zoomBy, onPointerDown, onPointerMove,
    onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onLostPointerCapture: () => { drag.current = null; setPanning(false); } };
}
