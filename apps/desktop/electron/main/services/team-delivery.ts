import type { Principal } from "@pi-desktop/agent-host";
import type {
  TeamMessageRecord,
  TeamRosterProjection,
} from "@pi-desktop/shared";
import type { AgentHostBridge } from "../agent-host-bridge";
import type { HostProcess } from "../host-process";

type RuntimeContext = {
  teamSessionId: string;
  callerSessionId: string;
  isLead: boolean;
  memberName?: string;
};

export type TeamDeliveryDependencies = {
  principal: Principal;
  getHost: () => HostProcess | null;
  getBridge: () => AgentHostBridge | null;
  activeTurns: Map<string, string>;
  log: (message: string, data: Record<string, unknown>) => void;
};

function requiredText(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${key} must be a nonempty string`), {
      errorCode: "INVALID_ARGUMENT",
    });
  }
  return value.trim();
}

function deliveryError(code: string, message: string): Error {
  return Object.assign(new Error(message), { errorCode: code, code });
}

function isQueueReceipt(
  bridge: AgentHostBridge,
  sessionId: string,
  messageId: string,
): boolean {
  return bridge.agentHost.queue.list(sessionId).some((entry) => entry.sessionMessageId === messageId);
}

export function createTeamDeliveryService(deps: TeamDeliveryDependencies) {
  const teamOperations = new Map<string, Promise<void>>();

  function requireHost(): HostProcess {
    const host = deps.getHost();
    if (!host || !host.isAvailable()) {
      throw deliveryError("HOST_UNAVAILABLE", "The Host is unavailable");
    }
    return host;
  }

  async function withTeamLock<T>(teamSessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = teamOperations.get(teamSessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    teamOperations.set(teamSessionId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (teamOperations.get(teamSessionId) === tail) teamOperations.delete(teamSessionId);
    }
  }

  async function rosterFor(host: HostProcess, teamSessionId: string): Promise<TeamRosterProjection> {
    return host.call<TeamRosterProjection>("team.getRoster", {
      teamSessionId,
      callerSessionId: teamSessionId,
    });
  }

  function setTeamHold(
    bridge: AgentHostBridge | null,
    roster: TeamRosterProjection,
    held: boolean,
  ): void {
    if (!bridge) return;
    const reason = `team:${roster.teamSessionId}`;
    const sessionIds = [
      roster.teamSessionId,
      ...roster.members.map((member) => member.memberSessionId),
    ];
    for (const sessionId of sessionIds) {
      if (held) bridge.agentHost.queue.hold(sessionId, reason);
      else bridge.agentHost.queue.resume(sessionId, reason);
    }
  }

  async function getPendingMessages(
    host: HostProcess,
    teamSessionId: string,
  ): Promise<TeamMessageRecord[]> {
    const response = await host.call<{ messages: TeamMessageRecord[] }>("team.pendingMessages", {
      teamSessionId,
      callerSessionId: teamSessionId,
    });
    return response.messages;
  }

  async function findMessage(
    host: HostProcess,
    teamSessionId: string,
    messageId: string,
  ): Promise<TeamMessageRecord> {
    const { message } = await host.call<{ message: TeamMessageRecord | null }>("team.getMessage", {
      teamSessionId,
      callerSessionId: teamSessionId,
      messageId,
    });
    if (!message) throw deliveryError("NOT_FOUND", "Team message is no longer pending");
    return message;
  }

  async function dispatchMessageOnce(
    teamSessionId: string,
    messageId: string,
  ): Promise<Record<string, unknown>> {
    const host = requireHost();
    const message = await findMessage(host, teamSessionId, messageId);
    const roster = await rosterFor(host, teamSessionId);
    const bridge = deps.getBridge();
    setTeamHold(bridge, roster, roster.paused);
    if (roster.paused) {
      return { messageId, accepted: false, deliveryStatus: "queued" };
    }
    if (!bridge) throw deliveryError("AGENT_UNAVAILABLE", "The Agent runtime is unavailable");

    if (message.status !== "queued") {
      if (message.deliveryStatus !== "acknowledged") {
        const result = await host.call<{ acknowledged: boolean }>("team.ackMessage", {
          teamSessionId,
          ackSessionId: message.targetSessionId,
          messageId: message.id,
        });
        if (!result.acknowledged) {
          throw deliveryError("TEAM_DELIVERY_PENDING", "The Host did not persist the Team acknowledgment");
        }
      }
      const current = await findMessage(host, teamSessionId, message.id).catch(() => message);
      return {
        messageId,
        targetSessionId: message.targetSessionId,
        accepted: true,
        deliveryStatus: current.deliveryStatus,
        message: current,
      };
    }

    const hadQueueReceipt = isQueueReceipt(bridge, message.targetSessionId, message.id);
    if (hadQueueReceipt) {
      await bridge.agentHost.resumeTeamMessage(
        deps.principal,
        message.targetSessionId,
        message.id,
      );
    } else {
      await bridge.agentHost.enqueueTeamMessage(deps.principal, {
        sessionId: message.targetSessionId,
        input: { text: message.content, sessionMessageId: message.id },
        admission: "queue",
        idempotencyKey: `team-message:${message.id}`,
        context: { requestId: `team-message:${message.id}` },
      });
    }

    if (!isQueueReceipt(bridge, message.targetSessionId, message.id)) {
      const current = await findMessage(host, teamSessionId, message.id).catch(() => null);
      if (current?.turnId || current?.status === "running" || current?.status === "completed") {
        const result = await host.call<{ acknowledged: boolean }>("team.ackMessage", {
          teamSessionId,
          ackSessionId: message.targetSessionId,
          messageId: message.id,
        });
        if (!result.acknowledged) {
          throw deliveryError("TEAM_DELIVERY_PENDING", "The Host did not persist the Team acknowledgment");
        }
        const acknowledged = await findMessage(host, teamSessionId, message.id).catch(() => current);
        return {
          messageId,
          targetSessionId: message.targetSessionId,
          accepted: true,
          deliveryStatus: acknowledged.deliveryStatus,
          message: acknowledged,
        };
      }
      throw deliveryError("TEAM_DELIVERY_PENDING", "The Host did not persist a Team turn receipt");
    }

    const acknowledged = await host.call<{ acknowledged: boolean }>("team.ackMessage", {
      teamSessionId,
      ackSessionId: message.targetSessionId,
      messageId: message.id,
    });
    if (!acknowledged.acknowledged) {
      throw deliveryError("TEAM_DELIVERY_PENDING", "The Host did not persist the Team acknowledgment");
    }
    await bridge.agentHost.resumeTeamMessage(
      deps.principal,
      message.targetSessionId,
      message.id,
    );
    bridge.agentHost.kick(message.targetSessionId);
    const current = await findMessage(host, teamSessionId, message.id).catch(() => message);
    return {
      messageId,
      targetSessionId: message.targetSessionId,
      accepted: true,
      deliveryStatus: current.deliveryStatus,
      message: current,
    };
  }

  async function dispatchMessage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const teamSessionId = requiredText(params, "teamSessionId");
    const messageId = requiredText(params, "messageId");
    return withTeamLock(teamSessionId, () => dispatchMessageOnce(teamSessionId, messageId));
  }

  async function drainTeam(teamSessionId: string): Promise<void> {
    const pendingMessageIds = await withTeamLock(teamSessionId, async () => {
      const host = requireHost();
      const roster = await rosterFor(host, teamSessionId);
      setTeamHold(deps.getBridge(), roster, roster.paused);
      if (roster.paused) return [];
      const messages = await getPendingMessages(host, teamSessionId);
      return messages.map((message) => message.id);
    });
    for (const messageId of pendingMessageIds) {
      try {
        await dispatchMessage({ teamSessionId, messageId });
      } catch (error) {
        deps.log("Team message delivery remains pending", {
          teamSessionId,
          messageId,
          error: String(error),
        });
      }
    }
  }

  async function drainPending(teamSessionId?: string): Promise<void> {
    const host = deps.getHost();
    if (!host?.isAvailable() || !deps.getBridge()) return;
    if (teamSessionId) {
      await drainTeam(teamSessionId);
      return;
    }
    const { sessions } = await host.call<{
      sessions: Array<{ id: string; executionProfile?: string }>;
    }>("session.list");
    const teams = await Promise.all(sessions
      .filter((session) => session.executionProfile === "team")
      .map(async (session) => {
        const context = await host.call<RuntimeContext | null>("team.getRuntimeContext", {
          sessionId: session.id,
        });
        return context?.isLead ? context.teamSessionId : null;
      }));
    await Promise.all([...new Set(teams.filter((id): id is string => Boolean(id)))].map(drainTeam));
  }

  async function pauseTeam(teamSessionId: string): Promise<unknown> {
    return withTeamLock(teamSessionId, async () => {
      const host = requireHost();
      const roster = await rosterFor(host, teamSessionId);
      setTeamHold(deps.getBridge(), roster, true);
      try {
        return await host.call("team.pause", {
          teamSessionId,
          callerSessionId: teamSessionId,
        });
      } catch (error) {
        if (!roster.paused) setTeamHold(deps.getBridge(), roster, false);
        throw error;
      }
    });
  }

  async function resumeTeam(teamSessionId: string): Promise<unknown> {
    const host = requireHost();
    const result = await withTeamLock(teamSessionId, async () => {
      if (requireHost() !== host) {
        throw deliveryError("HOST_UNAVAILABLE", "The Host changed during Team resume");
      }
      const resumed = await host.call("team.resume", {
        teamSessionId,
        callerSessionId: teamSessionId,
      });
      const roster = await rosterFor(host, teamSessionId);
      if (requireHost() !== host) {
        throw deliveryError("HOST_UNAVAILABLE", "The Host changed during Team resume");
      }
      setTeamHold(deps.getBridge(), roster, roster.paused);
      return resumed;
    });
    await drainPending(teamSessionId);
    await withTeamLock(teamSessionId, async () => {
      if (requireHost() !== host) {
        throw deliveryError("HOST_UNAVAILABLE", "The Host changed during Team resume");
      }
      const roster = await rosterFor(host, teamSessionId);
      if (requireHost() !== host) {
        throw deliveryError("HOST_UNAVAILABLE", "The Host changed during Team resume");
      }
      const bridge = deps.getBridge();
      setTeamHold(bridge, roster, roster.paused);
      if (!bridge || roster.paused) return;
      for (const sessionId of [teamSessionId, ...roster.members.map((member) => member.memberSessionId)]) {
        bridge.agentHost.kick(sessionId);
      }
    });
    return result;
  }

  async function pauseAndAbortTeam(teamSessionId: string, keepSessionId: string): Promise<void> {
    await withTeamLock(teamSessionId, async () => {
      const host = requireHost();
      const roster = await rosterFor(host, teamSessionId);
      const bridge = deps.getBridge();
      setTeamHold(bridge, roster, true);
      try {
        await host.call("team.pause", { teamSessionId, callerSessionId: teamSessionId });
      } catch (error) {
        if (!roster.paused) setTeamHold(bridge, roster, false);
        throw error;
      }
      const members = [teamSessionId, ...roster.members.map((member) => member.memberSessionId)];
      for (const sessionId of members) {
        if (sessionId === keepSessionId) continue;
        const turnId = deps.activeTurns.get(sessionId);
        if (!turnId || !bridge || deps.activeTurns.get(sessionId) !== turnId) continue;
        await bridge.interruptSessionMessage(sessionId, turnId);
      }
    });
  }

  async function beforeUserStop(sessionId: string): Promise<void> {
    const host = deps.getHost();
    if (!host?.isAvailable()) return;
    const detail = await host.call<{ session?: { executionProfile?: string } }>("session.get", {
      id: sessionId,
    });
    if (detail.session?.executionProfile !== "team") return;
    const context = await host.call<RuntimeContext | null>("team.getRuntimeContext", { sessionId });
    if (context) await pauseAndAbortTeam(context.teamSessionId, sessionId);
  }

  async function onNotification(method: string, params: unknown): Promise<void> {
    const input = params && typeof params === "object" && !Array.isArray(params)
      ? params as Record<string, unknown>
      : {};
    if (method === "team.messageQueued" || method === "team.queueChanged") {
      const teamSessionId = typeof input.teamSessionId === "string" ? input.teamSessionId : undefined;
      await drainPending(teamSessionId);
      return;
    }
    if (method === "team.interruptRequested") {
      const sessionId = typeof input.sessionId === "string" ? input.sessionId : undefined;
      const turnId = typeof input.turnId === "string" ? input.turnId : undefined;
      if (!sessionId || !turnId || deps.activeTurns.get(sessionId) !== turnId) return;
      const bridge = deps.getBridge();
      if (bridge) await bridge.interruptSessionMessage(sessionId, turnId);
    }
  }

  return {
    dispatchMessage,
    drainPending,
    onNotification,
    pauseTeam,
    resumeTeam,
    beforeUserStop,
  };
}
