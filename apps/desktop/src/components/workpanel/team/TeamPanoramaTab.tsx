import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { useAppStore } from "../../../stores/app-store";
import { getPanoramaViewport, savePanoramaViewport } from "../../../lib/panorama-memory";
import { deriveTeamLeadVisualState, localizedTeamSnapshotError } from "../../../lib/team-presentation";
import { teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { AgentPanorama, type PanoramaNode } from "../AgentPanorama";
import type { PanoramaViewport } from "../agent-panorama-viewport";
import { projectTeamPanorama } from "./team-panorama-projection";

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
    status: !isPaused && snapshot?.leadPhase === "provisioning" ? "provisioning" : leadState.status,
    statusLabel: leadState.waitingForMembers ? t("team.waitingForMembers") : undefined,
    avatarSeed: snapshot?.teamSessionId ?? teamSessionId,
    isLead: true,
    avatarIcon: "users",
    isRoot: true,
  };
  const projection = snapshot ? projectTeamPanorama(snapshot, t) : null;
  return (
    <AgentPanorama title={t("team.panoramaTitle")} rootNode={rootNode} childNodes={projection?.nodes ?? []}
      dependencyEdges={projection?.edges ?? []}
      onSelectNode={(nodeId) => {
        const target = projection?.targets.get(nodeId);
        const node = projection?.nodes.find((item) => item.id === nodeId);
        if (!target || !activeSessionId) return;
        openWorkPanelTabForSession(activeSessionId, teamWorkPanelTab(teamSessionId, target, node?.task ?? node?.name));
      }}
      emptyMessage={t("team.emptyRoster")} loading={loading && !snapshot}
      error={snapshot ? null : error} staleError={snapshot ? error : null}
      onRetry={() => void refresh()} viewportScopeKey={panoramaScopeKey}
      savedViewport={savedViewport} onViewportSave={handleViewportSave} />
  );
}
