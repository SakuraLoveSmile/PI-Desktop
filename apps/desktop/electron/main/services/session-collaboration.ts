import { randomUUID } from "node:crypto";
import type {
  AgentStatus,
  AppSettings,
  SessionCollaborationDelivery,
  SessionCollaborationMessage,
  SessionCollaborationSummary,
} from "@pi-desktop/shared";
import { DESKTOP_PRINCIPAL, type AgentHostBridge } from "../agent-host-bridge";
import { listReadyPluginModels, parsePluginModelKey } from "../plugin-agent-complete";
import type { McpControlInvokeInput } from "../mcp-control";

type Host = { call<T>(method: string, params?: Record<string, unknown>): Promise<T> };
type Sidecar = { call<T>(method: string, params: Record<string, unknown>): Promise<T> };

/** Shared by the plugin and the sidebar: durable outcomes plus live activity. */
export async function readSessionCollaboration(
  host: Host,
  sidecar: Sidecar | null,
  sessionId: string,
): Promise<SessionCollaborationSummary> {
  const [summary, live] = await Promise.all([
    host.call<SessionCollaborationSummary>("session.collaboration.status", { sessionId }),
    sidecar?.call<{ status: AgentStatus }>("agent.getStatus", { sessionId }),
  ]);
  if (live?.status.sessionId === sessionId && live.status.isRunning) {
    return {
      ...summary,
      status: live.status.pendingToolConfirmations > 0 ? "waiting_permission" : "running",
      observedAt: new Date().toISOString(),
    };
  }
  return summary;
}

export type SessionCollaborationDependencies = {
  getHost: () => Host | null;
  getSidecar: () => Sidecar | null;
  getBridge: () => AgentHostBridge | null;
  getActiveTurn: (sessionId: string) => string | undefined;
  flushTranscript: () => Promise<boolean>;
  isPluginLoaded: (pluginId: string) => boolean;
  isQuitting: () => boolean;
  onChanged: () => void;
  log: (message: string, data: Record<string, unknown>) => void;
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, errorCode: code });
}

function text(input: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) fail("INVALID_ARGUMENT", `${key} must be a nonempty string`);
  return value.trim();
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: string; errorCode?: string; data?: { errorCode?: string } };
  return value.data?.errorCode ?? value.errorCode ?? value.code;
}

function delivery(message: SessionCollaborationMessage): SessionCollaborationDelivery {
  return {
    sessionId: message.targetSessionId,
    messageId: message.id,
    status: message.status,
    ...(message.turnId ? { turnId: message.turnId } : {}),
  };
}

/** Coordinates reviewed operations; Rust owns all identity and outcome state. */
export function createSessionCollaborationService(deps: SessionCollaborationDependencies) {
  const dispatching = new Map<string, Promise<SessionCollaborationDelivery>>();
  const settlements = new Map<string, { sessionId: string; host: Host }>();
  let draining: Promise<void> | undefined;

  function requireHost(): Host {
    if (deps.isQuitting()) fail("ABORTED", "The application is shutting down");
    const host = deps.getHost();
    if (!host) fail("HOST_UNAVAILABLE", "The host is unavailable");
    return host;
  }

  function checkCurrent(host: Host, signal?: AbortSignal): void {
    if (signal?.aborted || deps.isQuitting()) fail("ABORTED", "The session operation was cancelled");
    if (deps.getHost() !== host) fail("HOST_UNAVAILABLE", "The host restarted during the session operation");
  }

  function sender(input: McpControlInvokeInput): { pluginId: string; sourceSessionId: string; sourceTurnId: string } {
    const context = input.pluginContext;
    if (!context?.sessionId || !context.turnId || !context.invocationId
      || deps.getActiveTurn(context.sessionId) !== context.turnId) {
      fail("PERMISSION_DENIED", "Sending requires an active, host-authenticated Agent tool invocation");
    }
    return { pluginId: context.pluginId, sourceSessionId: context.sessionId, sourceTurnId: context.turnId };
  }

  async function dispatch(message: SessionCollaborationMessage, signal?: AbortSignal): Promise<SessionCollaborationDelivery> {
    const existing = dispatching.get(message.id);
    if (existing) return existing;
    const operation = (async () => {
      const host = requireHost();
      try {
        checkCurrent(host, signal);
        const current = (await host.call<{ message?: SessionCollaborationMessage }>(
          "session.collaboration.message", { messageId: message.id },
        )).message;
        checkCurrent(host, signal);
        if (!current) fail("NOT_FOUND", "Session message not found");
        if (current.status !== "queued") return delivery(current);
        const bridge = deps.getBridge();
        if (!bridge || !deps.getSidecar()) fail("HOST_UNAVAILABLE", "The Agent runtime is unavailable");
        if (bridge.queue.list(current.targetSessionId).some((entry) => entry.sessionMessageId === current.id)) {
          return delivery(current);
        }
        if (!deps.isPluginLoaded(current.pluginId)) fail("ABORTED", "The sending plugin is no longer enabled");
        // beginTurn rechecks the persisted authorization ceiling at execution,
        // including when a queued turn resumes after settings have changed.
        await bridge.agentHost.startTurn(DESKTOP_PRINCIPAL, {
          sessionId: current.targetSessionId,
          input: { text: current.content, sessionMessageId: current.id },
          admission: "queue",
          idempotencyKey: `session-message:${current.id}`,
          context: { requestId: `session-message:${current.id}` },
        });
        checkCurrent(host);
        const accepted = (await host.call<{ message: SessionCollaborationMessage }>(
          "session.collaboration.message", { messageId: current.id },
        )).message;
        if (signal?.aborted) await cancel(host, { sessionId: current.targetSessionId, messageId: current.id });
        deps.onChanged();
        return delivery(accepted);
      } catch (error) {
        // A full callback inbox is deferred until a later queue/turn change.
        // It must not turn a successfully completed original task into failure.
        if (deps.getHost() === host && !(message.kind === "completion" && errorCode(error) === "AGENT_BUSY")) {
          await host.call("session.collaboration.fail", {
            messageId: message.id,
            error: String(error instanceof Error ? error.message : error).slice(0, 2000),
          }).catch((persistenceError: unknown) => deps.log("Session delivery failure could not be saved", {
            messageId: message.id, error: String(persistenceError),
          }));
        }
        throw error;
      }
    })();
    dispatching.set(message.id, operation);
    try { return await operation; }
    finally { if (dispatching.get(message.id) === operation) dispatching.delete(message.id); }
  }

  async function cancel(host: Host, args: Record<string, unknown>) {
    const result = await host.call<{
      sessionId: string; cancelled: true; sessionRetained: true; messageIds: string[]; runningTurnIds: string[];
    }>("session.collaboration.cancel", args);
    checkCurrent(host);
    const bridge = deps.getBridge();
    if (bridge) {
      for (const messageId of result.messageIds) await bridge.queue.cancelSessionMessage(result.sessionId, messageId);
      for (const turnId of result.runningTurnIds) {
        // The exact turn guard prevents a late cancellation from stopping a
        // newer task in this reusable session.
        if (deps.getActiveTurn(result.sessionId) === turnId) {
          await bridge.interruptSessionMessage(result.sessionId, turnId);
        }
      }
    }
    deps.onChanged();
    return { sessionId: result.sessionId, cancelled: true, sessionRetained: true };
  }

  async function drain(): Promise<void> {
    if (draining) return draining;
    if (!deps.getHost() || deps.isQuitting()) return;
    draining = (async () => {
      const host = requireHost();
      if (settlements.size && await deps.flushTranscript()) {
        checkCurrent(host);
        for (const [turnId, owner] of settlements) {
          if (owner.host === host) await host.call("session.collaboration.settle", { turnId });
          settlements.delete(turnId);
        }
      }
      const pending = await host.call<{ messages: SessionCollaborationMessage[] }>("session.collaboration.pending", {});
      checkCurrent(host);
      await Promise.all(pending.messages.map(async (message) => {
        try { await dispatch(message); }
        catch (error) {
          deps.log("Session completion delivery is pending or failed", { messageId: message.id, error: String(error) });
        }
      }));
    })();
    try { await draining; }
    finally { draining = undefined; }
  }

  return {
    async invoke(input: McpControlInvokeInput): Promise<unknown> {
      if (input.source !== "plugin" || !input.pluginContext?.pluginId) {
        fail("PERMISSION_DENIED", "Session collaboration requires a trusted plugin context");
      }
      const args = input.args?.[0];
      if (input.args?.length !== 1 || !args || typeof args !== "object" || Array.isArray(args)) {
        fail("INVALID_ARGUMENT", "One session operation object is required");
      }
      const data = args as Record<string, unknown>;
      const host = requireHost();
      checkCurrent(host, input.signal);
      switch (input.operation) {
        case "session/collaboration/status":
          await drain();
          return readSessionCollaboration(host, deps.getSidecar(), text(data, "sessionId")!);
        case "session/collaboration/list":
          await drain();
          return host.call("session.collaboration.list", {});
        case "session/collaboration/result":
          await drain();
          return host.call("session.collaboration.result", {
            sessionId: text(data, "sessionId"), messageId: text(data, "messageId", false), turnId: text(data, "turnId", false),
          });
        case "session/collaboration/cancel": {
          const result = await cancel(host, {
            sessionId: text(data, "sessionId"), messageId: text(data, "messageId", false),
            pluginId: input.pluginContext.pluginId,
            ...(input.pluginContext.sessionId ? { sourceSessionId: input.pluginContext.sessionId } : {}),
          });
          await drain();
          return result;
        }
        case "session/collaboration/spawn":
        case "session/collaboration/send": {
          const source = sender(input);
          const spawn = input.operation.endsWith("/spawn");
          const content = text(data, spawn ? "task" : "content");
          const notify = data.notifyOnCompletion;
          if (notify !== undefined && typeof notify !== "boolean") fail("INVALID_ARGUMENT", "notifyOnCompletion must be a boolean");
          let model: { providerId: string; modelId: string } | null = null;
          if (spawn) {
            const [listed, settings] = await Promise.all([
              host.call<{ providers: Parameters<typeof listReadyPluginModels>[0] }>("providers.list", { includeDisabled: false }),
              host.call<AppSettings>("settings.get"),
            ]);
            checkCurrent(host, input.signal);
            const models = listReadyPluginModels(listed.providers, settings);
            const requested = text(data, "modelKey", false);
            const chosen = requested ? models.find((item) => item.key === requested)
              : models.find((item) => item.availableForSubagents) ?? models.find((item) => item.isDefault);
            if (!chosen) fail("MODEL_NOT_CONFIGURED", "No matching configured model is available");
            model = parsePluginModelKey(chosen.key);
          }
          checkCurrent(host, input.signal);
          sender(input);
          const response = await host.call<{ message: SessionCollaborationMessage }>(`session.collaboration.${spawn ? "spawn" : "send"}`, {
            ...source, content,
            idempotencyKey: text(data, "idempotencyKey", false) ?? randomUUID(),
            ...(typeof notify === "boolean" ? { notifyOnCompletion: notify } : {}),
            ...(spawn ? { ...model, title: text(data, "title", false) }
              : { sessionId: text(data, "sessionId"), kind: data.kind ?? "message" }),
          });
          return dispatch(response.message, input.signal);
        }
        default: fail("NOT_FOUND", "Unknown session collaboration operation");
      }
    },
    async settle(sessionId: string, turnId: string): Promise<void> {
      const host = deps.getHost();
      if (!host || deps.isQuitting()) return;
      settlements.set(turnId, { sessionId, host });
      // Let final message_end enqueues from this event-loop turn reach the outbox.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await drain();
      deps.onChanged();
    },
    drain,
  };
}
