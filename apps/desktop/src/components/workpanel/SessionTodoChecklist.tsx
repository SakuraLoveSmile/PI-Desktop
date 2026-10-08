import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionTodo, TodoStatus } from "@pi-desktop/shared";
import { useSessionTodosRecovery } from "../../features/chat/todos/useSessionTodosRecovery";
import { useAppStore } from "../../stores/app-store";
import { Button } from "../ui";
import { IconCheck, IconChevronDown } from "../icons";

function statusSymbol(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "◐";
    case "cancelled":
      return "⊘";
    default:
      return "○";
  }
}

export function SessionTodoChecklist({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useAppStore((state) => state.sessionTodos[sessionId]);
  const [expanded, setExpanded] = useState(true);
  const listId = useId();

  useSessionTodosRecovery(sessionId);
  if (!snapshot || snapshot.todos.length === 0) return null;

  const completed = snapshot.todos.filter((todo) => todo.status === "completed").length;
  const cancelled = snapshot.todos.filter((todo) => todo.status === "cancelled").length;
  const total = snapshot.todos.length - cancelled;
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
          {snapshot.todos.map((todo, index) => (
            <TodoRow key={`${index}:${todo.content}`} todo={todo} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TodoRow({ todo }: { todo: SessionTodo }) {
  const { t } = useTranslation();
  const label = t(`chat.todo.status.${todo.status}`);
  return (
    <li className={`session-todo-checklist-row session-todo-checklist-row-${todo.status}`}>
      <span className="session-todo-checklist-symbol" aria-hidden>
        {todo.status === "completed" ? <IconCheck size={13} /> : statusSymbol(todo.status)}
      </span>
      <span className="session-todo-checklist-copy">
        <span className="session-todo-checklist-content">{todo.content}</span>
        <span className="session-todo-checklist-status">{label}</span>
      </span>
    </li>
  );
}
