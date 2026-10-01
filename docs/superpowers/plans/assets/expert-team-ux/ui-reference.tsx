// Planning reference: split into the component modules named in the plan.
// Import paths below assume apps/desktop/src/components/workpanel/team/.
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TeamMemberPhase, TeamMemberRole, TeamTaskRecord, TeamBoardProjection } from "@pi-desktop/shared";
import { Button, Badge, Input, TooltipButton } from "../../ui";
import { IconCheck, IconChevronDown, IconChevronRight, IconExternal, IconRefresh } from "../../icons";

export type TeamRole = TeamMemberRole;
export type MemberView = {
  sessionId: string;
  handle: string;
  displayName: string;
  role: TeamRole;
  phase: TeamMemberPhase;
  paused: boolean;
};
export type TaskVisualState = TeamTaskRecord["status"] | "blocked";
export type TaskRow = {
  task: TeamTaskRecord;
  ordinal: number;
  state: TaskVisualState;
  owner?: MemberView;
};
export function taskVisualState(
  task: TeamTaskRecord,
  readiness: TeamBoardProjection["readiness"][number] | undefined,
): TaskVisualState {
  if (task.status === "pending" && (readiness?.unresolvedBlockedBy.length ?? 0) > 0) {
    return "blocked";
  }
  return task.status;
}

// Copy the reviewed SVG assets into src/assets/team-avatars/. Use literal
// bundler imports for these paths in the production module, as below.
import leadPortrait from "../../../assets/team-avatars/lead.svg";
import alexPortrait from "../../../assets/team-avatars/alex.svg";
import samPortrait from "../../../assets/team-avatars/sam.svg";
import tinaPortrait from "../../../assets/team-avatars/tina.svg";
import noahPortrait from "../../../assets/team-avatars/noah.svg";
import mayaPortrait from "../../../assets/team-avatars/maya.svg";
import leoPortrait from "../../../assets/team-avatars/leo.svg";
import irisPortrait from "../../../assets/team-avatars/iris.svg";
import kaiPortrait from "../../../assets/team-avatars/kai.svg";
const portraits = [alexPortrait, samPortrait, tinaPortrait, noahPortrait,
  mayaPortrait, leoPortrait, irisPortrait, kaiPortrait];
function avatarIndex(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % portraits.length;
}
export function PixelAvatar({ seed, lead = false, size = 20 }: {
  seed: string;
  lead?: boolean;
  size?: 20 | 24 | 32 | 48;
}) {
  return <img className="team-pixel-avatar" src={lead ? leadPortrait : portraits[avatarIndex(seed)]}
    alt="" aria-hidden="true" width={size} height={size} draggable={false} />;
}
export function MemberIdentity({ member }: { member: MemberView }) {
  const { t } = useTranslation();
  return <span className="team-person">
    <PixelAvatar seed={member.sessionId} />
    <span className="team-person-name">{t(`team.roles.${member.role}`)} {member.displayName}</span>
  </span>;
}
function statusTone(state: TaskVisualState): "neutral" | "success" | "warning" | "error" {
  return state === "completed" ? "success" : state === "blocked" ? "warning"
    : state === "failed" ? "error" : "neutral";
}
function TaskStateIcon({ state }: { state: TaskVisualState }) {
  return <span className={`team-task-state team-task-state-${state}`} aria-hidden="true">
    {state === "completed" ? <IconCheck size={12} />
      : state === "in_progress" ? <IconRefresh size={13} className="team-task-spinner" />
      : state === "blocked" ? "!" : state === "failed" ? "×" : "·"}
  </span>;
}

export function TeamTaskProgress({ rows, completed, total, expanded, onToggle,
  onOpenTask, onOpenPanorama, onOpenBoard }: {
  rows: TaskRow[];
  completed: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenPanorama: () => void;
  onOpenBoard: () => void;
}) {
  const { t } = useTranslation();
  const rowsId = useId();
  return <section className="team-progress" aria-label={t("team.taskProgress")}>
    <header className="team-progress-header">
      <Button variant="ghost" size="sm" className="team-progress-disclosure"
        aria-expanded={expanded} aria-controls={rowsId} onClick={onToggle}>
        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span>{t("team.taskProgress")}</span>
        <span className="team-progress-count">{completed}/{total}</span>
      </Button>
      <TooltipButton className="team-progress-panorama" tooltip={t("team.viewInPanorama")}
        ariaLabel={t("team.viewInPanorama")} onClick={onOpenPanorama}>
        <span>{t("team.viewInPanorama")}</span><IconExternal size={13} />
      </TooltipButton>
    </header>
    <ol id={rowsId} className="team-progress-rows" hidden={!expanded}>
      {rows.map(({ task, ordinal, state, owner }) => <li key={task.taskId}>
        <Button variant="ghost" className="team-progress-row"
          aria-label={t("team.openTaskWithStatus", { subject: task.subject, status: t(`team.taskStatus.${state}`) })}
          onClick={() => onOpenTask(task.taskId)}>
          <TaskStateIcon state={state} />
          <span className="team-progress-copy">
            <span className="team-progress-task" title={task.subject}>
              {t("team.numberedTask", { number: ordinal, subject: task.subject })}
            </span>
            {owner ? <MemberIdentity member={owner} /> : <span className="team-person">{t("team.unassigned")}</span>}
          </span>
        </Button>
      </li>)}
    </ol>
    {expanded && total > rows.length && <Button variant="ghost" size="sm"
      onClick={onOpenBoard}>{t("team.viewAllTasks", { count: total })}</Button>}
    {expanded && total === 0 && <p className="team-empty-copy">{t("team.noTasks")}</p>}
  </section>;
}

export function PanoramaPersonCard({ name, seed, task, status, statusLabel, lead,
  progress, onSelect }: {
  name: string;
  seed: string;
  task: string;
  status: "idle" | "running" | "completed" | "failed" | "paused" | "provisioning";
  statusLabel: string;
  lead?: boolean;
  progress?: string;
  onSelect: () => void;
}) {
  return <Button variant="ghost" className={`team-panorama-person team-panorama-person-${status}`}
    aria-label={`${name}: ${task}; ${statusLabel}`} onClick={onSelect}>
    <span className="team-panorama-person-head">
      <PixelAvatar seed={seed} lead={lead} size={48} />
      <span className="team-panorama-person-copy">
        <span className="team-panorama-person-name" title={name}>{name}</span>
        <span className="team-panorama-person-task" title={task}>{task}</span>
      </span>
    </span>
    <span className="team-panorama-person-footer">
      <span className="team-panorama-status-icon" aria-hidden="true">
        {status === "completed" ? <IconCheck size={13} />
          : status === "running" ? <IconRefresh size={13} className="team-task-spinner" /> : "·"}
      </span>
      <span>{statusLabel}</span>{progress && <small>{progress}</small>}
    </span>
  </Button>;
}

export type BoardFilter = "all" | "in_progress" | "blocked" | "completed" | "failed";
const filters: BoardFilter[] = ["all", "in_progress", "blocked", "completed", "failed"];
export function CompactTeamBoard({ rows, filter, query, onFilter, onQuery,
  onOpenTask }: {
  rows: TaskRow[];
  filter: BoardFilter;
  query: string;
  onFilter: (filter: BoardFilter) => void;
  onQuery: (query: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const matching = rows.filter(row => (filter === "all" || row.state === filter) &&
    `${row.task.subject} ${row.owner?.displayName ?? ""}`.toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()));
  return <section className="team-compact-board" aria-label={t("team.taskBoard")}>
    <header className="team-board-filters">
      <div className="team-board-filter-buttons">
        {filters.map(value => <Button key={value} variant="ghost" size="sm"
          aria-pressed={filter === value} onClick={() => onFilter(value)}>
          {t(`team.boardFilters.${value}`)}
        </Button>)}
      </div>
      <Input type="search" value={query} aria-label={t("team.searchTasks")}
        placeholder={t("team.searchTasks")} onChange={event => onQuery(event.currentTarget.value)} />
    </header>
    <ol className="team-board-rows">
      {matching.map(({ task, state, owner }) => <li key={task.taskId}>
        <Button variant="ghost" className="team-board-row" onClick={() => onOpenTask(task.taskId)}>
          <TaskStateIcon state={state} />
          <span className="team-board-task" title={task.subject}>{task.subject}</span>
          <Badge tone={statusTone(state)}>{t(`team.taskStatus.${state}`)}</Badge>
          <span className="team-board-owner">{owner ? <MemberIdentity member={owner} /> : t("team.unassigned")}</span>
        </Button>
      </li>)}
    </ol>
    {matching.length === 0 && <p className="team-empty-copy">{t("team.noMatchingTasks")}</p>}
  </section>;
}

// Put this component in the existing ComposerStatus feature, rather than
// reproducing its Host-owned move/edit/promote/cancel actions.
export function QueueDisclosure({ panelId, count, nextLabel, expanded, onToggle, children }: {
  panelId: string;
  count: number;
  nextLabel: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return <section className="composer-queue-disclosure">
    <Button variant="ghost" className="composer-queue-heading" aria-expanded={expanded}
      aria-controls={panelId} onClick={onToggle}>
      {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
      <span>{t("chat.queuedPrompts")}</span><Badge>{count}</Badge>
      <span className="composer-queue-next">{t("chat.queueNext", { message: nextLabel })}</span>
    </Button>
    <div id={panelId} className="composer-queue-body" hidden={!expanded}>{children}</div>
  </section>;
}

export function TeamSessionGroup({ panelId, parentRow, memberCount, expanded,
  onToggle, childRows }: {
  panelId: string;
  parentRow: ReactNode;
  memberCount: number;
  expanded: boolean;
  onToggle: () => void;
  childRows: ReactNode[];
}) {
  const { t } = useTranslation();
  return <div className="sidebar-team-group">
    <div className="sidebar-team-parent">
      <TooltipButton className="sidebar-team-chevron" aria-expanded={expanded}
        aria-controls={panelId} tooltip={t(expanded ? "team.collapseMembers" : "team.expandMembers")}
        ariaLabel={t(expanded ? "team.collapseMembers" : "team.expandMembers")} onClick={onToggle}>
        {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
      </TooltipButton>
      <div className="sidebar-team-parent-row">{parentRow}</div>
      <span className="sidebar-team-count">{memberCount}</span>
    </div>
    <div id={panelId} className="sidebar-team-children" hidden={!expanded}>{childRows}</div>
  </div>;
}
