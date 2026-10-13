import { useTranslation } from "react-i18next";
import type { GoalHold } from "@pi-desktop/shared";
import { Badge, Button } from "./ui";
import { IconCircleAlert } from "./icons";

const reasonKeys: Record<string, string> = {
  report_missing: "reportMissing", report_invalid: "reportInvalid", verdict_partial: "verdictPartial",
  verdict_blocked: "verdictBlocked", verdict_unknown: "verdictUnknown", team_unsettled: "teamUnsettled",
  resume_failed: "resumeFailed",
};

export function GoalBlockedCard({ title, hold, busy = false, readOnly = false, error = false, onResume, onAccept, onAbandon }: {
  title: string; hold: GoalHold; busy?: boolean; readOnly?: boolean; error?: boolean;
  onResume?: () => void; onAccept?: () => void; onAbandon?: () => void;
}) {
  const { t } = useTranslation();
  return <section className="goal-report-card goal-blocked-card verdict-blocked status-interrupted" data-testid="goal-blocked-card"
    data-execution-id={hold.executionId} role="region" aria-label={t("goal.blocked.title")}>
    <div className="goal-report-card-head">
      <span className="goal-report-card-icon" aria-hidden><IconCircleAlert size={18} /></span>
      <div className="goal-report-card-titles">
        <strong className="goal-report-card-title">{title || t("goal.untitled")}</strong>
        <div className="goal-report-card-meta"><Badge tone="warning">{t("goal.blocked.title")}</Badge></div>
      </div>
    </div>
    <ul className="goal-report-card-summary">{hold.reasons.map((reason, index) => <li key={`${reason.code}:${index}`}>
      {t(`goal.blocked.reasons.${reason.code.startsWith("agent_error:") ? "agentError" : reasonKeys[reason.code] ?? "unknown"}`)}
      {reason.tasks?.length ? <ul>{reason.tasks.map((task) => <li key={task.id}>{task.title}
        {" · "}{t(`team.taskStatus.${task.status}`, { defaultValue: task.status })}{task.assigneeId ? ` · ${task.assigneeId}` : ""}</li>)}</ul> : null}
    </li>)}</ul>
    {hold.progress?.items.length ? <div className="goal-report-card-summary" aria-label={t("goal.progressListLabel")}>
      <strong>{t("goal.progressLabel")}</strong>
      <ul>{hold.progress.items.map((item) => <li key={item.id}>{item.id}: {item.label}{" · "}
        {t(`goal.blocked.progress.${item.status}`)}</li>)}</ul>
    </div> : null}
    {hold.draft?.limitations?.length ? <div className="goal-report-card-summary"><strong>{t("goalReport.view.limitations")}</strong>
      <ul>{hold.draft.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
    {hold.draft?.nextSteps?.length ? <div className="goal-report-card-summary"><strong>{t("goalReport.view.nextSteps")}</strong>
      <ul>{hold.draft.nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
    {error && <p className="goal-report-card-summary" role="alert">{t("goal.blocked.actionFailed")}</p>}
    {readOnly ? <p className="goal-report-card-summary">{t("goal.blocked.remoteReadOnly")}</p>
      : <div className="goal-report-card-actions">
        <Button size="sm" disabled={busy || !onResume} onClick={onResume}>{t("goal.blocked.resume")}</Button>
        <Button size="sm" variant="secondary" disabled={busy || !onAccept} onClick={onAccept}>{t("goal.blocked.accept")}</Button>
        <Button size="sm" variant="ghost" disabled={busy || !onAbandon} onClick={onAbandon}>{t("goal.blocked.abandon")}</Button>
      </div>}
  </section>;
}
