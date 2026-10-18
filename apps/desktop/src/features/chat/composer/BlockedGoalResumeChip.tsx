import { useTranslation } from "react-i18next";
import { Badge, Button } from "../../../components/ui";

export function BlockedGoalResumeChip({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return <div className="goal-resume-chip" data-testid="goal-resume-chip" role="status">
    <Badge tone="warning">{t("goal.blocked.sendContinues", { title })}</Badge>
    <Button size="sm" variant="ghost" onClick={onDismiss} aria-label={t("goal.blocked.normalMessage")}>
      {t("goal.blocked.normalMessage")}
    </Button>
  </div>;
}
