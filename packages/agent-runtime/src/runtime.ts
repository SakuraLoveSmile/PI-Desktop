import { randomUUID } from "node:crypto";
import {
  Agent,
  buildSessionContext,
  compact,
  convertToLlm,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  type AgentContext,
  type AgentEvent,
  type AgentLoopTurnUpdate,
  type AgentMessage,
  type AgentTool,
  type CompactionEntry,
  type CompactionSettings,
  type MessageEntry,
  type PrepareNextTurnContext,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  isContextOverflow,
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type ProviderStreams,
  type ToolResultMessage,
  type Usage,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from "@pi-desktop/shared";
import type {
  AgentEventEnvelope,
  AgentStatus,
  ContextCompactionReason,
  ContextCompactionRecord,
  ContextCompactionSettings,
  MessageUsage,
  Mode,
  ThinkingLevel,
  UiMessage,
} from "@pi-desktop/shared";
import type { HostClient } from "./host-client.js";
import { classifyAgentError } from "./agent-errors.js";
import { clampThinkingLevel, type PiModelConfig } from "./thinking-level.js";
import type { ProjectInstructions } from "./project-instructions.js";
import { projectInstructionsPrompt } from "./project-instructions-prompt.js";
import { pluginSkillsPrompt } from "./plugin-skills-prompt.js";
import { pluginSkillsDigest, type PluginSkills } from "./plugin-skills.js";
import { logTiming } from "./timing.js";


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

function usageToPi(usage: MessageUsage | undefined): Usage {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const cacheRead = usage?.cacheReadTokens ?? 0;
  const cacheWrite = usage?.cacheWriteTokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(usage?.reasoningTokens !== undefined
      ? { reasoning: usage.reasoningTokens }
      : {}),
    totalTokens:
      usage?.totalTokens ?? input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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
const CONTEXT_COMPACTION_TOOL_NAME = "CompactContext";
const CONTEXT_NUDGE_TURN_INTERVAL = 3;
const CHECKPOINT_TAIL_SAFETY_TOKENS = 256;
const PATH_SCOPED_INSTRUCTION_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "BrowserPreview",
]);
const CHECKPOINT_TOOL_RESULT_TRUNCATION_MARKER =
  "\n\n[checkpoint truncated: tool result exceeded the retained context budget]\n\n";
const CONTEXT_COMPACTION_NUDGE = [
  "<context_management>",
  "The working context is approaching its safe limit.",
  `Before starting more exploration, call ${CONTEXT_COMPACTION_TOOL_NAME} once with a short focus describing the active task and the facts that must survive.`,
  "You may finish the current atomic tool batch first. Do not call the tool repeatedly after it confirms the request.",
  "</context_management>",
].join("\n");

function normalizeCompactionSettings(
  value?: Partial<ContextCompactionSettings>,
): CompactionSettings {
  const positiveInt = (candidate: unknown, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
      ? Math.round(candidate)
      : fallback;
  return {
    enabled: value?.enabled !== false,
    reserveTokens: positiveInt(
      value?.reserveTokens,
      DEFAULT_CONTEXT_COMPACTION_SETTINGS.reserveTokens,
    ),
    keepRecentTokens: positiveInt(
      value?.keepRecentTokens,
      DEFAULT_CONTEXT_COMPACTION_SETTINGS.keepRecentTokens,
    ),
  };
}

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
  /** Instructions resolved from the session's workspace. */
  projectInstructions?: ProjectInstructions;
  /** Persisted transcript to seed the agent with (session isolation: each
   * session's agent carries only its own history). */
  history?: UiMessage[];
  /** Latest host-owned checkpoint used only to rebuild model context. */
  compaction?: ContextCompactionRecord;
  compactionSettings?: ContextCompactionSettings;
  /** Plugin agent tools to expose to the model this session. */
  pluginTools?: PluginToolDef[];
  /** Skill documents contributed by enabled plugins (`contributes.skills`). */
  pluginSkills?: PluginSkills;
  /** Absolute per-session scratch directory for temporary files (D114).
   * Advertised to the model in the system prompt; host-core enforces it as
   * a second containment root. */
  scratchDir?: string;
  onEvent: (envelope: AgentEventEnvelope) => void;
};

function nowIso() {
  return new Date().toISOString();
}

function timestampIso(timestamp: unknown): string {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : nowIso();
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

function retainedTailForContext(value: unknown): AgentMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((message) => {
    if (message.role !== "assistant") return message as unknown as AgentMessage;
    // Provider usage describes the request before compaction. Reusing it in a
    // restored retained tail makes the next budget calculation count the old
    // full context again instead of the compacted context.
    return {
      ...message,
      usage: usageToPi(undefined),
    } as AgentMessage;
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function fairToolResultTokenBudgets(
  tokenCounts: number[],
  totalBudget: number,
): number[] {
  if (tokenCounts.length === 0) return [];
  if (tokenCounts.reduce((sum, value) => sum + value, 0) <= totalBudget) {
    return tokenCounts;
  }

  const budgets = tokenCounts.map(() => 0);
  let remainingBudget = Math.max(tokenCounts.length, totalBudget);
  let pending = tokenCounts.map((_, index) => index);
  while (pending.length > 0) {
    const share = Math.floor(remainingBudget / pending.length);
    const complete = pending.filter((index) => tokenCounts[index] <= share);
    if (complete.length === 0) {
      const remainder = remainingBudget - share * pending.length;
      pending.forEach((index, position) => {
        budgets[index] = share + (position < remainder ? 1 : 0);
      });
      break;
    }
    for (const index of complete) {
      budgets[index] = tokenCounts[index];
      remainingBudget -= tokenCounts[index];
    }
    const completed = new Set(complete);
    pending = pending.filter((index) => !completed.has(index));
  }
  return budgets;
}

function toolResultTextForCheckpoint(message: ToolResultMessage): string {
  return message.content
    .map((block) =>
      block.type === "text"
        ? block.text
        : `[${block.type} tool result block omitted from checkpoint]`,
    )
    .join("\n");
}

function truncateTextForCheckpoint(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= CHECKPOINT_TOOL_RESULT_TRUNCATION_MARKER.length) {
    return CHECKPOINT_TOOL_RESULT_TRUNCATION_MARKER.trim().slice(0, maxChars);
  }
  const retainedChars = maxChars - CHECKPOINT_TOOL_RESULT_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(retainedChars * 0.75);
  const tailChars = retainedChars - headChars;
  return `${text.slice(0, headChars)}${CHECKPOINT_TOOL_RESULT_TRUNCATION_MARKER}${
    tailChars > 0 ? text.slice(-tailChars) : ""
  }`;
}

function truncateToolResultForCheckpoint(
  message: ToolResultMessage,
  tokenBudget: number,
): ToolResultMessage {
  const text = toolResultTextForCheckpoint(message);
  return {
    ...message,
    content: [
      {
        type: "text",
        text: truncateTextForCheckpoint(text, Math.max(1, tokenBudget) * 4),
      },
    ],
    // Host details often duplicate the content and are not provider-facing.
    // The original durable message still owns the complete diagnostic value.
    details: undefined,
  };
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
  private models: Models;
  private model: Model<Api>;
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
  private pluginSkills?: PluginSkills;
  private scratchDir?: string;
  private baseSystemPrompt: string;
  private baseProjectInstructions?: ProjectInstructions;
  private projectInstructions?: ProjectInstructions;
  /* Timing anchors (D137). `requestStartedAt` marks the moment the agent is
   * free to issue the next provider request — turn start, or the last tool
   * result coming back — so `providerWaitMs` below is the model's own latency
   * rather than the whole turn. With parallel tool calls the last one wins,
   * which is the correct anchor: the request goes out once all have resolved. */
  private requestStartedAt?: number;
  private streamStartedAt?: number;
  private fullEntries: MessageEntry[];
  private activeCompaction?: ContextCompactionRecord;
  private compactionSettings: CompactionSettings;
  private pendingUserMessageId?: string;
  private pendingOverflow = false;
  private overflowRecoveryAttempted = false;
  private suppressOverflowRunEnd = false;
  private turnHadError = false;
  private compactionAbort?: AbortController;
  private compactionInProgress = false;
  private pendingModelCompaction?: { instructions?: string };
  private nudgeCooldownTurns = 0;

  constructor(opts: AgentRuntimeOptions) {
    this.sessionId = opts.sessionId;
    this.mode = opts.mode;
    this.provider = opts.provider;
    this.thinkingLevel = clampThinkingLevel(opts.provider, opts.thinkingLevel);
    this.host = opts.host;
    this.onEvent = opts.onEvent;
    this.pluginTools = opts.pluginTools ?? [];
    this.pluginSkills = opts.pluginSkills;
    this.scratchDir = opts.scratchDir;
    this.baseProjectInstructions = opts.projectInstructions;
    this.projectInstructions = opts.projectInstructions;
    this.compactionSettings = normalizeCompactionSettings(
      opts.compactionSettings,
    );

    const model = this.buildModel();
    this.model = model;
    const tools = this.buildTools();
    const models = createModels();
    this.models = models;
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

    this.fullEntries = this.historyToEntries(opts.history ?? []);
    this.activeCompaction = opts.compaction;
    const projectInstructions = projectInstructionsPrompt(
      this.projectInstructions,
    );
    const pluginSkills = pluginSkillsPrompt(this.pluginSkills);
    const baseSystemPrompt =
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
      ].join("\n\n");
    this.baseSystemPrompt = baseSystemPrompt;

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
      convertToLlm,
      prepareNextTurnWithContext: (context, signal) =>
        this.prepareNextTurn(context, signal),
      initialState: {
        systemPrompt: [
          baseSystemPrompt,
          // Plugin skills sit ahead of the instruction chain so the user's own
          // AGENTS.md keeps the last word, matching how the chain itself gives
          // later entries precedence.
          ...(pluginSkills ? [pluginSkills] : []),
          ...(projectInstructions ? [projectInstructions] : []),
        ].join("\n\n"),
        model,
        tools,
        thinkingLevel: this.thinkingLevel,
        messages: buildSessionContext(this.entriesWithCompaction()).messages,
      },
    });

    this.agent.subscribe((event) => this.handleAgentEvent(event));
  }

  /** True when this runtime can be reused for a prompt with the given config. */
  matches(
    mode: Mode,
    provider: RuntimeProviderConfig,
    thinkingLevelOrPluginToolNames: ThinkingLevel | string[] = this.thinkingLevel,
    pluginToolNames: string[] = [],
    projectInstructions?: ProjectInstructions,
    pluginSkills?: PluginSkills,
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
      current === next &&
      safeJson(this.baseProjectInstructions ?? null) ===
        safeJson(projectInstructions ?? null) &&
      // Enabling a plugin, revoking agent.prompt.inject or editing a skill file
      // changes the digest, which retires the runtime and its stale prompt.
      pluginSkillsDigest(this.pluginSkills) === pluginSkillsDigest(pluginSkills)
    );
  }

  /* Rebuild pi-ai messages from the persisted transcript, including tool
   * call/result pairs — tool rows persist toolCallId/toolName/toolArgs and
   * the result, which is everything the model context needs. Losing them
   * (the pre-D120 behavior) collapsed a reseeded session to bare chat text:
   * the model forgot every file it had read and, seeing its own history
   * "answer" without visible tool use, stopped calling tools altogether.
   * Failed assistant turns stay transcript-only. */
  private historyToEntries(history: UiMessage[]): MessageEntry[] {
    const api = apiBindingForStyle(this.provider.apiStyle).api;
    const entries: MessageEntry[] = [];
    const append = (id: string, message: AgentMessage): MessageEntry => {
      const entry: MessageEntry = {
        type: "message",
        id,
        parentId: entries.at(-1)?.id ?? null,
        timestamp: timestampIso(message.timestamp),
        message,
      };
      entries.push(entry);
      return entry;
    };
    // Tool rows attach their calls to the assistant message that made them
    // (the nearest one above), keeping each call adjacent to its result as
    // the provider APIs require.
    let toolCarrier: AssistantMessage | undefined;
    for (const m of history) {
      const timestamp = Date.parse(m.createdAt) || Date.now();
      if (m.role === "user") {
        toolCarrier = undefined;
        if (!(m.content || "").trim()) continue;
        append(m.id, { role: "user", content: m.content, timestamp });
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
          usage: usageToPi(m.usage),
          stopReason: "stop",
          timestamp,
        };
        append(m.id, assistant);
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
            usage: usageToPi(undefined),
            stopReason: "toolUse",
            timestamp,
          };
          append(`${m.id}:carrier`, toolCarrier);
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
        append(m.id, toolResultFromUi(m, timestamp));
      }
    }
    return entries.filter(
      (entry) =>
        entry.message.role !== "assistant" || entry.message.content.length > 0,
    );
  }

  private entriesWithCompaction(
    checkpoint: ContextCompactionRecord | undefined = this.activeCompaction,
  ): SessionTreeEntry[] {
    const entries: SessionTreeEntry[] = [...this.fullEntries];
    if (!checkpoint) return entries;
    const throughIndex = entries.findIndex(
      (entry) => entry.id === checkpoint.throughMessageId,
    );
    if (throughIndex < 0) return entries;
    const compactionEntry: CompactionEntry = {
      type: "compaction",
      id: checkpoint.id,
      parentId: checkpoint.throughMessageId,
      timestamp: checkpoint.createdAt,
      summary: checkpoint.summary,
      firstKeptEntryId: checkpoint.firstKeptMessageId,
      tokensBefore: checkpoint.tokensBefore,
      retainedTail: retainedTailForContext(checkpoint.retainedTail),
      details: checkpoint.details,
      usage: checkpoint.usage as Usage | undefined,
    };
    entries.splice(throughIndex + 1, 0, compactionEntry);
    return entries;
  }

  private appendLiveEntry(id: string, message: AgentMessage): void {
    if (!id || this.fullEntries.some((entry) => entry.id === id)) return;
    this.fullEntries.push({
      type: "message",
      id,
      parentId: this.fullEntries.at(-1)?.id ?? null,
      timestamp: timestampIso(message.timestamp),
      message,
    });
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
        await this.loadPathInstructions(toolName, params);
        const startedAt = Date.now();
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
        // hostRttMs spans approval + execution + IPC. Compare it against the
        // host's own "tool timing" line for the same toolCallId: the gap is
        // the stdio hops, and permissionWaitMs there explains a large value.
        logTiming("tool", {
          tool: toolName,
          toolCallId,
          sessionId: this.sessionId,
          turnId: this.turnId,
          hostRttMs: Date.now() - startedAt,
          ok: result.ok,
          errorCode: result.errorCode,
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
    const contextTools = this.compactionSettings.enabled
      ? [this.buildContextCompactionTool()]
      : [];
    return [...builtins, ...pluginTools, ...contextTools];
  }

  private async loadPathInstructions(
    toolName: string,
    params: unknown,
  ): Promise<void> {
    if (!PATH_SCOPED_INSTRUCTION_TOOLS.has(toolName)) {
      return;
    }
    const path = isRecord(params) && typeof params.path === "string"
      ? params.path.trim()
      : "";
    if (!path) return;

    let resolved: ProjectInstructions | undefined;
    try {
      resolved = await this.host.call<ProjectInstructions | undefined>(
        "project.instructions.resolve",
        { sessionId: this.sessionId, path },
      );
    } catch {
      return;
    }
    // Rules are scoped to the file currently being accessed. Rebuild the
    // complete chain so sibling-directory rules never leak into one another
    // and edits to an existing instruction file take effect immediately.
    this.projectInstructions = resolved;
    const prompt = projectInstructionsPrompt(resolved);
    const skills = pluginSkillsPrompt(this.pluginSkills);
    this.agent.state.systemPrompt = [
      this.baseSystemPrompt,
      ...(skills ? [skills] : []),
      ...(prompt ? [prompt] : []),
    ].join("\n\n");
  }

  private buildContextCompactionTool(): AgentTool {
    return {
      name: CONTEXT_COMPACTION_TOOL_NAME,
      label: "Compact Context",
      description:
        "Request a checkpoint summary of older model context while preserving recent work. Use this once when a context-management instruction asks for it; compaction runs after the current tool turn.",
      parameters: Type.Object({
        focus: Type.Optional(
          Type.String({
            description:
              "Short description of the active task and details that the checkpoint must preserve.",
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const focus = isRecord(params) ? params.focus : undefined;
        const instructions =
          typeof focus === "string" && focus.trim()
            ? `Preserve this active focus with high fidelity: ${focus.trim().slice(0, 1_000)}`
            : undefined;
        this.pendingModelCompaction = { instructions };
        return {
          content: [
            {
              type: "text",
              text: "Context compaction is queued for the end of this tool turn. Continue after the refreshed context; do not request it again now.",
            },
          ],
          details: { queued: true },
        };
      },
    };
  }

  private emit(event: AgentEventEnvelope["event"], turnId?: string) {
    this.onEvent({
      sessionId: this.sessionId,
      turnId: turnId ?? this.turnId,
      ts: Date.now(),
      event,
    });
  }

  setCompactionSettings(settings?: ContextCompactionSettings): void {
    this.compactionSettings = normalizeCompactionSettings(settings);
    this.pendingModelCompaction = undefined;
    this.nudgeCooldownTurns = 0;
    this.agent.state.tools = this.buildTools();
  }

  private contextBudget(messages: AgentMessage[]): {
    tokens: number;
    softLimit: number;
    hardLimit: number;
    requestHeadroom: number;
    keepRecentTokens: number;
  } {
    const contextWindow = Math.max(
      1,
      Math.round(this.model.contextWindow || DEFAULT_CONTEXT_WINDOW),
    );
    const modelOutputBudget = Math.min(
      Math.max(1, Math.round(this.model.maxTokens || DEFAULT_MAX_TOKENS)),
      Math.max(1, Math.floor(contextWindow * 0.25)),
    );
    const configuredReserve = Math.min(
      this.compactionSettings.reserveTokens,
      Math.max(1, Math.floor(contextWindow * 0.5)),
    );
    const requestHeadroom = Math.min(
      contextWindow - 1,
      Math.max(
        configuredReserve,
        modelOutputBudget,
        Math.ceil(contextWindow * 0.05),
      ),
    );
    const hardLimit = Math.max(1, contextWindow - requestHeadroom);
    const keepRecentTokens = Math.min(
      this.compactionSettings.keepRecentTokens,
      Math.max(1, Math.floor(hardLimit * 0.5)),
    );
    const softGap = Math.min(
      Math.max(
        keepRecentTokens,
        Math.ceil(requestHeadroom / 2),
      ),
      Math.max(1, Math.floor(hardLimit * 0.25)),
    );
    return {
      tokens: estimateContextTokens(messages).tokens,
      softLimit: Math.max(1, hardLimit - softGap),
      hardLimit,
      requestHeadroom,
      keepRecentTokens,
    };
  }

  private automaticCompactionNeeded(
    additionalMessages: AgentMessage[] = [],
  ): boolean {
    const context = buildSessionContext(this.entriesWithCompaction());
    const messages = [...context.messages, ...additionalMessages];
    const budget = this.contextBudget(messages);
    return this.compactionSettings.enabled && budget.tokens >= budget.hardLimit;
  }

  private prepareCompactionInput(
    entries: SessionTreeEntry[],
    budget: {
      hardLimit: number;
      requestHeadroom: number;
      keepRecentTokens: number;
    },
  ) {
    const maxRetainedTailTokens = Math.max(1, Math.floor(budget.hardLimit * 0.5));
    let keepRecentTokens = budget.keepRecentTokens;
    let compactionEntries = entries;
    const trailingToolResultIndexes: number[] = [];
    let trailingToolResultTokens = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.type !== "message" || entry.message.role !== "toolResult") break;
      trailingToolResultIndexes.unshift(index);
      trailingToolResultTokens += estimateTokens(entry.message);
    }
    const carrierIndex =
      trailingToolResultIndexes.length > 0 ? trailingToolResultIndexes[0] - 1 : -1;
    const carrier = entries[carrierIndex];
    const carrierTokens =
      carrier?.type === "message" && carrier.message.role === "assistant"
        ? estimateTokens(carrier.message)
        : 0;
    const trailingAtomicBatchTokens = trailingToolResultTokens + carrierTokens;

    if (
      trailingToolResultIndexes.length > 0 &&
      trailingAtomicBatchTokens >= maxRetainedTailTokens
    ) {
      const toolResultBudget = Math.max(
        trailingToolResultIndexes.length,
        maxRetainedTailTokens - carrierTokens - CHECKPOINT_TAIL_SAFETY_TOKENS,
      );
      const originalTokenCounts = trailingToolResultIndexes.map((index) => {
        const entry = entries[index] as MessageEntry;
        return estimateTokens(entry.message);
      });
      const resultBudgets = fairToolResultTokenBudgets(
        originalTokenCounts,
        toolResultBudget,
      );
      compactionEntries = [...entries];
      trailingToolResultIndexes.forEach((index, resultIndex) => {
        const entry = entries[index] as MessageEntry;
        if (resultBudgets[resultIndex] >= originalTokenCounts[resultIndex]) {
          return;
        }
        compactionEntries[index] = {
          ...entry,
          message: truncateToolResultForCheckpoint(
            entry.message as ToolResultMessage,
            resultBudgets[resultIndex],
          ),
        };
      });
      trailingToolResultTokens = trailingToolResultIndexes.reduce(
        (sum, index) => {
          const entry = compactionEntries[index] as MessageEntry;
          return sum + estimateTokens(entry.message);
        },
        0,
      );
    }
    // pi's cut-point search cannot split a tool call/result pair. If the final
    // result batch crosses keepRecentTokens, let the scan reach its assistant
    // carrier instead of falling back to the oldest entry. An oversized batch
    // is truncated only in the checkpoint copy above; visible history remains
    // complete and every provider-valid tool call/result pair is retained.
    if (trailingToolResultTokens >= keepRecentTokens) {
      keepRecentTokens = Math.min(
        maxRetainedTailTokens,
        trailingToolResultTokens + 1,
      );
    }
    return prepareCompaction(compactionEntries, {
      ...this.compactionSettings,
      reserveTokens: budget.requestHeadroom,
      keepRecentTokens,
    });
  }

  private rebuiltAgentContext(): AgentContext {
    const messages = buildSessionContext(this.entriesWithCompaction()).messages;
    this.agent.state.messages = messages;
    return {
      systemPrompt: this.agent.state.systemPrompt,
      messages,
      tools: this.agent.state.tools,
    };
  }

  private async prepareNextTurn(
    turn: PrepareNextTurnContext,
    _signal?: AbortSignal,
  ): Promise<AgentLoopTurnUpdate> {
    let context = this.rebuiltAgentContext();
    if (!this.compactionSettings.enabled) {
      this.pendingModelCompaction = undefined;
      this.nudgeCooldownTurns = 0;
      return { context };
    }

    const budget = this.contextBudget(context.messages);
    const hardLimitReached = budget.tokens >= budget.hardLimit;
    const modelRequest = this.pendingModelCompaction;
    this.pendingModelCompaction = undefined;

    if (hardLimitReached || modelRequest) {
      const compacted = await this.runCompaction(
        "threshold",
        false,
        modelRequest?.instructions,
      );
      if (compacted) {
        this.nudgeCooldownTurns = 0;
        context = this.rebuiltAgentContext();
        const postCompactionBudget = this.contextBudget(context.messages);
        if (
          hardLimitReached &&
          postCompactionBudget.tokens >= postCompactionBudget.hardLimit
        ) {
          throw new Error(
            "CONTEXT_COMPACTION_FAILED: checkpoint remained above the safe model context budget",
          );
        }
        return { context };
      }
      if (hardLimitReached) {
        // Continuing would immediately issue the provider request that this
        // guard exists to prevent. The Agent wrapper converts this failure to
        // the normal error/agent_end event sequence.
        throw new Error(
          "CONTEXT_COMPACTION_FAILED: unable to create a checkpoint before the next model request",
        );
      }
    }

    if (budget.tokens < budget.softLimit) {
      this.nudgeCooldownTurns = 0;
      return { context };
    }
    if (turn.toolResults.length === 0) {
      return { context };
    }
    if (this.nudgeCooldownTurns > 0) {
      this.nudgeCooldownTurns -= 1;
      return { context };
    }

    this.nudgeCooldownTurns = CONTEXT_NUDGE_TURN_INTERVAL - 1;
    return {
      context: {
        ...context,
        systemPrompt: `${context.systemPrompt}\n\n${CONTEXT_COMPACTION_NUDGE}`,
      },
    };
  }

  private async runCompaction(
    reason: ContextCompactionReason,
    willRetry: boolean,
    customInstructions?: string,
  ): Promise<boolean> {
    if (this.compactionInProgress) return false;
    this.compactionInProgress = true;
    try {
      return await this.performCompaction(reason, willRetry, customInstructions);
    } finally {
      this.compactionAbort = undefined;
      this.compactionInProgress = false;
    }
  }

  private async performCompaction(
    reason: ContextCompactionReason,
    willRetry: boolean,
    customInstructions?: string,
  ): Promise<boolean> {
    this.emit({ type: "compaction_start", reason });
    const entries = this.entriesWithCompaction();
    const context = buildSessionContext(entries);
    const budget = this.contextBudget(context.messages);
    const preparation = this.prepareCompactionInput(entries, budget);
    if (!preparation.ok || !preparation.value) {
      const message = preparation.ok
        ? "No new context is available to compact"
        : preparation.error.message;
      this.emit({
        type: "compaction_end",
        reason,
        ok: false,
        willRetry: false,
        error: { code: "CONTEXT_COMPACTION_FAILED", message },
      });
      return false;
    }

    this.compactionAbort = new AbortController();
    let result: Awaited<ReturnType<typeof compact>>;
    try {
      result = await compact(
        preparation.value,
        this.models,
        this.model,
        customInstructions,
        this.compactionAbort.signal,
        this.thinkingLevel,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "compaction_end",
        reason,
        ok: false,
        tokensBefore: preparation.value.tokensBefore,
        willRetry: false,
        error: { code: "CONTEXT_COMPACTION_FAILED", message },
      });
      return false;
    } finally {
      this.compactionAbort = undefined;
    }
    if (!result.ok) {
      this.emit({
        type: "compaction_end",
        reason,
        ok: false,
        tokensBefore: preparation.value.tokensBefore,
        willRetry: false,
        error: {
          code: "CONTEXT_COMPACTION_FAILED",
          message: result.error.message,
        },
      });
      return false;
    }

    const throughMessageId = this.fullEntries.at(-1)?.id;
    if (!throughMessageId) {
      this.emit({
        type: "compaction_end",
        reason,
        ok: false,
        willRetry: false,
        error: {
          code: "CONTEXT_COMPACTION_FAILED",
          message: "Compaction has no durable transcript boundary",
        },
      });
      return false;
    }
    const checkpoint: ContextCompactionRecord = {
      id: randomUUID(),
      summary: result.value.summary,
      firstKeptMessageId: result.value.firstKeptEntryId,
      throughMessageId,
      tokensBefore: result.value.tokensBefore,
      usage: result.value.usage,
      retainedTail: result.value.retainedTail,
      details: result.value.details,
      providerId: this.provider.id,
      modelId: this.provider.modelId,
      createdAt: nowIso(),
    };
    const compactedBudget = this.contextBudget(
      buildSessionContext(this.entriesWithCompaction(checkpoint)).messages,
    );
    if (
      (reason === "overflow" || budget.tokens >= budget.hardLimit) &&
      compactedBudget.tokens >= compactedBudget.hardLimit
    ) {
      this.emit({
        type: "compaction_end",
        reason,
        ok: false,
        tokensBefore: result.value.tokensBefore,
        willRetry: false,
        error: {
          code: "CONTEXT_COMPACTION_FAILED",
          message:
            "The checkpoint did not reduce context below the safe request budget",
        },
      });
      return false;
    }
    try {
      await this.host.call("session.appendCompaction", {
        sessionId: this.sessionId,
        compaction: checkpoint,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "compaction_end",
        reason,
        ok: false,
        tokensBefore: result.value.tokensBefore,
        willRetry: false,
        error: { code: "CONTEXT_COMPACTION_FAILED", message },
      });
      return false;
    }

    this.activeCompaction = checkpoint;
    this.agent.state.messages = buildSessionContext(
      this.entriesWithCompaction(),
    ).messages;
    this.emit({
      type: "compaction_end",
      reason,
      ok: true,
      tokensBefore: checkpoint.tokensBefore,
      firstKeptMessageId: checkpoint.firstKeptMessageId,
      willRetry,
    });
    return true;
  }

  async compactManually(): Promise<void> {
    if (this.disposed) throw new Error("runtime disposed");
    if (this.agent.state.isStreaming || this.compactionInProgress) {
      throw Object.assign(new Error("session already has an active turn"), {
        errorCode: "AGENT_BUSY",
      });
    }
    const ok = await this.runCompaction("manual", false);
    if (!ok) {
      throw Object.assign(new Error("context compaction failed"), {
        errorCode: "CONTEXT_COMPACTION_FAILED",
      });
    }
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
          this.streamStartedAt = Date.now();
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
        if (event.message.role === "user") {
          const id = this.pendingUserMessageId ?? randomUUID();
          this.pendingUserMessageId = undefined;
          this.appendLiveEntry(id, event.message);
          break;
        }
        if (event.message.role === "toolResult") {
          this.appendLiveEntry(event.message.toolCallId || randomUUID(), event.message);
          break;
        }
        if (this.currentAssistant && event.message.role === "assistant") {
          const assistantId = this.currentAssistant.id;
          const content = assistantContent((event.message as any).content);
          // pi-agent-core encodes stream failures in the final message
          // (stopReason "error"/"aborted" + errorMessage) and resolves the
          // prompt normally, so this is where provider/model errors surface.
          const stopReason = (event.message as any).stopReason as
            | string
            | undefined;
          const overflow = isContextOverflow(
            event.message as AssistantMessage,
            this.model.contextWindow || DEFAULT_CONTEXT_WINDOW,
          );
          const failed = stopReason === "error" || overflow;
          const aborted = stopReason === "aborted";
          const errorMessage =
            failed &&
            typeof (event.message as any).errorMessage === "string" &&
            (event.message as any).errorMessage
              ? ((event.message as any).errorMessage as string)
              : failed
                ? "provider stream failed"
                : undefined;
          const classifiedError = overflow
            ? errorMessage
              ? classifyAgentError(errorMessage)
              : {
                  code: "CONTEXT_TOO_LARGE",
                  message:
                    "The provider rejected or truncated an oversized model context",
                  retriable: false,
                }
            : errorMessage
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
          const endedAt = Date.now();
          logTiming("model", {
            model: this.provider.modelId,
            providerId: this.provider.id,
            sessionId: this.sessionId,
            turnId: this.turnId,
            // Time from "the agent could send the request" to the first
            // streamed message: provider queue + network + first token.
            providerWaitMs:
              this.requestStartedAt !== undefined &&
              this.streamStartedAt !== undefined
                ? this.streamStartedAt - this.requestStartedAt
                : undefined,
            streamMs:
              this.streamStartedAt !== undefined
                ? endedAt - this.streamStartedAt
                : undefined,
            thinkingLevel: this.thinkingLevel,
            outcome: failed ? "error" : aborted ? "aborted" : "ok",
            errorCode: classifiedError?.code,
          });
          this.streamStartedAt = undefined;
          this.currentAssistant = undefined;
          const canRecoverOverflow =
            this.compactionSettings.enabled &&
            overflow &&
            !this.overflowRecoveryAttempted;
          if (!failed && !aborted) {
            this.appendLiveEntry(assistantId, event.message);
          } else {
            this.turnHadError = true;
          }
          if (canRecoverOverflow) {
            this.pendingOverflow = true;
            this.suppressOverflowRunEnd = true;
          } else if (classifiedError) {
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
        // The agent issues the follow-up provider request as soon as the tool
        // results are in, so this is the anchor for the next providerWaitMs.
        this.requestStartedAt = Date.now();
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
        });
        break;
      case "turn_end":
        if (this.suppressOverflowRunEnd) break;
        this.emit({ type: "turn_end" });
        break;
      case "agent_end":
        if (this.suppressOverflowRunEnd) break;
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
    // The failure path is where a slow turn matters most: a provider that
    // burns its retries before giving up shows here as a large providerWaitMs.
    logTiming("model", {
      model: this.provider.modelId,
      providerId: this.provider.id,
      sessionId: this.sessionId,
      turnId: this.turnId,
      providerWaitMs:
        this.requestStartedAt !== undefined
          ? Date.now() - this.requestStartedAt
          : undefined,
      outcome: status,
      errorCode: error?.code,
    });
    this.streamStartedAt = undefined;
    this.currentAssistant = undefined;
  }

  private failBeforeProviderRequest(
    incomingUserMessage: AgentMessage,
    error: ReturnType<typeof classifyAgentError>,
  ): void {
    const userMessageId = this.pendingUserMessageId || randomUUID();
    this.pendingUserMessageId = undefined;
    this.appendLiveEntry(userMessageId, incomingUserMessage);
    this.agent.state.messages = buildSessionContext(
      this.entriesWithCompaction(),
    ).messages;
    this.turnHadError = true;
    this.finalizeCurrentAssistant("error", error);
    this.emit({ type: "error", error });
  }

  async prompt(content: string, userMessageId?: string): Promise<{ turnId: string }> {
    if (this.disposed) throw new Error("runtime disposed");
    this.turnId = randomUUID();
    this.pendingUserMessageId = userMessageId;
    this.pendingOverflow = false;
    this.overflowRecoveryAttempted = false;
    this.suppressOverflowRunEnd = false;
    this.turnHadError = false;
    this.requestStartedAt = Date.now();
    this.emit({
      type: "status",
      status: this.getStatus(),
    });
    try {
      const incomingUserMessage: AgentMessage = {
        role: "user",
        content,
        timestamp: Date.now(),
      };
      if (this.automaticCompactionNeeded([incomingUserMessage])) {
        const compacted = await this.runCompaction("threshold", false);
        if (!compacted) {
          this.failBeforeProviderRequest(incomingUserMessage, {
            code: "CONTEXT_COMPACTION_FAILED",
            message: "Automatic context compaction failed before the model request",
            retriable: false,
          });
          return { turnId: this.turnId };
        }
        if (this.automaticCompactionNeeded([incomingUserMessage])) {
          this.failBeforeProviderRequest(incomingUserMessage, {
            code: "CONTEXT_TOO_LARGE",
            message:
              "The pending prompt still exceeds the safe model context budget after compaction",
            retriable: false,
          });
          return { turnId: this.turnId };
        }
      }
      await this.agent.prompt(content);
      await this.agent.waitForIdle();

      if (this.pendingOverflow) {
        this.pendingOverflow = false;
        this.suppressOverflowRunEnd = false;
        this.overflowRecoveryAttempted = true;
        const messages = [...this.agent.state.messages];
        if (messages.at(-1)?.role === "assistant") messages.pop();
        this.agent.state.messages = messages;
        const compacted = await this.runCompaction("overflow", true);
        if (!compacted) {
          this.emit({
            type: "error",
            error: {
              code: "CONTEXT_COMPACTION_FAILED",
              message: "Context overflow recovery could not create a checkpoint",
              retriable: false,
            },
          });
          return { turnId: this.turnId };
        }
        this.turnHadError = false;
        this.requestStartedAt = Date.now();
        await this.agent.continue();
        await this.agent.waitForIdle();
      }

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
    this.compactionAbort?.abort();
  }

  getStatus(): AgentStatus {
    return {
      sessionId: this.sessionId,
      isRunning: this.agent.state.isStreaming || this.compactionInProgress,
      currentTurnId: this.turnId,
      modelId: this.provider.modelId,
      pendingToolConfirmations: 0,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.agent.abort();
    this.compactionAbort?.abort();
  }
}
