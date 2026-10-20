import type { AskToolRequest, AskToolResolution } from "@pi-desktop/shared";

/** Owns live question waiters; durable Team ownership remains in Rust Host. */
export class AskToolInputs {
  private readonly pending = new Map<string, { request: AskToolRequest; resolve: (answers: Array<string[] | null>, kind: "answered" | "stopped" | "aborted") => void }>();
  private readonly resolutions = new WeakMap<Array<string[] | null>, "answered" | "stopped" | "aborted">();
  constructor(private readonly onRequest: (request: AskToolRequest) => void) {}
  wait(
    request: AskToolRequest,
    signal?: AbortSignal,
  ): Promise<Array<string[] | null>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (answers: Array<string[] | null>, kind: "answered" | "stopped" | "aborted") => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        this.pending.delete(request.requestId);
        this.resolutions.set(answers, kind);
        resolve(answers);
      };
      const abort = () => finish(request.questions.map(() => null), "aborted");
      this.pending.set(request.requestId, { request, resolve: finish });
      this.onRequest(request);
      if (!settled) {
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }
    });
  }

  resolve(resolution: AskToolResolution, sessionId: string): { ok: boolean } {
    if (resolution.sessionId !== sessionId) {
      throw Object.assign(new Error("asktool session mismatch"), {
        errorCode: "ASKTOOL_IDENTITY_MISMATCH",
      });
    }
    const pending = this.pending.get(resolution.requestId);
    if (!pending) {
      throw Object.assign(new Error("asktool request is no longer pending"), {
        errorCode: "ASKTOOL_NOT_FOUND",
      });
    }
    if (resolution.expectedToolCallId !== undefined && resolution.expectedToolCallId !== pending.request.toolCallId) {
      throw Object.assign(new Error("asktool tool call mismatch"), { errorCode: "ASKTOOL_IDENTITY_MISMATCH" });
    }
    if (resolution.expectedToolCallId !== undefined && (pending.request.teamManaged || pending.request.teamPending)) {
      throw Object.assign(new Error("Team-managed questions cannot be answered over MCP"), { errorCode: "ASKTOOL_TEAM_MANAGED" });
    }
    if (!Array.isArray(resolution.answers) || resolution.answers.length !== pending.request.questions.length) {
      throw Object.assign(new Error("asktool answer count does not match questions"), {
        errorCode: "ASKTOOL_INVALID_ARGUMENT",
      });
    }
    const answers = resolution.answers.map((answer, index) => {
      if (answer === null) return null;
      if (!Array.isArray(answer)) {
        throw Object.assign(new Error(`asktool answer ${index + 1} must be an array or null`), {
          errorCode: "ASKTOOL_INVALID_ARGUMENT",
        });
      }
      if (!answer.length || answer.some(value => typeof value !== "string" || !value.trim())) {
        throw Object.assign(new Error(`asktool answer ${index + 1} must contain non-empty strings`), { errorCode: "ASKTOOL_INVALID_ARGUMENT" });
      }
      const values = answer;
      if (!pending.request.questions[index].multiSelect && values.length > 1) {
        throw Object.assign(new Error(`asktool question ${index + 1} accepts one answer`), {
          errorCode: "ASKTOOL_INVALID_ARGUMENT",
        });
      }
      return [...new Set(values)];
    });
    pending.resolve(answers, "answered");
    return { ok: true };
  }

  cancelAll(kind: "stopped" | "aborted" = "aborted", ordinaryOnly = false): void {
    const pending = [...this.pending.values()].filter(entry => !ordinaryOnly || (!entry.request.teamManaged && !entry.request.teamPending));
    for (const entry of pending) {
      entry.resolve(entry.request.questions.map(() => null), kind);
    }
  }

  resolutionKind(answers: Array<string[] | null>): "answered" | "stopped" | "aborted" | undefined {
    return this.resolutions.get(answers);
  }

}
