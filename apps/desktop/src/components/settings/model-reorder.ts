/** Drag payload so a drop can recover the source if React state lags. */
export const MODEL_REORDER_MIME = "application/x-pi-desktop-model";

export type ReorderPlacement = "before" | "after";

export type DropTarget = { id: string; placement: ReorderPlacement };

/** Upper half including the midpoint inserts before; below the midpoint inserts after. */
export function dropPlacement(
  clientY: number,
  targetTop: number,
  targetHeight: number,
): ReorderPlacement {
  return clientY > targetTop + targetHeight / 2 ? "after" : "before";
}

/** Adjacent *visible* row for ArrowUp / ArrowDown; hidden filter matches stay put. */
export function visibleNeighborMove<T extends { id: string }>(
  visible: T[],
  id: string,
  direction: "up" | "down",
): { targetId: string; placement: ReorderPlacement } | null {
  const index = visible.findIndex((model) => model.id === id);
  if (index < 0) return null;
  const target = visible[index + (direction === "down" ? 1 : -1)];
  if (!target) return null;
  return {
    targetId: target.id,
    placement: direction === "down" ? "after" : "before",
  };
}

export function sameDropTarget(
  current: DropTarget | null,
  next: DropTarget | null,
): boolean {
  return current?.id === next?.id && current?.placement === next?.placement;
}

/** Move one binding without rebuilding it or dropping models hidden by a filter. */
export function reorderModel<T extends { id: string }>(
  models: T[],
  sourceId: string,
  targetId: string,
  placement: ReorderPlacement,
): T[] {
  const sourceIndex = models.findIndex((model) => model.id === sourceId);
  const targetIndex = models.findIndex((model) => model.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return models;

  const insertionIndex =
    targetIndex + (placement === "after" ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
  if (insertionIndex === sourceIndex) return models;
  const next = [...models];
  const [binding] = next.splice(sourceIndex, 1);
  next.splice(insertionIndex, 0, binding);
  return next;
}
