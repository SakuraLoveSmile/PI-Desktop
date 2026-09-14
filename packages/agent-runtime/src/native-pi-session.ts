import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  DefaultResourceLoader,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
  createAgentSession,
  hasTrustRequiringProjectResources,
  parseSessionEntries,
  type AgentSession,
  type AgentSessionEvent,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AgentEventEnvelope,
  SessionDetail,
  SessionSummary,
  ThinkingLevel,
  UiMessage,
} from "@pi-desktop/shared";
import {
  NativePiSessionLease,
  guardNativePiSessionManager,
  nativePiSnapshot,
  type NativePiSnapshot,
} from "./native-pi-session-lease.js";

export const NATIVE_PI_SESSION_PREFIX = "native-pi:";

export type NativePiReadOnlyReason =
  | "busy"
  | "changed-externally"
  | "invalid-session"
  | "legacy-format"
  | "missing-cwd"
  | "missing-trailing-newline"
  | "provider-unavailable"
  | "project-untrusted";

type NativeSessionRecord = {
  id: string;
  path: string;
  nativeId: string;
  cwd: string;
};

function stableId(path: string, nativeId: string): string {
  return `${NATIVE_PI_SESSION_PREFIX}${createHash("sha256")
    .update(`${path}\0${nativeId}`)
    .digest("base64url")
    .slice(0, 24)}`;
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function textContent(content: unknown): { text: string; thinking?: string } {
  if (typeof content === "string") return { text: content };
  if (!Array.isArray(content)) return { text: "" };
  const text: string[] = [];
  const thinking: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (Reflect.get(block, "type") === "text" && typeof Reflect.get(block, "text") === "string") {
      text.push(Reflect.get(block, "text"));
    }
    if (Reflect.get(block, "type") === "thinking" && typeof Reflect.get(block, "thinking") === "string") {
      thinking.push(Reflect.get(block, "thinking"));
    }
  }
  return { text: text.join("\n"), ...(thinking.length ? { thinking: thinking.join("\n") } : {}) };
}

function uiMessage(entry: SessionMessageEntry): UiMessage | undefined {
  const message = entry.message as any;
  const content = textContent(message.content);
  if (message.role === "user") {
    return { id: entry.id, role: "user", content: content.text, createdAt: entry.timestamp, status: "complete" };
  }
  if (message.role === "assistant") {
    return {
      id: entry.id,
      role: "assistant",
      content: content.text,
      ...(content.thinking ? { thinking: content.thinking } : {}),
      createdAt: entry.timestamp,
      status: message.stopReason === "error" ? "error" : message.stopReason === "aborted" ? "aborted" : "complete",
      ...(typeof message.model === "string" ? { modelId: message.model } : {}),
      ...(typeof message.provider === "string" ? { providerId: message.provider } : {}),
    };
  }
  if (message.role === "toolResult") {
    return {
      id: entry.id,
      role: "tool",
      content: content.text,
      createdAt: entry.timestamp,
      status: "complete",
      toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
      toolName: typeof message.toolName === "string" ? message.toolName : undefined,
      toolResult: message.details ?? message.content,
      toolStatus: message.isError ? "error" : "success",
      isError: message.isError === true,
    };
  }
  return undefined;
}

function visibleMessages(manager: SessionManager): UiMessage[] {
  const messages: UiMessage[] = [];
  for (const entry of manager.getBranch()) {
    if (entry.type === "message") {
      const projected = uiMessage(entry);
      if (projected) messages.push(projected);
    } else if (entry.type === "custom_message" && entry.display) {
      const content = textContent(entry.content);
      messages.push({
        id: entry.id,
        role: "system",
        content: content.text,
        createdAt: entry.timestamp,
        status: "complete",
      });
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      messages.push({
        id: entry.id,
        role: "system",
        content: entry.summary,
        createdAt: entry.timestamp,
        status: "complete",
      });
    }
  }
  return messages;
}

function thinkingLevel(value: string): ThinkingLevel {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : "off";
}

function walkJsonl(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }
  return files;
}

export type NativePiRuntimeNotifier = (envelope: AgentEventEnvelope) => void;

const nativeServices = new Map<string, NativePiSessionService>();

export function nativePiService(options: { agentDir?: string; sessionRoot?: string } = {}): NativePiSessionService {
  const agentDir = resolve(options.agentDir ?? join(process.env.HOME ?? "", ".pi", "agent"));
  const sessionRoot = resolve(options.sessionRoot ?? join(agentDir, "sessions"));
  const key = `${agentDir}\0${sessionRoot}`;
  let service = nativeServices.get(key);
  if (!service) {
    service = new NativePiSessionService({ agentDir, sessionRoot });
    nativeServices.set(key, service);
  }
  return service;
}

class NativePiRuntime {
  private readonly messageIds = new WeakMap<object, string>();
  private unsubscribe?: () => void;
  private turnId?: string;

  constructor(
    readonly id: string,
    private readonly session: AgentSession,
    private readonly lease: NativePiSessionLease,
    private readonly notify: NativePiRuntimeNotifier,
  ) {
    this.unsubscribe = session.subscribe((event) => this.onEvent(event));
  }

  get isRunning(): boolean {
    return this.session.isStreaming;
  }

  async prompt(content: string, turnId: string): Promise<void> {
    if (this.session.isStreaming) {
      throw Object.assign(new Error("session already has an active turn"), { errorCode: "AGENT_BUSY" });
    }
    this.turnId = turnId;
    try {
      await this.session.prompt(content);
    } finally {
      this.turnId = undefined;
    }
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.session.dispose();
    this.lease.release();
  }

  private emit(event: AgentEvent): void {
    this.notify({ sessionId: this.id, turnId: this.turnId, ts: Date.now(), event });
  }

  private onEvent(event: AgentSessionEvent): void {
    if (event.type === "message_end" && typeof event.message === "object" && event.message) {
      // The renderer already owns its optimistic user row. Emit only rows whose
      // durable native entry id is needed to replace/complete runtime output.
      if (event.message.role === "user") return;
      queueMicrotask(() => {
        const id = this.messageIds.get(event.message as object);
        if (!id) return;
        const entry = this.session.sessionManager.getEntry(id);
        if (entry?.type === "message") {
          const message = uiMessage(entry);
          if (message) this.emit({ type: "message_end", message });
        }
      });
      return;
    }
    if (event.type === "agent_start" || event.type === "turn_start") {
      this.emit({ type: event.type });
    } else if (event.type === "turn_end") {
      this.emit({ type: "turn_end" });
    } else if (event.type === "agent_end") {
      this.emit({ type: "agent_end", messageIds: [] });
    } else if (event.type === "tool_execution_start") {
      this.emit({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
    } else if (event.type === "tool_execution_update") {
      this.emit({ type: "tool_update", toolCallId: event.toolCallId, partialResult: event.partialResult });
    } else if (event.type === "tool_execution_end") {
      this.emit({ type: "tool_end", toolCallId: event.toolCallId, result: event.result, isError: event.isError });
    }
  }

  rememberMessage(message: object, id: string): void {
    this.messageIds.set(message, id);
  }
}

export class NativePiSessionService {
  private readonly root: string;
  private readonly agentDir: string;
  private readonly records = new Map<string, NativeSessionRecord>();
  private readonly runtimes = new Map<string, NativePiRuntime>();
  private readonly modelRuntimeFactory: () => Promise<ModelRuntime>;

  constructor(options: {
    agentDir?: string;
    sessionRoot?: string;
    modelRuntimeFactory?: () => Promise<ModelRuntime>;
  } = {}) {
    this.agentDir = resolve(options.agentDir ?? join(process.env.HOME ?? "", ".pi", "agent"));
    this.root = resolve(options.sessionRoot ?? join(this.agentDir, "sessions"));
    this.modelRuntimeFactory =
      options.modelRuntimeFactory ??
      (() =>
        ModelRuntime.create({
          authPath: join(this.agentDir, "auth.json"),
          modelsPath: join(this.agentDir, "models.json"),
          allowModelNetwork: false,
          refreshOnCreate: false,
        }));
  }

  async list(): Promise<SessionSummary[]> {
    let root: string;
    try {
      root = realpathSync(this.root);
    } catch {
      return [];
    }
    const modelRuntime = await this.modelRuntimeFactory().catch(() => undefined);
    const trustStore = new ProjectTrustStore(this.agentDir);
    const summaries = await Promise.all(
      walkJsonl(root).map(async (candidate) => {
        try {
          const path = realpathSync(candidate);
          if (!inside(root, path) || lstatSync(path).isSymbolicLink()) return undefined;
          const snap = nativePiSnapshot(path);
          const entries = parseSessionEntries(snap.bytes.toString("utf8"));
          const header = entries.find((entry) => entry.type === "session") as any;
          if (!header || typeof header.id !== "string") return undefined;
          const manager = SessionManager.inMemory(header.cwd ?? "", undefined, entries);
          const id = stableId(path, header.id);
          const branch = manager.getBranch();
          const messageCount = branch.filter((entry) => entry.type === "message").length;
          const firstUser = branch.find((entry) => entry.type === "message" && (entry as SessionMessageEntry).message.role === "user") as SessionMessageEntry | undefined;
          const context = manager.buildSessionContext();
          const createdAt = typeof header.timestamp === "string" ? header.timestamp : new Date(statSync(path).birthtimeMs).toISOString();
          const updatedAt = branch.at(-1)?.timestamp ?? createdAt;
          const cwd = typeof header.cwd === "string" ? header.cwd : "";
          this.records.set(id, { id, path, nativeId: header.id, cwd });
          let reason = this.structuralReadOnlyReason(snap, header, cwd);
          if (!reason && hasTrustRequiringProjectResources(cwd) && trustStore.get(cwd) !== true) {
            reason = "project-untrusted";
          }
          if (
            !reason &&
            (!context.model ||
              !modelRuntime?.getModel(context.model.provider, context.model.modelId) ||
              !modelRuntime.hasConfiguredAuth(context.model.provider))
          ) {
            reason = "provider-unavailable";
          }
          if (!reason && existsSync(`${path}.pi-desktop.lock`)) reason = "busy";
          return {
            id,
            title: manager.getSessionName() ?? (firstUser ? textContent((firstUser.message as any).content).text.slice(0, 80) : header.id),
            messageCount,
            ...(cwd && existsSync(cwd) ? { projectPath: cwd } : {}),
            ...(context.model ? { providerId: context.model.provider, modelId: context.model.modelId } : {}),
            mode: "agent" as const,
            thinkingLevel: thinkingLevel(context.thinkingLevel),
            permissionMode: "inherit" as const,
            source: "pi-native" as const,
            capabilities: { canPrompt: !reason, canStop: true, canRefresh: true },
            ...(reason ? { readOnlyReason: reason } : {}),
            updatedAt,
            createdAt,
          } as SessionSummary;
        } catch {
          return undefined;
        }
      }),
    );
    return summaries
      .filter((session): session is SessionSummary => Boolean(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  detail(id: string, options: { messageBefore?: number; messageLimit?: number; contentLimit?: number } = {}): SessionDetail | null {
    const record = this.record(id);
    const snap = nativePiSnapshot(record.path);
    const entries = parseSessionEntries(snap.bytes.toString("utf8"));
    const header = entries.find((entry) => entry.type === "session") as any;
    this.validateIdentity(record, header);
    const manager = SessionManager.inMemory(record.cwd, undefined, entries);
    const all = visibleMessages(manager);
    const before = Math.min(options.messageBefore ?? all.length, all.length);
    const limit = Math.max(1, Math.min(options.messageLimit ?? 100, 500));
    const start = Math.max(0, before - limit);
    const messages = all.slice(start, before).map((message) => ({
      ...message,
      content: options.contentLimit ? message.content.slice(0, options.contentLimit) : message.content,
    }));
    const context = manager.buildSessionContext();
    let reason = this.structuralReadOnlyReason(snap, header, record.cwd);
    if (!reason && hasTrustRequiringProjectResources(record.cwd) && new ProjectTrustStore(this.agentDir).get(record.cwd) !== true) {
      reason = "project-untrusted";
    }
    if (!reason && existsSync(`${record.path}.pi-desktop.lock`)) reason = "busy";
    return {
      id,
      title: manager.getSessionName() ?? record.nativeId,
      messageCount: all.length,
      ...(record.cwd && existsSync(record.cwd) ? { projectPath: record.cwd } : {}),
      ...(context.model ? { providerId: context.model.provider, modelId: context.model.modelId } : {}),
      mode: "agent",
      thinkingLevel: thinkingLevel(context.thinkingLevel),
      permissionMode: "inherit",
      source: "pi-native",
      capabilities: { canPrompt: !reason, canStop: true, canRefresh: true },
      ...(reason ? { readOnlyReason: reason } : {}),
      createdAt: typeof header.timestamp === "string" ? header.timestamp : new Date(snap.mtimeMs).toISOString(),
      updatedAt: manager.getBranch().at(-1)?.timestamp ?? new Date(snap.mtimeMs).toISOString(),
      messages,
      messageStart: start,
      hasMoreBefore: start > 0,
    } as SessionDetail;
  }

  async prompt(id: string, content: string, notify: NativePiRuntimeNotifier): Promise<{ accepted: true; turnId: string }> {
    let runtime = this.runtimes.get(id);
    if (!runtime) runtime = await this.openRuntime(id, notify);
    const turnId = randomUUID();
    void runtime.prompt(content, turnId).catch((error) => {
      notify({
        sessionId: id,
        turnId,
        ts: Date.now(),
        event: {
          type: "error",
          error: { code: (error as any)?.errorCode ?? "NATIVE_PI_RUNTIME_ERROR", message: error instanceof Error ? error.message : String(error), retriable: false },
        },
      });
      runtime?.dispose();
      this.runtimes.delete(id);
    });
    return { accepted: true, turnId };
  }

  status(id: string): { status: { sessionId: string; isRunning: boolean; pendingToolConfirmations: number } } {
    return {
      status: {
        sessionId: id,
        isRunning: this.runtimes.get(id)?.isRunning ?? false,
        pendingToolConfirmations: 0,
      },
    };
  }

  async abort(id: string): Promise<{ ok: boolean }> {
    await this.runtimes.get(id)?.abort();
    return { ok: true };
  }

  dispose(id: string): void {
    this.runtimes.get(id)?.dispose();
    this.runtimes.delete(id);
  }

  disposeAll(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
  }

  private record(id: string): NativeSessionRecord {
    if (!id.startsWith(NATIVE_PI_SESSION_PREFIX)) throw new Error("not a native Pi session");
    const record = this.records.get(id);
    if (!record) {
      throw Object.assign(new Error("Native Pi session not found; refresh sessions and try again"), { errorCode: "NOT_FOUND" });
    }
    const root = realpathSync(this.root);
    const path = realpathSync(record.path);
    if (!inside(root, path) || lstatSync(path).isSymbolicLink()) {
      throw Object.assign(new Error("Native Pi session path is outside the allowed root"), { errorCode: "PERMISSION_DENIED" });
    }
    return { ...record, path };
  }

  private validateIdentity(record: NativeSessionRecord, header: any): void {
    if (!header || header.type !== "session" || header.id !== record.nativeId || header.cwd !== record.cwd) {
      throw Object.assign(new Error("Native Pi session identity changed; refresh before continuing"), { errorCode: "NATIVE_PI_SESSION_CHANGED" });
    }
  }

  private structuralReadOnlyReason(snap: NativePiSnapshot, header: any, cwd: string): NativePiReadOnlyReason | undefined {
    if (!snap.bytes.length || !snap.validJsonl || !header || header.type !== "session") {
      return "invalid-session";
    }
    if (header.version !== CURRENT_SESSION_VERSION) return "legacy-format";
    if (snap.bytes.at(-1) !== 0x0a) return "missing-trailing-newline";
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return "missing-cwd";
    return undefined;
  }

  private async openRuntime(id: string, notify: NativePiRuntimeNotifier): Promise<NativePiRuntime> {
    const record = this.record(id);
    const snap = nativePiSnapshot(record.path);
    const entries = parseSessionEntries(snap.bytes.toString("utf8"));
    const header = entries.find((entry) => entry.type === "session") as any;
    this.validateIdentity(record, header);
    const structuralReason = this.structuralReadOnlyReason(snap, header, record.cwd);
    if (structuralReason) throw Object.assign(new Error(`Native Pi session is read-only: ${structuralReason}`), { errorCode: `NATIVE_PI_${structuralReason.toUpperCase().replaceAll("-", "_")}` });

    const trustStore = new ProjectTrustStore(this.agentDir);
    if (hasTrustRequiringProjectResources(record.cwd) && trustStore.get(record.cwd) !== true) {
      throw Object.assign(new Error("Native Pi project resources are not trusted"), { errorCode: "NATIVE_PI_PROJECT_UNTRUSTED" });
    }
    const contextManager = SessionManager.inMemory(record.cwd, undefined, entries);
    const context = contextManager.buildSessionContext();
    if (!context.model) {
      throw Object.assign(new Error("Native Pi session has no saved provider/model"), { errorCode: "NATIVE_PI_PROVIDER_UNAVAILABLE" });
    }
    const modelRuntime = await this.modelRuntimeFactory();
    const model = modelRuntime.getModel(context.model.provider, context.model.modelId);
    if (!model || !modelRuntime.hasConfiguredAuth(context.model.provider)) {
      throw Object.assign(new Error(`Native Pi provider is unavailable: ${context.model.provider}/${context.model.modelId}`), { errorCode: "NATIVE_PI_PROVIDER_UNAVAILABLE" });
    }

    const lease = NativePiSessionLease.acquire(record.path, snap);
    try {
      lease.assertUnchanged();
      const manager = SessionManager.open(record.path);
      let runtime: NativePiRuntime | undefined;
      this.guardManagerWrites(manager, lease, (message, entryId) => runtime?.rememberMessage(message, entryId));
      const settingsManager = SettingsManager.create(record.cwd, this.agentDir, { projectTrusted: true });
      const resourceLoader = new DefaultResourceLoader({ cwd: record.cwd, agentDir: this.agentDir, settingsManager });
      await resourceLoader.reload();
      const created = await createAgentSession({
        cwd: record.cwd,
        agentDir: this.agentDir,
        sessionManager: manager,
        settingsManager,
        resourceLoader,
        modelRuntime,
        model,
        thinkingLevel: thinkingLevel(context.thinkingLevel),
      });
      // The persistent manager has already parsed the complete native branch;
      // AgentSession owns all later appends to that same file.
      runtime = new NativePiRuntime(id, created.session, lease, notify);
      this.runtimes.set(id, runtime);
      return runtime;
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private guardManagerWrites(
    manager: SessionManager,
    lease: NativePiSessionLease,
    onMessage: (message: object, entryId: string) => void,
  ): void {
    guardNativePiSessionManager(manager, lease, onMessage);
  }
}

