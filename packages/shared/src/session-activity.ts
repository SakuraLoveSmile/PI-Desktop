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
