import type { AppError } from "./errors.js";
import type { KeybindingOverrides } from "./keyboard-shortcuts.js";

export type Mode = "chat" | "agent";
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type Risk = "low" | "medium" | "high";
export type PermissionDecision = "allow-once" | "allow-session" | "deny";
/** Permission mode (D115): how high-risk tool calls are approved.
 * `inherit` (sessions only) falls back to the global default. */
export const PERMISSION_MODES = ["inherit", "ask", "accept-edits", "auto"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
/** Global default: `inherit` is not meaningful at the settings level. */
export type GlobalPermissionMode = Exclude<PermissionMode, "inherit">;

export type UiMessageRole = "user" | "assistant" | "system" | "tool";

export type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
};

export type UiMessage = {
  id: string;
  role: UiMessageRole;
  content: string;
  /** Model reasoning kept separate from the answer text. */
  thinking?: string;
  createdAt: string;
  status?: "streaming" | "complete" | "error" | "aborted";
  /** Provider/model that produced this assistant turn, when known. */
  modelId?: string;
  providerId?: string;
  /** Token usage for the assistant turn, when the provider reported it. */
  usage?: MessageUsage;
  /** Structured failure attached to the assistant turn that failed. */
  error?: AppError;
  /** Stable regenerate-family key shared across rewritten user prompts. */
  revisionRootId?: string;
  /** Total regenerate variants for this user root turn. */
  revisionCount?: number;
  /** 1-based active variant index for this user root turn. */
  activeRevision?: number;
  /**
   * Typed slash invocation ("/name args") when this user message was
   * produced by a prompt-template command; `content` holds the expanded
   * text the model sees (D123). Transcript renders this as a chip.
   */
  command?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: "running" | "success" | "error" | "denied";
  toolArgs?: unknown;
  toolResult?: unknown;
  toolCompletedAt?: string;
  toolDurationMs?: number;
  isError?: boolean;
};

export type SessionSummary = {
  id: string;
  title: string;
  projectPath?: string;
  modelId?: string;
  providerId?: string;
  mode: Mode;
  thinkingLevel: ThinkingLevel;
  /** Per-session permission mode; `inherit` follows the global default (D115). */
  permissionMode: PermissionMode;
  /** Effective capability for this session's exact provider/model pair. */
  supportsReasoning?: boolean;
  supportedThinkingLevels?: ThinkingLevel[];
  updatedAt: string;
  createdAt: string;
};

export type SessionDetail = SessionSummary & {
  messages: UiMessage[];
  /** Latest durable model-context checkpoint; never rendered as a chat row. */
  compaction?: ContextCompactionRecord;
};

export type ContextCompactionSettings = {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
};

export const DEFAULT_CONTEXT_COMPACTION_SETTINGS: ContextCompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export type ContextCompactionRecord = {
  id: string;
  summary: string;
  firstKeptMessageId?: string;
  throughMessageId: string;
  tokensBefore: number;
  usage?: unknown;
  retainedTail?: unknown[];
  details?: unknown;
  providerId?: string;
  modelId?: string;
  createdAt: string;
};

export type ContextCompactionReason = "manual" | "threshold" | "overflow";

export type MessageRevisionSummary = {
  revisionIndex: number;
  isActive: boolean;
  createdAt: string;
  messageCount: number;
};

export type AgentStatus = {
  sessionId: string;
  isRunning: boolean;
  currentTurnId?: string;
  modelId?: string;
  pendingToolConfirmations: number;
};

export type AgentPromptRequest = {
  sessionId: string;
  content: string;
  /**
   * When set, truncate the durable transcript to this many leading messages
   * before appending the new user turn. Used by regenerate / edit-resend so
   * the branch replaces the tail instead of stacking a duplicate turn.
   */
  truncateBefore?: number;
};

export type AgentPromptResponse = {
  accepted: boolean;
  turnId: string;
};

export type AgentAbortRequest = {
  sessionId: string;
  turnId?: string;
};

export type AgentCompactRequest = {
  sessionId: string;
};

export type AgentCompactResponse = {
  accepted: boolean;
};

export type ToolPermissionRequest = {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  argsPreview: unknown;
  risk: Risk;
  reason: string;
};

export type ToolPermissionResolution = {
  requestId: string;
  decision: PermissionDecision;
};

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messageIds: string[] }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: UiMessage }
  | {
      type: "message_update";
      message: UiMessage;
      deltaText?: string;
      deltaThinking?: string;
    }
  | { type: "message_end"; message: UiMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; partialResult?: unknown }
  | {
      type: "tool_end";
      toolCallId: string;
      result: unknown;
      isError?: boolean;
    }
  | { type: "tool_permission_request"; request: ToolPermissionRequest }
  | { type: "compaction_start"; reason: ContextCompactionReason }
  | {
      type: "compaction_end";
      reason: ContextCompactionReason;
      ok: boolean;
      tokensBefore?: number;
      firstKeptMessageId?: string;
      willRetry: boolean;
      error?: { code: string; message: string };
    }
  | { type: "error"; error: { code: string; message: string; retriable?: boolean } }
  | { type: "status"; status: AgentStatus };

export type AgentEventEnvelope = {
  sessionId: string;
  turnId?: string;
  ts: number;
  event: AgentEvent;
};

export type AppNotificationKind = "task.completed" | "task.failed";

export type AppNotification = {
  id: string;
  kind: AppNotificationKind;
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  errorCode?: string;
  createdAt: string;
  readAt?: string | null;
};

export type NotificationListResult = {
  notifications: AppNotification[];
  unreadCount: number;
};

export type ProjectWorkspace = {
  path: string;
  name: string;
  /** Best-effort git branch from .git/HEAD when available. */
  branch?: string;
};

export type ProjectRecord = {
  id: number;
  path: string;
  name: string;
  pinned: boolean;
  createdAt: number;
  lastOpenedAt: number;
};

export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
  author?: string;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
  isDraft?: boolean;
};

export type ProviderPublic = {
  id: string;
  name: string;
  vendorKey: string;
  type: "native" | "openai_compatible" | "custom";
  protocol: string;
  enabled: boolean;
  baseUrl?: string;
  authKind: string;
  hasSecret: boolean;
  defaultModelId?: string;
  apiStyle?: string;
  /** Effective capability for the provider's current default model. */
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  /** Model context window override in tokens (runtime default when absent). */
  contextWindow?: number;
  /** Max output tokens override (runtime default when absent). */
  maxOutputTokens?: number;
  /** Sampling temperature override (provider default when absent). */
  temperature?: number;
  createdAt: string;
  updatedAt: string;
};

export type ProviderCreateInput = {
  name: string;
  vendorKey?: string;
  type?: "native" | "openai_compatible" | "custom";
  protocol?: string;
  baseUrl?: string;
  authKind?: string;
  defaultModelId?: string;
  secretValue?: string;
  apiStyle?: string;
  /** Explicit override for custom model catalogs. */
  supportsReasoning?: boolean;
  /**
   * Optional sparse override for custom/compatible models.
   * Values are canonical ThinkingLevel entries such as ["off","high"].
   * When omitted, capability resolution falls back to catalog/default sets.
   */
  supportedThinkingLevels?: ThinkingLevel[];
  /** Context window override in tokens; on update, 0 clears the override. */
  contextWindow?: number;
  /** Max output tokens override; on update, 0 clears the override. */
  maxOutputTokens?: number;
  /** Sampling temperature override; on update, 0 clears the override. */
  temperature?: number;
};

export type ProviderUpdateInput = Partial<ProviderCreateInput> & {
  id: string;
  enabled?: boolean;
};

export type ModelInfo = {
  modelId: string;
  displayName: string;
  providerId: string;
  contextWindow?: number;
  capabilities: Array<"text" | "tools" | "vision" | "reasoning" | "json">;
  supportedThinkingLevels?: ThinkingLevel[];
  source: "bundled" | "discovered" | "user";
};

export type AppSettings = {
  defaultProviderId?: string;
  defaultModelId?: string;
  defaultMode: Mode;
  /** Global permission mode default; sessions with `inherit` follow this. */
  defaultPermissionMode?: GlobalPermissionMode;
  theme: "system" | "light" | "dark";
  /** UI language; `auto` (and absent) follows the OS locale. */
  language?: "auto" | "en" | "zh-CN";
  enterToSend: boolean;
  /** Model-context checkpoint behavior; absent legacy values use defaults. */
  contextCompaction?: ContextCompactionSettings;
  /** User overrides for the shared application shortcut map. */
  keybindings?: KeybindingOverrides;
  /** Unlocks the devtools console (settings button, F12, macOS View menu). */
  developerMode?: boolean;
  onboardingDismissed: boolean;
};

export type PluginUpdateInfo = {
  version: string;
  changelog?: string;
  shasum: string;
  url: string;
  permissionDiff?: string[];
};

export type PluginMarketplaceMeta = {
  providerId: string;
  shasum?: string;
  publisherId?: string;
};

export type PluginUiMeta = {
  panel?: string;
  width?: number;
  height?: number;
  title?: string;
};

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  source: "installed" | "dev" | "marketplace";
  status: "ready" | "error" | "disabled" | "load_error";
  errorMessage?: string;
  permissions: string[];
  path?: string;
  description?: string;
  author?: string;
  installedAt?: string;
  updatedAt?: string;
  marketplace?: PluginMarketplaceMeta;
  autoUpdate?: boolean;
  updateAvailable?: PluginUpdateInfo;
  ui?: PluginUiMeta;
};

export type MarketPluginSummary = {
  id: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  latestVersion: string;
  downloads?: number;
  updatedAt: string;
  categories?: string[];
  permissionSummary: string[];
  verified?: boolean;
  installed?: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
};

export type MarketPluginDetail = MarketPluginSummary & {
  readmeMarkdown?: string;
  versions: Array<{
    version: string;
    publishedAt: string;
    changelog?: string;
    minPiDesktop?: string;
    shasum: string;
    url: string;
    sizeBytes: number;
    permissions: string[];
  }>;
  screenshots?: string[];
  homepage?: string;
  repository?: string;
  permissions: string[];
  safetyNotes?: string;
};

export type PluginInstallResult = {
  plugin: PluginSummary;
  upgraded: boolean;
  permissionDiff: string[];
};

export type CommandItem = {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  source: "builtin" | "plugin";
  pluginId?: string;
};

/** One entry of the composer "/" menu, merged from three sources (D123). */
export type ComposerCommand = {
  /** Slash name typed after "/"; unique across the merged list. */
  name: string;
  kind: "template" | "builtin" | "plugin";
  /** Display title (templates use their name). */
  title: string;
  description?: string;
  /** Template frontmatter `argument-hint`, shown as ghost text. */
  argumentHint?: string;
  /** Template provenance; project templates override user-global ones. */
  source?: "project" | "user";
  /** Palette command id for builtin/plugin execution. */
  id?: string;
};

export type AppVersionInfo = {
  name: string;
  version: string;
  protocolVersion: number;
  hostProtocolVersion?: number;
  hostVersion?: string;
  platform: string;
  arch: string;
};

export type HostHealth = {
  ok: boolean;
  protocolVersion: number;
  version: string;
  uptimeMs: number;
};

/** Payload of the `hostStatus` push event (backend supervision state). */
export type HostStatusEvent = {
  ok: boolean;
  component?: "host" | "sidecar";
  restarting?: boolean;
  restarted?: boolean;
  fatal?: boolean;
  message?: string;
};

/**
 * How app updates are delivered on this install:
 *  - in-app: electron-updater downloads and installs (Windows NSIS, Linux AppImage)
 *  - manual: we only detect new versions and link to the releases page
 *    (unsigned macOS builds, Linux deb)
 *  - disabled: development / unpackaged build
 */
export type UpdateMode = "in-app" | "manual" | "disabled";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "downloaded"
  | "error";

/** Snapshot pushed on the `updatesState` event and returned by updates IPC. */
export type UpdateState = {
  mode: UpdateMode;
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  /**
   * Localized product highlights for `availableVersion` from the dual-locale
   * in-app changelog. Plain text (bullet lines); absent when the version has
   * no catalog entry. Main selects the locale — the renderer never supplies
   * a feed or remote notes URL (ADR 0022 / D164).
   */
  releaseNotes?: string;
  /** 0-100 while status is "downloading". */
  progressPercent?: number;
  error?: string;
  /** True when the transition came from a user-initiated check. */
  manual?: boolean;
  releasesUrl: string;
};

export type OnboardingState = {
  showChecklist: boolean;
  steps: Array<{
    id: string;
    title: string;
    done: boolean;
    action?: string;
  }>;
};


export type ScheduledTaskCadence = "manual" | "hourly" | "daily" | "weekly";

export type ScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  cadence: ScheduledTaskCadence;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
};

// --- Work panel (review / terminal / browser / files) ---

export type DiffLineType = "add" | "del" | "context";

export type DiffLine = {
  type: DiffLineType;
  text: string;
};

export type DiffHunk = {
  /** Raw `@@ -a,b +c,d @@ …` header line. */
  header: string;
  lines: DiffLine[];
};

export type DiffFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

export type DiffFile = {
  path: string;
  oldPath?: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  binary?: boolean;
  /** Patch exceeded the per-file cap; hunks are omitted. */
  tooLarge?: boolean;
  hunks: DiffHunk[];
};

export type WorkspaceDiff = {
  /** Workspace root is a git work tree. */
  repo: boolean;
  /** No pending changes (only meaningful when repo). */
  clean: boolean;
  files: DiffFile[];
  /** File list hit the cap; more changes exist than listed. */
  truncated?: boolean;
};

export type TerminalCreateResult = {
  termId: string;
  /** Recent output replayed so a reopened panel restores scrollback. */
  replay: string;
};

export type TerminalDataEvent = {
  termId: string;
  data: string;
};

export type TerminalExitEvent = {
  termId: string;
  exitCode: number | null;
};

export type BrowserAction = "back" | "forward" | "reload" | "stop";

export type BrowserState = {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type FsEntry = {
  name: string;
  kind: "dir" | "file";
  size: number;
};

export type FsReadResult = {
  kind: "text" | "image" | "binary" | "tooLarge";
  /** UTF-8 file content when kind is "text". */
  content?: string;
  /** Base64 data URL when kind is "image". */
  dataUrl?: string;
  size: number;
};

export type AgentInstructionFile = {
  scope: "global" | "project";
  path: string;
  content: string;
  exists: boolean;
};

/** Workspace-relative entry of the `fs/index` snapshot for the "@" menu (D124). */
export type FsIndexEntry = {
  path: string;
  kind: "dir" | "file";
};

export type FsIndexResult = {
  entries: FsIndexEntry[];
  /** True when the index hit its entry cap and results were dropped. */
  truncated: boolean;
};
