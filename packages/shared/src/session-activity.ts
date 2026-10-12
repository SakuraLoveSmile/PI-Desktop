/** Desktop-owned session notes, independent of model context and transcripts. */
export type SessionQuickNote = {
  sessionId: string;
  content: string;
  revision: number;
  updatedAt?: string;
};

export const MAX_SESSION_NOTE_BYTES = 64 * 1024;

export type BackgroundProcessStatus =
  | "starting" | "running" | "stopping"
  | "completed" | "failed" | "stopped" | "timed_out" | "interrupted";

export type BackgroundServiceStopReason =
  | "explicit_stop" | "team_paused" | "run_replaced" | "member_removed"
  | "owner_workspace_changed" | "session_deleted" | "team_ended" | "goal_ended"
  | "ttl_expired" | "host_shutdown" | "host_restart" | "owner_cancelled";

export type BackgroundServiceStopMode = "unix-term-then-kill" | "windows-job-force";

export type BackgroundProcessSummary = {
  id: string;
  sessionId: string;
  toolCallId: string;
  command: string;
  cwd: string;
  status: BackgroundProcessStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  /** Missing kind on legacy rows means an ordinary timed command. */
  backgroundKind?: "command" | "service";
  teamSessionId?: string;
  teamRunId?: string;
  deadlineAt?: string;
  stopReason?: BackgroundServiceStopReason;
  stopRequestedAt?: string;
  /** Shutdown mechanism, present from launch; not proof it has already run. */
  stopMode?: BackgroundServiceStopMode;
  /** Reported only when a service has reached a stopping terminal outcome. */
  serviceStopEscalated?: boolean;
};

export type BackgroundProcessDetail = {
  process: BackgroundProcessSummary;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  errorCode?: string;
  errorMessage?: string;
  persistenceError?: string;
};

export type BackgroundProcessesChanged = { sessionId: string; id: string; revision: number };
export function backgroundProcessIsActive(status: BackgroundProcessStatus): boolean {
  return status === "starting" || status === "running" || status === "stopping";
}

/** Bounded, versioned projection of the owning session's complete canonical transcript. */
export type SessionActivityResource = { id: string; label: string; path?: string; messageId?: string };
export type SessionActivitySnapshot = {
  version: 1;
  sessionId: string;
  limited: boolean;
  revision: string;
  totals: Record<"subagents" | "changedFiles" | "websites" | "attachments" | "skills" | "memory" | "mcp", number>;
  subagents: { delegationId: string; agentName: string; task: string; messageId?: string; toolCallId?: string | null;
    status: "running" | "completed" | "timed_out" | "aborted" | "failed" | "stopped" | "denied";
    timing?: { startedAt?: number; completedAt?: number } }[];
  changedFiles: (SessionActivityResource & { path: string; changeCount: number;
    lastChangedAt?: string; addedLines?: number; removedLines?: number; groupLabel?: string })[];
  websites: { id: string; label: string; url: string; domain: string; sourceCount: number }[];
  attachments: SessionActivityResource[];
  references: { skills: SessionActivityResource[]; memory: SessionActivityResource[]; mcp: SessionActivityResource[] };
};
export type SessionActivityChanged = { sessionId: string };

export type SessionActivityPage = SessionActivitySnapshot & { hasMore: boolean; nextOffset: number | null };

/** Validate the additive transport boundary before a page enters renderer state. */
export function isSessionActivityPage(value: unknown): value is SessionActivityPage {
  const record = (item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item));
  const string = (item: unknown): item is string => typeof item === "string";
  const integer = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  const optionalString = (item: unknown) => item === undefined || string(item);
  const optionalInteger = (item: unknown) => item === undefined || integer(item);
  const resource = (item: unknown): boolean => record(item) && string(item.id) && string(item.label) && optionalString(item.path) && optionalString(item.messageId);
  const list = (item: unknown, valid: (item: unknown) => boolean): boolean => Array.isArray(item) && item.length <= 50 && item.every(valid);
  if (!record(value) || value.version !== 1 || !string(value.sessionId) || !string(value.revision) || !/^[a-f0-9]{64}$/.test(value.revision)
    || typeof value.limited !== "boolean" || typeof value.hasMore !== "boolean" || !record(value.references) || !record(value.totals)
    || (value.hasMore ? !integer(value.nextOffset) : value.nextOffset !== null)) return false;
  for (const key of ["subagents", "changedFiles", "websites", "attachments", "skills", "memory", "mcp"]) if (!integer(value.totals[key])) return false;
  const statuses = ["running", "completed", "timed_out", "aborted", "failed", "stopped", "denied"];
  return list(value.subagents, (item) => record(item) && string(item.delegationId) && string(item.agentName) && string(item.task)
    && string(item.status) && statuses.includes(item.status) && optionalString(item.messageId)
    && (item.toolCallId === null || optionalString(item.toolCallId)) && (item.timing === undefined || record(item.timing)
      && optionalInteger(item.timing.startedAt) && optionalInteger(item.timing.completedAt)))
    && list(value.changedFiles, (item) => resource(item) && record(item) && string(item.path) && integer(item.changeCount)
      && optionalInteger(item.addedLines) && optionalInteger(item.removedLines) && optionalString(item.lastChangedAt) && optionalString(item.groupLabel))
    && list(value.attachments, resource) && list(value.references.skills, resource) && list(value.references.memory, resource) && list(value.references.mcp, resource)
    && list(value.websites, (item) => {
      if (!record(item) || !string(item.id) || !string(item.label) || !string(item.url) || !string(item.domain) || !integer(item.sourceCount)) return false;
      try {
        const url = new URL(item.url);
        return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && url.hostname === item.domain;
      } catch { return false; }
    });
}
