import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TodoStatus } from "@pi-desktop/shared";
import { useSessionTodosRecovery } from "../../features/chat/todos/useSessionTodosRecovery";
import { todoRailProgress, todoRailRows, type TodoRailRow } from "../../features/chat/todos/todo-rail-rows";
import { useAppStore } from "../../stores/app-store";
import { Button } from "../ui";
import { IconChevronDown, IconCircle, IconCircleCheck, IconCircleSlash } from "../icons";

export function SessionTodoChecklist({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useAppStore((state) => state.sessionTodos[sessionId]);
  const [expanded, setExpanded] = useState(true);
  const listId = useId();

  useSessionTodosRecovery(sessionId);
  if (!snapshot || snapshot.todos.length === 0) return null;

  const { completed, total } = todoRailProgress(snapshot.todos);
  const rows = todoRailRows(snapshot.todos);
  const progressLabel = total === 0
    ? t("chat.todo.status.cancelled")
    : t("chat.todo.progressSummary", { completed, total });
  const current = snapshot.todos.find((todo) => todo.status === "in_progress");
  const statusLabel = total === 0
    ? t("chat.todo.status.cancelled")
    : current
      ? t("chat.todo.current", { completed, total, content: current.content })
      : t("chat.todo.progress", { completed, total });

  return (
    <section
      className="work-panel-overview-section session-todo-checklist"
      data-testid="overview-session-checklist"
    >
      <Button
        type="button"
        variant="ghost"
        className="session-todo-checklist-header"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={total === 0 ? statusLabel : `${progressLabel} · ${statusLabel}`}
        title={statusLabel}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="work-panel-overview-summary-label">{progressLabel}</span>
        <IconChevronDown
          size={16}
          className="work-panel-overview-chevron"
          aria-hidden
        />
      </Button>
      {expanded && (
        <ol
          id={listId}
          className="work-panel-overview-section-body session-todo-checklist-list"
          aria-label={progressLabel}
        >
          {rows.map((row) => (
            <TodoRow key={row.key} row={row} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TodoRow({ row }: { row: TodoRailRow }) {
  const { t } = useTranslation();
  const label = t(row.statusLabelKey);
  return (
    <li className={`session-todo-checklist-row session-todo-checklist-row-${row.status}`} title={label}>
      <span className="session-todo-checklist-symbol" aria-hidden>
        <TodoSymbol status={row.status} />
      </span>
      <span className="session-todo-checklist-copy">
        <span className="session-todo-checklist-content">{row.content}</span>
        {/* Visually hidden: the status stays in the DOM for assistive tech; the row shows the glyph and the title. */}
        <span className="session-todo-checklist-status">{label}</span>
      </span>
    </li>
  );
}

function TodoSymbol({ status }: { status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <IconCircleCheck size={16} />;
    case "cancelled":
      return <IconCircleSlash size={16} />;
    default:
      return <IconCircle size={16} />;
  }
}
