import { Fragment, type ReactNode } from "react";
import type { SessionSummary } from "@pi-desktop/shared";
import { TooltipButton } from "../../components/ui";
import { IconChevronDown } from "../../components/icons";
import { useTeamSnapshot } from "../../hooks/useTeamSnapshot";
import { projectMemberIdentities, type MemberView } from "../../lib/team-presentation";

type TeamSessionGroupProps = {
  sessionId: string;
  expanded: boolean;
  toggleLabel: string;
  members: SessionSummary[];
  visibleMembers: SessionSummary[];
  leadRow: ReactNode;
  renderMember: (member: SessionSummary, identity?: MemberView) => ReactNode;
  onToggle: () => void;
};

export function TeamSessionGroup({
  sessionId,
  expanded,
  toggleLabel,
  members,
  visibleMembers,
  leadRow,
  renderMember,
  onToggle,
}: TeamSessionGroupProps) {
  const { snapshot } = useTeamSnapshot(sessionId, { enabled: expanded });
  const identities = new Map(
    projectMemberIdentities(snapshot?.members ?? [], snapshot?.paused ?? false)
      .map((member) => [member.sessionId, member]),
  );

  return (
    <section
      className="sidebar-team-session-group"
      data-sidebar-team-group={sessionId}
      data-expanded={expanded ? "true" : "false"}
    >
      <div className="sidebar-team-session-lead">
        {leadRow}
        {members.length > 0 ? (
          <TooltipButton
            type="button"
            className="sidebar-team-session-toggle"
            data-action="toggle-team-session"
            ariaLabel={toggleLabel}
            tooltip={toggleLabel}
            aria-expanded={expanded}
            aria-controls={`sidebar-team-members-${sessionId}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            <IconChevronDown size={13} aria-hidden />
          </TooltipButton>
        ) : null}
      </div>
      {members.length > 0 ? (
        <div
          className={`sidebar-team-session-members ${expanded ? "expanded" : "collapsed"}`}
          id={`sidebar-team-members-${sessionId}`}
          aria-hidden={!expanded}
          inert={!expanded ? true : undefined}
        >
          <div className="sidebar-team-session-members-clip">
            <div className="sidebar-team-session-members-list">
              {visibleMembers.map((member) => (
                <Fragment key={member.id}>
                  {renderMember(member, identities.get(member.id))}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
