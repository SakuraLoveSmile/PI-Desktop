import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { IPC } = await import("@pi-desktop/shared");
const { registerAgentIpc } = await import("../electron/main/ipc/agent-ipc.ts");

test("agent prompt IPC persists Skill mentions and sends ordered instructions", async () => {
  const handlers = new Map();
  const events = [];
  const appendedMessages = [];
  const sidecarPrompts = [];
  const session = { id: "session-1", projectPath: "/workspace", messages: [] };
  const host = {
    async call(method, params) {
      if (method === "settings.get") return {};
      if (method === "session.get") return { session };
      if (method === "session.beginTurn") return { turnId: "turn-1" };
      if (method === "session.appendMessage") {
        appendedMessages.push(params.message);
        return {};
      }
      throw new Error(`Unexpected Host method: ${method}`);
    },
  };
  const sidecar = {
    setProjectInstructionRoot() {},
    setVendorAuthBindings() {},
    async call(method, params) {
      if (method !== "agent.prompt") throw new Error(`Unexpected sidecar method: ${method}`);
      sidecarPrompts.push(params);
      return { accepted: true, turnId: "turn-1" };
    },
  };

  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => host,
    getSidecar: () => sidecar,
    getAgentHostBridge: () => null,
    logger: { app() {} },
    vendorOAuth: {},
    agentExtensions: {},
    cancelSessionTools() {},
    persistenceOutbox: { async flush() {} },
    dataDir: "/data",
    activeTurns: new Map(),
    isTurnDispatchable: () => true,
    activeTurnUsages: new Map(),
    approvedExecutionIdsBySession: new Map(),
    claimedExecutionSessions: new Map(),
    resolveAgentRuntimeLaunch: async () => ({
      providerId: "provider-1",
      modelId: "model-1",
      projectPath: "/workspace",
      sidecarParams: {
        provider: { modelConfig: { modalities: { input: [] }, input: [] } },
      },
    }),
    acquireSessionOperation: async () => () => {},
    finishTurn: async () => {},
    lockAbortReason() {},
    finishApprovedExecution: async () => {},
    dispatchApprovedPlan: async () => {},
    dispatchExecutionForProposal: async () => {},
    emitAgentEvent: (envelope) => events.push(envelope),
    setNotificationViewingSessionId() {},
    optionalWorkspaceRoot: async () => null,
    composerCommandService: {
      async buildComposerCommands() {
        return [
          { name: "skill-a", kind: "skill", skillId: "skill-a-id" },
          { name: "skill-b", kind: "skill", skillId: "skill-b-id" },
        ];
      },
    },
    loadComposerTemplatesCached: async () => [],
  });

  const input = "/skill-a 🦋 /skill-b compare these approaches";
  const handler = handlers.get(IPC.invoke.agentPrompt);
  assert.equal(typeof handler, "function");
  const result = await handler({ sessionId: "session-1", messageId: "message-1", content: input });

  assert.deepEqual(result, { accepted: true, turnId: "turn-1" });
  assert.equal(appendedMessages.length, 1);
  const message = appendedMessages[0];
  assert.equal(message.command, input);
  assert.deepEqual(message.skillMentions, [
    { start: 0, end: "/skill-a".length, id: "skill-a-id" },
    {
      start: input.indexOf("/skill-b"),
      end: input.indexOf("/skill-b") + "/skill-b".length,
      id: "skill-b-id",
    },
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].event.message.skillMentions, message.skillMentions);
  assert.equal(sidecarPrompts.length, 1);
  assert.match(sidecarPrompts[0].content, /"skill-a-id", "skill-b-id"/);
  assert.match(sidecarPrompts[0].content, /🦋/);
  assert.match(sidecarPrompts[0].content, /compare these approaches/);
});
