import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import type { ModelBinding } from "@pi-desktop/shared";
import {
  MODEL_REORDER_MIME,
  dropPlacement,
  reorderModel,
  sameDropTarget,
  visibleNeighborMove,
  type DropTarget,
} from "./model-reorder";

/** Dragging previews a destination; only dropping or an arrow key edits the draft. */
export function useModelReorder(
  visibleModels: ModelBinding[],
  setModels: (update: (current: ModelBinding[]) => ModelBinding[]) => void,
  busy: boolean,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const disabled = busy || visibleModels.length < 2;

  const clearDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  useEffect(() => {
    if (disabled || !visibleModels.some((model) => model.id === draggingId)) {
      setDraggingId(null);
      setDropTarget(null);
    }
  }, [disabled, draggingId, visibleModels]);

  const destination = (id: string, clientY: number, element: HTMLElement): DropTarget => {
    const rect = element.getBoundingClientRect();
    return { id, placement: dropPlacement(clientY, rect.top, rect.height) };
  };

  const previewDrop = (id: string, clientY: number, element: HTMLElement) => {
    const next = id === draggingId ? null : destination(id, clientY, element);
    setDropTarget((current) => (sameDropTarget(current, next) ? current : next));
  };

  const rowEvents = (id: string): HTMLAttributes<HTMLLIElement> => ({
    onDragEnter(event) {
      if (disabled || !draggingId) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragOver(event) {
      if (disabled || !draggingId) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      previewDrop(id, event.clientY, event.currentTarget);
    },
    onDragLeave(event) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropTarget((current) => (current?.id === id ? null : current));
      }
    },
    onDrop(event) {
      const sourceId = draggingId || event.dataTransfer.getData(MODEL_REORDER_MIME);
      if (disabled || !sourceId) return;
      event.preventDefault();
      event.stopPropagation();
      const target = destination(id, event.clientY, event.currentTarget);
      setModels((current) => reorderModel(current, sourceId, id, target.placement));
      clearDrag();
    },
  });

  const handleEvents = (id: string): ButtonHTMLAttributes<HTMLButtonElement> => ({
    disabled,
    draggable: !disabled,
    onDragStart(event) {
      if (disabled) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(MODEL_REORDER_MIME, id);
      setDraggingId(id);
      setDropTarget(null);
    },
    onDragEnd: clearDrag,
    onKeyDown(event) {
      if (disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      event.stopPropagation();
      const move = visibleNeighborMove(
        visibleModels,
        id,
        event.key === "ArrowDown" ? "down" : "up",
      );
      if (!move) return;
      setModels((current) => reorderModel(current, id, move.targetId, move.placement));
    },
  });

  return { draggingId, dropTarget, rowEvents, handleEvents };
}
