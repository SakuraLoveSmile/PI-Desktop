import { backgroundProcessIsActive, type BackgroundProcessDetail } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

/** Existing invalidations are hints; scoped reads establish the terminal outcome. */
export class BackgroundProcessUpdates {
  private pending = new Map<string, number>();
  private consumed = new Set<string>();

  constructor(private host: RuntimeHost, private sessionId: string) {}

  changed(method: string, payload: unknown): boolean {
    if (method !== "backgroundProcesses.changed" || !payload || typeof payload !== "object" ||
        !("sessionId" in payload) || payload.sessionId !== this.sessionId ||
        !("id" in payload) || typeof payload.id !== "string" || !payload.id ||
        !("revision" in payload) || typeof payload.revision !== "number" ||
        !Number.isSafeInteger(payload.revision) || payload.revision < 0 || this.consumed.has(payload.id)) return false;
    this.pending.set(payload.id, payload.revision);
    return true;
  }

  hasPending(): boolean { return this.pending.size > 0; }

  async read(signal?: AbortSignal, current: () => boolean = () => true): Promise<BackgroundProcessDetail | undefined> {
    for (const [id, revision] of this.pending) {
      const detail = await this.host.call<BackgroundProcessDetail>("backgroundProcesses.read", { sessionId: this.sessionId, id });
      signal?.throwIfAborted();
      if (!current()) throw new Error("Background process wait is no longer active");
      if (detail.process?.id !== id || detail.process.sessionId !== this.sessionId ||
          !["starting", "running", "stopping", "completed", "failed", "stopped", "timed_out", "interrupted"].includes(detail.process.status)) {
        throw new Error("Background process ownership or status mismatch");
      }
      if (!backgroundProcessIsActive(detail.process.status)) return detail;
      if (this.pending.get(id) === revision) this.pending.delete(id);
    }
    return undefined;
  }

  consume(id: string): void {
    this.consumed.add(id);
    this.pending.delete(id);
  }
}
