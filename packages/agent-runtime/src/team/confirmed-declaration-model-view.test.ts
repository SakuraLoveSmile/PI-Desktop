import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TeamLaunchReview } from "@pi-desktop/shared";
import { describe, expect, it } from "vitest";
import { ConfirmedDeclarationModelView, type DeclarationExecutionScope } from "./confirmed-declaration-model-view.js";
import { buildDeclareStrategyResult } from "./declare-strategy-result.js";
import { dedupeToolCallMessages } from "../tool-call-dedupe.js";
import { convertToLlm } from "../pi-runtime-messages.js";
import type { Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertMessages as googleMessages } from "@earendil-works/pi-ai/api/google-shared";
import { stream as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { vi } from "vitest";

const review: TeamLaunchReview = {
  schemaVersion: 1, reviewId: "review-1", teamSessionId: "lead", leadTurnId: "execution-turn",
  revision: 2, status: "confirmed", strategy: "delegate", launchPolicy: "user_confirmed",
  members: [{ name: "builder", contextKind: "fresh", selection: { providerId: "local", modelId: "approved", thinkingLevel: "off" } }],
};
const scope: DeclarationExecutionScope = { teamSessionId: "lead", turnId: "execution-turn", epoch: 1, active: true };
const googleModel: Model<"google-generative-ai"> = {
  id: "gemini-2.5-pro", name: "Gemini fixture", provider: "google", api: "google-generative-ai",
  baseUrl: "https://fixture.invalid", reasoning: true, input: ["text"], contextWindow: 100_000, maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const anthropicModel: Model<"anthropic-messages"> = {
  ...googleModel, id: "claude-sonnet-4-5", name: "Anthropic fixture", provider: "anthropic", api: "anthropic-messages",
};

function result(id = "declare", owner = review): AgentMessage {
  return { role: "toolResult", toolCallId: id, toolName: "declare_team_strategy", isError: false, timestamp: 2,
    ...buildDeclareStrategyResult({ decision: { strategy: "delegate", reason: "Approved implementation", memberSessionIds: ["obsolete"] },
      review: { ...owner, status: "pending", revision: 1 } }, true) };
}
function assistant(): AgentMessage {
  return { role: "assistant", api: "openai-completions", provider: "local", model: "model", stopReason: "toolUse", timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: "text", text: "Pending roster" },
      { type: "toolCall", id: "declare", name: "declare_team_strategy", arguments: {} }] };
}
function fixture() {
  const original: AgentMessage[] = [assistant(), result()];
  const view = new ConfirmedDeclarationModelView();
  view.register(review, scope.epoch, original);
  return { view, original };
}
function payload(message: AgentMessage): Record<string, unknown> {
  if (message.role !== "toolResult" || message.content[0]?.type !== "text") throw new Error("Expected tool payload");
  return JSON.parse(message.content[0].text) as Record<string, unknown>;
}

describe("execution-scoped confirmed declaration model view", () => {
  it("projects all matching results through rebuilt requests without changing any historical or unrelated byte", () => {
    const { view, original } = fixture();
    const unrelated: AgentMessage = { role: "toolResult", toolCallId: "other", toolName: "team_status", isError: false,
      content: [{ type: "text", text: "  original unrelated result\n" }], timestamp: 3 };
    const previous = result("previous", { ...review, leadTurnId: "previous-execution" });
    const messages = [...original, result("same-review"), previous, unrelated];
    const bytes = JSON.stringify(messages);
    for (let request = 0; request < 3; request++) {
      const projected = view.project(messages, scope);
      expect(projected).not.toBe(messages);
      for (const index of [1, 2]) {
        expect(payload(projected[index])).toMatchObject({ status: "confirmed", awaitingUserApproval: false });
        expect(payload(projected[index])).not.toHaveProperty("memberSessionIds");
        expect(payload(projected[index]).nextStep).toEqual(expect.stringContaining("The user confirmed the execution roster"));
      }
      expect(projected[3]).toBe(previous);
      expect(projected[4]).toBe(unrelated);
      expect(JSON.stringify(projected[4])).toBe(JSON.stringify(unrelated));
      expect(JSON.stringify(messages)).toBe(bytes);
      expect(view.project(projected, scope)).toBe(projected);
    }
  });

  it("retains only a legally paired declaration after compaction, in the final view alone", () => {
    const { view, original } = fixture();
    const compacted: AgentMessage[] = [{ role: "user", content: "Continue the summarized execution", timestamp: 4 }];
    const bytes = JSON.stringify(compacted);
    const originalBytes = JSON.stringify(original);
    const projected = view.project(compacted, scope);
    expect(projected).toHaveLength(3);
    expect(projected[0]).toBe(compacted[0]);
    expect(projected[1]).toEqual(original[0]);
    expect(projected[2]).toMatchObject({ role: "toolResult", toolCallId: "declare" });
    expect(payload(projected[2]).awaitingUserApproval).toBe(false);
    expect(view.project(projected, scope)).toBe(projected);
    expect(JSON.stringify(compacted)).toBe(bytes);
    expect(JSON.stringify(original)).toBe(originalBytes);
  });

  it("does not synthesize a pair if its original assistant call is missing or already retained", () => {
    const view = new ConfirmedDeclarationModelView();
    view.register(review, 1, [result()]);
    const empty: AgentMessage[] = [];
    expect(view.project(empty, scope)).toBe(empty);
    const complete = fixture();
    const partial = [complete.original[0]];
    expect(complete.view.project(partial, scope)).toBe(partial);
  });

  it.each(["pending", "cancelled", "interrupted"] as const)("cannot register %s approval", status => {
    const { view, original } = fixture();
    view.register({ ...review, status }, 1, original);
    expect(view.project(original, scope)).toBe(original);
  });

  it.each([
    { active: false }, { epoch: 2 }, { turnId: "ordinary-turn" }, { teamSessionId: "other-team" },
  ])("revokes registration when its execution ends, stops or changes owner: %j", mismatch => {
    const { view, original } = fixture();
    expect(view.project(original, { ...scope, ...mismatch })).toBe(original);
    expect(view.project(original, scope)).toBe(original);
    expect(view.project([], scope)).toEqual([]);
  });

  it.each([
    { reviewId: "review-2" }, { status: "cancelled" }, { status: "interrupted" }, { revision: 3 },
  ])("fails closed on a newer/revoked observed review even if later compacted away: %j", change => {
    const { view, original } = fixture();
    const newer = result();
    if (newer.role !== "toolResult") throw new Error("Expected declaration");
    const revoked = { ...review, status: "pending", ...change } as TeamLaunchReview;
    newer.details = { decision: { strategy: "delegate", reason: "New declaration" }, review: revoked };
    const messages = [...original, newer];
    expect(view.project(messages, scope)).toBe(messages);
    expect(view.project([], scope)).toEqual([]);
  });

  it("never registers an unmatched declaration or automatic research review", () => {
    const { view, original } = fixture();
    view.register({ ...review, reviewId: "other-review" }, 1, original);
    expect(view.project(original, scope)).toBe(original);
    view.register({ ...review, launchPolicy: "automatic_plan" }, 1, original);
    expect(view.project(original, scope)).toBe(original);
  });

  it("snapshots the trusted registration and remains idempotent when registered twice", () => {
    const { view, original } = fixture();
    const mutable = structuredClone(review);
    view.register(mutable, 1, original);
    mutable.members[0].selection.modelId = "changed-after-read";
    const projected = view.project(original, scope);
    expect(payload(projected[1]).members).toEqual([{ name: "builder", modelId: "approved", providerId: "local" }]);
    view.register(review, 1, projected);
    expect(view.project(projected, scope)).toBe(projected);
    view.clear();
    expect(view.project(original, scope)).toBe(original);
  });

  it("preserves its legal replay through another guard recovery after compaction", () => {
    const { view } = fixture();
    const compacted: AgentMessage[] = [{ role: "user", content: "Compacted execution", timestamp: 4 }];
    view.register(review, 1, compacted);
    const projected = view.project(compacted, scope);
    expect(projected).toHaveLength(3);
    expect(payload(projected[2]).awaitingUserApproval).toBe(false);
    view.register({ ...review, revision: 3, members: [{ ...review.members[0], selection: {
      ...review.members[0].selection, modelId: "fresh-confirmed-binding",
    } }] }, 1, compacted);
    expect(payload(view.project(compacted, scope)[2]).members).toEqual([
      { name: "builder", modelId: "fresh-confirmed-binding", providerId: "local" },
    ]);
  });

  it("never lets an archived composite ID steal newer wire-visible work", () => {
    const oldAssistant = assistant();
    if (oldAssistant.role !== "assistant") throw new Error("Expected assistant");
    oldAssistant.content = [{ type: "toolCall", id: "wire|old", name: "declare_team_strategy", arguments: {} }];
    const view = new ConfirmedDeclarationModelView();
    view.register(review, 1, [oldAssistant, result("wire|old")]);
    const newerAssistant = { ...oldAssistant, content: [{ type: "toolCall" as const, id: "wire|new", name: "team_status", arguments: {} }] };
    const newerResult = { ...result("wire|new"), toolName: "team_status" };
    const current = [newerAssistant, newerResult];
    expect(view.project(current, scope)).toBe(current);
    expect(dedupeToolCallMessages(view.project(current, scope)).messages).toBe(current);
  });

  it("keeps complete signed Gemini batches and sibling results through native serialization", () => {
    const model = googleModel;
    const signed = assistant();
    if (signed.role !== "assistant") throw new Error("Expected assistant");
    signed.api = model.api; signed.provider = model.provider; signed.model = model.id;
    signed.content = [
      { type: "thinking", thinking: "Plan", thinkingSignature: "cGxhbg==" },
      { type: "text", text: "", textSignature: "dGV4dA==" },
      { type: "toolCall", id: "other", name: "team_status", arguments: {}, thoughtSignature: "Zmlyc3Q=" },
      { type: "toolCall", id: "declare", name: "declare_team_strategy", arguments: {}, thoughtSignature: "c2Vjb25k" },
    ];
    const sibling = { ...result("other"), toolName: "team_status" };
    const original = [signed, sibling, result()];
    const bytes = JSON.stringify(original);
    const view = new ConfirmedDeclarationModelView();
    view.register(review, 1, original);
    const projected = view.project([{ role: "user", content: "Compacted", timestamp: 4 }], scope);
    expect(projected[1]).toEqual(signed);
    expect(projected[2]).toEqual(sibling);
    const wire = googleMessages(model, normalizeContext({ messages: convertToLlm(projected) }));
    expect(wire.find(message => message.role === "model")?.parts).toEqual([
      { text: "Plan", thought: true, thoughtSignature: "cGxhbg==" },
      { text: "", thoughtSignature: "dGV4dA==" },
      { functionCall: { name: "team_status", args: {} }, thoughtSignature: "Zmlyc3Q=" },
      { functionCall: { name: "declare_team_strategy", args: {} }, thoughtSignature: "c2Vjb25k" },
    ]);
    expect(JSON.stringify(original)).toBe(bytes);
  });

  it("preserves Anthropic signed thinking without any provider/network call", async () => {
    const model = anthropicModel;
    const signed = assistant();
    if (signed.role !== "assistant") throw new Error("Expected assistant");
    signed.api = model.api; signed.provider = model.provider; signed.model = model.id;
    signed.content.unshift({ type: "thinking", thinking: "Signed plan", thinkingSignature: "signed-plan" });
    const view = new ConfirmedDeclarationModelView();
    view.register(review, 1, [signed, result()]);
    const fetch = vi.fn(async () => { throw new Error("Must not fetch"); });
    let captured: unknown;
    const response = await anthropicStream(model, normalizeContext({ messages: convertToLlm(view.project([
      { role: "user", content: "Compacted", timestamp: 4 },
    ], scope)) }), { apiKey: "unit-test", thinkingEnabled: true, fetch,
      onPayload: payload => { captured = payload; throw new Error("Payload captured before network"); },
    }).result();
    expect(response.stopReason).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
    expect(captured).toMatchObject({ messages: expect.arrayContaining([{
      role: "assistant", content: expect.arrayContaining([
        { type: "thinking", thinking: "Signed plan", signature: "signed-plan" },
        { type: "tool_use", id: "declare", name: "declare_team_strategy", input: {} },
      ]),
    }]) });
  });
});
