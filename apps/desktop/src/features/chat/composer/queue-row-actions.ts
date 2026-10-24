import type { QueuedPromptDirection } from "../../../lib/queued-prompts";

/**
 * What one queued row may do, decided from its admission flags alone so the
 * lock rules are testable without the store or the DOM.
 */
export type QueueRowFlags = {
  /** Promoted rows form the queue head and wait for the current task to finish. */
  promoted: boolean;
  /** Pending rows exist only in the renderer until the Host acknowledges them. */
  pending: boolean;
};

export type QueueMenuActionId = "edit" | "moveUp" | "moveDown" | "remove";

export type QueueMenuAction = {
  id: QueueMenuActionId;
  disabled: boolean;
  danger: boolean;
  separatorBefore: boolean;
};

/**
 * The ⋯ menu's rows. The Host owns the place of a promoted row, so edit and
 * moves lock; only removal stays open. A pending row locks all four, which is
 * why its trigger is disabled as well.
 */
export function queueRowMenuActions({ promoted, pending }: QueueRowFlags): QueueMenuAction[] {
  const orderLocked = promoted || pending;
  return [
    { id: "edit", disabled: orderLocked, danger: false, separatorBefore: false },
    { id: "moveUp", disabled: orderLocked, danger: false, separatorBefore: false },
    { id: "moveDown", disabled: orderLocked, danger: false, separatorBefore: false },
    { id: "remove", disabled: pending, danger: true, separatorBefore: true },
  ];
}

export type QueueRowHandlers = {
  edit: (id: string) => void;
  remove: (id: string) => void;
  move: (id: string, direction: QueuedPromptDirection) => Promise<void>;
};

/** Routes one ⋯ menu choice to the handler that owns it. */
export function runQueueRowAction(id: QueueMenuActionId, promptId: string, handlers: QueueRowHandlers): void {
  if (id === "edit") handlers.edit(promptId);
  else if (id === "remove") handlers.remove(promptId);
  else void handlers.move(promptId, id === "moveUp" ? "up" : "down");
}
