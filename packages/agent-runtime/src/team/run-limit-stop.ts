import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

/** Budget pauses cancel provider waits, never the agent/tool execution signal. */
export class TeamRunLimitStop {
  requested = false;
  private settled = false;
  private providerAbort = new AbortController();
  private admittedBatches = new WeakSet<object>();

  get providerSignal(): AbortSignal { return this.providerAbort.signal; }
  reset(): void {
    this.providerAbort.abort();
    this.providerAbort = new AbortController();
    this.requested = false;
    this.settled = false;
    this.admittedBatches = new WeakSet();
  }
  request(): void {
    this.requested = true;
    this.providerAbort.abort();
  }
  claimSettlement(): boolean {
    if (this.settled) return false;
    this.settled = true;
    return true;
  }
  assertModelAdmission(): void {
    if (this.requested) throw new DOMException("Team paused at its hard run limit.", "AbortError");
  }
  denial(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
    if (this.requested && !this.admittedBatches.has(context.assistantMessage)) {
      return { block: true, reason: "TEAM_RUN_LIMIT_REACHED: the Team is paused; no new tool batch may start." };
    }
    return undefined;
  }
  beforeToolCall(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
    const blocked = this.denial(context);
    if (blocked) return blocked;
    // Preserve every tool of a batch admitted before the deadline. A model
    // response still arriving at the deadline has no admission proof.
    this.admittedBatches.add(context.assistantMessage);
    return undefined;
  }
}
