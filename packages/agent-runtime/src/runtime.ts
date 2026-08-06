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
  type AgentToolResult,
  type AfterToolCallContext,
  type AfterToolCallResult,
  type CompactionPreparation,
  type CompactionEntry,
  type CompactionSettings,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
  type MessageEntry,
  type PrepareNextTurnContext,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import {
  isContextOverflow,
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type ToolResultMessage,
  type Usage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { DEFAULT_COMMAND_TIMEOUT_MS } from "@pi-desktop/shared";
import type {
  AgentEventEnvelope,
  AgentStatus,
  ContextCompactionFallback,
  CommandShellOption,
  ContextCompactionReason,
  ContextCompactionRecord,
  ContextCompactionSettings,
  MessageUsage,
  Mode,
  PlanExecution,
  PlanProposal,
  PlanningState,
  Risk,
  SubagentDefinition,
  ThinkingLevel,
  ToolTokenUsage,
  UiMessage,
} from "@pi-desktop/shared";
import {
  checkpointGeneration,
  contextCompactionStatus,
  isCommandShellOption,
  isToolsOutputParams,
  MAX_SUBAGENT_CONCURRENCY,
  normalizeSubagentName,
  proposalKindForMode,
  subagentModelKey,
  type ProposalKind,
} from "@pi-desktop/shared";
import type { HostClient } from "./host-client.js";
import { classifyAgentError } from "./agent-errors.js";
import {
  assistantContent,
  isRecord,
  nowIso,
  timestampIso,
  usageFromPi,
  usageToPi,
} from "./agent-messages.js";
import {
  apiBindingForStyle,
  buildProviderModel,
  createProviderModels,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  providerRequestKey,
  type RuntimeProviderConfig,
} from "./provider-binding.js";
import { PathMutex, Semaphore } from "./path-lock.js";
import {
  composeSubagentSystemPrompt,
  SubagentRun,
  SUBAGENT_TOOL_NAME,
  type SubagentRunResult,
} from "./subagent.js";
import {
  composeModeSystemPrompt,
  DEFAULT_RUNTIME_SYSTEM_PROMPT,
} from "./mode-prompts.js";
import { clampThinkingLevel, type PiModelConfig } from "./thinking-level.js";
import type { ProjectInstructions } from "./project-instructions.js";
import { projectInstructionsPrompt } from "./project-instructions-prompt.js";
import {
  pluginSkillsPrompt,
  SKILL_TOOL_NAME,
  type PluginSkillDef,
} from "./plugin-skills-prompt.js";
import { pluginSkillsDigest } from "./plugin-skills.js";
import { logTiming } from "./timing.js";

export type { RuntimeProviderConfig } from "./provider-binding.js";

const PROVIDER_REQUEST_MAX_RETRIES = 1;
const PROVIDER_MAX_RETRY_DELAY_MS = 8_000;
const PROVIDER_STREAM_RETRY_BACKOFF_MS = 750;
const MAX_MUTATION_RECOVERY_FAILURES = 2;
const BASH_PATCH_FAILURE_KEY = "__bash_patch_command__";
export const TOOL_SEARCH_NAME = "ToolSearch";
/**
 * Tokens held back from the context window for the summary prompt and the
 * model's own output. Compaction thresholds are derived from the active model's
 * window rather than configured, and this floor reproduces the reserve that
 * used to be the default setting, so the hard safety boundary is unchanged.
 */
const COMPACTION_RESERVE_FLOOR_TOKENS = 16_384;
/**
 * Retained-tail target as a share of the safe budget, bounded so a 32K window
 * still keeps a usable tail and a 1M window does not carry the whole session
 * forward. A single fixed token count cannot serve both.
 */
const COMPACTION_KEEP_RECENT_RATIO = 0.2;
const COMPACTION_MIN_KEEP_RECENT_TOKENS = 8_000;
const COMPACTION_MAX_KEEP_RECENT_TOKENS = 64_000;
/**
 * Cap on the user messages carried across a compaction boundary, matching
 * Codex's `COMPACT_USER_MESSAGE_MAX_TOKENS`. Clamped against the safe budget so
 * a small model window is not filled by retention alone.
 */
const COMPACTION_RETAINED_USER_MESSAGE_MAX_TOKENS = 20_000;
const COMPACTION_FALLBACK_KEEP_RECENT_RATIO = 0.25;
const COMPACTION_FALLBACK_MAX_SUMMARY_CHARS = 12_000;
const COMPACTION_SUMMARY_PROMPT_SAFETY_TOKENS = 2_048;
const COMPACTION_FALLBACK_MARKER =
  "[automatic context recovery: older context was omitted after summary generation failed]";
/** Path-scoped rules are best-effort and must not stall a file tool turn. */
export const PATH_INSTRUCTION_RESOLUTION_TIMEOUT_MS = 2_000;
const PATH_SCOPED_INSTRUCTION_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "BrowserPreview",
]);
/** Tools whose `path` argument is rewritten, and which therefore must not run
 * concurrently against the same file (see `PathMutex`). */
const PATH_MUTATING_TOOLS = new Set(["Write", "Edit"]);
const CHAT_CORE_TOOL_NAMES = new Set(["Read", "Glob", "Grep"]);
const AGENT_CORE_TOOL_NAMES = new Set([
  "Read",
  "Write",
  "Edit",
  "Bash",
]);
const MAX_ON_DEMAND_TOOL_PROMPT_ENTRIES = 64;
const MAX_TOOL_SEARCH_RESULT_NAMES = 24;

/** Tools that ask the host to switch this session into a contract mode (D198). */
const ENTER_TOOL_NAMES: Record<ProposalKind, string> = {
  plan: "EnterPlanMode",
  goal: "EnterGoalMode",
};
/** Tools that submit a contract of one kind for approval (D198). */
const SUBMIT_TOOL_NAMES: Record<ProposalKind, string> = {
  plan: "SubmitPlan",
  goal: "SubmitGoal",
};
/**
 * Every mode transition must be the only call in its assistant message, so the
 * host commits one durable mode change per tool-call batch.
 */
const MODE_TRANSITION_TOOL_NAMES = new Set([
  ...Object.values(ENTER_TOOL_NAMES),
  ...Object.values(SUBMIT_TOOL_NAMES),
]);

function enterToolKind(name: string): ProposalKind | undefined {
  return name === ENTER_TOOL_NAMES.plan
    ? "plan"
    : name === ENTER_TOOL_NAMES.goal
      ? "goal"
      : undefined;
}

function submitToolKind(name: string): ProposalKind | undefined {
  return name === SUBMIT_TOOL_NAMES.plan
    ? "plan"
    : name === SUBMIT_TOOL_NAMES.goal
      ? "goal"
      : undefined;
}

function modeLabel(mode: Mode): string {
  return mode === "plan" ? "Plan" : mode === "goal" ? "Goal" : "Agent";
}

type ToolCatalogEntry = {
  name: string;
  description: string;
};

type PathInstructionResolution = {
  instructions?: ProjectInstructions;
  fallback: boolean;
};

type PathInstructionTiming = {
  durationMs: number;
  cacheHit: boolean;
  fallback: boolean;
};

function pathInstructionScope(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) || "/" : ".";
}

const CHECKPOINT_TRUNCATION_MARKER =
  "\n\n[checkpoint truncated: this message crossed the retained context budget]\n\n";
/**
 * Appended for one automatic re-run after a turn that produced nothing the
 * user can see. Two shapes were observed: a wholly empty response, and a
 * finished conclusion written into reasoning while the visible text stayed
 * empty. The same nudge covers both, because both need the same next move.
 */
const SILENT_TURN_NUDGE = [
  "<no_output_recovery>",
  "Your previous turn ended with no visible text and no tool call, so the user saw nothing happen.",
  "Your reasoning is never shown to the user. If you already reached the answer, state it now in plain text.",
  "Otherwise continue the unfinished work, starting with one sentence about what you are doing.",
  "</no_output_recovery>",
].join("\n");

/**
 * Some OpenAI-style models emit their internal parallel-call wrapper as
 * assistant text (`to=multi_tool_use.parallel code:{"tool_uses":[…]}`) instead
 * of real tool calls. PI-Desktop has no such tool, so the whole batch lands as
 * prose and silently does nothing — the turn looks finished while no work ran.
 * Rare (2 occurrences across 255 recorded sessions) but indistinguishable from
 * a stuck agent when it happens.
 */
export function looksLikePseudoToolCall(text: string): boolean {
  return (
    text.includes("multi_tool_use.parallel") || text.includes('{"tool_uses":')
  );
}

/**
 * Automatic protection is on unless a caller explicitly disables it. The token
 * thresholds carried by the legacy settings shape are ignored: they are derived
 * from the active model's context window in `contextBudget`, because no single
 * configured number fits both a 32K and a 1M window.
 */
function compactionEnabled(value?: Partial<ContextCompactionSettings>): boolean {
  return value?.enabled !== false;
}

/**
 * Context thresholds derived from the active model's window.
 *
 * `hardLimit` is the safety boundary: the next provider request must not be
 * issued while the context is at or above it. Compaction happens inline at that
 * boundary, the way Codex does it — there is no off-critical-path variant.
 */
type ContextBudget = {
  /** Estimated tokens in the reconstructed model context. */
  tokens: number;
  /** Point where an uncompacted provider request is no longer allowed. */
  hardLimit: number;
  /** Tokens reserved for the request's own prompt and output. */
  requestHeadroom: number;
  /** Approximate recent-context tokens a checkpoint should retain. */
  keepRecentTokens: number;
};

export type PluginToolDef = {
  /** Full exposed name (`plugin_<pluginIdSafe>_<toolName>`, D015). */
  name: string;
  description?: string;
  /** JSON schema for arguments (manifest agentTools[].schema). */
  parameters?: unknown;
  /** Declared plugin risk, when the plugin supplied a bounded value. */
  risk?: Risk;
};

export type AgentRuntimeOptions = {
  host: HostClient;
  sessionId: string;
  mode: Mode;
  /** Durable host turn ID for the current prompt, used by plan identity. */
  turnId?: string;
  provider: RuntimeProviderConfig;
  thinkingLevel: ThinkingLevel;
  systemPrompt?: string;
  /** Session-bound workspace root used for path-scoped instruction requests. */
  projectPath?: string;
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
  /** Plugin skills advertised in the system prompt and loaded via `Skill`. */
  pluginSkills?: PluginSkillDef[];
  /** Effective command shell selected by host-core for this session. */
  commandShell: CommandShellOption;
  /** Absolute per-session scratch directory for temporary files (D114).
   * Advertised to the model in the system prompt; host-core enforces it as
   * a second containment root. */
  scratchDir?: string;
  onEvent: (envelope: AgentEventEnvelope) => void;
  /**
   * Subagent definitions this session may delegate to (ADR 0062), already
   * merged and capped by Electron main. Empty means no `Task` tool at all.
   */
  subagents?: SubagentDefinition[];
  /**
   * Provider resolved for each definition that pins one, keyed by definition
   * name. Main owns credential lookup, so a pinned provider that is missing
   * here is unavailable and the delegate must fail loudly rather than
   * silently run on the session's model.
   */
  subagentProviders?: Record<string, RuntimeProviderConfig>;
};

export type RuntimeMatchConfig = {
  mode: Mode;
  provider: RuntimeProviderConfig;
  thinkingLevel: ThinkingLevel;
  pluginTools?: PluginToolDef[];
  pluginSkills?: PluginSkillDef[];
  projectInstructions?: ProjectInstructions;
  projectPath?: string;
  commandShell: CommandShellOption;
  subagents?: SubagentDefinition[];
  subagentProviders?: Record<string, RuntimeProviderConfig>;
};

/** Tool calls ride in the assistant content array as `type: "toolCall"`. A
 * message that requested any is never a silent turn: the loop keeps going and
 * the user sees the tool activity. */
function messageRequestsTools(message: unknown): boolean {
  const content = isRecord(message) ? message.content : undefined;
  return (
    Array.isArray(content) &&
    content.some((part) => isRecord(part) && part.type === "toolCall")
  );
}

function boundedText(value: string, maxChars: number): string {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  const marker = "\n\n[context recovery summary shortened]\n\n";
  const available = Math.max(2, maxChars - marker.length);
  const headChars = Math.ceil(available / 2);
  const tailChars = Math.floor(available / 2);
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function mutationFailureKey(path: unknown): string {
  return String(path).replaceAll("\\", "/").replace(/^\.\//, "");
}

function isPatchCommand(command: unknown): boolean {
  if (typeof command !== "string") return false;
  return (
    /(?:^|[;&|]\s*)(?:env\s+|command\s+)?(?:\S+\/)?apply_patch(?:\s|$)/m.test(
      command,
    ) ||
    /\bgit(?:\s+\S+)*\s+apply(?:\s|$)/m.test(command) ||
    /(?:^|[;&|]\s*)(?:env\s+|command\s+)?(?:\S+\/)?patch(?:\s|$)/m.test(
      command,
    )
  );
}

function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timeout);
      reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    };
    timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type CheckpointPersistResult = "persisted" | "oversized" | "failed";

type CheckpointBuildSuccess = {
  ok: true;
  checkpoint: ContextCompactionRecord;
  entries: SessionTreeEntry[];
  budget: ContextBudget;
  preparation: CompactionPreparation;
};

type CheckpointBuildFailure = {
  ok: false;
  entries: SessionTreeEntry[];
  budget: ContextBudget;
  preparation?: CompactionPreparation;
  message: string;
  tokensBefore?: number;
  /**
   * False when the failure must be reported as-is instead of falling back to a
   * retained-tail checkpoint: the build was cancelled, or the transcript has no
   * durable boundary to anchor any checkpoint to.
   */
  recoverable: boolean;
};

type CheckpointBuild = CheckpointBuildSuccess | CheckpointBuildFailure;

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

const MIN_COMMAND_TIMEOUT_SECONDS = 1;
const MAX_COMMAND_TIMEOUT_SECONDS = 300;
const TOOL_OUTPUT_UPDATE_THROTTLE_MS = 100;
const MAX_TOOL_PROGRESS_CHARS = 64 * 1024;
const TOOL_PROGRESS_TRUNCATION_MARKER =
  "\n\n[tool output progress truncated]\n\n";

function shellScratchVariable(shell: CommandShellOption): string {
  switch (shell.dialect) {
    case "powershell":
      return "$env:PI_SCRATCH_DIR";
    case "cmd":
      return "%PI_SCRATCH_DIR%";
    case "posix":
      return "$PI_SCRATCH_DIR";
  }
}

function shellSyntaxGuidance(shell: CommandShellOption): string {
  switch (shell.dialect) {
    case "powershell":
      return "Use native Windows PowerShell syntax and Windows paths such as `C:\\work\\file.txt` or `.\\file.txt`.";
    case "cmd":
      return "Use native cmd.exe syntax and Windows paths such as `C:\\work\\file.txt` or `.\\file.txt`.";
    case "posix":
      return "Use native POSIX shell syntax and forward-slash paths such as `/work/file.txt` or `./file.txt`.";
  }
}

export function commandShellGuidance(
  shell: CommandShellOption,
  scratchDir?: string,
): string {
  const scratchVariable = shellScratchVariable(shell);
  const scratch = scratchDir
    ? `The session scratch directory is \`${scratchDir}\`; use ${scratchVariable} for it and keep temporary files there.`
    : `When PI_SCRATCH_DIR is available, use ${scratchVariable} for the session scratch directory and keep temporary files there.`;
  return [
    `Shell commands run through ${shell.label} (${shell.id}). The protocol tool remains named Bash for compatibility, even when the active shell is PowerShell or cmd.`,
    shellSyntaxGuidance(shell),
    scratch,
  ].join(" ");
}

function commandShellToolDescription(
  shell: CommandShellOption,
  scratchDir?: string,
): string {
  return [
    `Run a non-interactive command through ${shell.label} in the workspace root.`,
    "The protocol tool remains named Bash for compatibility; write commands for the active shell dialect.",
    shellSyntaxGuidance(shell),
    `The session scratch directory variable is ${shellScratchVariable(shell)}.`,
    "An optional timeout from 1 to 300 seconds may be supplied; without it, the command defaults to a 60-second timeout.",
    ...(scratchDir ? [`The session scratch directory is ${scratchDir}.`] : []),
  ].join(" ");
}

function commandTimeoutMs(params: unknown): number {
  const timeout = isRecord(params) ? params.timeout : undefined;
  if (timeout === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;
  if (
    typeof timeout !== "number" ||
    !Number.isFinite(timeout) ||
    timeout < MIN_COMMAND_TIMEOUT_SECONDS
  ) {
    throw Object.assign(
      new Error(
        `Invalid timeout: must be a finite number of seconds between ${MIN_COMMAND_TIMEOUT_SECONDS} and ${MAX_COMMAND_TIMEOUT_SECONDS}`,
      ),
      { errorCode: "INVALID_ARGUMENT" },
    );
  }
  if (timeout > MAX_COMMAND_TIMEOUT_SECONDS) {
    throw Object.assign(
      new Error(
        `Invalid timeout: maximum is ${MAX_COMMAND_TIMEOUT_SECONDS} seconds`,
      ),
      { errorCode: "INVALID_ARGUMENT" },
    );
  }
  const timeoutMs = Math.ceil(timeout * 1000);
  return timeoutMs;
}

function appendToolProgress(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  if (combined.length <= MAX_TOOL_PROGRESS_CHARS) return combined;
  const codePoints = Array.from(combined);
  const marker = Array.from(TOOL_PROGRESS_TRUNCATION_MARKER);
  const remaining = Math.max(0, MAX_TOOL_PROGRESS_CHARS - marker.length);
  const head = Math.ceil(remaining * 0.6);
  const tail = remaining - head;
  return `${codePoints.slice(0, head).join("")}${TOOL_PROGRESS_TRUNCATION_MARKER}${
    tail > 0 ? codePoints.slice(-tail).join("") : ""
  }`;
}

function truncateTextForCheckpoint(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= CHECKPOINT_TRUNCATION_MARKER.length) {
    return CHECKPOINT_TRUNCATION_MARKER.trim().slice(0, maxChars);
  }
  const retainedChars = maxChars - CHECKPOINT_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(retainedChars * 0.75);
  const tailChars = retainedChars - headChars;
  return `${text.slice(0, headChars)}${CHECKPOINT_TRUNCATION_MARKER}${
    tailChars > 0 ? text.slice(-tailChars) : ""
  }`;
}

/**
 * Flatten a user message to plain text so it can be truncated at a token
 * budget. Images and other non-text blocks are named rather than kept: a
 * checkpoint that carried them would spend its whole budget on one of them.
 */
function userMessageTextForCheckpoint(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) =>
      block.type === "text"
        ? block.text
        : `[${block.type} content omitted from checkpoint]`,
    )
    .join("\n");
}

function truncateUserMessageForCheckpoint(
  message: UserMessage,
  tokenBudget: number,
): UserMessage {
  return {
    ...message,
    content: truncateTextForCheckpoint(
      userMessageTextForCheckpoint(message),
      Math.max(1, tokenBudget) * 4,
    ),
  };
}

/**
 * Choose the user messages that survive a compaction boundary: newest first up
 * to `maxTokens`, truncating the one that crosses the budget instead of
 * dropping it, then restored to chronological order. This is Codex's
 * `build_compacted_history_with_limit` selection.
 */
function selectRetainedUserMessages(
  candidates: UserMessage[],
  maxTokens: number,
): UserMessage[] {
  const selected: UserMessage[] = [];
  let remaining = Math.max(0, maxTokens);
  for (let index = candidates.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = candidates[index];
    const tokens = estimateTokens(message);
    if (tokens <= remaining) {
      selected.push(message);
      remaining -= tokens;
      continue;
    }
    selected.push(truncateUserMessageForCheckpoint(message, remaining));
    break;
  }
  return selected.reverse();
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
  const rawRecord: Record<string, unknown> | undefined = isRecord(raw)
    ? raw
    : undefined;
  const rawAddedToolNames = rawRecord?.addedToolNames;
  const addedToolNames =
    Array.isArray(rawAddedToolNames)
      ? rawAddedToolNames.filter(
          (name: unknown): name is string =>
            typeof name === "string" && name.length > 0,
        )
      : [];
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
    ...(addedToolNames.length > 0 ? { addedToolNames } : {}),
    isError:
      interrupted ||
      m.toolStatus === "error" ||
      m.toolStatus === "denied" ||
      m.isError === true,
    timestamp,
  };
}

function estimateToolTokenUsage(
  model: Model<Api>,
  toolCallId: string,
  toolName: string,
  args: unknown,
  result: unknown,
  isError: boolean,
  timestamp: number,
): ToolTokenUsage {
  const toolCall = {
    role: "assistant" as const,
    content: [
      {
        type: "toolCall" as const,
        id: toolCallId,
        name: toolName,
        arguments: isRecord(args) ? args : { value: args },
      },
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usageToPi(undefined),
    stopReason: "toolUse" as const,
    timestamp,
  } satisfies AssistantMessage;
  const toolRow = {
    id: toolCallId,
    role: "tool" as const,
    content: safeJson(result),
    createdAt: new Date(timestamp).toISOString(),
    toolCallId,
    toolName,
    toolResult: result,
    toolStatus: isError ? ("error" as const) : ("success" as const),
    isError,
  } satisfies UiMessage;
  const resultMessage = toolResultFromUi(toolRow, timestamp);
  const argumentTokens = estimateTokens(toolCall);
  const resultTokens = estimateTokens(resultMessage);

  return {
    argumentTokens,
    resultTokens,
    totalTokens: argumentTokens + resultTokens,
    estimated: true,
  };
}

export class DesktopAgentRuntime {
  private agent: Agent;
  private models: Models;
  private model: Model<Api>;
  private turnId?: string;
  private hostTurnId?: string;
  private disposed = false;
  readonly sessionId: string;
  private mode: Mode;
  private provider: RuntimeProviderConfig;
  private thinkingLevel: ThinkingLevel;
  private host: HostClient;
  private onEvent: (envelope: AgentEventEnvelope) => void;
  private baseSystemPrompt: string;
  private planningState: PlanningState;
  private pendingPlanId?: string;
  private currentAssistant?: UiMessage;
  private pluginTools: PluginToolDef[];
  private pluginSkills: PluginSkillDef[];
  /** Subagent definitions offered through the `Task` tool (ADR 0062). */
  private subagents: SubagentDefinition[];
  private subagentProviders: Record<string, RuntimeProviderConfig>;
  /** Caps concurrent delegates across every `Task` batch in this session. */
  private subagentSlots = new Semaphore(MAX_SUBAGENT_CONCURRENCY);
  /** Serializes same-path mutations across the parent and its delegates. */
  private writeLocks = new PathMutex();
  /** Complete tool registry; only the active subset is sent to the provider. */
  private toolCatalog = new Map<string, AgentTool>();
  /** Tools intentionally omitted from the initial provider request. */
  private deferredToolNames = new Set<string>();
  /** Deferred tools loaded for the current user prompt. */
  private activeDeferredToolNames = new Set<string>();
  private scratchDir?: string;
  private projectPath?: string;
  private commandShell: CommandShellOption;
  private baseProjectInstructions?: ProjectInstructions;
  private projectInstructions?: ProjectInstructions;
  /** Per-prompt claims prevent repeated path-resolution RPCs for one directory. */
  private pathInstructionClaims = new Map<
    string,
    Promise<PathInstructionResolution>
  >();
  /* Timing anchors (D137). `requestStartedAt` marks the moment the agent is
   * free to issue the next provider request — turn start, or the last tool
   * result coming back — so `providerWaitMs` below is the model's own latency
   * rather than the whole turn. With parallel tool calls the last one wins,
   * which is the correct anchor: the request goes out once all have resolved. */
  private requestStartedAt?: number;
  private streamStartedAt?: number;
  private providerResponseStatus?: number;
  private pendingProviderRetry?: ReturnType<typeof classifyAgentError>;
  private providerRetryAttempted = false;
  private activeProviderRetryAttempt = 0;
  private providerRetryInProgress = false;
  private suppressProviderRetryRunEnd = false;
  private providerRetryAbort?: AbortController;
  /* Silent-turn recovery: a turn that ends with no tool call and no visible
   * text is invisible to the user. 15 of 255 recorded sessions ended a turn
   * that way, and every one of them was followed by the user typing "继续".
   * One automatic re-run per prompt, then the failure becomes visible. */
  private pendingSilentTurnRerun = false;
  private silentTurnRerunAttempted = false;
  private silentTurnRerunInProgress = false;
  private suppressSilentTurnRunEnd = false;
  private activeToolCalls = new Map<
    string,
    { toolName: string; args: unknown }
  >();
  /** Host failures need to reach pi-agent-core's tool error channel without
   * discarding the structured diagnostics returned in `details`. */
  private failedHostToolCalls = new Set<string>();
  /** Per-prompt mutation failures provide one recovery attempt, then stop. */
  private mutationFailureCounts = new Map<string, number>();
  private terminatingToolCalls = new Set<string>();
  private fullEntries: MessageEntry[];
  private activeCompaction?: ContextCompactionRecord;
  private compactionEnabled: boolean;
  private pendingUserMessageId?: string;
  private pendingOverflow = false;
  private overflowRecoveryAttempted = false;
  private suppressOverflowRunEnd = false;
  private turnHadError = false;
  private compactionAbort?: AbortController;
  private compactionInProgress = false;
  private activeToolProgressCleanups = new Set<(flush: boolean) => void>();
  private hostCloseUnsubscribe?: () => void;

  constructor(opts: AgentRuntimeOptions) {
    this.sessionId = opts.sessionId;
    this.hostTurnId = opts.turnId;
    this.turnId = opts.turnId;
    this.mode = opts.mode;
    this.planningState = proposalKindForMode(this.mode) ? "planning" : "inactive";
    this.provider = opts.provider;
    this.thinkingLevel = clampThinkingLevel(opts.provider, opts.thinkingLevel);
    this.host = opts.host;
    this.hostCloseUnsubscribe = this.host.onClose?.(() => {
      this.cleanupActiveToolProgress();
    });
    this.onEvent = opts.onEvent;
    this.pluginTools = opts.pluginTools ?? [];
    this.pluginSkills = opts.pluginSkills ?? [];
    this.subagents = opts.subagents ?? [];
    this.subagentProviders = opts.subagentProviders ?? {};
    if (!isCommandShellOption(opts.commandShell) || !opts.commandShell.available) {
      throw Object.assign(new Error("active command shell is invalid or unavailable"), {
        errorCode: "COMMAND_SHELL_INVALID",
      });
    }
    this.commandShell = opts.commandShell;
    this.scratchDir = opts.scratchDir;
    this.projectPath = opts.projectPath?.trim() || undefined;
    this.baseProjectInstructions = opts.projectInstructions;
    this.projectInstructions = opts.projectInstructions;
    this.compactionEnabled = compactionEnabled(opts.compactionSettings);

    this.rebuildToolCatalog();
    const model = buildProviderModel(this.provider);
    this.model = model;
    const tools = this.activeTools();
    const models = createProviderModels(this.provider, model);
    this.models = models;
    const runtimeApiKey = providerRequestKey(this.provider);

    this.fullEntries = this.historyToEntries(opts.history ?? []);
    this.activeCompaction = opts.compaction;
    const skillsPrompt = pluginSkillsPrompt(this.pluginSkills);
    const defaultSystemPrompt = [
      DEFAULT_RUNTIME_SYSTEM_PROMPT,
      // Collaboration rules. Measured sessions ran hours with 380 assistant
      // messages and exactly one non-empty text body: a reasoning model reads
      // "prefer concise" as "say nothing", writes its conclusion into thinking
      // (which the user never sees), and the user is left sending "继续" to
      // find out whether anything happened. Every clause below is one of those
      // observed failures stated as a hard rule.
      "Collaboration: answer in the same language the user writes in. Before each batch of tool calls, write one short sentence saying what you are about to do; never leave the user with no new text for more than one tool batch or 60 seconds of work. Whatever the user asked must be answered in your visible text — your reasoning is not shown to them, so a conclusion that lives only there never reached them. Make the final message self-contained: the outcome, what you changed, and anything still open, without asking the user to re-read intermediate updates. Carry the work through end to end; when you hit a blocker, try to clear it yourself and report what you tried, instead of stopping at analysis or a half-finished change.",
      // Search-tool steering. Read/Grep/Glob are host-bounded and scopeable;
      // hand-rolled shell pipelines are not, and unbounded shell output is
      // what exhausted context and forced repeated re-searching.
      "Searching and reading: prefer the Read, Grep, and Glob tools over shell `cat`, `sed`, `head`, `grep`, or `find`. Scope every search with the native parameters: Grep takes `path`, `include`, `outputMode`, and `headLimit`; Glob takes `path` and `limit`; Read takes `offset` and `limit` and paginates any file, however large. Use `outputMode: \"filesWithMatches\"` or `\"count\"` when file contents are not needed, and use `include` to avoid scanning generated or vendor trees. These tools bound their own output; a shell pipeline does not, and one unscoped search over a whole workspace costs context you will need later. Workspace-relative paths are portable across macOS, Linux, and Windows; an explicit path outside the workspace and session scratch roots asks for permission unless the effective mode is Auto, so do not retry a denied path blindly. When a search genuinely needs Bash, use the active shell's syntax and a bounded command; use `rg` only when it is available, and never assume POSIX utilities, `/`-based paths, or PowerShell commands on every platform. Do not re-run a search whose answer you already have.",
      // Observed leak: OpenAI-style models sometimes emit the internal
      // `multi_tool_use.parallel` wrapper as assistant text. PI-Desktop has no
      // such tool, so the whole batch is silently lost as prose.
      "Call tools through the native tool-call interface only. Never write a tool call as text, and never emit a `multi_tool_use.parallel` / `{\"tool_uses\": [...]}` wrapper — there is no such tool here, and a call written as prose does not run. To run several tools at once, emit several real tool calls in one assistant message.",
      "Editing workflow: use the built-in Edit or Write tool directly on the deliverable file whenever it is inside the advertised workspace. Use Edit for one small unique replacement and Write for a coherent whole-file rewrite. Do not invoke shell apply_patch, git apply, or patch commands; do not create or hand-edit unified-diff files in scratch or repeatedly repair their hunk headers. Treat an edit or shell patch failure as stale state: perform one fresh Read, regenerate the change from that current content once, then stop and report the exact mismatch instead of looping. Never issue concurrent Write/Edit calls for the same path. When a dedicated worktree is outside the advertised workspace, make one guarded, deterministic edit inside that worktree with Bash, then verify it with git diff or an equivalent check.",
      // Work panel browser preview (D100): workspace HTML files render
      // in the embedded browser with live reload on file changes.
      `For user-visible HTML pages, call the BrowserPreview tool once after creating the page or making the first meaningful visual edit, using its workspace-relative path (e.g. \`index.html\` or \`demo/index.html\`) to show it in PI-Desktop's built-in browser panel. Reuse that preview while iterating: it live-reloads as you edit, so no repeat call or manual refresh is needed. Skip generated, test-only, and non-visual HTML files. If BrowserPreview is not in the current tool list, load it first with ${TOOL_SEARCH_NAME}.`,
      // Shell dialect and scratch variable are selected by host-core.
      commandShellGuidance(this.commandShell, this.scratchDir),
      // Session scratch directory (D114): temp files must not dirty
      // the user's workspace or its git status.
      ...(this.scratchDir
        ? [
            `Your scratch directory for this session is \`${this.scratchDir}\` (in Bash: $PI_SCRATCH_DIR). Write ALL temporary and intermediate files there using absolute paths — one-off scripts, downloaded data, drafts, experiment output — never into the workspace. Only write into the workspace when the file is a deliverable the user asked for. Scratch files persist across turns of this session and are cleaned up automatically when the session is deleted.`,
          ]
        : []),
      // Plugin skills (D174): the catalog rides in the base prompt so a
      // path-scoped instruction reload never drops it, and it stays ahead of
      // the instruction chain so the user's own AGENTS.md keeps the last word.
      ...(skillsPrompt ? [skillsPrompt] : []),
    ].join("\n\n");
    this.baseSystemPrompt = opts.systemPrompt ?? defaultSystemPrompt;
    this.agent = new Agent({
      streamFn: (m, context, options) => {
        this.providerResponseStatus = undefined;
        return models.streamSimple(m, context, {
          ...options,
          // Keep provider-level retries bounded. A second retry is handled
          // only for a mid-stream transient failure, after the failed
          // assistant has been removed from the model context.
          maxRetries: PROVIDER_REQUEST_MAX_RETRIES,
          maxRetryDelayMs: PROVIDER_MAX_RETRY_DELAY_MS,
          sessionId: this.sessionId,
          onResponse: async (response, responseModel) => {
            this.providerResponseStatus = response.status;
            await options?.onResponse?.(response, responseModel);
          },
        });
      },
      getApiKey: async () => runtimeApiKey,
      convertToLlm,
      prepareNextTurnWithContext: (context, signal) =>
        this.prepareNextTurn(context, signal),
      afterToolCall: async (context) => this.afterToolCall(context),
      initialState: {
        systemPrompt: this.composeSystemPrompt(),
        model,
        tools,
        thinkingLevel: this.thinkingLevel,
        messages: buildSessionContext(this.entriesWithCompaction()).messages,
      },
      // Plan transitions must be the only tool call in an assistant batch.
      // Sequential execution also makes the host-confirmed mode change visible
      // before the next model request in the same run.
      beforeToolCall: (context) => this.beforeToolCall(context),
      // Every tool except `Task` carries `executionMode: "sequential"`, and pi
      // runs a batch sequentially as soon as it contains one such tool. So the
      // only batch that actually runs concurrently is a batch of nothing but
      // `Task` calls — subagent fan-out (ADR 0062) — and every existing tool
      // ordering guarantee is untouched.
      toolExecution: "parallel",
    });

    this.agent.subscribe((event) => this.handleAgentEvent(event));
  }

  /** Switch the planning state on this Agent without creating another Agent. */
  setMode(mode: Mode): void {
    if (this.disposed) throw new Error("runtime disposed");
    // Plan and Goal are both contract-negotiating states (D198); only Agent
    // executes freely.
    const kind = proposalKindForMode(mode);
    const planningState: PlanningState = kind ? "planning" : "inactive";
    const details = kind ? { kind } : {};
    if (this.mode === mode) {
      this.setPlanningState(planningState, details);
      return;
    }
    this.mode = mode;
    this.activeDeferredToolNames.clear();
    this.rebuildToolCatalog();
    this.agent.state.systemPrompt = this.composeSystemPrompt();
    this.agent.state.tools = this.activeTools();
    this.setPlanningState(planningState, details);
  }

  getMode(): Mode {
    return this.mode;
  }

  private composeSystemPrompt(): string {
    const projectPrompt = projectInstructionsPrompt(this.projectInstructions);
    const optionalToolsPrompt = this.optionalToolsPrompt();
    return composeModeSystemPrompt(
      this.mode,
      [
        this.baseSystemPrompt,
        ...(optionalToolsPrompt ? [optionalToolsPrompt] : []),
        ...(projectPrompt ? [projectPrompt] : []),
      ].join("\n\n"),
    );
  }

  /**
   * Host failures and mutation-failure termination are recorded per tool-call
   * id while the call runs; this is where they reach pi's tool-error channel.
   * Subagents reuse it so a delegate's host failure behaves like the parent's.
   */
  private afterToolCall({
    toolCall,
  }: AfterToolCallContext): AfterToolCallResult | undefined {
    const terminate = this.terminatingToolCalls.delete(toolCall.id);
    const failed = this.failedHostToolCalls.delete(toolCall.id);
    if (!failed) return terminate ? { terminate: true } : undefined;
    return {
      isError: true,
      ...(terminate ? { terminate: true } : {}),
    };
  }

  private async beforeToolCall(
    context: BeforeToolCallContext,
  ): Promise<BeforeToolCallResult | undefined> {
    const toolCalls = (context.assistantMessage.content as Array<{ type?: string }>).filter(
      (block) => block.type === "toolCall",
    );
    const transition = MODE_TRANSITION_TOOL_NAMES.has(context.toolCall.name);
    const transitionInBatch = toolCalls.some((block) =>
      MODE_TRANSITION_TOOL_NAMES.has((block as { name?: string }).name ?? ""),
    );
    if (transitionInBatch && toolCalls.length !== 1) {
      return {
        block: true,
        reason: `${[...MODE_TRANSITION_TOOL_NAMES].join(", ")} must be the only tool call in the assistant message.`,
      };
    }
    if (!transition) return undefined;
    const enterKind = enterToolKind(context.toolCall.name);
    if (enterKind && this.mode !== "agent") {
      return {
        block: true,
        reason: `${context.toolCall.name} is available only in Agent mode.`,
      };
    }
    const submitKind = submitToolKind(context.toolCall.name);
    if (submitKind && this.mode !== submitKind) {
      return {
        block: true,
        reason: `${context.toolCall.name} is available only in ${modeLabel(submitKind)} mode.`,
      };
    }
    return undefined;
  }

  private setPlanningState(
    state: PlanningState,
    details: {
      kind?: ProposalKind;
      proposalId?: string;
      title?: string;
      markdown?: string;
      question?: string;
      artifact?: PlanProposal["artifact"];
      version?: number;
      plan?: string;
      action?: "approve" | "reject";
      targetPermissionMode?: "ask" | "accept-edits" | "auto";
      executionId?: string;
      executionState?: PlanProposal["executionState"];
      proposal?: PlanProposal;
    } = {},
  ): void {
    this.planningState = state;
    this.pendingPlanId = details.proposalId;
    this.emit({ type: "planning_state", state, ...details });
  }

  /** True when this runtime can be reused for a prompt with the given config. */
  matches(config: RuntimeMatchConfig): boolean {
    const requestedPluginTools = config.pluginTools ?? [];
    const requestedPluginSkills = config.pluginSkills ?? [];
    const current = this.pluginTools.map((t) => t.name).sort().join(",");
    const next = requestedPluginTools.map((t) => t.name).sort().join(",");
    const currentThinkingLevels = [
      ...(this.provider.supportedThinkingLevels ?? ["off"]),
    ]
      .sort()
      .join(",");
    const nextThinkingLevels = [
      ...(config.provider.supportedThinkingLevels ?? ["off"]),
    ]
      .sort()
      .join(",");
    return (
      !this.disposed &&
      this.provider.id === config.provider.id &&
      this.provider.modelId === config.provider.modelId &&
      (this.provider.baseUrl ?? "") === (config.provider.baseUrl ?? "") &&
      this.provider.apiKey === config.provider.apiKey &&
      this.provider.authKind === config.provider.authKind &&
      (this.provider.apiStyle ?? "") === (config.provider.apiStyle ?? "") &&
      this.provider.supportsReasoning === config.provider.supportsReasoning &&
      currentThinkingLevels === nextThinkingLevels &&
      safeJson(this.provider.modelConfig ?? null) ===
        safeJson(config.provider.modelConfig ?? null) &&
      this.mode === config.mode &&
      this.thinkingLevel ===
        clampThinkingLevel(config.provider, config.thinkingLevel) &&
      current === next &&
      safeJson(this.commandShell) === safeJson(config.commandShell) &&
      safeJson(this.baseProjectInstructions ?? null) ===
        safeJson(config.projectInstructions ?? null) &&
      (this.projectPath ?? "") === (config.projectPath?.trim() ?? "") &&
      // Enabling a plugin, revoking agent.prompt.inject or renaming a skill
      // changes the catalog digest, which retires the runtime and its stale
      // prompt. Bodies are excluded: the Skill tool always reads them fresh.
      pluginSkillsDigest(this.pluginSkills) === pluginSkillsDigest(requestedPluginSkills) &&
      // Editing `.pi/agents/*.md` must reach the next prompt. Definition
      // bodies are part of the `Task` tool's behavior, so unlike skills they
      // are compared in full.
      safeJson(this.subagents) === safeJson(config.subagents ?? []) &&
      safeJson(this.subagentProviders) === safeJson(config.subagentProviders ?? {})
    );
  }

  /* Rebuild pi-ai messages from the persisted transcript, including tool
   * call/result pairs — tool rows persist toolCallId/toolName/toolArgs and
   * the result (including deferred-tool activation markers), which is
   * everything the model context needs. Losing them
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
      // Subagent rows belong to the transcript and to review, never to the
      // parent's model context (ADR 0062): the parent only ever saw the `Task`
      // report, and replaying a delegate's messages would both contradict that
      // and reintroduce the context cost delegation exists to avoid.
      if (m.parentToolCallId) continue;
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

  private buildToolDefinitions(): AgentTool[] {
    // With a scratch dir provisioned, file tools accept absolute paths into
    // it as a second root (D114); keep the wording in sync with host-core.
    const scratchPathHint = this.scratchDir
      ? " `path` is workspace-relative, or an absolute path inside the session scratch directory."
      : "";
    const externalPathHint =
      " An explicit path outside the workspace and session scratch roots requires permission unless the effective mode is Auto.";
    const describe = (toolName: string): string => {
      switch (toolName) {
        case "BrowserPreview":
          return "Open a workspace HTML file in PI-Desktop's built-in browser panel. `path` is workspace-relative (e.g. \"demo/index.html\"). The preview live-reloads on later edits to the file or its sibling assets, so call once per page.";
        case "Read":
          return (
            "Read a bounded window from a text file. Use `offset` and `limit` " +
            "to paginate large files." +
            `${scratchPathHint}${externalPathHint}`
          );
        case "Glob":
          return (
            "List files by glob pattern, newest first. Use `path` to scope the " +
            "directory and `limit` to bound results; patterns use `/` as a " +
            "portable separator." +
            `${scratchPathHint}${externalPathHint}`
          );
        case "Grep":
          return (
            "Search file contents with a Rust-compatible regex. Use `path` and " +
            "`include` to narrow the scan, `headLimit` to bound results, and " +
            'outputMode: "filesWithMatches" or "count" when content is unnecessary; ' +
            "`path` accepts portable relative paths." +
            `${scratchPathHint}${externalPathHint}`
          );
        case "Write":
          return `Create or overwrite a file. Deliverables go into the workspace; temporary/intermediate files go into the scratch directory.${scratchPathHint}${externalPathHint}`;
        case "Edit":
          return `Replace one unique occurrence of old_string in a file. Use Edit for a small localized change and Write for a whole-file rewrite; never guess old_string. After one failed edit, perform one fresh Read and regenerate the edit from that content. If the second attempt fails, stop instead of looping or repairing an old patch; do not repair an old patch repeatedly. Do not edit the same path concurrently.${scratchPathHint}${externalPathHint}`;
        case "Bash":
          return `${commandShellToolDescription(this.commandShell, this.scratchDir)} Use Edit or Write instead of apply_patch, git apply, or patch; do not retry a failed shell patch command repeatedly.`;
        case "PluginScaffold":
          return "Create a PI-Desktop plugin from a template and load it for development. `directory` is workspace-relative and must be empty or new; `template` is one of panel-basic, agent-tool-basic, skill-pack, full-demo. Use this instead of hand-writing plugin files.";
        case "PluginCheck":
          return "Validate a PI-Desktop plugin directory against every rule the installer enforces (manifest, entry file, panel, skills, permissions, package limits). `directory` is workspace-relative. Run this before packaging.";
        case "PluginPack":
          return "Package a PI-Desktop plugin directory into an installable dist/<id>-<version>.piplug. `directory` is workspace-relative. Runs the same validation as PluginCheck first and refuses to package a plugin with errors. Never build a .piplug with shell tools — the installer only accepts uncompressed archives.";
        default:
          return `${toolName} tool via PI-Desktop host-core`;
      }
    };
    // One entry per tool: the shapes diverge enough that a chain of ternaries
    // stopped being readable.
    const parameters: Record<string, Parameters<typeof Type.Object>[0]> = {
      Read: {
        path: Type.String({ description: "Workspace-relative or explicitly approved file path." }),
        offset: Type.Optional(
          Type.Number({ minimum: 0, description: "0-based line offset; defaults to 0." }),
        ),
        limit: Type.Optional(
          Type.Number({ minimum: 1, description: "Maximum lines to return; defaults to 2000." }),
        ),
      },
      BrowserPreview: { path: Type.String() },
      Glob: {
        pattern: Type.String({ description: "Glob pattern, for example **/*.ts." }),
        path: Type.Optional(
          Type.String({
            description:
              "Directory to search; defaults to the workspace root and accepts an absolute scratch path.",
          }),
        ),
        limit: Type.Optional(
          Type.Number({ minimum: 1, description: "Maximum entries; defaults to 100." }),
        ),
      },
      Grep: {
        pattern: Type.String({ description: "Rust-compatible regex matched per line." }),
        path: Type.Optional(
          Type.String({
            description:
              "Directory to search; defaults to the workspace root and accepts an absolute scratch path.",
          }),
        ),
        include: Type.Optional(
          Type.String({ description: "Glob filter, for example **/*.{ts,tsx}." }),
        ),
        outputMode: Type.Optional(
          Type.Union([
            Type.Literal("content"),
            Type.Literal("filesWithMatches"),
            Type.Literal("count"),
          ]),
        ),
        headLimit: Type.Optional(
          Type.Number({ minimum: 1, description: "Maximum matches or files; defaults to 200." }),
        ),
        caseInsensitive: Type.Optional(Type.Boolean()),
      },
      Write: { path: Type.String(), content: Type.String() },
      Edit: {
        path: Type.String(),
        old_string: Type.String(),
        new_string: Type.String(),
      },
      Bash: {
        command: Type.String(),
        timeout: Type.Optional(
          Type.Number({
            minimum: MIN_COMMAND_TIMEOUT_SECONDS,
            maximum: MAX_COMMAND_TIMEOUT_SECONDS,
            description:
              "Optional command timeout in seconds from 1 to 300; defaults to 60 seconds.",
          }),
        ),
      },
      PluginScaffold: {
        template: Type.String(),
        directory: Type.String(),
        id: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
      },
      PluginCheck: { directory: Type.String() },
      PluginPack: { directory: Type.String() },
    };
    const exec = (toolName: string): AgentTool => {
      const run: AgentTool["execute"] = async (
        toolCallId,
        params,
        signal,
        onUpdate,
      ) => {
        const instructionTiming = await this.loadPathInstructions(toolName, params);
        const startedAt = Date.now();
        const isBash = toolName === "Bash";
        const timeoutMs = isBash ? commandTimeoutMs(params) : undefined;
        let progress = "";
        let progressDirty = false;
        let progressTimer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        let abortRequested = false;
        let cleaned = false;
        let abortError: unknown;
        let abortPromise: Promise<void> | undefined;
        let cleanup: (flush: boolean) => void = () => undefined;
        const flushProgress = () => {
          progressTimer = undefined;
          if (!onUpdate || !progress || !progressDirty) return;
          progressDirty = false;
          try {
            onUpdate({
              content: [{ type: "text", text: progress }],
              details: { output: progress },
            });
          } catch {
            // Progress is advisory; a renderer callback must not fail the tool.
          }
        };
        const scheduleProgress = () => {
          if (!onUpdate || progressTimer || settled) return;
          progressTimer = setTimeout(flushProgress, TOOL_OUTPUT_UPDATE_THROTTLE_MS);
        };
        const unsubscribeOutput = isBash && this.host.onNotification
          ? this.host.onNotification((method, params) => {
              if (
                settled ||
                method !== "tools.output" ||
                !isToolsOutputParams(params) ||
                params.sessionId !== this.sessionId ||
                params.toolCallId !== toolCallId ||
                params.commandShellId !== this.commandShell.id
              ) {
                return;
              }
              progress = appendToolProgress(progress, params.chunk);
              progressDirty = true;
              scheduleProgress();
            })
          : undefined;
        const abort = () => {
          if (!isBash || abortRequested || settled) return;
          abortRequested = true;
          abortPromise = this.host
            .call("tools.abort", {
              sessionId: this.sessionId,
              toolCallId,
            })
            .then(
              () => undefined,
              (error) => {
                abortError = error;
              },
            );
          cleanup(true);
        };

        cleanup = (flush: boolean) => {
          if (cleaned) return;
          cleaned = true;
          settled = true;
          if (progressTimer) clearTimeout(progressTimer);
          if (flush) flushProgress();
          unsubscribeOutput?.();
          signal?.removeEventListener("abort", abort);
          this.activeToolProgressCleanups.delete(cleanup);
        };
        this.activeToolProgressCleanups.add(cleanup);
        if (signal?.aborted) {
          cleanup(false);
          throw Object.assign(new Error("tool execution aborted before it started"), {
            errorCode: "TOOL_ABORTED",
          });
        }
        if (signal) {
          signal.addEventListener("abort", abort, { once: true });
        }

        let result: {
          ok: boolean;
          content: unknown;
          isError?: boolean;
          errorCode?: string;
          denied?: boolean;
        } | undefined;
        let executionError: unknown;
        let executionFailed = false;
        try {
          result = await this.host.call<{
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
              ...(isBash
                ? {
                    expectedCommandShellId: this.commandShell.id,
                    expectedCommandShellDialect: this.commandShell.dialect,
                    timeoutMs,
                  }
                : {}),
              ...(toolName.startsWith("plugin_")
                ? {
                    declaredRisk: this.pluginTools.find((tool) => tool.name === toolName)
                      ?.risk,
                  }
                : {}),
            });
        } catch (error) {
          executionFailed = true;
          executionError = error;
        } finally {
          cleanup(true);
        }
        if (abortPromise) await abortPromise;
        if (abortError) throw abortError;
        if (executionFailed) throw executionError;
        if (!result) throw new Error("tool execution returned no result");
        // hostRttMs spans approval + execution + IPC. Compare it against the
        // host's own "tool timing" line for the same toolCallId: the gap is
        // the stdio hops, and permissionWaitMs there explains a large value.
        const recordParams = isRecord(params) ? params : undefined;
        const failedToolExecution = !result.ok && result.denied !== true;
        const failedEditPath =
          toolName === "Edit" &&
          failedToolExecution &&
          typeof recordParams?.path === "string"
            ? mutationFailureKey(recordParams.path)
            : undefined;
        const failedPatchCommand =
          toolName === "Bash" &&
          failedToolExecution &&
          isPatchCommand(recordParams?.command);
        const failureKey = failedEditPath
          ? failedEditPath
          : failedPatchCommand
            ? BASH_PATCH_FAILURE_KEY
            : undefined;
        const mutationFailureAttempt = failureKey
          ? (this.mutationFailureCounts.get(failureKey) ?? 0) + 1
          : undefined;
        const mutationFailureKind = failedEditPath
          ? "edit"
          : failedPatchCommand
            ? "patch-command"
            : undefined;
        const terminateAfterMutationFailure =
          mutationFailureAttempt !== undefined &&
          mutationFailureAttempt >= MAX_MUTATION_RECOVERY_FAILURES;
        if (failureKey && mutationFailureAttempt !== undefined) {
          this.mutationFailureCounts.set(failureKey, mutationFailureAttempt);
        }
        if (terminateAfterMutationFailure) {
          this.terminatingToolCalls.add(toolCallId);
        }
        logTiming("tool", {
          tool: toolName,
          toolCallId,
          sessionId: this.sessionId,
          turnId: this.turnId,
          hostRttMs: Date.now() - startedAt,
          instructionResolveMs: instructionTiming?.durationMs,
          instructionCacheHit: instructionTiming?.cacheHit,
          instructionFallback: instructionTiming?.fallback ? "base" : undefined,
          ok: result.ok,
          errorCode: result.errorCode,
          ...(mutationFailureKind ? { mutationFailureKind } : {}),
          ...(mutationFailureAttempt !== undefined
            ? { mutationFailureAttempt }
            : {}),
          ...(terminateAfterMutationFailure ? { terminate: true } : {}),
        });
        const text =
          typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content, null, 2);
        if (!result.ok) this.failedHostToolCalls.add(toolCallId);
        return {
          content: [{ type: "text", text }],
          details: result.content,
          ...(terminateAfterMutationFailure ? { terminate: true } : {}),
          isError: result.isError === true || result.ok === false,
        };
      };
      return {
        name: toolName,
        label: toolName,
        description: describe(toolName),
        parameters: Type.Object(
          parameters[toolName] ?? { command: Type.String() },
        ),
        execute: (toolCallId, params, signal, onUpdate) =>
          PATH_MUTATING_TOOLS.has(toolName)
            ? this.writeLocks.run(
                isRecord(params) ? String(params.path ?? "") : "",
                () => run(toolCallId, params, signal, onUpdate),
              )
            : run(toolCallId, params, signal, onUpdate),
      };
    };

    // BrowserPreview is non-mutating (renders an existing workspace file in
    // the work panel browser), so it ships in every mode. PluginCheck only
    // reads a directory; PluginScaffold and PluginPack write, so they follow
    // Write/Edit/Bash into agent mode only.
    const tools =
      this.mode === "agent"
        ? [
            "Read",
            "Bash",
            "Edit",
            "Write",
            "Glob",
            "Grep",
            "BrowserPreview",
            "PluginCheck",
          ]
        : ["Read", "Glob", "Grep", "BrowserPreview", "Bash"];
    if (this.mode === "agent") {
      tools.push("PluginScaffold", "PluginPack");
    }
    const builtins = tools.map(exec);

    const pluginTools: AgentTool[] =
      this.mode === "agent"
        ? this.pluginTools.map((def) => ({
            name: def.name,
            label: def.name,
            description: def.description || `${def.name} plugin tool`,
            parameters: (def.parameters ??
              Type.Object({})) as AgentTool["parameters"],
            executionMode: "sequential" as const,
            execute: exec(def.name).execute,
          }))
        : [];
    // Only offered when a plugin actually taught a skill; Electron main serves
    // it locally (host-core never sees the skill documents).
    const skillTools: AgentTool[] =
      this.mode === "agent" && this.pluginSkills.length
      ? [
          {
            name: SKILL_TOOL_NAME,
            label: "Skill",
            description:
              "Load the full instructions of one skill listed in the Skills section of your system prompt. Pass its exact id (for example \"demo.hello/release-notes\"). Returns the skill document; follow it for the current task.",
            parameters: Type.Object({
              id: Type.String({
                description: "Skill id exactly as listed in the Skills section.",
              }),
            }),
            execute: exec(SKILL_TOOL_NAME).execute,
          },
        ]
      : [];
    const modeTools =
      this.mode === "agent"
        ? [this.buildEnterModeTool("plan"), this.buildEnterModeTool("goal")]
        : [this.buildSubmitTool(this.mode)];
    // Delegation is an Agent-mode capability: Plan and Goal are read-only
    // contract negotiations, and a delegate with Bash or Edit would drive
    // straight through that (ADR 0062).
    const subagentTools =
      this.mode === "agent" && this.subagents.length
        ? [this.buildSubagentTool()]
        : [];
    return [
      ...builtins,
      ...pluginTools,
      ...skillTools,
      ...modeTools,
      ...subagentTools,
    ];
  }

  /**
   * Build the complete registry once, then expose only the core subset to the
   * first provider request. This mirrors pi's active-tool model while keeping
   * the host tool implementation and permission path unchanged.
   */
  private rebuildToolCatalog(): void {
    const catalog = new Map<string, AgentTool>();
    for (const tool of this.buildToolDefinitions()) {
      if (!this.isToolAllowedInMode(tool.name)) continue;
      // The execution mode is decided here, in one place, so no tool can grow
      // an accidental parallel batch: everything is sequential except `Task`.
      // pi runs a whole batch sequentially when it holds one sequential tool,
      // so only an all-`Task` batch fans out.
      catalog.set(tool.name, {
        ...tool,
        executionMode:
          tool.name === SUBAGENT_TOOL_NAME ? "parallel" : "sequential",
      });
    }
    this.toolCatalog = catalog;
    this.deferredToolNames = new Set(
      [...catalog.keys()].filter(
        (name) => !this.isCoreTool(name) && name !== TOOL_SEARCH_NAME,
      ),
    );
    for (const name of this.activeDeferredToolNames) {
      if (!this.deferredToolNames.has(name)) {
        this.activeDeferredToolNames.delete(name);
      }
    }
    if (this.deferredToolNames.size > 0) {
      this.toolCatalog.set(TOOL_SEARCH_NAME, {
        ...this.buildToolSearchTool(),
        executionMode: "sequential",
      });
    }
  }

  private isToolAllowedInMode(name: string): boolean {
    const kind = proposalKindForMode(this.mode);
    if (!kind) return true;
    // Contract modes are read-only: inspection tools plus the one submit tool
    // that belongs to this kind.
    return new Set([
      "Read",
      "Glob",
      "Grep",
      "BrowserPreview",
      "Bash",
      SUBMIT_TOOL_NAMES[kind],
    ]).has(name);
  }

  private isCoreTool(name: string): boolean {
    return (
      MODE_TRANSITION_TOOL_NAMES.has(name) ||
      // `Task` stays in the core set rather than the on-demand catalog: a
      // capability the model has to go looking for is one it will not use, and
      // delegation is worth the one extra schema per request.
      name === SUBAGENT_TOOL_NAME ||
      (this.mode === "agent"
        ? AGENT_CORE_TOOL_NAMES.has(name)
        : proposalKindForMode(this.mode)
          ? new Set(["Read", "Glob", "Grep", "Bash", "BrowserPreview"]).has(name)
          : CHAT_CORE_TOOL_NAMES.has(name))
    );
  }

  private activeTools(): AgentTool[] {
    return [...this.toolCatalog.entries()]
      .filter(
        ([name]) =>
          this.isCoreTool(name) ||
          name === TOOL_SEARCH_NAME ||
          this.activeDeferredToolNames.has(name),
      )
      .map(([, tool]) => tool);
  }

  private optionalToolsPrompt(): string {
    const entries: ToolCatalogEntry[] = [...this.deferredToolNames]
      .map((name) => this.toolCatalog.get(name))
      .filter((tool): tool is AgentTool => tool !== undefined)
      .map((tool) => ({
        name: tool.name,
        description: this.toolCatalogDescription(tool),
      }));
    if (entries.length === 0) return "";

    const visibleEntries = entries.slice(0, MAX_ON_DEMAND_TOOL_PROMPT_ENTRIES);
    const lines = visibleEntries.map(
      (entry) => `- ${entry.name}: ${this.compactToolDescription(entry.description)}`,
    );
    if (entries.length > visibleEntries.length) {
      lines.push(
        `- ... ${entries.length - visibleEntries.length} more; search by exact name or capability`,
      );
    }
    return [
      "# On-demand tools",
      `The following capabilities are available on demand. Call ${TOOL_SEARCH_NAME} with an exact tool name or a short capability description before using one that is not in the current tool list.`,
      ...lines,
    ].join("\n");
  }

  private compactToolDescription(description: string): string {
    const compact = description.replace(/\s+/g, " ").trim();
    return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`;
  }

  private toolCatalogDescription(tool: AgentTool): string {
    switch (tool.name) {
      case "BrowserPreview":
        return "Preview an HTML file in the built-in browser panel.";
      case "PluginCheck":
        return "Validate a PI-Desktop plugin directory.";
      case "PluginScaffold":
        return "Create a PI-Desktop plugin from a template.";
      case "PluginPack":
        return "Validate and package a PI-Desktop plugin.";
      case SKILL_TOOL_NAME:
        return "Load the full instructions for a listed skill.";
      default:
        return this.compactToolDescription(tool.description);
    }
  }

  private buildToolSearchTool(): AgentTool {
    return {
      name: TOOL_SEARCH_NAME,
      label: "Tool Search",
      description:
        "Find and activate an on-demand tool by exact name or capability. Use this before calling any tool listed under On-demand tools that is not already in the current tool list.",
      parameters: Type.Object({
        query: Type.String({
          description:
            "Exact tool name or a short capability description, for example `BrowserPreview` or `validate plugin`.",
        }),
      }),
      execute: async (_toolCallId, params) => {
        const query =
          isRecord(params) && typeof params.query === "string"
            ? params.query.trim()
            : "";
        const matches = this.findDeferredTools(query);
        const activated = matches.filter(
          (name) => !this.activeDeferredToolNames.has(name),
        );
        for (const name of activated) {
          this.activeDeferredToolNames.add(name);
        }
        const available = [...this.deferredToolNames];
        const availablePreview = available.slice(0, MAX_TOOL_SEARCH_RESULT_NAMES);
        const remaining = available.length - availablePreview.length;
        const text =
          activated.length > 0
            ? `Activated on-demand tools: ${activated.join(", ")}. They are available on the next model turn.`
            : matches.length > 0
              ? `These tools are already active: ${matches.join(", ")}.`
              : `No matching on-demand tool. Available names: ${availablePreview.join(", ")}${remaining > 0 ? `, and ${remaining} more` : ""}.`;
        return {
          content: [{ type: "text", text }],
          details: { query, matches, activated },
          ...(activated.length > 0 ? { addedToolNames: activated } : {}),
        };
      },
    };
  }

  private buildEnterModeTool(kind: ProposalKind): AgentTool {
    const name = ENTER_TOOL_NAMES[kind];
    const label = modeLabel(kind);
    return {
      name,
      label: `Enter ${label} Mode`,
      description:
        kind === "plan"
          ? "Switch this same agent into Plan mode after the host confirms the durable session transition. Use when the user wants to agree on the implementation steps before any change is made."
          : "Switch this same agent into Goal mode after the host confirms the durable session transition. Use when the user states an outcome and wants you to agree on the goal and its acceptance criteria, then reach it autonomously.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async (toolCallId) => {
        await this.host.call("plans.enter", {
          sessionId: this.sessionId,
          turnId: this.turnId,
          toolCallId,
          kind,
        });
        // The host is authoritative. Rebuild the live prompt and tool set only
        // after plans.enter has committed the new mode.
        this.setMode(kind);
        return {
          content: [
            {
              type: "text",
              text:
                kind === "plan"
                  ? "Plan mode is active. Inspect the workspace, formulate the plan, then call SubmitPlan for approval."
                  : "Goal mode is active. Clarify the outcome and how it will be verified, then call SubmitGoal for approval.",
            },
          ],
          details: { mode: kind, kind, planningState: "planning" },
        };
      },
    };
  }

  /** Provider a delegate runs on: the definition's pin resolved by Electron
   * main, or the session's own provider when it pins nothing. */
  private subagentProvider(
    definition: SubagentDefinition,
  ): RuntimeProviderConfig | undefined {
    if (!definition.model) return this.provider;
    return this.subagentProviders[subagentModelKey(definition.model)];
  }

  /**
   * Session facts a delegate needs and cannot discover: the shell dialect, the
   * scratch directory, and the project's own instruction chain. The parent's
   * collaboration rules are deliberately left out — a delegate has no user to
   * talk to, and its report format is set by `composeSubagentSystemPrompt`.
   */
  private subagentGuidance(definition: SubagentDefinition): string[] {
    const tools = new Set(definition.tools);
    const blocks: string[] = [];
    if (tools.has("Read") || tools.has("Grep") || tools.has("Glob")) {
      blocks.push(
        "Searching and reading: prefer Read, Grep, and Glob over shell text utilities, and scope every call — Grep takes `path`, `include`, `outputMode`, and `headLimit`; Glob takes `path` and `limit`; Read takes `offset` and `limit`. Use `outputMode: \"filesWithMatches\"` or `\"count\"` when contents are not needed. Your context is finite too: an unscoped search over the whole workspace costs the tokens you need to finish.",
      );
    }
    if (tools.has("Edit") || tools.has("Write")) {
      blocks.push(
        "Editing: use Edit for one small unique replacement and Write for a coherent whole-file rewrite. Treat a failed edit as stale content — Read the file once, regenerate the change, and if it fails again report the exact mismatch instead of looping. Never write a file the task did not ask you to change; another agent may be working in the same tree.",
      );
    }
    if (tools.has("Bash")) {
      blocks.push(commandShellGuidance(this.commandShell, this.scratchDir));
    }
    if (this.scratchDir && (tools.has("Bash") || tools.has("Write"))) {
      blocks.push(
        `Write temporary and intermediate files into the session scratch directory \`${this.scratchDir}\` (in Bash: $PI_SCRATCH_DIR) using absolute paths, never into the workspace.`,
      );
    }
    const projectPrompt = projectInstructionsPrompt(this.projectInstructions);
    if (projectPrompt) blocks.push(projectPrompt);
    return blocks;
  }

  /**
   * A `Task` call that never reached a delegate. pi ignores an `isError` field
   * on a tool result — only a thrown error or `afterToolCall` marks one — so
   * the failure is registered the same way host tool failures are, and throwing
   * is avoided to keep the explanation in the result the model reads.
   */
  private subagentToolError(
    toolCallId: string,
    text: string,
  ): AgentToolResult<unknown> {
    this.failedHostToolCalls.add(toolCallId);
    return {
      content: [{ type: "text", text }],
      details: { error: text },
    };
  }

  /**
   * `Task`: delegate one bounded piece of work to a subagent (ADR 0062).
   *
   * The catalog of definitions rides in this tool's description rather than in
   * the system prompt, because the two change together: a project adding an
   * agent file changes the tool, and nothing else about the prompt.
   */
  private buildSubagentTool(): AgentTool {
    const names = this.subagents.map((definition) => definition.name);
    const catalog = this.subagents
      .map(
        (definition) =>
          `- ${definition.name} (tools: ${definition.tools.join(", ")}): ${definition.description}`,
      )
      .join("\n");
    return {
      name: SUBAGENT_TOOL_NAME,
      label: "Task",
      description: [
        "Delegate one self-contained piece of work to a subagent with its own context window, and get back a single written report.",
        "Delegate when the work is separable and its intermediate output would otherwise fill this context: a wide search, a long log, a survey of many files. Do not delegate what you can finish in a couple of tool calls, and do not delegate anything that needs the user — a subagent cannot ask a question or propose a plan on your behalf.",
        "`task` is the delegate's only instruction. It cannot see this conversation, and you cannot correct it while it runs, so state the goal, the paths and facts it cannot infer, and exactly what to report back.",
        "Its final message is all you receive; everything it read or ran stays out of your context. Check anything you are about to rely on for an irreversible change.",
        "To run delegates concurrently, emit several Task calls in one assistant message. A message that mixes Task with any other tool runs one call at a time.",
        `Available subagents:\n${catalog}`,
      ].join("\n\n"),
      parameters: Type.Object({
        agent: Type.String({
          description: `Name of the subagent to run: ${names.join(", ")}.`,
        }),
        task: Type.String({
          description:
            "The complete brief: goal, context the delegate cannot infer, and the exact report you want back.",
        }),
        description: Type.Optional(
          Type.String({
            description:
              "Short label for this delegation (3-6 words), shown to the user.",
          }),
        ),
      }),
      // Set in `rebuildToolCatalog`, which owns every execution mode; repeated
      // here so the intent survives a tool built outside that path.
      executionMode: "parallel",
      execute: async (toolCallId, params, signal) => {
        const requested = isRecord(params) ? String(params.agent ?? "") : "";
        const definition = this.subagents.find(
          (candidate) => candidate.name === normalizeSubagentName(requested),
        );
        if (!definition) {
          return this.subagentToolError(
            toolCallId,
            `Unknown subagent "${requested}". Available: ${names.join(", ")}.`,
          );
        }
        const task =
          isRecord(params) && typeof params.task === "string"
            ? params.task.trim()
            : "";
        if (!task) {
          return this.subagentToolError(
            toolCallId,
            `Delegating to ${definition.name} needs a non-empty \`task\` brief.`,
          );
        }
        const provider = this.subagentProvider(definition);
        if (!provider) {
          // A pinned model that is not configured must not silently fall back
          // to the session model: the definition asked for that model on
          // purpose, and the parent can do the work itself instead.
          return this.subagentToolError(
            toolCallId,
            `The ${definition.name} subagent pins ${definition.model?.providerId}/${definition.model?.modelId}, which is not configured in PI-Desktop. Do this work yourself or delegate to another subagent.`,
          );
        }
        const tools = definition.tools
          .map((name) => this.toolCatalog.get(name))
          .filter((tool): tool is AgentTool => tool !== undefined);
        if (tools.length === 0) {
          return this.subagentToolError(
            toolCallId,
            `The ${definition.name} subagent declares no tool available in this session.`,
          );
        }
        const startedAt = Date.now();
        const result = await this.subagentSlots.run(() =>
          new SubagentRun({
            definition,
            sessionId: this.sessionId,
            turnId: this.turnId,
            parentToolCallId: toolCallId,
            task,
            provider,
            thinkingLevel: clampThinkingLevel(
              provider,
              definition.thinkingLevel ?? this.thinkingLevel,
            ),
            systemPrompt: composeSubagentSystemPrompt({
              definition,
              guidance: this.subagentGuidance(definition),
            }),
            tools,
            onEvent: this.onEvent,
            // A host failure inside a delegate reaches its tool-error channel
            // through the same bookkeeping the parent uses.
            resolveToolOutcome: (context) => this.afterToolCall(context),
            signal,
          }).run(),
        );
        logTiming("subagent", {
          agent: result.agentName,
          toolCallId,
          sessionId: this.sessionId,
          turnId: this.turnId,
          provider: provider.id,
          model: provider.modelId,
          status: result.status,
          turns: result.turns,
          toolCalls: result.toolCalls,
          durationMs: Date.now() - startedAt,
          errorCode: result.error?.code,
        });
        // A failed delegate is a failed tool call. A truncated or aborted one
        // still carries a partial report that says so in its own text, so the
        // parent can work with what there is.
        if (result.status === "failed") this.failedHostToolCalls.add(toolCallId);
        return {
          content: [{ type: "text", text: result.report }],
          details: {
            agent: result.agentName,
            status: result.status,
            turns: result.turns,
            toolCalls: result.toolCalls,
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.error ? { error: result.error } : {}),
          },
        };
      },
    };
  }

  private findDeferredTools(query: string): string[] {
    const normalizedQuery = query.toLowerCase();
    if (!normalizedQuery) return [];
    const terms = normalizedQuery.split(/[\s,;|/]+/).filter(Boolean);
    return [...this.deferredToolNames]
      .map((name) => {
        const tool = this.toolCatalog.get(name);
        const normalizedName = name.toLowerCase();
        const description = tool?.description.toLowerCase() ?? "";
        let score = 0;
        if (normalizedName === normalizedQuery) score += 10_000;
        else if (normalizedName.includes(normalizedQuery)) score += 2_000;
        for (const term of terms) {
          if (normalizedName.includes(term)) score += 300;
          if (description.includes(term)) score += 25;
        }
        return { name, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((candidate) => candidate.name);
  }

  private resetDeferredToolsForPrompt(): void {
    this.activeDeferredToolNames.clear();
    this.agent.state.tools = this.activeTools();
  }

  private buildSubmitTool(kind: ProposalKind): AgentTool {
    const name = SUBMIT_TOOL_NAMES[kind];
    return {
      name,
      label: kind === "plan" ? "Submit plan" : "Submit goal",
      description:
        kind === "plan"
          ? "Submit one new complete Markdown implementation plan for user approval. Prior submissions are immutable historical checkpoints; after a rejected, expired, or interrupted approval, revise the plan and submit a new full snapshot in this turn. Do not use this until the plan is concrete."
          : "Submit one new complete Markdown goal contract for user approval: the outcome to reach, the acceptance criteria that prove it, and the boundaries you must not cross. Prior submissions are immutable historical checkpoints; after a rejected, expired, or interrupted approval, revise the contract and submit a new full snapshot in this turn. Do not use this until the goal is unambiguous and every criterion is checkable.",
      parameters: Type.Object({
        title: Type.String({
          description:
            kind === "plan"
              ? "A concise title for the implementation plan."
              : "A concise title naming the goal.",
        }),
        markdown: Type.String({
          description:
            kind === "plan"
              ? "The exact Markdown implementation plan, including files, behavior, and validation."
              : "The exact Markdown goal contract, with a Goal section, an Acceptance criteria section of objectively checkable items, and a Boundaries section. Describe outcomes, not implementation steps.",
        }),
        question: Type.String({
          description:
            kind === "plan"
              ? "The question or decision the user should answer when approving this plan."
              : "The question or decision the user should answer when approving this goal contract.",
        }),
      }),
      executionMode: "sequential",
      execute: async (toolCallId, params) => {
        const title =
          isRecord(params) && typeof params.title === "string"
            ? params.title.trim()
            : "";
        const markdown =
          isRecord(params) && typeof params.markdown === "string"
            ? params.markdown
            : "";
        const question =
          isRecord(params) && typeof params.question === "string"
            ? params.question.trim()
            : "";
        if (!title || !markdown.trim() || !question) {
          return {
            content: [
              {
                type: "text",
                text: `${name} requires non-empty title, markdown, and question.`,
              },
            ],
            details: { errorCode: "PLAN_INVALID_ARGUMENT" },
            isError: true,
          };
        }
        let result: { status?: string; proposal?: PlanProposal };
        try {
          result = await this.host.call("plans.submit", {
            sessionId: this.sessionId,
            // This is the durable host turn ID passed into the runtime for the
            // current prompt, not a newly generated provider-side identifier.
            turnId: this.turnId,
            toolCallId,
            kind,
            title,
            markdown,
            question,
          });
        } catch (error) {
          const errorCode =
            (error as { data?: { errorCode?: string } })?.data?.errorCode ??
            "PLAN_SUBMIT_FAILED";
          return {
            content: [
              {
                type: "text",
                text: `${modeLabel(kind)} submission failed: ${errorCode}`,
              },
            ],
            details: { errorCode },
            isError: true,
            terminate: true,
          };
        }

        const proposal = result.proposal;
        if (
          result.status !== "pending" ||
          !proposal ||
          typeof proposal.id !== "string" ||
          !proposal.artifact ||
          typeof proposal.artifact.relativePath !== "string" ||
          typeof proposal.artifact.sha256 !== "string" ||
          typeof proposal.artifact.sizeBytes !== "number"
        ) {
          return {
            content: [
              {
                type: "text",
                text: `${modeLabel(kind)} submission returned an invalid proposal.`,
              },
            ],
            details: { errorCode: "PLAN_SUBMIT_FAILED" },
            isError: true,
            terminate: true,
          };
        }

        this.setPlanningState("awaiting_approval", {
          kind,
          proposalId: proposal.id,
          title: proposal.title || title,
          markdown: proposal.markdown || markdown,
          question: proposal.question || question,
          artifact: proposal.artifact,
          version: proposal.version,
          plan: proposal.markdown || markdown,
          executionId: proposal.executionId,
          executionState: proposal.executionState,
          proposal,
        });
        return {
          content: [
            {
              type: "text",
              text:
                kind === "plan"
                  ? "Plan submitted for approval. Execution will begin only after approval."
                  : "Goal contract submitted for approval. Autonomous execution will begin only after approval.",
            },
          ],
          details: { proposal },
          terminate: true,
        };
      },
    };
  }

  private async loadPathInstructions(
    toolName: string,
    params: unknown,
  ): Promise<PathInstructionTiming | undefined> {
    if (!PATH_SCOPED_INSTRUCTION_TOOLS.has(toolName)) {
      return undefined;
    }
    const path = isRecord(params) && typeof params.path === "string"
      ? params.path.trim()
      : "";
    if (!path) return undefined;

    const key = `${this.projectPath ?? ""}\u0000${pathInstructionScope(path)}`;
    const startedAt = Date.now();
    let resolution = this.pathInstructionClaims.get(key);
    const cacheHit = resolution !== undefined;
    if (!resolution) {
      resolution = this.host
        .call<ProjectInstructions | undefined>(
          "project.instructions.resolve",
          {
            sessionId: this.sessionId,
            path,
            ...(this.projectPath ? { projectPath: this.projectPath } : {}),
          },
          PATH_INSTRUCTION_RESOLUTION_TIMEOUT_MS,
        )
        .then((instructions) => ({ instructions, fallback: false }))
        .catch(() => ({
          // Path-scoped rules are best-effort. Do not carry a sibling path's
          // rules into this tool call when the resolver or host is unavailable.
          instructions: undefined,
          fallback: true,
        }));
      this.pathInstructionClaims.set(key, resolution);
    }
    const resolved = await resolution;
    // Rules are scoped to the file currently being accessed. Rebuild the
    // complete chain so sibling-directory rules never leak into one another
    // and edits to an existing instruction file take effect immediately.
    this.applyProjectInstructions(
      resolved.fallback ? this.baseProjectInstructions : resolved.instructions,
    );
    return {
      durationMs: Date.now() - startedAt,
      cacheHit,
      fallback: resolved.fallback,
    };
  }

  private applyProjectInstructions(resolved: ProjectInstructions | undefined): void {
    this.projectInstructions = resolved;
    this.agent.state.systemPrompt = this.composeSystemPrompt();
  }

  private emit(event: AgentEventEnvelope["event"], turnId?: string) {
    this.onEvent({
      sessionId: this.sessionId,
      turnId: turnId ?? this.turnId,
      ts: Date.now(),
      event,
    });
  }

  private shouldRetryProviderError(
    error: ReturnType<typeof classifyAgentError>,
  ): boolean {
    return (
      !this.providerRetryAttempted &&
      error.retriable === true &&
      (error.code === "STREAM_FAILED" ||
        error.code === "NETWORK_ERROR" ||
        error.code === "TIMEOUT")
    );
  }

  private providerErrorWithDiagnostics(
    error: ReturnType<typeof classifyAgentError>,
    phase: "request" | "stream",
    providerWaitMs?: number,
    streamMs?: number,
  ): ReturnType<typeof classifyAgentError> {
    const existingDetails = isRecord(error.details) ? error.details : {};
    return {
      ...error,
      details: {
        ...existingDetails,
        phase,
        ...(providerWaitMs !== undefined ? { providerWaitMs } : {}),
        ...(streamMs !== undefined ? { streamMs } : {}),
        ...(this.providerResponseStatus !== undefined &&
        existingDetails.providerStatus === undefined
          ? { providerStatus: this.providerResponseStatus }
          : {}),
        ...(this.activeProviderRetryAttempt > 0
          ? { retryAttempt: this.activeProviderRetryAttempt }
          : {}),
      },
    };
  }

  private async retryPendingProviderFailure(): Promise<void> {
    if (!this.pendingProviderRetry) return;
    this.pendingProviderRetry = undefined;

    const messages = [...this.agent.state.messages];
    if (messages.at(-1)?.role !== "assistant") {
      throw new Error("Cannot retry a provider stream without its failed assistant message");
    }
    messages.pop();
    this.agent.state.messages = messages;

    this.providerRetryInProgress = true;
    this.requestStartedAt = Date.now();
    this.providerRetryAbort = new AbortController();
    try {
      await delayWithAbort(
        PROVIDER_STREAM_RETRY_BACKOFF_MS,
        this.providerRetryAbort.signal,
      );
      if (this.disposed) throw new Error("runtime disposed");
      // The failed attempt has already finished. Only its lifecycle events
      // are suppressed; the retry must close the visible run normally.
      this.suppressProviderRetryRunEnd = false;
      this.activeProviderRetryAttempt = 1;
      await this.agent.continue();
      await this.agent.waitForIdle();
    } finally {
      this.providerRetryAbort = undefined;
      this.activeProviderRetryAttempt = 0;
      this.providerRetryInProgress = false;
      this.suppressProviderRetryRunEnd = false;
    }
  }

  /**
   * Re-run the request that came back silent, once, with SILENT_TURN_NUDGE
   * appended. The nudge goes on `agent.state.systemPrompt` rather than through
   * `prepareNextTurn`, because that hook only shapes turns inside a live run
   * and this run has already ended; `continue()` rebuilds its context from
   * state. It is restored afterwards unless a path-scoped instruction reload
   * rewrote the prompt in the meantime — that rebuild is newer, so it wins.
   */
  private async rerunSilentTurn(): Promise<void> {
    if (!this.pendingSilentTurnRerun) return;
    this.pendingSilentTurnRerun = false;
    this.suppressSilentTurnRunEnd = false;

    // agentLoopContinue refuses a transcript ending in an assistant message,
    // and this one carries nothing worth resending anyway.
    const messages = [...this.agent.state.messages];
    if (messages.at(-1)?.role === "assistant") messages.pop();
    this.agent.state.messages = messages;

    const promptBefore = this.agent.state.systemPrompt;
    const promptWithNudge = `${promptBefore}\n\n${SILENT_TURN_NUDGE}`;
    this.agent.state.systemPrompt = promptWithNudge;
    this.silentTurnRerunInProgress = true;
    this.requestStartedAt = Date.now();
    try {
      if (this.disposed) throw new Error("runtime disposed");
      await this.agent.continue();
      await this.agent.waitForIdle();
    } finally {
      if (this.agent.state.systemPrompt === promptWithNudge) {
        this.agent.state.systemPrompt = promptBefore;
      }
      this.silentTurnRerunInProgress = false;
      this.suppressSilentTurnRunEnd = false;
    }
  }

  private cleanupActiveToolProgress(): void {
    for (const cleanup of [...this.activeToolProgressCleanups]) cleanup(false);
    this.activeToolProgressCleanups.clear();
  }

  setCompactionSettings(settings?: ContextCompactionSettings): void {
    this.compactionEnabled = compactionEnabled(settings);
    this.rebuildToolCatalog();
    this.agent.state.tools = this.activeTools();
  }

  private contextBudget(messages: AgentMessage[]): ContextBudget {
    const contextWindow = Math.max(
      1,
      Math.round(this.model.contextWindow || DEFAULT_CONTEXT_WINDOW),
    );
    const modelOutputBudget = Math.min(
      Math.max(1, Math.round(this.model.maxTokens || DEFAULT_MAX_TOKENS)),
      Math.max(1, Math.floor(contextWindow * 0.25)),
    );
    const reserveFloor = Math.min(
      COMPACTION_RESERVE_FLOOR_TOKENS,
      Math.max(1, Math.floor(contextWindow * 0.5)),
    );
    const requestHeadroom = Math.min(
      contextWindow - 1,
      Math.max(
        reserveFloor,
        modelOutputBudget,
        Math.ceil(contextWindow * 0.05),
      ),
    );
    const hardLimit = Math.max(1, contextWindow - requestHeadroom);
    const keepRecentTokens = Math.min(
      Math.max(
        COMPACTION_MIN_KEEP_RECENT_TOKENS,
        Math.min(
          COMPACTION_MAX_KEEP_RECENT_TOKENS,
          Math.floor(hardLimit * COMPACTION_KEEP_RECENT_RATIO),
        ),
      ),
      Math.max(1, Math.floor(hardLimit * 0.5)),
    );
    return {
      tokens: estimateContextTokens(messages).tokens,
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
    return this.compactionEnabled && budget.tokens >= budget.hardLimit;
  }

  /**
   * Cap on the user messages a checkpoint carries forward. Codex uses a flat
   * 20k; the clamp keeps a small model window from being filled by retention
   * alone, which would leave the summary no room.
   */
  private retainedUserMessageBudget(budget: ContextBudget): number {
    return Math.max(
      1,
      Math.min(
        COMPACTION_RETAINED_USER_MESSAGE_MAX_TOKENS,
        Math.floor(budget.hardLimit * 0.5),
      ),
    );
  }

  /**
   * Prepare a checkpoint in Codex's shape: the summary covers every message
   * since the previous boundary, and the only messages carried past the
   * boundary are recent user messages.
   *
   * pi's cut point is still what marks the boundary, but the split it produces
   * is folded back together (see `codexShapedPreparation`), so
   * `budget.keepRecentTokens` no longer decides what survives — it only decides
   * which messages pi attributes file operations to.
   */
  private prepareCompactionInput(
    entries: SessionTreeEntry[],
    budget: ContextBudget,
    retainedUserTokens = this.retainedUserMessageBudget(budget),
  ) {
    const prepared = prepareCompaction(entries, {
      enabled: this.compactionEnabled,
      reserveTokens: budget.requestHeadroom,
      keepRecentTokens: budget.keepRecentTokens,
    } satisfies CompactionSettings);
    if (!prepared.ok || !prepared.value) return prepared;
    return {
      ok: true as const,
      value: this.codexShapedPreparation(
        prepared.value,
        entries,
        retainedUserTokens,
      ),
    };
  }

  /**
   * Reshape a pi preparation the way Codex compacts:
   *
   * - Everything pi would have split across `messagesToSummarize`,
   *   `turnPrefixMessages` and `retainedTail` is summarized as one range. The
   *   three are contiguous and ordered, so concatenating them loses nothing —
   *   and it is what makes dropping the tail safe: no message leaves the model
   *   context without the summary covering it.
   * - The retained tail is rebuilt from user messages alone. Dropping assistant
   *   messages also drops their `toolCall` blocks, and their results go with
   *   them in the same pass, so no orphaned tool call can reach a provider.
   * - `firstKeptEntryId` points at the anchor the checkpoint is filed against,
   *   so the next boundary starts there. The anchor itself is summarized twice
   *   as a result; a one-entry overlap is the safe direction to err in.
   */
  private codexShapedPreparation(
    preparation: CompactionPreparation,
    entries: SessionTreeEntry[],
    retainedUserTokens: number,
  ): CompactionPreparation {
    const messagesToSummarize = [
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
      ...preparation.retainedTail,
    ];
    // User messages the previous checkpoint retained are older than this
    // boundary but still in the model context, which is where Codex reads its
    // own candidates from.
    const previousCompaction = [...entries]
      .reverse()
      .find((entry) => entry.type === "compaction");
    const carriedForward =
      previousCompaction?.type === "compaction"
        ? (previousCompaction.retainedTail ?? [])
        : [];
    const candidates = [...carriedForward, ...messagesToSummarize].filter(
      (message): message is UserMessage => message.role === "user",
    );
    return {
      ...preparation,
      firstKeptEntryId:
        this.fullEntries.at(-1)?.id ?? preparation.firstKeptEntryId,
      messagesToSummarize,
      turnPrefixMessages: [],
      isSplitTurn: false,
      retainedTail: selectRetainedUserMessages(candidates, retainedUserTokens),
    };
  }

  private rebuiltAgentContext(): AgentContext {
    const messages = buildSessionContext(this.entriesWithCompaction()).messages;
    const tools = this.activeTools();
    this.agent.state.messages = messages;
    this.agent.state.tools = tools;
    return {
      systemPrompt: this.agent.state.systemPrompt,
      messages,
      tools,
    };
  }

  private async prepareNextTurn(
    _turn: PrepareNextTurnContext,
    _signal?: AbortSignal,
  ): Promise<AgentLoopTurnUpdate> {
    let context = this.rebuiltAgentContext();
    if (!this.compactionEnabled) return { context };

    const budget = this.contextBudget(context.messages);
    if (budget.tokens < budget.hardLimit) return { context };

    const compacted = await this.runCompaction("threshold", false);
    if (!compacted) {
      // Continuing would immediately issue the provider request that this
      // guard exists to prevent. The Agent wrapper converts this failure to
      // the normal error/agent_end event sequence.
      throw new Error(
        "CONTEXT_COMPACTION_FAILED: unable to create a checkpoint before the next model request",
      );
    }
    context = this.rebuiltAgentContext();
    const postCompactionBudget = this.contextBudget(context.messages);
    if (postCompactionBudget.tokens >= postCompactionBudget.hardLimit) {
      throw new Error(
        "CONTEXT_COMPACTION_FAILED: checkpoint remained above the safe model context budget",
      );
    }
    return { context };
  }

  private async runCompaction(
    reason: ContextCompactionReason,
    willRetry: boolean,
  ): Promise<boolean> {
    if (this.compactionInProgress) return false;
    this.compactionInProgress = true;
    try {
      return await this.performCompaction(reason, willRetry);
    } finally {
      this.compactionAbort = undefined;
      this.compactionInProgress = false;
    }
  }

  private emitCompactionFailure(
    reason: ContextCompactionReason,
    tokensBefore: number | undefined,
    message: string,
  ): void {
    this.emit({
      type: "compaction_end",
      reason,
      ok: false,
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      willRetry: false,
      error: { code: "CONTEXT_COMPACTION_FAILED", message },
    });
  }

  private checkpointDetails(preparation: CompactionPreparation) {
    return {
      readFiles: [...preparation.fileOps.read].sort(),
      modifiedFiles: [
        ...new Set([
          ...preparation.fileOps.written,
          ...preparation.fileOps.edited,
        ]),
      ].sort(),
    };
  }

  private createCheckpoint(
    preparation: CompactionPreparation,
    throughMessageId: string,
    summary: string,
    usage?: Usage,
    details?: unknown,
  ): ContextCompactionRecord {
    return {
      id: randomUUID(),
      summary,
      firstKeptMessageId: preparation.firstKeptEntryId,
      throughMessageId,
      tokensBefore: preparation.tokensBefore,
      ...(usage ? { usage } : {}),
      retainedTail: preparation.retainedTail,
      details: this.checkpointDetailsWithGeneration(details),
      providerId: this.provider.id,
      modelId: this.provider.modelId,
      createdAt: nowIso(),
    };
  }

  /**
   * Stamp the checkpoint with its generation so the context inspector can show
   * how many times a session has been compacted. A non-object `details` value
   * is nested rather than dropped: it belongs to whoever produced it.
   */
  private checkpointDetailsWithGeneration(details: unknown): unknown {
    const base =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : details === undefined
          ? {}
          : { value: details };
    return {
      ...base,
      generation: this.activeCompaction
        ? checkpointGeneration(this.activeCompaction.details) + 1
        : 1,
    };
  }

  private createFallbackCheckpoint(
    preparation: CompactionPreparation,
    throughMessageId: string,
    maxSummaryChars: number,
  ): ContextCompactionRecord {
    const previousSummary = preparation.previousSummary
      ? boundedText(
          preparation.previousSummary,
          Math.min(COMPACTION_FALLBACK_MAX_SUMMARY_CHARS, maxSummaryChars),
        )
      : "No previous context checkpoint is available.";
    const summary = [
      previousSummary,
      COMPACTION_FALLBACK_MARKER,
      "The automatic summary request did not complete. Older messages before this checkpoint are omitted from the next model request.",
      "The complete transcript remains available in the session. Use the retained recent messages as the source of truth for immediate continuation.",
    ].join("\n\n");
    return this.createCheckpoint(
      preparation,
      throughMessageId,
      summary,
      undefined,
      {
        ...this.checkpointDetails(preparation),
        fallback: "retained_tail" satisfies ContextCompactionFallback,
        failureCode: "CONTEXT_COMPACTION_FAILED",
      },
    );
  }

  /**
   * The recovery path retains less than a normal checkpoint: its summary is a
   * carried-forward one rather than a fresh one, so the retained messages are
   * the only thing that has to fit.
   */
  private prepareFallbackCompactionInput(
    entries: SessionTreeEntry[],
    budget: ContextBudget,
  ) {
    return this.prepareCompactionInput(
      entries,
      budget,
      Math.max(
        1,
        Math.min(
          this.retainedUserMessageBudget(budget),
          Math.floor(budget.hardLimit * COMPACTION_FALLBACK_KEEP_RECENT_RATIO),
        ),
      ),
    );
  }

  private compactionSummaryWouldExceedBudget(
    preparation: CompactionPreparation,
    budget: { hardLimit: number; requestHeadroom: number },
  ): boolean {
    const contextWindow = budget.hardLimit + budget.requestHeadroom;
    const modelOutputBudget = Math.min(
      Math.floor(budget.requestHeadroom * 0.8),
      Math.max(1, Math.round(this.model.maxTokens || DEFAULT_MAX_TOKENS)),
    );
    const summaryInputLimit = Math.max(
      1,
      contextWindow -
        modelOutputBudget -
        COMPACTION_SUMMARY_PROMPT_SAFETY_TOKENS,
    );
    // The summary now covers the whole boundary range, so its input is the
    // context that tripped the hard limit. On a window whose headroom leaves
    // less room for the summary request than the hard limit allows, this is the
    // guard that routes the turn to retained-tail recovery instead.
    const historyTokens = preparation.messagesToSummarize.reduce(
      (total, message) => total + estimateTokens(message),
      0,
    );
    const previousSummaryTokens = preparation.previousSummary
      ? Math.ceil(preparation.previousSummary.length / 4)
      : 0;
    return historyTokens + previousSummaryTokens >= summaryInputLimit;
  }

  private async persistCheckpoint(
    checkpoint: ContextCompactionRecord,
    reason: ContextCompactionReason,
    willRetry: boolean,
    mustFitSafeBudget: boolean,
    fallback?: ContextCompactionFallback,
  ): Promise<CheckpointPersistResult> {
    const compactedBudget = this.contextBudget(
      buildSessionContext(this.entriesWithCompaction(checkpoint)).messages,
    );
    if (
      mustFitSafeBudget &&
      compactedBudget.tokens >= compactedBudget.hardLimit
    ) {
      return "oversized";
    }
    try {
      await this.host.call("session.appendCompaction", {
        sessionId: this.sessionId,
        compaction: checkpoint,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitCompactionFailure(reason, checkpoint.tokensBefore, message);
      return "failed";
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
      ...(fallback ? { fallback } : {}),
      status: contextCompactionStatus(checkpoint),
    });
    return "persisted";
  }

  private fallbackPreparation(
    entries: SessionTreeEntry[],
    budget: ContextBudget,
    preparation?: CompactionPreparation,
  ): CompactionPreparation | undefined {
    const fallbackInput = this.prepareFallbackCompactionInput(entries, budget);
    if (fallbackInput.ok && fallbackInput.value) return fallbackInput.value;

    // A persisted checkpoint can be the last entry when a new prompt pushes
    // its retained tail over the hard limit. pi correctly reports that there
    // is no new history to summarize; rebuild a smaller tail from the full
    // transcript while carrying the existing summary forward.
    const terminal = entries.at(-1);
    if (terminal?.type !== "compaction") return preparation;
    const sourceInput = this.prepareFallbackCompactionInput(
      entries.slice(0, -1),
      budget,
    );
    if (!sourceInput.ok || !sourceInput.value) return preparation;
    return {
      ...sourceInput.value,
      previousSummary: terminal.summary,
    };
  }

  private async recoverCompactionFailure(
    entries: SessionTreeEntry[],
    budget: ContextBudget,
    reason: ContextCompactionReason,
    willRetry: boolean,
    preparation: CompactionPreparation | undefined,
    failureMessage: string,
  ): Promise<boolean> {
    if (reason === "manual") {
      this.emitCompactionFailure(
        reason,
        preparation?.tokensBefore,
        failureMessage,
      );
      return false;
    }

    const fallbackPreparation = this.fallbackPreparation(
      entries,
      budget,
      preparation,
    );
    if (!fallbackPreparation) {
      this.emitCompactionFailure(reason, undefined, failureMessage);
      return false;
    }
    const throughMessageId = this.fullEntries.at(-1)?.id;
    if (!throughMessageId) {
      this.emitCompactionFailure(
        reason,
        fallbackPreparation.tokensBefore,
        "Compaction has no durable transcript boundary",
      );
      return false;
    }

    const checkpoint = this.createFallbackCheckpoint(
      fallbackPreparation,
      throughMessageId,
      Math.max(
        256,
        Math.min(
          COMPACTION_FALLBACK_MAX_SUMMARY_CHARS,
          Math.floor(budget.hardLimit * 0.75),
        ),
      ),
    );
    const persisted = await this.persistCheckpoint(
      checkpoint,
      reason,
      willRetry,
      true,
      "retained_tail",
    );
    if (persisted === "persisted") return true;
    if (persisted === "oversized") {
      this.emitCompactionFailure(
        reason,
        checkpoint.tokensBefore,
        "Automatic context recovery could not reduce the retained context below the safe model budget",
      );
    }
    return false;
  }

  private async generateCompaction(
    preparation: CompactionPreparation,
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof compact>>> {
    return compact(
      preparation,
      this.models,
      this.model,
      undefined,
      signal,
      this.thinkingLevel,
    );
  }

  /**
   * Produce a checkpoint without touching the session: no persistence, no
   * `activeCompaction` mutation, no events. Keeping generation separate from
   * installation is what lets a failed build fall through to the retained-tail
   * recovery path without having already changed the session.
   */
  private async buildCheckpoint(signal: AbortSignal): Promise<CheckpointBuild> {
    const entries = this.entriesWithCompaction();
    const context = buildSessionContext(entries);
    const budget = this.contextBudget(context.messages);
    const preparation = this.prepareCompactionInput(entries, budget);
    if (!preparation.ok || !preparation.value) {
      return {
        ok: false,
        entries,
        budget,
        message: preparation.ok
          ? "No new context is available to compact"
          : preparation.error.message,
        recoverable: true,
      };
    }

    if (this.compactionSummaryWouldExceedBudget(preparation.value, budget)) {
      return {
        ok: false,
        entries,
        budget,
        preparation: preparation.value,
        tokensBefore: preparation.value.tokensBefore,
        message: "Compaction summary input exceeds the safe model budget",
        recoverable: true,
      };
    }

    let result: Awaited<ReturnType<typeof compact>>;
    try {
      result = await this.generateCompaction(preparation.value, signal);
    } catch (error) {
      return {
        ok: false,
        entries,
        budget,
        preparation: preparation.value,
        tokensBefore: preparation.value.tokensBefore,
        message: error instanceof Error ? error.message : String(error),
        recoverable: !signal.aborted,
      };
    }
    if (!result.ok) {
      return {
        ok: false,
        entries,
        budget,
        preparation: preparation.value,
        tokensBefore: preparation.value.tokensBefore,
        message: result.error.message,
        recoverable: result.error.code !== "aborted",
      };
    }

    const throughMessageId = this.fullEntries.at(-1)?.id;
    if (!throughMessageId) {
      return {
        ok: false,
        entries,
        budget,
        preparation: preparation.value,
        tokensBefore: result.value.tokensBefore,
        message: "Compaction has no durable transcript boundary",
        recoverable: false,
      };
    }
    return {
      ok: true,
      entries,
      budget,
      preparation: preparation.value,
      checkpoint: this.createCheckpoint(
        preparation.value,
        throughMessageId,
        result.value.summary,
        result.value.usage,
        result.value.details,
      ),
    };
  }

  /**
   * Install an already-generated checkpoint on the blocking path. The budget
   * recheck inside `persistCheckpoint` runs against the current transcript, so
   * a checkpoint built earlier is still validated against what it would
   * actually produce now.
   */
  private async installCheckpoint(
    build: CheckpointBuildSuccess,
    reason: ContextCompactionReason,
    willRetry: boolean,
  ): Promise<boolean> {
    const mustFitSafeBudget =
      reason === "overflow" || build.budget.tokens >= build.budget.hardLimit;
    const persisted = await this.persistCheckpoint(
      build.checkpoint,
      reason,
      willRetry,
      mustFitSafeBudget,
    );
    if (persisted === "persisted" || persisted === "failed") {
      return persisted === "persisted";
    }
    return await this.recoverCompactionFailure(
      build.entries,
      build.budget,
      reason,
      willRetry,
      build.preparation,
      "The checkpoint did not reduce context below the safe request budget",
    );
  }

  private async performCompaction(
    reason: ContextCompactionReason,
    willRetry: boolean,
  ): Promise<boolean> {
    this.emit({ type: "compaction_start", reason });
    this.compactionAbort = new AbortController();
    let build: CheckpointBuild;
    try {
      build = await this.buildCheckpoint(this.compactionAbort.signal);
    } finally {
      this.compactionAbort = undefined;
    }
    if (!build.ok) {
      if (!build.recoverable) {
        this.emitCompactionFailure(reason, build.tokensBefore, build.message);
        return false;
      }
      return await this.recoverCompactionFailure(
        build.entries,
        build.budget,
        reason,
        willRetry,
        build.preparation,
        build.message,
      );
    }
    return await this.installCheckpoint(build, reason, willRetry);
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
          const retryingAssistant =
            this.providerRetryInProgress || this.silentTurnRerunInProgress
              ? this.currentAssistant
              : undefined;
          this.currentAssistant = {
            id: retryingAssistant?.id ?? randomUUID(),
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
          if (retryingAssistant) {
            // Keep one visible assistant bubble across the bounded retry. The
            // failed partial response is replaced instead of leaving a
            // duplicate error row when the second request succeeds. The same
            // applies to a silent-turn re-run: one bubble, no empty row.
            this.providerRetryInProgress = false;
            this.silentTurnRerunInProgress = false;
            this.emit({ type: "message_update", message: this.currentAssistant });
          } else {
            this.emit({ type: "message_start", message: this.currentAssistant });
          }
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
          let classifiedError = overflow
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
          if (looksLikePseudoToolCall(nextText)) {
            // The visible text is a lost tool batch, not an answer. Logging it
            // separates "the model went quiet" from "the model tried to act and
            // the call never reached the host" when a session is reviewed.
            process.stderr.write(
              `[agent-runtime] assistant emitted a tool call as text (session=${this.sessionId} turn=${this.turnId})\n`,
            );
          }
          const usage = usageFromPi((event.message as any).usage as Usage | undefined);
          const endedAt = Date.now();
          const providerWaitMs =
            this.requestStartedAt !== undefined &&
            this.streamStartedAt !== undefined
              ? this.streamStartedAt - this.requestStartedAt
              : undefined;
          const streamMs =
            this.streamStartedAt !== undefined
              ? Math.max(0, endedAt - this.streamStartedAt)
              : undefined;
          if (classifiedError) {
            classifiedError = this.providerErrorWithDiagnostics(
              classifiedError,
              "stream",
              providerWaitMs,
              streamMs,
            );
          }
          // A turn with no tool call and no visible text ends the run while
          // leaving the user with nothing: the reasoning that may hold the
          // answer is never rendered. Re-run once with a nudge before letting
          // that surface as a finished turn.
          const silentTurn =
            !failed &&
            !aborted &&
            nextText.trim().length === 0 &&
            !messageRequestsTools(event.message);
          if (silentTurn && !this.silentTurnRerunAttempted) {
            this.silentTurnRerunAttempted = true;
            this.pendingSilentTurnRerun = true;
            this.suppressSilentTurnRunEnd = true;
            // Hold the bubble open. The re-run streams into this same one, so
            // a recovered turn leaves no empty message behind in the
            // transcript and the user never learns it happened.
            this.currentAssistant = {
              ...this.currentAssistant,
              content: nextText,
              ...(nextThinking
                ? { thinking: nextThinking }
                : content.hasThinking
                  ? { thinking: undefined }
                  : {}),
              status: "streaming",
              modelId: this.provider.modelId,
              providerId: this.provider.id,
              ...(usage ? { usage } : {}),
            };
            this.emit({ type: "message_update", message: this.currentAssistant });
            logTiming("model", {
              model: this.provider.modelId,
              providerId: this.provider.id,
              sessionId: this.sessionId,
              turnId: this.turnId,
              providerWaitMs,
              streamMs,
              thinkingLevel: this.thinkingLevel,
              outcome: "silent",
              thinkingOnly: nextThinking.trim().length > 0,
            });
            this.streamStartedAt = undefined;
            break;
          }
          if (silentTurn) {
            // The re-run came back silent too. Stop guessing and say so: an
            // error row with a retriable code gives the UI its "continue"
            // affordance instead of leaving the user to invent one.
            classifiedError = this.providerErrorWithDiagnostics(
              {
                code: "EMPTY_MODEL_RESPONSE",
                message:
                  "The model ended its turn without producing any output",
                retriable: true,
              },
              "stream",
              providerWaitMs,
              streamMs,
            );
          }
          const emptyResponse = silentTurn;
          const diagnosticError = classifiedError;
          const retryProviderError =
            !overflow &&
            diagnosticError !== undefined &&
            this.shouldRetryProviderError(diagnosticError);
          if (retryProviderError) {
            this.pendingProviderRetry = diagnosticError;
            this.providerRetryAttempted = true;
            this.suppressProviderRetryRunEnd = true;
            this.currentAssistant = {
              ...this.currentAssistant,
              content: nextText,
              ...(nextThinking
                ? { thinking: nextThinking }
                : content.hasThinking
                  ? { thinking: undefined }
                  : {}),
              status: "streaming",
              modelId: this.provider.modelId,
              providerId: this.provider.id,
              ...(usage ? { usage } : {}),
            };
            this.emit({ type: "message_update", message: this.currentAssistant });
            logTiming("model", {
              model: this.provider.modelId,
              providerId: this.provider.id,
              sessionId: this.sessionId,
              turnId: this.turnId,
              providerWaitMs,
              streamMs,
              thinkingLevel: this.thinkingLevel,
              outcome: "retry",
              errorCode: diagnosticError.code,
              retryAttempt: 1,
              providerStatus: this.providerResponseStatus,
            });
            this.streamStartedAt = undefined;
            break;
          }
          const responseDurationMs =
            this.streamStartedAt !== undefined
              ? Math.max(0, endedAt - this.streamStartedAt)
              : undefined;
          this.currentAssistant = {
            ...this.currentAssistant,
            content: nextText,
            ...(nextThinking
              ? { thinking: nextThinking }
              : content.hasThinking
                ? { thinking: undefined }
                : {}),
            status: failed || emptyResponse
              ? "error"
              : aborted
                ? "aborted"
                : "complete",
            modelId: this.provider.modelId,
            providerId: this.provider.id,
            ...(usage ? { usage } : {}),
            ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
            ...(classifiedError
              ? { error: classifiedError, isError: true }
              : {}),
          };
          this.emit({ type: "message_end", message: this.currentAssistant });
          logTiming("model", {
            model: this.provider.modelId,
            providerId: this.provider.id,
            sessionId: this.sessionId,
            turnId: this.turnId,
            // Time from "the agent could send the request" to the first
            // streamed message: provider queue + network + first token.
            providerWaitMs,
            streamMs,
            thinkingLevel: this.thinkingLevel,
            outcome: failed || emptyResponse
              ? "error"
              : aborted
                ? "aborted"
                : "ok",
            errorCode: diagnosticError?.code,
            providerStatus: this.providerResponseStatus,
            ...(this.activeProviderRetryAttempt > 0
              ? { retryAttempt: this.activeProviderRetryAttempt }
              : {}),
          });
          this.activeProviderRetryAttempt = 0;
          this.streamStartedAt = undefined;
          this.currentAssistant = undefined;
          const canRecoverOverflow =
            this.compactionEnabled &&
            overflow &&
            !this.overflowRecoveryAttempted;
          if (!failed && !aborted && !emptyResponse) {
            this.appendLiveEntry(assistantId, event.message);
          } else {
            this.turnHadError = true;
          }
          if (canRecoverOverflow) {
            this.pendingOverflow = true;
            this.suppressOverflowRunEnd = true;
          } else if (diagnosticError) {
            this.emit({ type: "error", error: diagnosticError });
          }
        }
        break;
      }
      case "tool_execution_start":
        this.activeToolCalls.set(event.toolCallId, {
          toolName: event.toolName,
          args: event.args,
        });
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
        {
          const endedAt = Date.now();
          const activeTool = this.activeToolCalls.get(event.toolCallId);
          this.activeToolCalls.delete(event.toolCallId);
          const toolUsage = activeTool
            ? estimateToolTokenUsage(
                this.model,
                event.toolCallId,
                activeTool.toolName,
                activeTool.args,
                event.result,
                event.isError,
                endedAt,
              )
            : undefined;
          this.requestStartedAt = endedAt;
          this.emit({
            type: "tool_end",
            toolCallId: event.toolCallId,
            result: event.result,
            isError: event.isError,
            ...(toolUsage ? { toolUsage } : {}),
          });
        }
        break;
      case "turn_end":
        if (
          this.suppressOverflowRunEnd ||
          this.suppressProviderRetryRunEnd ||
          this.suppressSilentTurnRunEnd
        )
          break;
        this.emit({ type: "turn_end" });
        break;
      case "agent_end":
        if (
          this.suppressOverflowRunEnd ||
          this.suppressProviderRetryRunEnd ||
          this.suppressSilentTurnRunEnd
        )
          break;
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

  /**
   * Start execution for a host-approved plan without creating a visible user
   * turn. pi-agent-core needs a user message before `continue()`, so the
   * instruction is appended only to this runtime's in-memory context. Main
   * never receives a user event for it and therefore cannot persist or render
   * it as a transcript row.
   */
  async executeApprovedPlan(
    execution: PlanExecution,
    durableTurnId: string,
  ): Promise<{ turnId: string }> {
    if (this.disposed) throw new Error("runtime disposed");
    if (execution.sessionId !== this.sessionId) {
      throw Object.assign(new Error("approved plan belongs to another session"), {
        errorCode: "PLAN_EXECUTION_NOT_FOUND",
      });
    }
    if (!durableTurnId.trim()) {
      throw Object.assign(new Error("execution turn id required"), {
        errorCode: "TURN_NOT_FOUND",
      });
    }

    // Keep every new user turn small. A capability loaded for the preceding
    // turn can be searched again when the new task actually needs it.
    this.resetDeferredToolsForPrompt();
    // Claims are message-scoped: a later prompt must observe edited or newly
    // created instruction files instead of reusing a previous chain.
    this.pathInstructionClaims.clear();
    this.hostTurnId = durableTurnId;
    this.turnId = durableTurnId;
    this.pendingUserMessageId = undefined;
    this.pendingOverflow = false;
    this.overflowRecoveryAttempted = false;
    this.suppressOverflowRunEnd = false;
    this.pendingProviderRetry = undefined;
    this.providerRetryAttempted = false;
    this.activeProviderRetryAttempt = 0;
    this.providerRetryInProgress = false;
    this.suppressProviderRetryRunEnd = false;
    this.providerRetryAbort?.abort();
    this.providerRetryAbort = undefined;
    this.mutationFailureCounts.clear();
    this.terminatingToolCalls.clear();
    this.turnHadError = false;
    this.currentAssistant = undefined;
    this.requestStartedAt = Date.now();
    this.setMode("agent");

    const kind = execution.kind === "goal" ? "goal" : "plan";
    const instruction =
      kind === "goal"
        ? [
            "The user approved the goal contract below. Reach that goal now, autonomously.",
            `Use the host-created goal artifact at the workspace-relative path: ${execution.artifact.relativePath}`,
            `Approved goal title: ${execution.title}`,
            `Approval question: ${execution.question}`,
            "Treat the following Markdown as the exact approved contract. Do not renegotiate it, replace it with a new contract, or ask for approval again.",
            "<approved-goal-markdown>",
            execution.plan,
            "</approved-goal-markdown>",
            "Choose your own approach with the normal Agent tools. Then verify every acceptance criterion yourself, running the checks the contract names rather than assuming they pass.",
            "Keep working while a criterion is still unmet and you have an untried approach. Stop early only if a boundary in the contract blocks you or a criterion cannot be verified; say which one and why.",
            "Finish with a report that walks the acceptance criteria one by one, each marked met or unmet with the evidence you observed.",
          ].join("\n")
        : [
            "Execute the approved implementation plan now.",
            `Use the host-created plan artifact at the workspace-relative path: ${execution.artifact.relativePath}`,
            `Approved plan title: ${execution.title}`,
            `Approval question: ${execution.question}`,
            "Treat the following Markdown as the exact approved snapshot. Do not replace it with a new plan or ask for approval again.",
            "<approved-plan-markdown>",
            execution.plan,
            "</approved-plan-markdown>",
            "Implement the approved plan with the normal Agent tools, then report the result.",
          ].join("\n");
    const internalId = `approved-${kind}:${execution.id}`;
    const internalMessage: AgentMessage = {
      role: "user",
      content: instruction,
      timestamp: Date.now(),
    };
    this.appendLiveEntry(internalId, internalMessage);
    this.agent.state.messages = buildSessionContext(
      this.entriesWithCompaction(),
    ).messages;
    await this.agent.continue();
    await this.agent.waitForIdle();
    return { turnId: this.turnId };
  }

  async prompt(
    content: string,
    userMessageId?: string,
    durableTurnId?: string,
  ): Promise<{ turnId: string }> {
    if (this.disposed) throw new Error("runtime disposed");
    const nextTurnId = durableTurnId?.trim() || randomUUID();
    this.hostTurnId = nextTurnId;
    this.turnId = nextTurnId;
    // Capabilities and path-scoped instruction claims belong to one prompt.
    this.resetDeferredToolsForPrompt();
    this.pathInstructionClaims.clear();
    this.pendingUserMessageId = userMessageId;
    this.pendingOverflow = false;
    this.overflowRecoveryAttempted = false;
    this.suppressOverflowRunEnd = false;
    this.pendingProviderRetry = undefined;
    this.providerRetryAttempted = false;
    this.activeProviderRetryAttempt = 0;
    this.providerRetryInProgress = false;
    this.suppressProviderRetryRunEnd = false;
    this.pendingSilentTurnRerun = false;
    this.silentTurnRerunAttempted = false;
    this.silentTurnRerunInProgress = false;
    this.suppressSilentTurnRunEnd = false;
    this.providerRetryAbort?.abort();
    this.providerRetryAbort = undefined;
    this.mutationFailureCounts.clear();
    this.terminatingToolCalls.clear();
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

      if (this.pendingProviderRetry) {
        await this.retryPendingProviderFailure();
      }

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

      // Last, so a turn that went silent after overflow recovery still gets
      // its one re-run, and a re-run that goes silent again is not re-run.
      if (this.pendingSilentTurnRerun) {
        await this.rerunSilentTurn();
      }

    } catch (err) {
      const classifiedError = classifyAgentError(err);
      const diagnosticError =
        classifiedError.code === "TURN_ABORTED"
          ? classifiedError
          : this.providerErrorWithDiagnostics(
              classifiedError,
              "request",
              this.requestStartedAt !== undefined
                ? Math.max(0, Date.now() - this.requestStartedAt)
                : undefined,
            );
      this.finalizeCurrentAssistant(
        classifiedError.code === "TURN_ABORTED" ? "aborted" : "error",
        classifiedError.code === "TURN_ABORTED" ? undefined : diagnosticError,
      );
      if (classifiedError.code === "TURN_ABORTED") throw err;
      throw Object.assign(new Error(diagnosticError.message), diagnosticError);
    }
    return { turnId: this.turnId };
  }

  async abort(): Promise<void> {
    this.agent.abort();
    this.providerRetryAbort?.abort();
    this.compactionAbort?.abort();
  }

  getStatus(): AgentStatus {
    return {
      sessionId: this.sessionId,
      isRunning: this.agent.state.isStreaming || this.compactionInProgress,
      currentTurnId: this.turnId,
      modelId: this.provider.modelId,
      pendingToolConfirmations: 0,
      planningState: this.planningState,
      ...(this.pendingPlanId ? { pendingPlanId: this.pendingPlanId } : {}),
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.pathInstructionClaims.clear();
    this.failedHostToolCalls.clear();
    this.mutationFailureCounts.clear();
    this.terminatingToolCalls.clear();
    this.hostCloseUnsubscribe?.();
    this.hostCloseUnsubscribe = undefined;
    this.agent.abort();
    this.providerRetryAbort?.abort();
    this.cleanupActiveToolProgress();
    this.compactionAbort?.abort();
  }
}
