import { useTranslation } from "react-i18next";
import type { TeamMemberRecord, TeamSnapshot, TeamTaskRecord } from "@pi-desktop/shared";
import type { MemberView } from "../../../lib/team-presentation";
import { Button } from "../../ui";
import { MemberIdentity } from "./TeamTaskProgress";

export function TeamTaskBrief({ task, ownerMember, identities, taskOverlaps, onSelectMember }: {
  task: TeamTaskRecord;
  ownerMember?: TeamMemberRecord;
  identities: Map<string, MemberView>;
  taskOverlaps: TeamSnapshot["scopeOverlaps"];
  onSelectMember: (memberSessionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="team-section">
      <div className="team-detail-field">
        <span className="team-detail-field-label">{t("team.taskOwner")}</span>
        {ownerMember ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onSelectMember(ownerMember.memberSessionId)}
            className="team-owner-btn"
          >
            {identities.get(ownerMember.memberSessionId) ? (
              <MemberIdentity member={identities.get(ownerMember.memberSessionId)!} />
            ) : ownerMember.name}
          </Button>
        ) : (
          <span className="team-detail-field-value">
            {task.ownerMemberName ?? t("team.unassigned")}
          </span>
        )}
      </div>

      {task.blockedBy.length > 0 ? (
        <div className="team-detail-field">
          <span className="team-detail-field-label">{t("team.taskReadiness")}</span>
          <span className="team-detail-field-value">
            {t("team.blockedBy", {
              tasks: task.blockedBy.map((id) => `#${id}`).join(", "),
            })}
          </span>
        </div>
      ) : null}

      {task.writeScopes.length > 0 ? (
        <div className="team-detail-field">
          <span className="team-detail-field-label">{t("team.taskScopes")}</span>
          <span className="team-detail-field-value">
            {t("team.scopes", { scopes: task.writeScopes.join(", ") })}
          </span>
        </div>
      ) : null}
      {taskOverlaps.map((overlap) => (
        <div key={`${overlap.scope}-${overlap.taskIds.join("-")}`} className="team-detail-field">
          <span className="team-detail-field-label">{t("team.warnings")}</span>
          <span className="team-detail-field-value">
            {t("team.overlapTask", {
              tasks: overlap.taskIds.map((id) => `#${id}`).join(", "),
              scope: overlap.scope,
            })}
          </span>
        </div>
      ))}
    </section>
  );
}
