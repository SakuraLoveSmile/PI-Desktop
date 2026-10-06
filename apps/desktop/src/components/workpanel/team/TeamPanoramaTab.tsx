import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { useAppStore } from "../../../stores/app-store";
import { getPanoramaViewport, savePanoramaViewport } from "../../../lib/panorama-memory";
import { deriveTeamLeadVisualState, localizedTeamSnapshotError, memberFocusTask, projectMemberIdentities } from "../../../lib/team-presentation";
import { teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { AgentPanorama, type PanoramaNode } from "../AgentPanorama";
import type { PanoramaViewport } from "../agent-panorama-viewport";

export function TeamPanoramaTab({ teamSessionId }: { teamSessionId: string }) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const openWorkPanelTabForSession = useAppStore((state) => state.openWorkPanelTabForSession);
  const { snapshot, loading, error: snapshotError, refresh } = useTeamSnapshot(teamSessionId);
  const error = snapshotError ? localizedTeamSnapshotError(snapshotError, t) : snapshotError;
  const panoramaScopeKey = `team:desktop:${teamSessionId}`;
  const [savedViewport, setSavedViewport] = useState<PanoramaViewport | undefined>(() =>
    getPanoramaViewport(panoramaScopeKey),
  );
  const handleViewportSave = useCallback((scopeKey: string, viewport: PanoramaViewport) => {
    savePanoramaViewport(scopeKey, viewport);
    if (scopeKey === panoramaScopeKey) setSavedViewport(viewport);
  }, [panoramaScopeKey]);
  useEffect(() => {
    setSavedViewport(getPanoramaViewport(panoramaScopeKey));
  }, [panoramaScopeKey]);
  const roster = snapshot?.members ?? [];
  const tasks = snapshot?.tasks.filter((task) => !task.deleted) ?? [];
  const isPaused = snapshot?.paused ?? false;
  const leadState = deriveTeamLeadVisualState(
    snapshot?.leadPhase ?? "idle", isPaused, roster, tasks, snapshot?.queuedMessageCount ?? 0,
  );
  const rootNode: PanoramaNode = {
    id: snapshot?.teamSessionId ?? teamSessionId,
    name: t("team.lead"),
    task: t("team.coordinatingExperts"),
    status: leadState.status,
    statusLabel: leadState.waitingForMembers ? t("team.waitingForMembers") : undefined,
    avatarSeed: snapshot?.teamSessionId ?? teamSessionId,
    isLead: true,
    avatarIcon: "users",
    isRoot: true,
  };
  const identities = projectMemberIdentities(roster, isPaused);
  const childNodes: PanoramaNode[] = roster.map((member, index) => {
    const focus = memberFocusTask(member, tasks);
    const identity = identities[index];
    const status = isPaused ? "paused" : member.phase === "provisioning" ? "idle" : member.phase;
    return {
      id: member.memberSessionId,
      name: identity.displayName,
      roleLabel: t(`team.roles.${identity.role}`),
      avatarSeed: member.memberSessionId,
      task: focus?.subject ?? member.description ?? t("team.noCurrentTask"),
      status,
      contextKind: member.contextKind,
      avatarIcon: "bot",
    };
  });
  return (
    <AgentPanorama title={t("team.panoramaTitle")} rootNode={rootNode} childNodes={childNodes}
      onSelectNode={(memberSessionId) => {
        const member = roster.find((item) => item.memberSessionId === memberSessionId);
        if (!member || !activeSessionId) return;
        const focus = memberFocusTask(member, tasks);
        const identity = identities.find((item) => item.sessionId === memberSessionId);
        const target = focus ? { kind: "task" as const, taskId: focus.taskId }
          : { kind: "member" as const, memberSessionId };
        openWorkPanelTabForSession(activeSessionId, teamWorkPanelTab(teamSessionId, target, focus?.subject ?? identity?.displayName ?? member.name));
      }}
      emptyMessage={t("team.emptyRoster")} loading={loading && !snapshot}
      error={snapshot ? null : error} staleError={snapshot ? error : null}
      onRetry={() => void refresh()} viewportScopeKey={panoramaScopeKey}
      savedViewport={savedViewport} onViewportSave={handleViewportSave} />
  );
}
