import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type ProviderStreams,
  type ToolResultMessage,
  type Usage,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import type {
  AgentEventEnvelope,
  AgentStatus,
  MessageUsage,
  Mode,
  ThinkingLevel,
  UiMessage,
} from "@pi-desktop/shared";
import type { HostClient } from "./host-client.js";
import { classifyAgentError } from "./agent-errors.js";
import { clampThinkingLevel, type PiModelConfig } from "./thinking-level.js";


function usageFromPi(usage: Usage | undefined | null): MessageUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = Math.max(0, Math.round(usage.input || 0));
  const outputTokens = Math.max(0, Math.round(usage.output || 0));
  const cacheReadTokens = Math.max(0, Math.round(usage.cacheRead || 0));
  const cacheWriteTokens = Math.max(0, Math.round(usage.cacheWrite || 0));
  const reasoningTokens =
    typeof usage.reasoning === "number"
      ? Math.max(0, Math.round(usage.reasoning))
      : undefined;
  const totalTokens = Math.max(
    0,
    Math.round(
      usage.totalTokens ||
        inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    ),
  );
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    totalTokens,
  };
}

export type RuntimeProviderConfig = {
  id: string;
  name: string;
  baseUrl?: string;
  modelId: string;
  apiKey: string;
  authKind?: string;
  /** Wire protocol for the endpoint (provider config apiStyle). */
  apiStyle?: string;
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  /** Complete model metadata resolved from pi-ai by Electron main. */
  modelConfig?: PiModelConfig;
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

type ApiBinding = {
  api: Api;
  adapter: () => ProviderStreams;
  defaultBaseUrl: string;
};

/** Map a stored provider apiStyle onto a pi-ai wire API. Unknown styles fall
 * back to OpenAI Chat Completions, the pre-apiStyle behavior. */
function apiBindingForStyle(apiStyle?: string): ApiBinding {
  switch (apiStyle) {
    case "responses":
      return {
        api: "openai-responses",
        adapter: openAIResponsesApi,
        defaultBaseUrl: "https://api.openai.com/v1",
      };
    case "anthropic_messages":
      return {
        api: "anthropic-messages",
        adapter: anthropicMessagesApi,
        defaultBaseUrl: "https://api.anthropic.com",
      };
    case "google_generative_ai":
      return {
        api: "google-generative-ai",
        adapter: googleGenerativeAIApi,
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      };
    default:
      return {
        api: "openai-completions",
        adapter: openAICompletionsApi,
        defaultBaseUrl: "https://api.openai.com/v1",
      };
  }
}

export type PluginToolDef = {
  /** Full exposed name (`plugin_<pluginIdSafe>_<toolName>`, D015). */
  name: string;
  description?: string;
  /** JSON schema for arguments (manifest agentTools[].schema). */
  parameters?: unknown;
};

export type AgentRuntimeOptions = {
  host: HostClient;
  sessionId: string;
  mode: Mode;
  provider: RuntimeProviderConfig;
  thinkingLevel: ThinkingLevel;
  systemPrompt?: string;
  /** Persisted transcript to seed the agent with (session isolation: each
   * session's agent carries only its own history). */
  history?: UiMessage[];
  /** Plugin agent tools to expose to the model this session. */
  pluginTools?: PluginToolDef[];
  /** Absolute per-session scratch directory for temporary files (D114).
   * Advertised to the model in the system prompt; host-core enforces it as
   * a second containment root. */
  scratchDir?: string;
  onEvent: (envelope: AgentEventEnvelope) => void;
};

function nowIso() {
  return new Date().toISOString();
}

type AssistantContent = {
  text: string;
  thinking: string;
  hasText: boolean;
  hasThinking: boolean;
};

function assistantContent(content: unknown): AssistantContent {
  if (typeof content === "string") {
    return { text: content, thinking: "", hasText: true, hasThinking: false };
  }
  if (!Array.isArray(content)) {
    return { text: "", thinking: "", hasText: false, hasThinking: false };
  }

  let text = "";
  let thinking = "";
  let hasText = false;
  let hasThinking = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const block = part as {
      type?: string;
      text?: string;
      thinking?: string;
    };
    if (block.type === "text" && typeof block.text === "string") {
      hasText = true;
      text += block.text;
    } else if (block.type === "thinking") {
      hasThinking = true;
      if (typeof block.thinking === "string") {
        thinking += block.thinking;
      } else if (typeof block.text === "string") {
        // Accept OpenAI-compatible adapters that expose thinking as `text`.
        thinking += block.text;
      }
    }
  }
  return { text, thinking, hasText, hasThinking };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Rebuild a pi-ai tool result from a persisted tool row. Rows that never
 * finished (app quit / abort mid-tool) restore as errored results so the
 * model knows the call produced nothing. */
function toolResultFromUi(
  m: UiMessage,
  timestamp: number,
): ToolResultMessage {
  const raw = m.toolResult as
    | { content?: unknown; details?: unknown }
    | string
    | null
    | undefined;
  const blocks: ToolResultMessage["content"] = [];
  const rawBlocks =
    isRecord(raw) && Array.isArray(raw.content) ? raw.content : undefined;
  if (rawBlocks) {
    for (const b of rawBlocks) {
      if (!isRecord(b)) continue;
      if (b.type === "text" && typeof b.text === "string") {
        blocks.push({ type: "text", text: b.text });
      } else if (
        b.type === "image" &&
        typeof b.data === "string" &&
        typeof b.mimeType === "string"
      ) {
        blocks.push({ type: "image", data: b.data, mimeType: b.mimeType });
      }
    }
  } else if (typeof raw === "string" && raw.trim()) {
    blocks.push({ type: "text", text: raw });
  } else if (raw !== undefined && raw !== null) {
    blocks.push({ type: "text", text: safeJson(raw) });
  }
  const interrupted = m.toolStatus === "running";
  if (blocks.length === 0) {
    blocks.push({
      type: "text",
      text: interrupted
        ? "[tool call was interrupted before a result was recorded]"
        : "[no tool result recorded]",
    });
  }
  return {
    role: "toolResult",
    toolCallId: m.toolCallId ?? "",
    toolName: m.toolName ?? "",
    content: blocks,
    ...(isRecord(raw) && raw.details !== undefined
      ? { details: raw.details }
      : {}),
    isError:
      interrupted ||
      m.toolStatus === "error" ||
      m.toolStatus === "denied" ||
      m.isError === true,
    timestamp,
  };
}

export class DesktopAgentRuntime {
  private agent: Agent;
  private turnId?: string;
  private disposed = false;
  readonly sessionId: string;
  private mode: Mode;
  private provider: RuntimeProviderConfig;
  private thinkingLevel: ThinkingLevel;
  private host: HostClient;
  private onEvent: (envelope: AgentEventEnvelope) => void;
  private currentAssistant?: UiMessage;
  private pluginTools: PluginToolDef[];
  private scratchDir?: string;

  constructor(opts: AgentRuntimeOptions) {
    this.sessionId = opts.sessionId;
    this.mode = opts.mode;
    this.provider = opts.provider;
    this.thinkingLevel = clampThinkingLevel(opts.provider, opts.thinkingLevel);
    this.host = opts.host;
    this.onEvent = opts.onEvent;
    this.pluginTools = opts.pluginTools ?? [];
    this.scratchDir = opts.scratchDir;

    const model = this.buildModel();
    const tools = this.buildTools();
    const models = createModels();
    const runtimeApiKey =
      this.provider.apiKey ||
      (this.provider.authKind === "none" ? "pi-desktop-no-auth" : "");
    const provider = createProvider({
      id: this.provider.id,
      name: this.provider.name,
      baseUrl: this.provider.baseUrl,
      auth: {
        apiKey: {
          name: `${this.provider.name} API key`,
          // Plain apiKey semantics let each adapter emit its own auth header
          // (Bearer for OpenAI-style APIs, x-api-key for Anthropic, …).
          resolve: async () => ({ auth: { apiKey: runtimeApiKey } }),
        },
      },
      models: [model],
      api: apiBindingForStyle(this.provider.apiStyle).adapter(),
    });
    models.setProvider(provider);

    this.agent = new Agent({
      streamFn: (m, context, options) =>
        models.streamSimple(m, context, {
          ...options,
          // Transient provider failures (request timeouts, dropped
          // connections, 429/5xx) retry with interruptible backoff instead
          // of failing the turn. A failed turn pushes the user into
          // regenerate, which forks the transcript and reseeds the agent —
          // far more expensive than a retry.
          maxRetries: 2,
        }),
      getApiKey: async () => runtimeApiKey,
      initialState: {
        systemPrompt:
          opts.systemPrompt ??
          [
            "You are PI-Desktop, a local-first coding agent. Prefer concise, actionable answers. Use tools when they help.",
            // Work panel browser preview (D100): workspace HTML files render
            // in the embedded browser with live reload on file changes.
            "When you create or edit an HTML page in the workspace, call the BrowserPreview tool with its workspace-relative path (e.g. `index.html` or `demo/index.html`) to show it in PI-Desktop's built-in browser panel. The preview live-reloads as you keep editing, so one call per page is enough — no external browser or manual refresh needed.",
            // Shell dialect (host-core D084): commands run through bash on
            // every platform — Git Bash on Windows, bash on macOS/Linux.
            process.platform === "win32"
              ? "Shell commands run in Git Bash (POSIX bash on Windows). Always write bash/POSIX syntax with forward-slash paths — never cmd.exe or PowerShell syntax."
              : "Shell commands run in bash. Write bash/POSIX syntax.",
            // Session scratch directory (D114): temp files must not dirty
            // the user's workspace or its git status.
            ...(this.scratchDir
              ? [
                  `Your scratch directory for this session is \`${this.scratchDir}\` (in Bash: $PI_SCRATCH_DIR). Write ALL temporary and intermediate files there using absolute paths — one-off scripts, downloaded data, drafts, experiment output — never into the workspace. Only write into the workspace when the file is a deliverable the user asked for. Scratch files persist across turns of this session and are cleaned up automatically when the session is deleted.`,
                ]
              : []),
          ].join("\n\n"),
        model,
        tools,
        thinkingLevel: this.thinkingLevel,
        messages: this.historyToAgentMessages(opts.history ?? []),
      },
    });

    this.agent.subscribe((event) => {
      void this.handleAgentEvent(event);
    });
  }

  /** True when this runtime can be reused for a prompt with the given config. */
  matches(
    mode: Mode,
    provider: RuntimeProviderConfig,
    thinkingLevelOrPluginToolNames: ThinkingLevel | string[] = this.thinkingLevel,
    pluginToolNames: string[] = [],
  ): boolean {
    // Keep the pre-thinking overload usable for callers that passed plugin
    // names as the third argument. New callers pass the selected level.
    const legacyPluginToolNames = Array.isArray(thinkingLevelOrPluginToolNames)
      ? thinkingLevelOrPluginToolNames
      : undefined;
    const thinkingLevel: ThinkingLevel = Array.isArray(
      thinkingLevelOrPluginToolNames,
    )
      ? this.thinkingLevel
      : thinkingLevelOrPluginToolNames;
    const effectivePluginToolNames =
      legacyPluginToolNames ?? pluginToolNames;
    const current = this.pluginTools.map((t) => t.name).sort().join(",");
    const next = [...effectivePluginToolNames].sort().join(",");
    const currentThinkingLevels = [
      ...(this.provider.supportedThinkingLevels ?? ["off"]),
    ]
      .sort()
      .join(",");
    const nextThinkingLevels = [
      ...(provider.supportedThinkingLevels ?? ["off"]),
    ]
      .sort()
      .join(",");
    return (
      !this.disposed &&
      this.mode === mode &&
      this.provider.id === provider.id &&
      this.provider.modelId === provider.modelId &&
      (this.provider.baseUrl ?? "") === (provider.baseUrl ?? "") &&
      this.provider.apiKey === provider.apiKey &&
      this.provider.authKind === provider.authKind &&
      (this.provider.apiStyle ?? "") === (provider.apiStyle ?? "") &&
      this.provider.supportsReasoning === provider.supportsReasoning &&
      currentThinkingLevels === nextThinkingLevels &&
      safeJson(this.provider.modelConfig ?? null) ===
        safeJson(provider.modelConfig ?? null) &&
      this.thinkingLevel === clampThinkingLevel(provider, thinkingLevel) &&
      current === next
    );
  }

  /* Rebuild pi-ai messages from the persisted transcript, including tool
   * call/result pairs — tool rows persist toolCallId/toolName/toolArgs and
   * the result, which is everything the model context needs. Losing them
   * (the pre-D120 behavior) collapsed a reseeded session to bare chat text:
   * the model forgot every file it had read and, seeing its own history
   * "answer" without visible tool use, stopped calling tools altogether.
   * Failed assistant turns stay transcript-only. */
  private historyToAgentMessages(history: UiMessage[]): AgentMessage[] {
    const zeroUsage: Usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const api = apiBindingForStyle(this.provider.apiStyle).api;
    const messages: AgentMessage[] = [];
    // Tool rows attach their calls to the assistant message that made them
    // (the nearest one above), keeping each call adjacent to its result as
    // the provider APIs require.
    let toolCarrier: AssistantMessage | undefined;
    for (const m of history) {
      const timestamp = Date.parse(m.createdAt) || Date.now();
      if (m.role === "user") {
        toolCarrier = undefined;
        if (!(m.content || "").trim()) continue;
        messages.push({ role: "user", content: m.content, timestamp });
      } else if (m.role === "assistant") {
        toolCarrier = undefined;
        // Failed provider responses belong in the transcript for diagnosis,
        // but must never become model context on the next turn.
        if (m.status === "error" || m.isError || m.error) continue;
        const content: AssistantMessage["content"] = [];
        if (m.thinking?.trim()) {
          content.push({ type: "thinking" as const, thinking: m.thinking });
        }
        if (m.content?.trim()) {
          content.push({ type: "text" as const, text: m.content });
        }
        // Kept even when empty: a call-only turn has no text of its own and
        // becomes the carrier for the tool rows that follow. Assistants that
        // end up with no content and no calls are dropped at the end.
        const assistant: AssistantMessage = {
          role: "assistant",
          content,
          api,
          provider: this.provider.id,
          model: this.provider.modelId,
          usage: zeroUsage,
          stopReason: "stop",
          timestamp,
        };
        messages.push(assistant);
        toolCarrier = assistant;
      } else if (m.role === "tool") {
        if (!m.toolCallId || !m.toolName) continue;
        if (!toolCarrier) {
          // Tool row whose assistant row was lost (truncated branch):
          // synthesize a carrier so the call/result pair stays well-formed.
          toolCarrier = {
            role: "assistant",
            content: [],
            api,
            provider: this.provider.id,
            model: this.provider.modelId,
            usage: zeroUsage,
            stopReason: "toolUse",
            timestamp,
          };
          messages.push(toolCarrier);
        }
        toolCarrier.content.push({
          type: "toolCall",
          id: m.toolCallId,
          name: m.toolName,
          arguments: isRecord(m.toolArgs)
            ? (m.toolArgs as Record<string, unknown>)
            : {},
        });
        toolCarrier.stopReason = "toolUse";
        messages.push(toolResultFromUi(m, timestamp));
      }
    }
    return messages.filter(
      (message) => message.role !== "assistant" || message.content.length > 0,
    );
  }

  private buildModel(): Model<Api> {
    const binding = apiBindingForStyle(this.provider.apiStyle);
    const catalog = this.provider.modelConfig;
    const catalogModel = catalog
      ? (({ source: _source, ...model }) => model)(catalog)
      : {
          name: this.provider.modelId,
          reasoning: false,
          input: ["text" as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          maxTokens: DEFAULT_MAX_TOKENS,
        };
    return {
      ...catalogModel,
      id: this.provider.modelId,
      api: binding.api,
      provider: this.provider.id,
      baseUrl:
        this.provider.baseUrl ?? catalog?.baseUrl ?? binding.defaultBaseUrl,
    } as Model<Api>;
  }

  private buildTools(): AgentTool[] {
    // With a scratch dir provisioned, file tools accept absolute paths into
    // it as a second root (D114); keep the wording in sync with host-core.
    const scratchPathHint = this.scratchDir
      ? " `path` is workspace-relative, or an absolute path inside the session scratch directory."
      : "";
    const describe = (toolName: string): string => {
      switch (toolName) {
        case "BrowserPreview":
          return "Open a workspace HTML file in PI-Desktop's built-in browser panel. `path` is workspace-relative (e.g. \"demo/index.html\"). The preview live-reloads on later edits to the file or its sibling assets, so call once per page.";
        case "Read":
          return `Read a file.${scratchPathHint}`;
        case "Write":
          return `Create or overwrite a file. Deliverables go into the workspace; temporary/intermediate files go into the scratch directory.${scratchPathHint}`;
        case "Edit":
          return `Replace text in a file (first occurrence of old_string).${scratchPathHint}`;
        case "Bash":
          return this.scratchDir
            ? "Run a non-interactive shell command in the workspace root. $PI_SCRATCH_DIR points at the session scratch directory for temporary files."
            : "Run a non-interactive shell command in the workspace root.";
        default:
          return `${toolName} tool via PI-Desktop host-core`;
      }
    };
    const exec = (toolName: string): AgentTool => ({
      name: toolName,
      label: toolName,
      description: describe(toolName),
      parameters: Type.Object(
        toolName === "Read" || toolName === "BrowserPreview"
          ? { path: Type.String() }
          : toolName === "Glob"
            ? { pattern: Type.String() }
            : toolName === "Grep"
              ? {
                  pattern: Type.String(),
                  caseInsensitive: Type.Optional(Type.Boolean()),
                }
              : toolName === "Write"
                ? { path: Type.String(), content: Type.String() }
                : toolName === "Edit"
                  ? {
                      path: Type.String(),
                      old_string: Type.String(),
                      new_string: Type.String(),
                    }
                  : { command: Type.String() },
      ),
      execute: async (toolCallId, params) => {
        const result = await this.host.call<{
          ok: boolean;
          content: unknown;
          isError?: boolean;
          errorCode?: string;
          denied?: boolean;
        }>("tools.execute", {
          sessionId: this.sessionId,
          turnId: this.turnId,
          toolCallId,
          toolName,
          args: params,
          mode: this.mode,
          timeoutMs: 60_000,
        });
        const text =
          typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content, null, 2);
        return {
          content: [{ type: "text", text }],
          details: result.content,
        };
      },
    });

    // BrowserPreview is non-mutating (renders an existing workspace file in
    // the work panel browser), so it ships in every mode.
    const tools = ["Read", "Glob", "Grep", "BrowserPreview"];
    if (this.mode === "agent") {
      tools.push("Write", "Edit", "Bash");
    }
    const builtins = tools.map(exec);

    const hostExecute = (toolName: string) =>
      exec(toolName).execute;
    const pluginTools: AgentTool[] = this.pluginTools.map((def) => ({
      name: def.name,
      label: def.name,
      description: def.description || `${def.name} plugin tool`,
      parameters: (def.parameters ??
        Type.Object({})) as AgentTool["parameters"],
      execute: hostExecute(def.name),
    }));
    return [...builtins, ...pluginTools];
  }

  private emit(event: AgentEventEnvelope["event"], turnId?: string) {
    this.onEvent({
      sessionId: this.sessionId,
      turnId: turnId ?? this.turnId,
      ts: Date.now(),
      event,
    });
  }

  private async handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "agent_start":
        this.emit({ type: "agent_start" });
        break;
      case "turn_start":
        this.emit({ type: "turn_start" });
        break;
      case "message_start": {
        if (event.message.role === "assistant") {
          const content = assistantContent((event.message as any).content);
          this.currentAssistant = {
            id: randomUUID(),
            role: "assistant",
            content: content.text,
            ...(content.hasThinking && content.thinking
              ? { thinking: content.thinking }
              : {}),
            createdAt: nowIso(),
            status: "streaming",
            modelId: this.provider.modelId,
            providerId: this.provider.id,
          };
          this.emit({ type: "message_start", message: this.currentAssistant });
        }
        // User messages are echoed and persisted by the desktop main process
        // (agentPrompt handler); re-emitting them here would duplicate the
        // bubble in the transcript since each emit mints a fresh id.
        break;
      }
      case "message_update": {
        if (this.currentAssistant && event.message.role === "assistant") {
          const content = assistantContent((event.message as any).content);
          const previousText = this.currentAssistant.content;
          const previousThinking = this.currentAssistant.thinking ?? "";
          const nextText = content.hasText ? content.text : previousText;
          const nextThinking = content.hasThinking
            ? content.thinking
            : previousThinking;
          const deltaText = content.hasText
            ? content.text.startsWith(previousText)
              ? content.text.slice(previousText.length)
              : content.text
            : "";
          const deltaThinking = content.hasThinking
            ? content.thinking.startsWith(previousThinking)
              ? content.thinking.slice(previousThinking.length)
              : content.thinking
            : "";
          this.currentAssistant = {
            ...this.currentAssistant,
            content: nextText,
            ...(nextThinking
              ? { thinking: nextThinking }
              : content.hasThinking
                ? { thinking: undefined }
                : {}),
            status: "streaming",
          };
          this.emit({
            type: "message_update",
            message: this.currentAssistant,
            deltaText,
            ...(deltaThinking ? { deltaThinking } : {}),
          });
        }
        break;
      }
      case "message_end": {
        if (this.currentAssistant && event.message.role === "assistant") {
          const content = assistantContent((event.message as any).content);
          // pi-agent-core encodes stream failures in the final message
          // (stopReason "error"/"aborted" + errorMessage) and resolves the
          // prompt normally, so this is where provider/model errors surface.
          const stopReason = (event.message as any).stopReason as
            | string
            | undefined;
          const failed = stopReason === "error";
          const aborted = stopReason === "aborted";
          const errorMessage =
            failed &&
            typeof (event.message as any).errorMessage === "string" &&
            (event.message as any).errorMessage
              ? ((event.message as any).errorMessage as string)
              : failed
                ? "provider stream failed"
                : undefined;
          const classifiedError = errorMessage
            ? classifyAgentError(errorMessage)
            : undefined;
          const nextText = content.hasText
            ? content.text
            : this.currentAssistant.content;
          const nextThinking = content.hasThinking
            ? content.thinking
            : this.currentAssistant.thinking ?? "";
          const usage = usageFromPi((event.message as any).usage as Usage | undefined);
          this.currentAssistant = {
            ...this.currentAssistant,
            content: nextText,
            ...(nextThinking
              ? { thinking: nextThinking }
              : content.hasThinking
                ? { thinking: undefined }
                : {}),
            status: failed ? "error" : aborted ? "aborted" : "complete",
            modelId: this.provider.modelId,
            providerId: this.provider.id,
            ...(usage ? { usage } : {}),
            ...(classifiedError
              ? { error: classifiedError, isError: true }
              : {}),
          };
          this.emit({ type: "message_end", message: this.currentAssistant });
          this.currentAssistant = undefined;
          if (classifiedError) {
            this.emit({ type: "error", error: classifiedError });
          }
        }
        break;
      }
      case "tool_execution_start":
        this.emit({
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_update":
        this.emit({
          type: "tool_update",
          toolCallId: event.toolCallId,
          partialResult: event.partialResult,
        });
        break;
      case "tool_execution_end":
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
        });
        break;
      case "turn_end":
        this.emit({ type: "turn_end" });
        break;
      case "agent_end":
        this.emit({
          type: "agent_end",
          messageIds: [],
        });
        break;
      default:
        break;
    }
  }

  /** Resolve a bubble left in "streaming" when the run dies without a
   * message_end (rejected prompt), so the transcript never sticks mid-stream. */
  private finalizeCurrentAssistant(
    status: "error" | "aborted",
    error?: ReturnType<typeof classifyAgentError>,
  ) {
    if (!this.currentAssistant) {
      if (status !== "error" || !error) return;
      this.currentAssistant = {
        id: randomUUID(),
        role: "assistant",
        content: "",
        createdAt: nowIso(),
        status,
        modelId: this.provider.modelId,
        providerId: this.provider.id,
        error,
        isError: true,
      };
      this.emit({ type: "message_start", message: this.currentAssistant });
    } else {
      this.currentAssistant = {
        ...this.currentAssistant,
        status,
        ...(error ? { error, isError: true } : {}),
      };
    }
    this.emit({ type: "message_end", message: this.currentAssistant });
    this.currentAssistant = undefined;
  }

  async prompt(content: string): Promise<{ turnId: string }> {
    if (this.disposed) throw new Error("runtime disposed");
    this.turnId = randomUUID();
    this.emit({
      type: "status",
      status: this.getStatus(),
    });
    try {
      await this.agent.prompt(content);
      await this.agent.waitForIdle();
    } catch (err) {
      const classifiedError = classifyAgentError(err);
      this.finalizeCurrentAssistant(
        classifiedError.code === "TURN_ABORTED" ? "aborted" : "error",
        classifiedError.code === "TURN_ABORTED" ? undefined : classifiedError,
      );
      throw err;
    }
    return { turnId: this.turnId };
  }

  async abort(): Promise<void> {
    this.agent.abort();
  }

  getStatus(): AgentStatus {
    return {
      sessionId: this.sessionId,
      isRunning: this.agent.state.isStreaming,
      currentTurnId: this.turnId,
      modelId: this.provider.modelId,
      pendingToolConfirmations: 0,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.agent.abort();
  }
}
