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
  settleMemberTurn?: (sessionId: string, turnId: string) => Promise<void>;
  principal: Principal;
  getHost: () => HostProcess | null;
  getSidecar: () => AgentSidecar | null;
  getBridge: () => AgentHostBridge | null;
  isPluginLoaded: (pluginId: string) => boolean;
  isQuitting: () => boolean;
  isTurnDispatchable?: (sessionId: string, turnId: string) => boolean;
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
    getRuntimeIdentity: deps.getSidecar,
    isTurnDispatchable: deps.isTurnDispatchable,
    abortMemberTurn: async (sessionId, turnId) => {
      if (deps.activeTurns.get(sessionId) !== turnId) return;
      const sidecar = deps.getSidecar();
      try {
        if (sidecar) await sidecar.call("agent.abort", { sessionId, turnId });
      } finally {
        await deps.settleMemberTurn?.(sessionId, turnId);
      }
    },
    stopAtBoundary: async (sessionId, turnId) => {
      const sidecar = deps.getSidecar();
      if (!sidecar || deps.activeTurns.get(sessionId) !== turnId) return;
      // Host-only path: the ordinary user stop hook aborts peers and must not
      // run for a wall-clock pause. Preserve the current foreground tool batch.
      await sidecar.call("agent.stop", { sessionId, turnId, preserveRunningTools: true });
    },
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
