import { backgroundProcessIsActive, type BackgroundProcessDetail } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

/** Existing invalidations are hints; scoped reads establish the terminal outcome. */
export class BackgroundProcessUpdates {
  private pending = new Map<string, number>();
  private consumed = new Set<string>();
  private registered = new Set<string>();
  private disposed = false;

  constructor(private host: RuntimeHost, private sessionId: string,
    private getScope: () => number | undefined = () => 0) {}

  /** Capture trusted launch ownership before the asynchronous Bash RPC. */
  captureReceipt(): (receipt: { ok: boolean; content: unknown } | undefined, signal?: AbortSignal) => void {
    const scope = this.getScope();
    return (receipt, signal) => {
      if (this.disposed || signal?.aborted || scope === undefined || this.getScope() !== scope || !receipt?.ok) return;
      const content = receipt.content;
      if (!content || typeof content !== "object" || !("backgroundProcessId" in content) ||
          typeof content.backgroundProcessId !== "string" || !content.backgroundProcessId.trim()) return;
      if (!this.consumed.has(content.backgroundProcessId)) {
        this.registered.add(content.backgroundProcessId);
        if (!this.pending.has(content.backgroundProcessId)) this.pending.set(content.backgroundProcessId, 0);
      }
    };
  }

  /** Reconcile only this runtime's known unconsumed launches, never historical rows. */
  prime(): void {
    for (const id of this.registered) if (!this.pending.has(id)) this.pending.set(id, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.registered.clear();
    this.consumed.clear();
  }

  changed(method: string, payload: unknown): boolean {
    if (this.disposed || method !== "backgroundProcesses.changed" || !payload || typeof payload !== "object" ||
        !("sessionId" in payload) || payload.sessionId !== this.sessionId ||
        !("id" in payload) || typeof payload.id !== "string" || !payload.id ||
        !("revision" in payload) || typeof payload.revision !== "number" ||
        !Number.isSafeInteger(payload.revision) || payload.revision < 0 || !this.registered.has(payload.id) || this.consumed.has(payload.id)) return false;
    this.pending.set(payload.id, payload.revision);
    return true;
  }

  hasPending(): boolean { return this.pending.size > 0; }

  async read(signal?: AbortSignal, current: () => boolean = () => true): Promise<BackgroundProcessDetail | undefined> {
    for (const [id, revision] of this.pending) {
      const detail = await this.host.call<BackgroundProcessDetail>("backgroundProcesses.read", { sessionId: this.sessionId, id });
      signal?.throwIfAborted();
      if (this.disposed || !current()) throw new Error("Background process wait is no longer active");
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
    this.registered.delete(id);
  }
}
