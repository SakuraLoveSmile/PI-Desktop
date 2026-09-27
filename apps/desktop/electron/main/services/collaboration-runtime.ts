import type { Principal } from "@pi-desktop/agent-host";
import { IPC } from "@pi-desktop/shared";
import type { AgentHostBridge } from "../agent-host-bridge";
import type { AgentSidecar } from "../agent-sidecar";
import type { HostProcess } from "../host-process";
import type { Logger } from "../logger";
import type { PersistenceOutbox } from "../persistence-outbox";
import { createSessionCollaborationService } from "./session-collaboration";
import { createTeamDeliveryService } from "./team-delivery";

export type CollaborationRuntimeDependencies = {
  activeTurns: Map<string, string>;
  principal: Principal;
  getHost: () => HostProcess | null;
  getSidecar: () => AgentSidecar | null;
  getBridge: () => AgentHostBridge | null;
  isPluginLoaded: (pluginId: string) => boolean;
  isQuitting: () => boolean;
  logger: Logger;
  persistenceOutbox: PersistenceOutbox;
  sendToRenderer: (channel: string, payload: unknown) => void;
};

export function createCollaborationRuntime(deps: CollaborationRuntimeDependencies) {
  const sessionCollaboration = createSessionCollaborationService({
    getHost: deps.getHost,
    getSidecar: deps.getSidecar,
    getBridge: deps.getBridge,
    getActiveTurn: (sessionId) => deps.activeTurns.get(sessionId),
    flushTranscript: async () => {
      await deps.persistenceOutbox.flush(() => deps.getHost());
      return deps.persistenceOutbox.size() === 0;
    },
    isPluginLoaded: deps.isPluginLoaded,
    isQuitting: deps.isQuitting,
    onChanged: () =>
      deps.sendToRenderer(IPC.event.sessionsChanged, {
        reason: "session.collaboration",
      }),
    log: (message, data) => deps.logger.app("runtime", "warn", message, { data }),
  });
  const teamDelivery = createTeamDeliveryService({
    principal: deps.principal,
    getHost: deps.getHost,
    getBridge: deps.getBridge,
    activeTurns: deps.activeTurns,
    log: (message, data) => deps.logger.app("runtime", "warn", message, { data }),
  });
  const drainTeamMail = () => teamDelivery.drainPending();

  return {
    sessionCollaboration,
    teamDelivery,
    onTeamNotification: (method: string, params: unknown) =>
      teamDelivery.onNotification(method, params),
    onBackendsReady: drainTeamMail,
    onAgentHostReady: drainTeamMail,
    onSessionQueueChange: () => {
      void sessionCollaboration.drain().catch((error: unknown) => {
        deps.logger.app("runtime", "warn", "session callback drain failed", {
          data: String(error),
        });
      });
    },
  };
}
