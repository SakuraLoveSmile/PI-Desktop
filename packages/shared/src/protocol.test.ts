import { describe, expect, it } from "vitest";
import {
  IPC,
  IPC_WHITELIST,
  PROTOCOL_VERSION,
  normalizeMode,
  type PlanResolveRequest,
} from "./index.js";

describe("Plan protocol contracts", () => {
  it("uses protocol v7 and exposes the plan approval IPC channels", () => {
    expect(PROTOCOL_VERSION).toBe(7);
    expect(IPC_WHITELIST.has(IPC.invoke.plansPending)).toBe(true);
    expect(IPC_WHITELIST.has(IPC.invoke.plansResolve)).toBe(true);
    expect(IPC_WHITELIST.has(IPC.event.plansChanged)).toBe(true);
  });

  it("maps legacy Chat values to Plan while keeping Agent as fallback", () => {
    expect(normalizeMode("chat")).toBe("plan");
    expect(normalizeMode("plan")).toBe("plan");
    expect(normalizeMode("agent")).toBe("agent");
    expect(normalizeMode(undefined)).toBe("agent");
  });

  it("keeps approval actions and target permission modes typed", () => {
    const request: PlanResolveRequest = {
      proposalId: "proposal-1",
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "exit-call-1",
      action: "approve",
      targetPermissionMode: "auto",
    };
    expect(request).toMatchObject({
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "exit-call-1",
      action: "approve",
      targetPermissionMode: "auto",
    });
  });

  it("uses durable approval statuses separately from resolution actions", () => {
    const statuses = [
      "pending",
      "approved",
      "changes_requested",
      "rejected",
      "expired",
      "interrupted",
    ] as const;
    expect(statuses).toContain("pending");
    expect(statuses).toContain("changes_requested");
    expect(statuses).not.toContain("request_changes" as never);
  });
});
