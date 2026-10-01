import type { SessionSummary } from "@pi-desktop/shared";
import type { ProjectMeta, SessionMeta } from "./sidebar-preferences";

/** Replace only the Host's generated member label, preserving custom titles. */
export function teamMemberRowTitle(session: SessionSummary, identity?: string): string {
  return identity && session.team?.role === "member" &&
    session.title === `Teammate: ${session.team.memberName}`
    ? identity : session.title;
}

export function normalizeProjectPath(projectPath?: string | null): string | null {
  const value = projectPath?.trim();
  if (!value) return null;

  let normalized = value.replace(/\\/g, "/");
  // Strip the Windows extended-length prefix (`//?/C:/...` → `C:/...`)
  if (/^\/\/\?\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(4);
  }
  // Remove trailing slashes but keep the one after a drive letter (e.g. `C:/`)
  normalized = normalized.replace(/(?<![A-Za-z]:)\/+$/, "");
  return normalized || "/";
}

export function sessionMatchesProject(
  session: Pick<SessionSummary, "projectPath">,
  projectPath?: string | null,
): boolean {
  return normalizeProjectPath(session.projectPath) === normalizeProjectPath(projectPath);
}

/** Return normalized project paths belonging to sessions added by a refresh. */
export function projectPathsForNewSessions(
  previousSessions: readonly Pick<SessionSummary, "id">[],
  nextSessions: readonly Pick<SessionSummary, "id" | "projectPath">[],
): string[] {
  const previousIds = new Set(previousSessions.map((session) => session.id));
  const paths = new Set<string>();
  for (const session of nextSessions) {
    if (previousIds.has(session.id)) continue;
    const path = normalizeProjectPath(session.projectPath);
    if (path) paths.add(path);
  }
  return [...paths];
}

export function groupSidebarSessions(
  sessions: SessionSummary[],
  projectPath?: string | null,
): {
  projectSessions: SessionSummary[];
  temporarySessions: SessionSummary[];
} {
  const normalizedProjectPath = normalizeProjectPath(projectPath);

  return {
    projectSessions: normalizedProjectPath
      ? sessions.filter(
          (session) => normalizeProjectPath(session.projectPath) === normalizedProjectPath,
        )
      : [],
    temporarySessions: sessions.filter(
      (session) => normalizeProjectPath(session.projectPath) === null,
    ),
  };
}

export function sessionArchived(session: SessionSummary, meta: SessionMeta | undefined): boolean {
  return Boolean(meta?.archived || (session as SessionSummary & { archived?: boolean }).archived);
}

export function sessionPinned(session: SessionSummary, meta: SessionMeta | undefined): boolean {
  return Boolean(meta?.pinned || (session as SessionSummary & { pinned?: boolean }).pinned);
}

/** Pins are global shortcuts; project retention and dates do not limit discovery. */
export function getGlobalPinnedSessions(
  sessions: SessionSummary[],
  sessionMeta: Record<string, SessionMeta>,
  projectMeta: Record<string, ProjectMeta>,
  showArchived: boolean,
): SessionSummary[] {
  return sessions.filter((session) => {
    if (!sessionPinned(session, sessionMeta[session.id])) return false;
    const path = normalizeProjectPath(session.projectPath);
    const project = path ? (projectMeta[path] ?? projectMeta[session.projectPath!]) : undefined;
    return (
      showArchived || (!sessionArchived(session, sessionMeta[session.id]) && !project?.archived)
    );
  });
}

type TimeGroup = "today" | "yesterday" | "thisWeek" | "older14d" | "archived";

export type SidebarSessionGroup =
  | { kind: "team"; lead: SessionSummary; members: SessionSummary[] }
  | { kind: "session"; session: SessionSummary; parentSessionId?: string };

function stableCreatedOrder(a: SessionSummary, b: SessionSummary): number {
  const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return (Number.isFinite(created) ? created : 0) || a.id.localeCompare(b.id);
}

/** Collapse host-linked member sessions under their lead without losing or reparenting rows. */
export function groupTeamSessions(sessions: readonly SessionSummary[]): SidebarSessionGroup[] {
  const leads = new Map(
    sessions.filter((session) => session.team?.role === "lead").map((session) => [session.id, session]),
  );
  const members = new Map<string, SessionSummary[]>();
  const standalone: SidebarSessionGroup[] = [];

  for (const session of sessions) {
    if (session.team?.role === "lead") continue;
    const parentId = session.team?.role === "member" ? session.team.teamSessionId : undefined;
    if (!parentId || !leads.has(parentId)) {
      standalone.push({ kind: "session", session, ...(parentId ? { parentSessionId: parentId } : {}) });
      continue;
    }
    const children = members.get(parentId) ?? [];
    children.push(session);
    members.set(parentId, children);
  }

  const teams = [...leads.values()].map((lead): SidebarSessionGroup => ({
    kind: "team",
    lead,
    members: (members.get(lead.id) ?? []).sort(stableCreatedOrder),
  }));
  const consumed = new Set<string>([
    ...leads.keys(),
    ...[...members.values()].flatMap((items) => items.map((item) => item.id)),
  ]);
  return [...teams, ...standalone.filter((item) => item.kind !== "session" || !consumed.has(item.session.id))];
}

export function sidebarSessionGroupIds(group: SidebarSessionGroup): string[] {
  return group.kind === "team"
    ? [group.lead.id, ...group.members.map((member) => member.id)]
    : [group.session.id];
}

export function sidebarSessionGroupUpdatedAt(group: SidebarSessionGroup): string {
  if (group.kind !== "team") return group.session.updatedAt;
  return [group.lead, ...group.members].reduce((latest, session) =>
    Date.parse(session.updatedAt) > Date.parse(latest) ? session.updatedAt : latest,
  group.lead.updatedAt);
}

/** Recent order follows the latest activity in any visible member; other sort modes keep lead order. */
export function sortSidebarSessionGroups(
  groups: readonly SidebarSessionGroup[],
  compareSessions: (a: SessionSummary, b: SessionSummary) => number,
  recent: boolean,
): SidebarSessionGroup[] {
  return [...groups].sort((a, b) => {
    const aParent = a.kind === "team" ? a.lead : a.session;
    const bParent = b.kind === "team" ? b.lead : b.session;
    if (recent) {
      return compareSessions(
        { ...aParent, updatedAt: sidebarSessionGroupUpdatedAt(a) },
        { ...bParent, updatedAt: sidebarSessionGroupUpdatedAt(b) },
      );
    }
    return compareSessions(aParent, bParent);
  });
}

export function visibleSidebarSessionGroups(
  groups: readonly SidebarSessionGroup[],
  expanded: boolean,
  limit: number,
): { visible: SidebarSessionGroup[]; hiddenCount: number } {
  const visible = expanded ? [...groups] : groups.slice(0, Math.max(0, limit));
  return { visible, hiddenCount: groups.length - visible.length };
}

export function partitionPinnedSidebarSessionGroups(
  groups: readonly SidebarSessionGroup[],
  pinnedIds: ReadonlySet<string>,
): { pinned: SidebarSessionGroup[]; history: SidebarSessionGroup[]; pinnedSessionIds: Set<string> } {
  const pinned: SidebarSessionGroup[] = [];
  const history: SidebarSessionGroup[] = [];
  const pinnedSessionIds = new Set<string>();
  for (const group of groups) {
    if (group.kind === "team") {
      if (pinnedIds.has(group.lead.id)) {
        pinned.push(group);
        for (const id of sidebarSessionGroupIds(group)) pinnedSessionIds.add(id);
        continue;
      }
      history.push(group);
      for (const member of group.members) {
        if (!pinnedIds.has(member.id)) continue;
        pinned.push({ kind: "session", session: member, parentSessionId: group.lead.id });
        pinnedSessionIds.add(member.id);
      }
      continue;
    }
    if (pinnedIds.has(group.session.id)) {
      pinned.push(group);
      pinnedSessionIds.add(group.session.id);
    } else {
      history.push(group);
    }
  }
  return { pinned, history, pinnedSessionIds };
}

function getTimeGroup(dateStr: string | undefined, now: Date): TimeGroup {
  if (!dateStr) return "older14d";
  const ts = Date.parse(dateStr);
  if (!Number.isFinite(ts)) return "older14d";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 6 * 86400000; // last 7 days
  const startOf14d = startOfToday - 13 * 86400000;
  if (ts >= startOfToday) return "today";
  if (ts >= startOfYesterday) return "yesterday";
  if (ts >= startOfWeek) return "thisWeek";
  if (ts >= startOf14d) return "older14d";
  return "archived"; // older than 14 days
}

const TIME_GROUP_ORDER: TimeGroup[] = ["today", "yesterday", "thisWeek", "older14d", "archived"];

export function groupSidebarSessionGroupsByTime(
  groups: readonly SidebarSessionGroup[],
  now = new Date(),
) {
  const grouped = new Map<TimeGroup, SidebarSessionGroup[]>();
  for (const item of groups) {
    const group = getTimeGroup(sidebarSessionGroupUpdatedAt(item), now);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(item);
  }
  return TIME_GROUP_ORDER.flatMap((group) => {
    const items = grouped.get(group);
    return items?.length ? [{ group, sessions: items }] : [];
  });
}
/** Group only normal history; callers remove global pins before any row limit. */
export function groupSidebarSessionsByTime(sessions: SessionSummary[], now = new Date()) {
  const grouped = new Map<TimeGroup, SessionSummary[]>();
  for (const session of sessions) {
    const group = getTimeGroup(session.updatedAt, now);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(session);
  }
  return TIME_GROUP_ORDER.flatMap((group) => {
    const rows = grouped.get(group);
    return rows?.length ? [{ group, sessions: rows }] : [];
  });
}

/**
 * The row a quick archive/restore should hand focus to.
 *
 * `renderedIds` is the rendered order with hidden rows already removed, so the
 * result can never name a row that is no longer in the document. The acted-on
 * row is skipped, and the walk only considers the given direction.
 */
export function nextVisibleSessionId(
  renderedIds: readonly string[],
  actedId: string,
  direction: 1 | -1,
): string | null {
  const index = renderedIds.indexOf(actedId);
  if (index === -1) return null;
  for (let step = index + direction; step >= 0 && step < renderedIds.length; step += direction) {
    const candidate = renderedIds[step];
    if (candidate && candidate !== actedId) return candidate;
  }
  return null;
}
