import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskToolRequest } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";
import { waitForLeadAsk } from "./lead-ask-wait.js";

const request: AskToolRequest = { requestId: "ask", sessionId: "lead", toolCallId: "call", questions: [{ question: "Next?", options: ["Wait"] }] };
const pendingRequest: AskToolRequest = { ...request, teamPending: { deferredAt: new Date(1800000).toISOString(), requiresNewApproval: true } };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fixture(deferredStatus = "pending", fail?: string) {
  vi.useFakeTimers();vi.setSystemTime(0);
  const host = { call: vi.fn(async (method: string) => {
    if (method === fail) throw new Error("Host unavailable");
    if (method === "team.registerLeadAsk") return { ask: { status: "waiting", request }, deadlineMs: 1800000 };
    if (method === "team.deferLeadAsk") return { ask: { status: deferredStatus, request: pendingRequest,
      ...(deferredStatus === "answered_live" ? { answers: [["Wait"]] } : {}),
      ...(deferredStatus === "answered" ? { queueId: "asktool-answer:ask" } : {}),
    } };
    return { ok: true };
  }) };
  const pending = vi.fn();
  const wait = vi.fn((_request: AskToolRequest, signal?: AbortSignal) => new Promise<Array<string[] | null>>(resolve => {
    signal?.addEventListener("abort", () => resolve([null]), { once: true });
  }));
  const controller = new AbortController();
  const result = waitForLeadAsk({ host: host as unknown as RuntimeHost, request, turnId: "turn", signal: controller.signal, wait, pending });
  return { host, pending, wait, controller, result };
}

describe("Host-bound Lead ask wait", () => {
  afterEach(() => vi.useRealTimers());
  it("defers once at 30 minutes and releases every timer", async () => {
    const f=fixture();await flush();
    await vi.advanceTimersByTimeAsync(1799999);expect(f.pending).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(await f.result).toBeUndefined();
    expect(f.pending).toHaveBeenCalledWith({ ...pendingRequest, teamManaged: true });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6*60*60*1000);
    expect(f.host.call.mock.calls.filter(([method])=>method==="team.deferLeadAsk")).toHaveLength(1);
  });
  it("accepts the durable live answer when it wins the timeout race", async () => {
    const f=fixture("answered_live");await flush();await vi.advanceTimersByTimeAsync(1800000);
    expect(await f.result).toEqual([["Wait"]]);expect(f.pending).not.toHaveBeenCalled();
    expect(f.host.call.mock.calls.some(([method])=>method==="team.ackLeadAsk")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases after a late answer is already queued without resurrecting its card", async () => {
    const f=fixture("answered");await flush();await vi.advanceTimersByTimeAsync(1800000);
    expect(await f.result).toBeUndefined();expect(f.pending).toHaveBeenCalledWith();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancellation removes the deadline and never defers the cancelled turn", async () => {
    const f=fixture();const rejection=expect(f.result).rejects.toMatchObject({ name:"AbortError" });
    await flush();f.controller.abort();await rejection;
    await vi.advanceTimersByTimeAsync(1800000);
    expect(f.pending).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
    expect(f.host.call.mock.calls.some(([method])=>method==="team.deferLeadAsk")).toBe(false);
  });
  it("keeps Host failure observable and cleans up the live waiter", async () => {
    const f=fixture("pending","team.deferLeadAsk");const rejection=expect(f.result).rejects.toThrow("Host unavailable");
    await flush();await vi.advanceTimersByTimeAsync(1800000);await rejection;
    expect(f.pending).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});
