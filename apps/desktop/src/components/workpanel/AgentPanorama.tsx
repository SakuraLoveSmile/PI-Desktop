import {
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import {
  IconCircle, IconCircleCheck, IconCircleDashed, IconCirclePause, IconCircleX,
  IconLoader, IconZoomIn, IconZoomOut, IconScan, IconRefreshCw,
  IconChevronLeft,
  IconRefresh,
  IconX,
} from "../icons";
import { Button, TooltipButton } from "../ui";
import { PixelAvatar } from "./team/PixelAvatar";
import {
  createPanoramaLayout,
  panoramaEdgePath,
  PANORAMA_NODE_HEIGHT,
  PANORAMA_NODE_WIDTH,
  usePanoramaViewport,
  type PanoramaViewport,
} from "./agent-panorama-viewport";
import "../../styles/agent-panorama.css";

export type PanoramaNodeStatus =
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "idle"
  | "todo"
  | "blocked";

export type PanoramaNode = {
  id: string;
  name: string;
  task?: string;
  status: PanoramaNodeStatus;
  statusLabel?: string;
  contextKind?: string;
  avatarIcon?: "bot" | "target" | "users";
  roleLabel?: string;
  avatarSeed?: string;
  isLead?: boolean;
  isRoot?: boolean;
};

export type AgentPanoramaProps = {
  title?: string;
  rootNode: PanoramaNode;
  childNodes: PanoramaNode[];
  onBack?: () => void;
  onSelectNode?: (id: string) => void;
  emptyMessage?: string;
  loading?: boolean;
  error?: string | null;
  staleError?: string | null;
  onRetry?: () => void;
  viewportScopeKey: string;
  savedViewport?: PanoramaViewport;
  onViewportSave: (scopeKey: string, viewport: PanoramaViewport) => void;
};

export function AgentPanorama({
  title,
  rootNode,
  childNodes,
  onBack,
  onSelectNode,
  emptyMessage,
  loading = false,
  error = null,
  staleError = null,
  onRetry,
  viewportScopeKey,
  savedViewport,
  onViewportSave,
}: AgentPanoramaProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const topologyKey = JSON.stringify(childNodes.map(({ id }) => id));
  const layout = useMemo(() => createPanoramaLayout(childNodes.map(({ id }) => id)), [topologyKey]);
  const viewportController = usePanoramaViewport({
    scopeKey: viewportScopeKey,
    active: !loading && !error,
    geometryKey: layout.topologyKey,
    geometry: { width: layout.width, height: layout.height },
    containerRef,
    savedViewport,
    onSave: onViewportSave,
  });
  const { viewport, isPanning, fit, reset, zoomBy } = viewportController;

  // Escape key returns to aggregate view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onBack) {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  const renderStatusBadge = (status: PanoramaNodeStatus, statusLabel?: string) => {
    const statusLabels: Record<PanoramaNodeStatus, string> = {
      running: t("team.phase.running"),
      completed: t("team.phase.completed"),
      failed: t("team.phase.failed"),
      paused: t("team.pausedBadge"),
      idle: t("team.phase.idle"),
      todo: t("team.taskStatus.pending"),
      blocked: t("team.readiness.blocked"),
    };

    const Glyph = {
      running: IconLoader,
      completed: IconCircleCheck,
      failed: IconCircleX,
      paused: IconCirclePause,
      blocked: IconCircleDashed,
      idle: IconCircle,
      todo: IconCircle,
    }[status] ?? IconCircle;

    return (
      <span className={`agent-panorama-status-badge status-${status}`}>
        <Glyph size={12} aria-hidden />
        <span>{statusLabel ?? statusLabels[status] ?? status}</span>
      </span>
    );
  };

  if (loading) {
    return (
      <div className="agent-panorama agent-panorama-loading" data-testid="agent-panorama">
        <div className="agent-panorama-state-center">
          <IconRefresh className="animate-spin" size={24} />
          <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="agent-panorama agent-panorama-error" data-testid="agent-panorama">
        <div className="agent-panorama-state-center">
          <IconX size={24} />
          <span>{error}</span>
          {onRetry && (
            <Button size="sm" className="agent-panorama-btn" onClick={onRetry}>
              {t("team.retry")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const rootCenterX = layout.root.x + PANORAMA_NODE_WIDTH / 2;
  const rootBottomY = layout.root.y + PANORAMA_NODE_HEIGHT;
  const rootIdentity = rootNode.roleLabel
    ? `${rootNode.roleLabel} ${rootNode.name}`
    : rootNode.name;

  return (
    <div
      ref={containerRef}
      className={`agent-panorama ${isPanning ? "is-panning" : ""}`}
      data-testid="agent-panorama"
      data-panorama-canvas
      data-panorama-zoom={viewport.zoom}
      data-panorama-pan-x={viewport.x}
      data-panorama-pan-y={viewport.y}
      onPointerDown={viewportController.onPointerDown}
      onPointerMove={viewportController.onPointerMove}
      onPointerUp={viewportController.onPointerUp}
      onPointerCancel={viewportController.onPointerCancel}
      onLostPointerCapture={viewportController.onLostPointerCapture}
      role="region"
      aria-label={title || t("team.panoramaTitle")}
      tabIndex={0}
    >
      {staleError && (
        <div className="agent-panorama-refresh-error" role="status" data-panorama-tool>
          <span>{t("team.staleData")}: {staleError}</span>
          {onRetry && <Button size="sm" onClick={onRetry}>{t("team.retry")}</Button>}
        </div>
      )}
      {/* Top right toolbar */}
      <div className="agent-panorama-toolbar" data-panorama-toolbar data-panorama-tool>
        {onBack && (
          <>
            <TooltipButton type="button" className="icon-btn icon-btn-square"
              tooltip={t("team.back")} ariaLabel={t("team.back")} onClick={onBack}>
              <IconChevronLeft size={16} aria-hidden />
            </TooltipButton>
            <span className="agent-panorama-toolbar-divider" aria-hidden />
          </>
        )}
        <div className="agent-panorama-zoom-controls">
          <TooltipButton type="button" className="icon-btn icon-btn-square"
            tooltip={t("team.zoomOut")} ariaLabel={t("team.zoomOut")}
            disabled={viewport.zoom <= 0.5} onClick={() => zoomBy(-0.1)}>
            <IconZoomOut size={16} aria-hidden />
          </TooltipButton>
          <span className="agent-panorama-zoom-label">{Math.round(viewport.zoom * 100)}%</span>
          <TooltipButton type="button" className="icon-btn icon-btn-square"
            tooltip={t("team.zoomIn")} ariaLabel={t("team.zoomIn")}
            disabled={viewport.zoom >= 1.5} onClick={() => zoomBy(0.1)}>
            <IconZoomIn size={16} aria-hidden />
          </TooltipButton>
        </div>
        <span className="agent-panorama-toolbar-divider" aria-hidden />
        <TooltipButton type="button" className="icon-btn icon-btn-square"
          tooltip={t("team.zoomFit")} ariaLabel={t("team.zoomFit")} onClick={fit}>
          <IconScan size={16} aria-hidden />
        </TooltipButton>
        <TooltipButton type="button" className="icon-btn icon-btn-square"
          tooltip={t("team.zoomReset")} ariaLabel={t("team.zoomReset")} onClick={reset}>
          <IconRefreshCw size={16} aria-hidden />
        </TooltipButton>
      </div>

      {/* Stage */}
      <div
        className="agent-panorama-stage"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          width: `${layout.width}px`,
          height: `${layout.height}px`,
        }}
        data-panorama-world
      >
        {/* SVG Connectors */}
        <svg
          className="agent-panorama-edges-layer"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.children.map((childPos) => {
            const childCenterX = childPos.x + PANORAMA_NODE_WIDTH / 2;
            const childTopY = childPos.y;
            const d = panoramaEdgePath(rootCenterX, rootBottomY, childCenterX, childTopY);
            return (
              <path
                key={`edge-${childPos.id}`}
                d={d}
                className="agent-panorama-edge"
              />
            );
          })}
        </svg>

        {/* Root Node */}
        <div
          className={`agent-panorama-node agent-panorama-root-node status-${rootNode.status}`}
          style={{
            transform: `translate(${layout.root.x}px, ${layout.root.y}px)`,
          }}
          data-node-id={rootNode.id}
          data-panorama-node
        >
          <span className="agent-panorama-node-header">
            <span className="agent-panorama-node-avatar" aria-hidden="true">
              <PixelAvatar seed={rootNode.avatarSeed ?? rootNode.id} lead={rootNode.isLead} size={32} />
            </span>
            <span className="agent-panorama-node-copy">
              <span className="agent-panorama-node-title" title={rootIdentity}>
                {rootIdentity}
              </span>
              {rootNode.task && (
                <span className="agent-panorama-node-task" title={rootNode.task}>
                  {rootNode.task}
                </span>
              )}
            </span>
          </span>
          <span className="agent-panorama-node-status">
            {renderStatusBadge(rootNode.status, rootNode.statusLabel)}
          </span>
        </div>

        {/* Child Nodes */}
        {childNodes.map((child, index) => {
          const pos = layout.children[index];
          if (!pos) return null;
          const identity = child.roleLabel ? `${child.roleLabel} ${child.name}` : child.name;
          return (
            <Button
              type="button"
              variant="ghost"
              key={child.id}
              className={`agent-panorama-node status-${child.status} ${onSelectNode ? "is-clickable" : ""}`}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
              }}
              data-node-id={child.id}
              data-panorama-node
              disabled={!onSelectNode}
              onClick={() => onSelectNode?.(child.id)}
            >
              <span className="agent-panorama-node-header">
                <span className="agent-panorama-node-avatar" aria-hidden="true">
                  <PixelAvatar seed={child.avatarSeed ?? child.id} lead={child.isLead} size={32} />
                </span>
                <span className="agent-panorama-node-copy">
                  <span className="agent-panorama-node-title" title={identity}>
                    {identity}
                  </span>
                  {child.task && (
                    <span className="agent-panorama-node-task" title={child.task}>
                      {child.task}
                    </span>
                  )}
                </span>
              </span>
              <span className="agent-panorama-node-status">
                {renderStatusBadge(child.status, child.statusLabel)}
              </span>
            </Button>
          );
        })}

        {childNodes.length === 0 && emptyMessage && (
          <div
            className="agent-panorama-empty-note"
            style={{
              transform: `translate(${layout.root.x}px, ${layout.root.y + PANORAMA_NODE_HEIGHT + 32}px)`,
              width: `${PANORAMA_NODE_WIDTH}px`,
            }}
          >
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
