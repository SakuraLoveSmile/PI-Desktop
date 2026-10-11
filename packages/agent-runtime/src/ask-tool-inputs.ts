import type { AskToolRequest, AskToolResolution } from "@pi-desktop/shared";

/** Owns live question waiters; durable Team ownership remains in Rust Host. */
export class AskToolInputs {
  private readonly pending = new Map<string, { request: AskToolRequest; resolve: (answers: Array<string[] | null>) => void }>();
  constructor(private readonly onRequest: (request: AskToolRequest) => void) {}
  wait(
    request: AskToolRequest,
    signal?: AbortSignal,
  ): Promise<Array<string[] | null>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (answers: Array<string[] | null>) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        this.pending.delete(request.requestId);
        resolve(answers);
      };
      const abort = () => finish(request.questions.map(() => null));
      this.pending.set(request.requestId, { request, resolve: finish });
      this.onRequest(request);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  resolve(resolution: AskToolResolution, sessionId: string): { ok: boolean } {
    if (resolution.sessionId !== sessionId) {
      throw Object.assign(new Error("asktool session mismatch"), {
        errorCode: "ASKTOOL_NOT_FOUND",
      });
    }
    const pending = this.pending.get(resolution.requestId);
    if (!pending) {
      throw Object.assign(new Error("asktool request is no longer pending"), {
        errorCode: "ASKTOOL_NOT_FOUND",
      });
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
      const values = answer
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!pending.request.questions[index].multiSelect && values.length > 1) {
        throw Object.assign(new Error(`asktool question ${index + 1} accepts one answer`), {
          errorCode: "ASKTOOL_INVALID_ARGUMENT",
        });
      }
      return [...new Set(values)];
    });
    pending.resolve(answers);
    return { ok: true };
  }

  cancelAll(): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      entry.resolve(entry.request.questions.map(() => null));
    }
  }

}
