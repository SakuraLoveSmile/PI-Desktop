import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  IconBot,
  IconCheck,
  IconChevronLeft,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconTarget,
  IconUsers,
  IconX,
} from "../icons";
import { TooltipButton } from "../ui";
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
  contextKind?: string;
  avatarIcon?: "bot" | "target" | "users";
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
  onRetry?: () => void;
};

const NODE_WIDTH = 260;
const NODE_HEIGHT = 90;
const GAP_X = 24;
const VERTICAL_SEPARATION = 80;
const ROW_GAP = 36;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

export function AgentPanorama({
  title,
  rootNode,
  childNodes,
  onBack,
  onSelectNode,
  emptyMessage,
  loading = false,
  error = null,
  onRetry,
}: AgentPanoramaProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Layout calculation
  const layout = useMemo(() => {
    const cols = Math.max(1, Math.min(childNodes.length, 3));
    const gridWidth = cols * NODE_WIDTH + (cols - 1) * GAP_X;
    const totalWidth = Math.max(NODE_WIDTH, gridWidth);

    const rootX = (totalWidth - NODE_WIDTH) / 2;
    const rootY = 40;

    const childrenPositions = childNodes.map((child, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const countInThisRow = Math.min(3, childNodes.length - row * 3);
      const rowWidth = countInThisRow * NODE_WIDTH + (countInThisRow - 1) * GAP_X;
      const rowStartX = (totalWidth - rowWidth) / 2;
      const x = rowStartX + col * (NODE_WIDTH + GAP_X);
      const y = rootY + NODE_HEIGHT + VERTICAL_SEPARATION + row * (NODE_HEIGHT + ROW_GAP);
      return { id: child.id, x, y };
    });

    const totalHeight =
      childNodes.length === 0
        ? rootY + NODE_HEIGHT + 40
        : (childrenPositions[childrenPositions.length - 1]?.y ?? rootY) + NODE_HEIGHT + 40;

    return {
      totalWidth,
      totalHeight,
      root: { x: rootX, y: rootY },
      children: childrenPositions,
    };
  }, [childNodes]);

  // Fit view inside container
  const handleFit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth, clientHeight } = el;
    if (clientWidth <= 0 || clientHeight <= 0) return;

    const padding = 48;
    const availableWidth = clientWidth - padding * 2;
    const availableHeight = clientHeight - padding * 2;

    const scaleX = availableWidth / layout.totalWidth;
    const scaleY = availableHeight / layout.totalHeight;
    const targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(scaleX, scaleY)));

    const scaledWidth = layout.totalWidth * targetZoom;
    const scaledHeight = layout.totalHeight * targetZoom;

    const centerX = Math.max(0, (clientWidth - scaledWidth) / 2);
    const centerY = Math.max(0, (clientHeight - scaledHeight) / 2);

    setZoom(targetZoom);
    setPan({ x: centerX, y: centerY });
  }, [layout]);

  // Reset to 100%
  const handleReset = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const { clientWidth } = el;
    const centerX = Math.max(0, (clientWidth - layout.totalWidth) / 2);
    setZoom(1);
    setPan({ x: centerX, y: 40 });
  }, [layout]);

  // Fit on first render or size change
  useEffect(() => {
    handleFit();
  }, [handleFit]);

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

  // Background pointer dragging for pan
  const handlePointerDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Only pan on primary button and direct background click (not on nodes or buttons)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".agent-panorama-node") || target.closest(".agent-panorama-toolbar")) {
      return;
    }

    setIsPanning(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!isPanning || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    dragStartRef.current = null;
  };

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(1)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(1)));

  const renderStatusBadge = (status: PanoramaNodeStatus) => {
    const statusLabels: Record<PanoramaNodeStatus, string> = {
      running: t("team.phase.running", { defaultValue: "Running" }),
      completed: t("team.phase.completed", { defaultValue: "Completed" }),
      failed: t("team.phase.failed", { defaultValue: "Failed" }),
      paused: t("team.pausedBadge", { defaultValue: "Paused" }),
      idle: t("team.phase.idle", { defaultValue: "Idle" }),
      todo: t("team.taskStatus.pending", { defaultValue: "Pending" }),
      blocked: t("team.readiness.blocked", { defaultValue: "Blocked" }),
    };

    return (
      <span className={`agent-panorama-status-badge status-${status}`}>
        {status === "completed" && <IconCheck size={12} aria-hidden />}
        {status === "failed" && <IconX size={12} aria-hidden />}
        <span>{statusLabels[status] ?? status}</span>
      </span>
    );
  };

  const renderNodeIcon = (avatarIcon?: "bot" | "target" | "users") => {
    if (avatarIcon === "target") return <IconTarget size={18} />;
    if (avatarIcon === "users") return <IconUsers size={18} />;
    return <IconBot size={18} />;
  };

  if (loading) {
    return (
      <div className="agent-panorama agent-panorama-loading" data-testid="agent-panorama">
        <div className="agent-panorama-state-center">
          <IconRefresh className="animate-spin" size={24} />
          <span>{t("common.loading", { defaultValue: "Loading..." })}</span>
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
            <button type="button" className="agent-panorama-btn" onClick={onRetry}>
              {t("team.retry", { defaultValue: "Retry" })}
            </button>
          )}
        </div>
      </div>
    );
  }

  const rootCenterX = layout.root.x + NODE_WIDTH / 2;
  const rootBottomY = layout.root.y + NODE_HEIGHT;

  return (
    <div
      ref={containerRef}
      className={`agent-panorama ${isPanning ? "is-panning" : ""}`}
      data-testid="agent-panorama"
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      role="region"
      aria-label={title || t("team.panoramaTitle", { defaultValue: "Agent Panorama" })}
      tabIndex={0}
    >
      {/* Top right toolbar */}
      <div className="agent-panorama-toolbar">
        {onBack && (
          <TooltipButton
            type="button"
            className="icon-btn"
            tooltip={t("team.back", { defaultValue: "Back" })}
            ariaLabel={t("team.back", { defaultValue: "Back" })}
            onClick={onBack}
          >
            <IconChevronLeft size={16} />
            <span className="text-sm">{t("team.back", { defaultValue: "Back" })}</span>
          </TooltipButton>
        )}
        <div className="agent-panorama-zoom-controls">
          <TooltipButton
            type="button"
            className="icon-btn icon-btn-square"
            tooltip={t("team.zoomOut", { defaultValue: "Zoom out" })}
            ariaLabel={t("team.zoomOut", { defaultValue: "Zoom out" })}
            disabled={zoom <= MIN_ZOOM}
            onClick={zoomOut}
          >
            <IconMinus size={14} />
          </TooltipButton>
          <span className="agent-panorama-zoom-label">{Math.round(zoom * 100)}%</span>
          <TooltipButton
            type="button"
            className="icon-btn icon-btn-square"
            tooltip={t("team.zoomIn", { defaultValue: "Zoom in" })}
            ariaLabel={t("team.zoomIn", { defaultValue: "Zoom in" })}
            disabled={zoom >= MAX_ZOOM}
            onClick={zoomIn}
          >
            <IconPlus size={14} />
          </TooltipButton>
          <TooltipButton
            type="button"
            className="agent-panorama-text-btn"
            tooltip={t("team.zoomFit", { defaultValue: "Fit" })}
            ariaLabel={t("team.zoomFit", { defaultValue: "Fit" })}
            onClick={handleFit}
          >
            {t("team.zoomFit", { defaultValue: "Fit" })}
          </TooltipButton>
          <TooltipButton
            type="button"
            className="agent-panorama-text-btn"
            tooltip={t("team.zoomReset", { defaultValue: "Reset" })}
            ariaLabel={t("team.zoomReset", { defaultValue: "Reset" })}
            onClick={handleReset}
          >
            {t("team.zoomReset", { defaultValue: "Reset" })}
          </TooltipButton>
        </div>
      </div>

      {/* Stage */}
      <div
        className="agent-panorama-stage"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          width: `${layout.totalWidth}px`,
          height: `${layout.totalHeight}px`,
        }}
      >
        {/* SVG Connectors */}
        <svg
          className="agent-panorama-edges-layer"
          width={layout.totalWidth}
          height={layout.totalHeight}
          aria-hidden="true"
        >
          {layout.children.map((childPos) => {
            const childCenterX = childPos.x + NODE_WIDTH / 2;
            const childTopY = childPos.y;
            const midY = (rootBottomY + childTopY) / 2;
            const d = `M ${rootCenterX} ${rootBottomY} C ${rootCenterX} ${midY}, ${childCenterX} ${midY}, ${childCenterX} ${childTopY}`;
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
        >
          <div className="agent-panorama-node-header">
            <span className="agent-panorama-node-avatar" aria-hidden="true">
              {renderNodeIcon(rootNode.avatarIcon)}
            </span>
            <div className="agent-panorama-node-copy">
              <span className="agent-panorama-node-title" title={rootNode.name}>
                {rootNode.name}
              </span>
              {rootNode.task && (
                <span className="agent-panorama-node-task" title={rootNode.task}>
                  {rootNode.task}
                </span>
              )}
            </div>
          </div>
          <div className="agent-panorama-node-status">
            {renderStatusBadge(rootNode.status)}
          </div>
        </div>

        {/* Child Nodes */}
        {childNodes.map((child, index) => {
          const pos = layout.children[index];
          if (!pos) return null;
          return (
            <div
              key={child.id}
              className={`agent-panorama-node status-${child.status} ${onSelectNode ? "is-clickable" : ""}`}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
              }}
              data-node-id={child.id}
              role={onSelectNode ? "button" : undefined}
              tabIndex={onSelectNode ? 0 : undefined}
              onClick={() => onSelectNode?.(child.id)}
              onKeyDown={(e) => {
                if (onSelectNode && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelectNode(child.id);
                }
              }}
            >
              <div className="agent-panorama-node-header">
                <span className="agent-panorama-node-avatar" aria-hidden="true">
                  {renderNodeIcon(child.avatarIcon)}
                </span>
                <div className="agent-panorama-node-copy">
                  <span className="agent-panorama-node-title" title={child.name}>
                    {child.name}
                  </span>
                  {child.task && (
                    <span className="agent-panorama-node-task" title={child.task}>
                      {child.task}
                    </span>
                  )}
                </div>
              </div>
              <div className="agent-panorama-node-status">
                {renderStatusBadge(child.status)}
                {child.contextKind && (
                  <span className="agent-panorama-node-context">
                    {t(`team.context.${child.contextKind}`, { defaultValue: child.contextKind })}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {childNodes.length === 0 && emptyMessage && (
          <div
            className="agent-panorama-empty-note"
            style={{
              transform: `translate(${layout.root.x}px, ${layout.root.y + NODE_HEIGHT + 32}px)`,
              width: `${NODE_WIDTH}px`,
            }}
          >
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
