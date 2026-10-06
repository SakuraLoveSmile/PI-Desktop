import type {
  TeamMemberPhase,
  TeamMemberPresentation,
  TeamMemberRecord,
  TeamTaskRecord,
  TeamBoardProjection,
  SessionSummary,
} from "@pi-desktop/shared";

/** Team IPC is local-only; members read the parent Team, never their own ID. */
export function localTeamSessionId(session: SessionSummary | undefined): string | undefined {
  if (!session || session.executionProfile !== "team" ||
    (session.source ?? "desktop") !== "desktop" ||
    session.id.startsWith("remote:") || session.id.startsWith("native-pi:")) return undefined;
  return session.team?.teamSessionId ?? session.id;
}

export type MemberView = {
  sessionId: string;
  handle: string;
  displayName: string;
  role: TeamMemberPresentation["role"];
  phase: TeamMemberPhase;
  paused: boolean;
};

export type TaskVisualState = TeamTaskRecord["status"] | "blocked";
export function taskStateLabelKey(state: TaskVisualState): string {
  return state === "blocked" ? "team.waitingForDependencies" : `team.taskStatus.${state}`;
}

export type TaskRow = {
  task: TeamTaskRecord;
  ordinal: number;
  state: TaskVisualState;
  owner?: MemberView;
};

export type TeamLeadVisualState = {
  status: "idle" | "running" | "completed" | "failed" | "paused";
  waitingForMembers: boolean;
};

export function deriveTeamLeadVisualState(
  leadPhase: TeamMemberPhase,
  paused: boolean,
  members: TeamMemberRecord[],
  tasks: TeamTaskRecord[],
  queuedMessageCount: number,
): TeamLeadVisualState {
  if (paused) return { status: "paused", waitingForMembers: false };
  if (leadPhase === "failed") return { status: "failed", waitingForMembers: false };
  if (leadPhase === "running") return { status: "running", waitingForMembers: false };

  const memberIsRunning = members.some((member) => member.phase === "running");
  const leadIsSettled = leadPhase === "idle" || leadPhase === "completed";
  const waitingForMembers = leadIsSettled && (memberIsRunning || queuedMessageCount > 0);
  if (waitingForMembers) return { status: "idle", waitingForMembers: true };

  if (leadPhase === "completed") {
    return {
      status: tasks.every((task) => task.status === "completed") && queuedMessageCount === 0
        ? "completed"
        : "idle",
      waitingForMembers: false,
    };
  }

  return {
    status: leadPhase === "provisioning" ? "idle" : leadPhase,
    waitingForMembers: false,
  };
}

const legacyAliases = ["Alex", "Sam", "Tina", "Noah", "Maya", "Leo", "Iris", "Kai"];
const roleHandles: Record<string, TeamMemberPresentation["role"]> = {
  researcher: "researcher",
  executor: "executor",
  reviewer: "reviewer",
  planner: "planner",
};

export function projectMemberIdentities(
  members: TeamMemberRecord[],
  paused = false,
): MemberView[] {
  let legacyOrdinal = 0;
  return members.map((member) => {
    if (member.presentation) {
      return {
        sessionId: member.memberSessionId,
        handle: member.name,
        displayName: member.presentation.displayName,
        role: member.presentation.role,
        phase: member.phase,
        paused,
      };
    }

    const isScout = /^V\d+_.*_scout$/i.test(member.name);
    const machineRole = roleHandles[member.name.toLowerCase()];
    if (isScout || machineRole) {
      const role = isScout ? "researcher" : machineRole!;
      const displayName = legacyAliases[legacyOrdinal] ?? member.name;
      legacyOrdinal += 1;
      return {
        sessionId: member.memberSessionId,
        handle: member.name,
        displayName,
        role,
        phase: member.phase,
        paused,
      };
    }

    return {
      sessionId: member.memberSessionId,
      handle: member.name,
      displayName: member.name,
      role: "collaborator",
      phase: member.phase,
      paused,
    };
  });
}

export function taskVisualState(
  task: TeamTaskRecord,
  readiness: TeamBoardProjection["readiness"][number] | undefined,
): TaskVisualState {
  if (
    task.status === "pending" &&
    (readiness?.unresolvedBlockedBy.length ?? 0) > 0
  ) {
    return "blocked";
  }
  return task.status;
}

function byCreationOrder(a: TeamTaskRecord, b: TeamTaskRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId);
}

export function buildTeamTaskRows(
  tasks: TeamTaskRecord[],
  members: TeamMemberRecord[],
  readiness: TeamBoardProjection["readiness"],
  paused = false,
): TaskRow[] {
  const identities = projectMemberIdentities(members, paused);
  const readinessByTask = new Map(readiness.map((item) => [item.taskId, item]));
  const identityBySession = new Map(identities.map((item) => [item.sessionId, item]));
  const identityByHandle = new Map(identities.map((item) => [item.handle, item]));
  return tasks
    .filter((task) => !task.deleted)
    .slice()
    .sort(byCreationOrder)
    .map((task, index) => ({
      task,
      ordinal: index + 1,
      state: taskVisualState(task, readinessByTask.get(task.taskId)),
      owner: task.ownerSessionId
        ? identityBySession.get(task.ownerSessionId)
        : task.ownerMemberName
          ? identityByHandle.get(task.ownerMemberName)
          : undefined,
    }));
}

const overviewPriority: Record<TaskVisualState, number> = {
  failed: 0,
  in_progress: 1,
  blocked: 2,
  pending: 3,
  completed: 4,
  cancelled: 5,
};

export function selectOverviewTaskRows(rows: TaskRow[], limit = 5): TaskRow[] {
  return rows
    .slice()
    .sort((a, b) => overviewPriority[a.state] - overviewPriority[b.state] || a.ordinal - b.ordinal)
    .slice(0, Math.max(0, limit));
}

export type BoardFilter = "all" | "in_progress" | "blocked" | "completed" | "failed";

export function filterTeamTaskRows(
  rows: TaskRow[],
  filter: BoardFilter,
  query: string,
): TaskRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(({ task, state, owner }) =>
    (filter === "all" || state === filter) &&
    (!needle || `${task.subject} ${owner?.displayName ?? ""}`.toLocaleLowerCase().includes(needle)),
  );
}
