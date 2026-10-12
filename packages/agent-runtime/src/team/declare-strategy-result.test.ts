import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TeamExecutionDecision, TeamLaunchReview } from "@pi-desktop/shared";
import { describe, expect, it } from "vitest";
import { createTeamTools } from "./team-tools.js";
import { buildDeclareStrategyResult, refreshDeclareStrategyResult } from "./declare-strategy-result.js";
import type { RuntimeHost } from "../host-client.js";

const review: TeamLaunchReview = {
  schemaVersion: 1, reviewId: "review-1", teamSessionId: "lead", leadTurnId: "turn-1",
  revision: 2, status: "confirmed", strategy: "delegate", launchPolicy: "user_confirmed",
  members: [{ name: "builder", contextKind: "fresh", selection: {
    providerId: "fixture", modelId: "model", thinkingLevel: "off",
  } }],
};
const decision: TeamExecutionDecision = {
  schemaVersion: 1, teamSessionId: "lead", leadTurnId: "turn-1", strategy: "delegate",
  reason: "Implement the approved work", updatedAt: "2026-10-11T00:00:00Z",
  taskIds: [], memberSessionIds: [], messageIds: [],
};
function declaration(id = "call-1", reviewId = review.reviewId): AgentMessage {
  const result = buildDeclareStrategyResult({ decision, review: { ...review, reviewId, status: "pending" } }, true);
  return { role: "toolResult", toolCallId: id, toolName: "declare_team_strategy",
    ...result, isError: false, timestamp: 1 };
}

describe("confirmed declaration model projection", () => {
  it("refreshes only the latest matching non-error declaration without mutating history", () => {
    const earlier = declaration("earlier");
    const match = declaration();
    const unrelated = declaration("unrelated", "review-2");
    const failed = { ...declaration("failed"), isError: true };
    const messages = [earlier, match, unrelated, failed];
    const original = JSON.stringify(messages);
    const refreshed = refreshDeclareStrategyResult(messages, review);
    expect(refreshed).not.toBe(messages);
    expect(refreshed[0]).toBe(earlier);
    expect(refreshed[2]).toBe(unrelated);
    expect(refreshed[3]).toBe(failed);
    expect(refreshed[1]).toMatchObject({ role: "toolResult", toolCallId: "call-1", details: { review } });
    expect(JSON.stringify(messages)).toBe(original);
    const result = refreshed[1];
    if (result.role !== "toolResult") throw new Error("Expected declaration result");
    expect(result.content).not.toBe(match.role === "toolResult" ? match.content : undefined);
    const block = result.content[0];
    if (block.type !== "text") throw new Error("Expected text payload");
    expect(JSON.parse(block.text)).toMatchObject({ status: "confirmed", awaitingUserApproval: false,
      members: [{ name: "builder", modelId: "model", providerId: "fixture" }] });
    expect(JSON.parse(block.text)).not.toHaveProperty("memberSessionIds");
    expect(refreshDeclareStrategyResult(refreshed, review)).toEqual(refreshed);
  });

  it.each(["missing", "different review", "error", "different tool", "missing details"])("leaves %s results unchanged", kind => {
    const entry = declaration("call", kind === "different review" ? "other-review" : review.reviewId);
    if (entry.role !== "toolResult") throw new Error("Expected result");
    if (kind === "error") entry.isError = true;
    if (kind === "different tool") entry.toolName = "team_status";
    if (kind === "missing details") delete entry.details;
    const messages = kind === "missing" ? [] : [entry];
    expect(refreshDeclareStrategyResult(messages, review)).toBe(messages);
  });

  it.each(["pending", "cancelled", "interrupted"] as const)("never projects an unconfirmed %s review", status => {
    const messages = [declaration()];
    expect(refreshDeclareStrategyResult(messages, { ...review, status })).toBe(messages);
  });

  it("uses the same confirmed payload as the real declaration tool", async () => {
    // A Host review read has no decision/session snapshot. Omit those IDs from
    // this comparison as well; never manufacture member session identities.
    const { memberSessionIds: _stale, ...currentDecision } = decision;
    const result = { decision: currentDecision, review };
    const host = { call: async () => result } as unknown as RuntimeHost;
    const tool = createTeamTools({ host, teamSessionId: "lead", callerSessionId: "lead",
      isLead: true, approvedExecution: () => true, getTurnId: () => "turn-1" })
      .find(item => item.name === "declare_team_strategy");
    if (!tool) throw new Error("Expected declaration tool");
    const live = await tool.execute("call-1", { strategy: "delegate", reason: decision.reason,
      members: [{ name: "builder" }] });
    const refreshed = refreshDeclareStrategyResult([declaration()], review)[0];
    if (refreshed.role !== "toolResult") throw new Error("Expected declaration result");
    expect(refreshed.content).toEqual(live.content);
    expect(refreshed.details).toEqual(live.details);
  });
});
