/**
 * Node pi agent sidecar.
 * Protocol: NDJSON JSON-RPC on stdio with Electron main.
 * Host access is proxied through main (single host-core process).
 */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { ParentHostProxy } from "./parent-host-proxy.js";
import { classifyAgentError } from "./agent-errors.js";
import {
  DesktopAgentRuntime,
  type PluginToolDef,
  type RuntimeProviderConfig,
} from "./runtime.js";
import type { ProjectInstructions } from "./project-instructions.js";
import {
  normalizeSupportedThinkingLevels,
  normalizeThinkingLevel,
} from "./sidecar-config.js";
import { isCommandShellOption, normalizeMode } from "@pi-desktop/shared";
import type {
  AgentEventEnvelope,
  ContextCompactionRecord,
  ContextCompactionSettings,
  CommandShellOption,
  Mode,
  PlanExecution,
  ThinkingLevel,
  UiMessage,
} from "@pi-desktop/shared";

type RuntimeMap = Map<string, DesktopAgentRuntime>;

const runtimes: RuntimeMap = new Map();
const hostProxy = new ParentHostProxy();
const testRuntimeIds = new WeakMap<DesktopAgentRuntime, string>();

function testRuntimeIdentity(sessionId: string) {
  if (process.env.PI_DESKTOP_PLAN_UI_PROBE !== "1") {
    throw Object.assign(new Error("test runtime identity RPC is unavailable"), {
      rpcCode: -32601,
    });
  }
  const runtime = runtimes.get(sessionId);
  if (!runtime) {
    throw Object.assign(new Error("runtime not found for session"), {
      rpcCode: -32000,
      errorCode: "RUNTIME_NOT_FOUND",
    });
  }
  let runtimeId = testRuntimeIds.get(runtime);
  if (!runtimeId) {
    runtimeId = randomUUID();
    testRuntimeIds.set(runtime, runtimeId);
  }
  const status = runtime.getStatus();
  return {
    runtimeId,
    sessionId: runtime.sessionId,
    mode: runtime.getMode(),
    modelId: status.modelId,
    status: {
      isRunning: status.isRunning,
      currentTurnId: status.currentTurnId,
      planningState: status.planningState,
      pendingToolConfirmations: status.pendingToolConfirmations,
      ...(status.pendingPlanId ? { pendingPlanId: status.pendingPlanId } : {}),
    },
  };
}

type RuntimeParams = {
  sessionId: string;
  mode?: Mode;
  /** Durable host turn ID for the prompt currently being executed. */
  turnId?: string;
  thinkingLevel?: ThinkingLevel;
  provider: RuntimeProviderConfig;
  commandShell: CommandShellOption;
  pluginTools?: PluginToolDef[];
  scratchDir?: string;
  projectInstructions?: ProjectInstructions;
  compactionSettings?: ContextCompactionSettings;
};

function write(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function notify(method: string, params: unknown) {
  write({ jsonrpc: "2.0", method, params });
}

function respond(id: string | number, result?: unknown, error?: unknown) {
  if (error) write({ jsonrpc: "2.0", id, error });
  else write({ jsonrpc: "2.0", id, result });
}

async function runtimeFor(
  params: RuntimeParams,
  currentPrompt?: string,
): Promise<DesktopAgentRuntime> {
  const sessionId = String(params.sessionId);
  const mode = normalizeMode(params.mode);
  if (!isCommandShellOption(params.commandShell) || !params.commandShell.available) {
    throw Object.assign(new Error("active command shell is invalid or unavailable"), {
      rpcCode: -32000,
      errorCode: "COMMAND_SHELL_INVALID",
    });
  }
  const providerInput = params.provider;
  const provider = {
    ...providerInput,
    supportsReasoning: providerInput?.supportsReasoning === true,
    supportedThinkingLevels: normalizeSupportedThinkingLevels(
      providerInput?.supportedThinkingLevels,
      providerInput?.supportsReasoning === true,
    ),
  };
  const thinkingLevel = normalizeThinkingLevel(params.thinkingLevel);
  const pluginTools = params.pluginTools ?? [];
  const pluginToolNames = pluginTools.map((tool) => tool.name);
  if (!provider?.modelId || (!provider.apiKey && provider.authKind !== "none")) {
    throw Object.assign(new Error("model/provider not configured"), {
      rpcCode: -32000,
      errorCode: "MODEL_NOT_CONFIGURED",
    });
  }

  const existing = runtimes.get(sessionId);
  if (existing?.getStatus().isRunning) {
    throw Object.assign(new Error("session already has an active turn"), {
      rpcCode: -32000,
      errorCode: "AGENT_BUSY",
    });
  }
  const reusable = existing?.matches(
    mode,
    provider,
    thinkingLevel,
    pluginToolNames,
    params.projectInstructions,
    params.commandShell,
  )
    ? existing
    : undefined;
  if (existing && !reusable) {
    await existing.dispose();
    runtimes.delete(sessionId);
  }
  if (reusable) {
    reusable.setCompactionSettings(params.compactionSettings);
    reusable.setMode(mode);
    return reusable;
  }

  let history: UiMessage[] = [];
  let compaction: ContextCompactionRecord | undefined;
  try {
    const detail = await hostProxy.call<{
      session?: {
        messages?: UiMessage[];
        compaction?: ContextCompactionRecord;
      } | null;
    }>("session.get", { id: sessionId });
    history = detail?.session?.messages ?? [];
    compaction = detail?.session?.compaction;
  } catch {
    // History restore is best-effort; a prompt can still start cleanly.
  }
  if (currentPrompt !== undefined) {
    const last = history.at(-1);
    if (last?.role === "user" && last.content === currentPrompt) {
      history = history.slice(0, -1);
    }
  }
  const runtime = new DesktopAgentRuntime({
    host: hostProxy as any,
    sessionId,
    mode,
    turnId: params.turnId,
    provider,
    commandShell: params.commandShell,
    thinkingLevel,
    history,
    compaction,
    compactionSettings: params.compactionSettings,
    pluginTools,
    projectInstructions: params.projectInstructions,
    scratchDir:
      typeof params.scratchDir === "string" && params.scratchDir
        ? params.scratchDir
        : undefined,
    onEvent: (envelope: AgentEventEnvelope) => notify("agent.event", envelope),
  });
  runtimes.set(sessionId, runtime);
  return runtime;
}

function classifiedRuntimeError(err: unknown) {
  const errorCode = (err as { errorCode?: unknown })?.errorCode;
  if (typeof errorCode === "string") {
    return {
      code: errorCode,
      message: err instanceof Error ? err.message : String(err),
      retriable: false,
    };
  }
  return classifyAgentError(err);
}

// Host notifications (permissions.request never reaches us — main forwards
// it to the renderer directly; re-emitting it here would duplicate the
// permission dialog delivery).

async function handle(method: string, params: any): Promise<unknown> {
  switch (method) {
    case "sidecar.configure": {
      // Main owns host-core; sidecar only keeps config metadata.
      return { ok: true, mode: "host-proxy" };
    }
    case "sidecar.health":
      return { ok: true, runtimes: runtimes.size };
    case "agent.testRuntimeIdentity": {
      return testRuntimeIdentity(String(params.sessionId ?? ""));
    }
    case "agent.prompt": {
      const sessionId = String(params.sessionId);
      const content = String(params.content ?? "");
      const turnId =
        typeof params.turnId === "string" && params.turnId.trim()
          ? params.turnId
          : randomUUID();
      const runtime = await runtimeFor(params, content);
      const userMessageId =
        typeof params.userMessageId === "string" && params.userMessageId
          ? params.userMessageId
          : undefined;
      void runtime.prompt(content, userMessageId, turnId).catch((err) => {
        // Rejected-prompt path (pre-flight/transport failures). Streamed
        // provider errors surface via stopReason "error" and are classified
        // and emitted by the runtime itself.
        notify("agent.event", {
          sessionId,
          turnId,
          ts: Date.now(),
          event: {
            type: "error",
            error: classifiedRuntimeError(err),
          },
        });
      });
      return { accepted: true, turnId };
    }
    case "agent.executeApprovedPlan": {
      const sessionId = String(params.sessionId ?? "");
      const turnId = String(params.turnId ?? "").trim();
      const execution = params.execution as PlanExecution | undefined;
      if (!sessionId || !turnId || !execution) {
        throw Object.assign(new Error("approved plan execution parameters required"), {
          errorCode: "PLAN_EXECUTION_NOT_FOUND",
        });
      }
      const runtime = await runtimeFor({
        ...params,
        sessionId,
        mode: "agent",
        turnId,
      });
      void runtime.executeApprovedPlan(execution, turnId).catch((err) => {
        notify("agent.event", {
          sessionId,
          turnId,
          ts: Date.now(),
          event: {
            type: "error",
            error: classifiedRuntimeError(err),
          },
        });
      });
      return { accepted: true, turnId };
    }
    case "agent.compact": {
      const runtime = await runtimeFor(params);
      await runtime.compactManually();
      return { accepted: true };
    }
    case "agent.abort": {
      const sessionId = String(params.sessionId);
      await hostProxy.call("plans.abort", { sessionId }).catch(() => undefined);
      const runtime = runtimes.get(sessionId);
      if (runtime) await runtime.abort();
      return { ok: true };
    }
    case "agent.getStatus": {
      const sessionId = String(params.sessionId);
      const runtime = runtimes.get(sessionId);
      return {
        status: runtime?.getStatus() ?? {
          sessionId,
          isRunning: false,
          pendingToolConfirmations: 0,
        },
      };
    }
    case "agent.disposeSession": {
      const sessionId = String(params.sessionId);
      const runtime = runtimes.get(sessionId);
      if (runtime) {
        await runtime.dispose();
        runtimes.delete(sessionId);
      }
      return { ok: true };
    }
    default:
      throw Object.assign(new Error(`method not found: ${method}`), {
        rpcCode: -32601,
      });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // Responses to host.proxy requests from parent
  if (hostProxy.handleParentMessage(msg)) return;

  if (!msg.method || msg.id === undefined) return;
  try {
    const result = await handle(msg.method, msg.params ?? {});
    respond(msg.id, result);
  } catch (err: any) {
    respond(msg.id, undefined, {
      code: err.rpcCode ?? -32000,
      message: err instanceof Error ? err.message : String(err),
      data: { errorCode: err.errorCode ?? "INTERNAL" },
    });
  }
});

process.stderr.write("[agent-sidecar] ready (host-proxy mode)\n");
