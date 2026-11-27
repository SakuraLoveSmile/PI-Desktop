import type { SessionTodo, TodoStatus } from "@pi-desktop/shared";

/** One todo as a row: the status picks the glyph, the content is the todo line itself. */
export type TodoRailRow = {
  /** Stable across a reorder of the same todos, and unique inside one snapshot. */
  key: string;
  content: string;
  status: TodoStatus;
  /** Catalog key of the status word; the row keeps it for its title and accessible text. */
  statusLabelKey: string;
};

export type TodoRailProgress = { completed: number; cancelled: number; total: number };

/**
 * Cancelled todos keep their row but leave the count, so "done / left to do" never counts work that was dropped.
 * This is the rule the Overview checklist already shows, kept here so every todo surface counts the same way.
 */
export function todoRailProgress(todos: readonly SessionTodo[]): TodoRailProgress {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const cancelled = todos.filter((todo) => todo.status === "cancelled").length;
  return { completed, cancelled, total: todos.length - cancelled };
}

/** Every todo becomes a row; nothing is truncated, because the list is the session's own plan. */
export function todoRailRows(todos: readonly SessionTodo[]): TodoRailRow[] {
  return todos.map((todo, index) => ({
    key: `${index}:${todo.content}`,
    content: todo.content,
    status: todo.status,
    statusLabelKey: `chat.todo.status.${todo.status}`,
  }));
}
