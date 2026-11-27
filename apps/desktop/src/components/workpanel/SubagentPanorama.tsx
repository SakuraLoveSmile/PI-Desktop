import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { activitySubagents } from "../../features/chat/activity/session-activity-model";
import { getPanoramaViewport, savePanoramaViewport } from "../../lib/panorama-memory";
import { useAppStore } from "../../stores/app-store";
import { AgentPanorama, type PanoramaNode } from "./AgentPanorama";
import { overviewSubagentTone } from "./overview-subagent-status";

/**
 * The sub-agent panorama of one session: the session sits at the root as the coordinator and every
 * sub-agent it delegated to hangs below it. The viewport scope key is derived from the session, so the
 * same session pans and zooms the same way wherever this panorama is opened.
 */
export function SubagentPanorama({ sessionId, onSelectNode, onBack }: {
  sessionId: string;
  onSelectNode?: (delegationId: string, agentName: string) => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.sessions.find((candidate) => candidate.id === sessionId));
  const messages = useAppStore((state) => state.messages);
  const running = useAppStore((state) => state.runningSessions[sessionId] === true);
  const outcome = useAppStore((state) => state.sessionOutcomes[sessionId]);
  const subagents = useMemo(() => activitySubagents(messages, running)
    .map((item) => ({ ...item, agentName: item.agentName || t("chat.subagentUnnamed") })),
  [messages, running, t]);
  if (!session) return null;
  const rootNode: PanoramaNode = {
    id: session.id,
    name: session.title || t("chat.subagentCoordinator"),
    task: t("chat.subagentCoordinating", { count: subagents.length }),
    status: running ? "running" : outcome ?? "idle",
    avatarIcon: "target",
    isRoot: true,
  };
  const childNodes: PanoramaNode[] = subagents.map((sub) => ({
    id: sub.delegationId,
    name: sub.agentName,
    task: sub.task || undefined,
    status: overviewSubagentTone(sub.status),
    avatarIcon: "bot",
  }));
  const viewportScopeKey = `subagents:${session.source ?? "desktop"}:${session.id}`;
  return (
    <AgentPanorama
      title={session.title ? `${session.title} - ${t("team.panoramaTitle")}` : t("team.panoramaTitle")}
      rootNode={rootNode}
      childNodes={childNodes}
      viewportScopeKey={viewportScopeKey}
      savedViewport={getPanoramaViewport(viewportScopeKey)}
      onViewportSave={savePanoramaViewport}
      onBack={onBack}
      onSelectNode={(id) => {
        const sub = subagents.find((candidate) => candidate.delegationId === id);
        if (sub) onSelectNode?.(sub.delegationId, sub.agentName);
      }}
      emptyMessage={t("panel.overview.noSubagents")}
    />
  );
}
