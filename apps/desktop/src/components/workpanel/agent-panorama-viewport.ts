import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export type PanoramaViewport = {
  zoom: number;
  x: number;
  y: number;
  mode: "fit" | "manual";
};

export type PanoramaGeometry = { width: number; height: number };
export type PanoramaPosition = { id: string; x: number; y: number };
export type PanoramaLayout = {
  width: number;
  height: number;
  root: PanoramaPosition;
  children: PanoramaPosition[];
  topologyKey: string;
};

export const PANORAMA_NODE_WIDTH = 304;
export const PANORAMA_NODE_HEIGHT = 140;
export const PANORAMA_GAP_X = 24;
export const PANORAMA_ROOT_CHILD_GAP = 80;
export const PANORAMA_ROW_GAP = 32;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

export function createPanoramaLayout(childIds: readonly string[]): PanoramaLayout {
  const columns = Math.max(1, Math.min(childIds.length, 3));
  const width = Math.max(
    PANORAMA_NODE_WIDTH,
    columns * PANORAMA_NODE_WIDTH + (columns - 1) * PANORAMA_GAP_X,
  );
  const root = { id: "root", x: (width - PANORAMA_NODE_WIDTH) / 2, y: 40 };
  const children = childIds.map((id, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const rowCount = Math.min(3, childIds.length - row * 3);
    const rowWidth = rowCount * PANORAMA_NODE_WIDTH + (rowCount - 1) * PANORAMA_GAP_X;
    return {
      id,
      x: (width - rowWidth) / 2 + column * (PANORAMA_NODE_WIDTH + PANORAMA_GAP_X),
      y: root.y + PANORAMA_NODE_HEIGHT + PANORAMA_ROOT_CHILD_GAP +
        row * (PANORAMA_NODE_HEIGHT + PANORAMA_ROW_GAP),
    };
  });
  const height = children.length === 0
    ? root.y + PANORAMA_NODE_HEIGHT + 40
    : children[children.length - 1]!.y + PANORAMA_NODE_HEIGHT + 40;

  return {
    width,
    height,
    root,
    children,
    topologyKey: JSON.stringify({ width, height, root, children }),
  };
}

function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function fittedViewport(
  width: number,
  height: number,
  geometry: PanoramaGeometry,
): PanoramaViewport {
  const zoom = clampZoom(
    Math.min((width - 48) / geometry.width, (height - 84) / geometry.height),
  );
  return {
    zoom,
    x: (width - geometry.width * zoom) / 2,
    y: Math.max(64, (height - geometry.height * zoom) / 2),
    mode: "fit",
  };
}

export function zoomedViewport(
  viewport: PanoramaViewport,
  nextZoom: number,
  centerX: number,
  centerY: number,
): PanoramaViewport {
  const zoom = clampZoom(nextZoom);
  return {
    zoom,
    x: centerX - (centerX - viewport.x) * zoom / viewport.zoom,
    y: centerY - (centerY - viewport.y) * zoom / viewport.zoom,
    mode: "manual",
  };
}

export function pannedViewport(
  viewport: PanoramaViewport,
  deltaX: number,
  deltaY: number,
): PanoramaViewport {
  return { ...viewport, x: viewport.x + deltaX, y: viewport.y + deltaY, mode: "manual" };
}

export function refreshFittedViewport(
  current: PanoramaViewport,
  nextFit: PanoramaViewport,
): PanoramaViewport {
  return current.mode === "fit" ? nextFit : current;
}

export function resetViewport(width: number, geometry: PanoramaGeometry): PanoramaViewport {
  return {
    zoom: 1,
    x: (width - geometry.width) / 2,
    y: 64,
    mode: "manual",
  };
}

type DragState = {
  scopeKey: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  start: PanoramaViewport;
};

export function usePanoramaViewport({
  scopeKey,
  active,
  geometryKey,
  geometry,
  containerRef,
  savedViewport,
  onSave,
}: {
  scopeKey: string;
  active: boolean;
  geometryKey: string;
  geometry: PanoramaGeometry;
  containerRef: RefObject<HTMLDivElement | null>;
  savedViewport?: PanoramaViewport;
  onSave: (scopeKey: string, viewport: PanoramaViewport) => void;
}) {
  const [viewport, setViewport] = useState<PanoramaViewport>(
    savedViewport ?? { zoom: 1, x: 0, y: 0, mode: "fit" },
  );
  const [isPanning, setPanning] = useState(false);
  const current = useRef(viewport);
  const initializedScope = useRef<string | null>(null);
  const previousGeometryKey = useRef(geometryKey);
  const drag = useRef<DragState | null>(null);

  const commit = useCallback((next: PanoramaViewport) => {
    current.current = next;
    setViewport(next);
    onSave(scopeKey, next);
  }, [onSave, scopeKey]);

  const makeFit = useCallback(() => {
    const element = containerRef.current;
    if (!element || element.clientWidth <= 0 || element.clientHeight <= 0 ||
      geometry.width <= 0 || geometry.height <= 0) return undefined;
    return fittedViewport(element.clientWidth, element.clientHeight, geometry);
  }, [containerRef, geometry.width, geometry.height]);

  const initializeScope = useCallback(() => {
    const initial = savedViewport ?? makeFit();
    if (!initial) return false;
    initializedScope.current = scopeKey;
    drag.current = null;
    setPanning(false);
    commit(initial);
    return true;
  }, [commit, makeFit, savedViewport, scopeKey]);

  useLayoutEffect(() => {
    if (!active) {
      setPanning(false);
      return;
    }
    if (initializedScope.current === scopeKey) return;
    const activeDrag = drag.current;
    const container = containerRef.current;
    drag.current = null;
    if (activeDrag && container?.hasPointerCapture(activeDrag.pointerId)) {
      container.releasePointerCapture(activeDrag.pointerId);
    }
    setPanning(false);
    initializeScope();
  }, [active, containerRef, initializeScope, scopeKey]);

  useLayoutEffect(() => {
    if (!active) return;
    const topologyChanged = previousGeometryKey.current !== geometryKey;
    previousGeometryKey.current = geometryKey;
    if (!topologyChanged || initializedScope.current !== scopeKey || current.current.mode !== "fit") return;
    const next = makeFit();
    if (next) commit(refreshFittedViewport(current.current, next));
  }, [active, commit, geometryKey, makeFit, scopeKey]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (initializedScope.current !== scopeKey) {
        initializeScope();
        return;
      }
      if (current.current.mode !== "fit") return;
      const next = makeFit();
      if (next) commit(refreshFittedViewport(current.current, next));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, commit, containerRef, initializeScope, makeFit, scopeKey]);

  useEffect(() => {
    const container = containerRef.current;
    return () => {
      const active = drag.current;
      drag.current = null;
      if (active && container?.hasPointerCapture(active.pointerId)) {
        container.releasePointerCapture(active.pointerId);
      }
    };
  }, [active, containerRef, scopeKey]);

  const fit = useCallback(() => {
    const next = makeFit();
    if (next) commit(next);
  }, [commit, makeFit]);

  const reset = useCallback(() => {
    const width = containerRef.current?.clientWidth ?? geometry.width;
    commit(resetViewport(width, geometry));
  }, [commit, containerRef, geometry]);

  const zoomBy = useCallback((delta: number) => {
    const container = containerRef.current;
    if (!container) return;
    const nextZoom = Math.round((current.current.zoom + delta) * 10) / 10;
    commit(zoomedViewport(
      current.current,
      nextZoom,
      container.clientWidth / 2,
      container.clientHeight / 2,
    ));
  }, [commit, containerRef]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element &&
      event.target.closest("[data-panorama-node], [data-panorama-tool]"))) return;
    const start = { ...current.current, mode: "manual" as const };
    commit(start);
    drag.current = {
      scopeKey,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      start,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }, [commit, scopeKey]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.scopeKey !== scopeKey || active.pointerId !== event.pointerId) return;
    commit(pannedViewport(active.start, event.clientX - active.clientX, event.clientY - active.clientY));
  }, [commit, scopeKey]);

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.scopeKey !== scopeKey || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [scopeKey]);

  const onLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.scopeKey !== scopeKey || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
  }, [scopeKey]);

  return {
    viewport,
    isPanning,
    fit,
    reset,
    zoomBy,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerCancel: endPan,
    onLostPointerCapture,
  };
}
