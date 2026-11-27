import { useTranslation } from "react-i18next";
import type { TodoStatus } from "@pi-desktop/shared";
import { IconCircle, IconCircleCheck, IconCircleSlash } from "../../../components/icons";
import { useAppStore } from "../../../stores/app-store";
import { useSessionTodosRecovery } from "../todos/useSessionTodosRecovery";
import { todoRailProgress, todoRailRows } from "../todos/todo-rail-rows";
import { ActivityRailGroup } from "./ActivityRailGroup";

/**
 * The session checklist inside the activity rail: every todo the session recorded, with the status it holds.
 * The rail is the session summary now, so nothing is folded away behind a second surface and nothing is truncated.
 */
export function ActivityTodosSection({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const { t } = useTranslation();
  const snapshot = useAppStore((state) => state.sessionTodos[sessionId]);
  useSessionTodosRecovery(sessionId);
  const todos = snapshot?.todos ?? [];
  if (todos.length === 0) return null;
  const { completed, total } = todoRailProgress(todos);
  const label = t("panel.activity.todos", { completed, total });
  return <ActivityRailGroup sessionId={sessionId} group="todos" sectionHeading trackAttention={visible} label={label}>
    <ol className="session-activity-todos" aria-label={label}>
      {todoRailRows(todos).map((row) => <li key={row.key} className="session-activity-todo" data-todo-status={row.status}
        title={t(row.statusLabelKey)}>
        <span className="session-activity-todo-glyph" aria-hidden><TodoGlyph status={row.status} /></span>
        <span className="session-activity-todo-text">{row.content}</span>
        {/* Kept for assistive technology and text search: the row draws the glyph, the status stays readable. */}
        <span className="session-activity-hidden-text">{t(row.statusLabelKey)}</span>
      </li>)}
    </ol>
  </ActivityRailGroup>;
}

/** A finished row is a check, the row in progress spins, a dropped row keeps a slash and everything else is a circle. */
function TodoGlyph({ status }: { status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <IconCircleCheck size={15} />;
    case "cancelled":
      return <IconCircleSlash size={15} />;
    case "in_progress":
      return <span className="session-activity-spinner" />;
    default:
      return <IconCircle size={15} />;
  }
}
