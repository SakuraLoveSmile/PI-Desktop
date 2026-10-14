/** Production Desktop prompt, launch, event persistence and turn finalization.
 * The fixture omits renderer, OAuth and installed plugins, and uses the real
 * Rust Host, sidecar and file-backed persistence outbox supplied by its caller.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { IPC } from "../../packages/shared/dist/protocol.js";
import { InflightCheckpointer } from "../../packages/host-runtime/dist/inflight-checkpoint.js";
import { capabilitiesFromModelConfig } from "../../packages/agent-runtime/dist/model-capabilities.js";

export async function unattendedDesktopRuntime({ host, sidecar, dataDir, workspace, handlers, events, results, logs }) {
  const { createAgentHostBridge } = await import("../../apps/desktop/electron/main/agent-host-bridge.ts");
  const { registerAgentIpc } = await import("../../apps/desktop/electron/main/ipc/agent-ipc.ts");
  const { createSessionCoordination } = await import("../../apps/desktop/electron/main/runtime/session-coordination.ts");
  const { createPlanRuntime } = await import("../../apps/desktop/electron/main/runtime/plans.ts");
  const { createEventPersistence } = await import("../../apps/desktop/electron/main/runtime/event-persistence.ts");
  const { PersistenceOutbox } = await import("../../apps/desktop/electron/main/persistence-outbox.ts");
  const { createSessionLaunchRuntime } = await import("../../apps/desktop/electron/main/runtime/session-launch.ts");
  const { ModelsDevCatalog } = await import("../../apps/desktop/electron/main/models-dev-catalog.ts");
  const activeTurns = new Map(), activeToolCalls = new Map(), approvedExecutionIdsBySession = new Map();
  const claimedExecutionSessions = new Map(), approvedExecutionTurns = new Map(), planSubmissionTurnIds = new Set();
  const runtimeState = { host, sidecar };
  const logger = { app: (...args) => logs.push(args) };
  const coordination = createSessionCoordination({ activeTurns, getMainWindow: () => null, getViewingSessionId: () => null });
  const outboxErrors = [];
  const outbox = new PersistenceOutbox(dataDir, (...args) => { logs.push(args); outboxErrors.push(args); });
  const launch = createSessionLaunchRuntime({ runtimeState, logger, dataDir,
    userMcp: { setRecords() {}, toolsForProject: async () => [] },
    plugins: { listLoaded: () => [], getSkills: () => [], getTools: () => [], getAgentExtensions: () => [] },
    sessionProjects: new Map(), vendorOAuth: {},
    modelsDevCatalog: new ModelsDevCatalog({ catalogPath: fileURLToPath(new URL("../../apps/desktop/resources/models.dev/api.json", import.meta.url)) }),
    getWorkspacePath: () => workspace, pluginActiveInProject: () => false,
    bindingForModel: (row, id) => row.models?.find(model => model.id === id),
    effectiveSubagentModelConfig: (_provider, _id, modelConfig) => ({ modelConfig, capabilities: capabilitiesFromModelConfig(modelConfig) }),
    normalizeThinkingLevel: () => "off" });
  const bridge = createAgentHostBridge({ getHost: () => host, channels: IPC.invoke,
    isSessionBusy: coordination.isSessionBusy, log: (...args) => logs.push(args),
    invoke: async (channel, args) => {
      assert.ok(handlers.has(channel), `Missing production Desktop handler: ${channel}`);
      return handlers.get(channel)(...args);
    } });
  runtimeState.agentHostBridge = bridge;
  const plans = createPlanRuntime({ runtimeState, planState: { approvedExecutionDrain: null }, logger,
    sendToRenderer() {}, coordination, scheduledRunsBySession: new Map(), activeToolCalls, planSubmissionTurnIds,
    approvedExecutionIdsBySession, claimedExecutionSessions, approvedExecutionTurns, startedApprovedExecutions: new Set(),
    finishedApprovedExecutions: new Set(), dispatchingApprovedExecutions: new Set(), inFlightExecutionFinishes: new Set(),
    pendingExecutionFinishes: new Map(), announceTurnEnded: ended => results.push({ ended }), emitAgentEvent() {},
    acquireSessionOperation: coordination.acquireSessionOperation, resolveAgentRuntimeLaunch: launch.resolveAgentRuntimeLaunch,
    isQuitting: () => false, persistenceOutbox: outbox });
  registerAgentIpc({ registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => host, getSidecar: () => sidecar, getAgentHostBridge: () => bridge, logger, dataDir, activeTurns,
    vendorOAuth: {}, agentExtensions: { cancelPrompts() {} }, cancelSessionTools() {}, persistenceOutbox: outbox,
    isTurnDispatchable: coordination.isTurnDispatchable, activeTurnUsages: coordination.activeTurnUsages,
    approvedExecutionIdsBySession, claimedExecutionSessions, acquireSessionOperation: coordination.acquireSessionOperation,
    resolveAgentRuntimeLaunch: launch.resolveAgentRuntimeLaunch, lockAbortReason: coordination.lockAbortReason,
    ...plans, waitForTurnSettlement: coordination.waitForTurnSettlement, emitAgentEvent() {},
    setNotificationViewingSessionId() {}, optionalWorkspaceRoot: async () => workspace,
    composerCommandService: { buildComposerCommands: async () => [] }, loadComposerTemplatesCached: async () => [] });
  const checkpointer = new InflightCheckpointer(checkpoint => host.call("session.saveInflightMessage", checkpoint));
  const persistence = createEventPersistence({ runtimeState, steeringReplies: new Set(), activeTurns, activeToolCalls,
    activeToolCallKey: coordination.activeToolCallKey, approvedExecutionIdsBySession, approvedExecutionTurns,
    planSubmissionTurnIds, planSubmissionTurnKey: coordination.planSubmissionTurnKey, inflightCheckpointer: checkpointer,
    persistenceOutbox: outbox, addActiveTurnUsage: coordination.addActiveTurnUsage, logger,
    ...plans, isStaleTerminalEvent: coordination.isStaleTerminalEvent, emitAgentEvent() {} });
  const detach = sidecar.onNotification((method, envelope) => {
    if (method !== "agent.event") return;
    events.push(envelope);
    if (!coordination.isStaleTerminalEvent(envelope)) bridge.ingest(envelope);
    persistence.persistAgentEvent(envelope);
  });
  return {
    async flushPersistence(sessionId) {
      await outbox.flush(() => host);
      return { pending: outbox.size(sessionId), failed: outboxErrors.map(entry => String(entry[1])) };
    },
    respondInput: input => handlers.get(IPC.invoke.askToolResolve)(input),
    pendingInteractive: sessionId => handlers.get(IPC.invoke.pendingInteractive)({ sessionId }),
    async dispose() {
      detach(); await checkpointer.flushAll(); checkpointer.dispose(); await outbox.flush(() => host);
    },
  };
}
