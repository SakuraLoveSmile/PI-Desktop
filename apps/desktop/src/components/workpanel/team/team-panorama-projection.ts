import type { TeamSnapshot } from "@pi-desktop/shared";
import { buildTeamTaskRows, projectMemberIdentities } from "../../../lib/team-presentation";
import type { PanoramaNode, PanoramaNodeStatus } from "../AgentPanorama";
import type { PanoramaDependency } from "../agent-panorama-graph";

export function projectTeamPanorama(snapshot: TeamSnapshot, translate: (key: string) => string): {
  nodes: PanoramaNode[];
  edges: PanoramaDependency[];
  targets: Map<string, { kind: "task"; taskId: string } | { kind: "member"; memberSessionId: string }>;
} {
  const rows = buildTeamTaskRows(snapshot.tasks, snapshot.members, snapshot.readiness, snapshot.paused);
  const targets = new Map<string, { kind: "task"; taskId: string } | { kind: "member"; memberSessionId: string }>();
  const nodes: PanoramaNode[] = rows.map(({ task, state, owner }) => {
    targets.set(task.taskId, { kind: "task", taskId: task.taskId });
    const status: PanoramaNodeStatus = snapshot.paused && ["pending", "in_progress", "blocked"].includes(state)
      ? "paused" : state === "pending" ? "todo" : state === "in_progress" ? "running" : state;
    return {
      id: task.taskId,
      name: owner?.displayName ?? translate("team.unassigned"),
      roleLabel: owner ? translate(`team.roles.${owner.role}`) : undefined,
      avatarSeed: owner?.sessionId ?? task.taskId,
      task: task.subject,
      status,
    };
  });
  const ids = new Set(rows.map(({ task }) => task.taskId));
  const edges = rows.flatMap(({ task }) => task.blockedBy
    .filter((id) => ids.has(id) && id !== task.taskId)
    .map((id) => ({ from: id, to: task.taskId })));
  // A roster with no dispatched tasks still provides reachable member details.
  if (rows.length === 0) {
    const identities = projectMemberIdentities(snapshot.members, snapshot.paused);
    for (const [index, member] of snapshot.members.entries()) {
      const identity = identities[index]!;
      targets.set(member.memberSessionId, { kind: "member", memberSessionId: member.memberSessionId });
      nodes.push({ id: member.memberSessionId, name: identity.displayName,
        roleLabel: translate(`team.roles.${identity.role}`), avatarSeed: member.memberSessionId,
        task: member.description ?? translate("team.noCurrentTask"),
        status: snapshot.paused ? "paused" : member.phase });
    }
  }
  return { nodes, edges, targets };
}
