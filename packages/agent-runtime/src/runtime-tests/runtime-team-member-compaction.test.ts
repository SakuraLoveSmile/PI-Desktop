import "./runtime-test-harness.js";
import type { Agent } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Models,
} from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, ContextCompactionRecord, UiMessage } from "@pi-desktop/shared";
import { describe, expect, it, vi } from "vitest";
import { automaticCompactionThresholdFor, contextBudgetLimitsFor } from "../context-budget.js";
import { estimateContextTokens } from "../pi-runtime-estimates.js";
import { assistantMessage, createRuntime, provider } from "./runtime-test-harness.js";

const task = "task-owned-by-researcher";
const assignment = `Verify ${task}; report the result to Lead without repeating completed work.`;
const summary = `The researcher owns ${task}; earlier investigation is complete. Preserve the assignment and report the verified result to Lead.`;
const report = `${task}: verification complete; no delegated command was repeated.`;

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function usageHistory(inputTokens: number): UiMessage[] {
  return [0, 1, 2].flatMap((index): UiMessage[] => [
    { id: `old-user-${index}`, role: "user", content: assignment,
      createdAt: `2026-10-11T00:00:0${index * 2}Z`, status: "complete" },
    { id: `old-assistant-${index}`, role: "assistant", content: `Investigation stage ${index} complete.`,
      createdAt: `2026-10-11T00:00:0${index * 2 + 1}Z`, status: "complete",
      providerId: provider.id, modelId: provider.modelId,
      usage: { inputTokens: index === 2 ? inputTokens : 700_000, outputTokens: 16,
        totalTokens: (index === 2 ? inputTokens : 700_000) + 16 } },
  ]);
}

function fixture(inputTokens: number, inline = false, holdCheckpoint = false) {
  const events: AgentEventEnvelope["event"][] = [];
  const trace: string[] = [];
  const requests: Context[] = [];
  const summaries: Context[] = [];
  const checkpoints: ContextCompactionRecord[] = [];
  const checkpointEntered = deferred();
  const checkpointReleased = deferred();
  const host = {
    call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "session.appendCompaction") {
        trace.push("checkpoint-start");
        checkpoints.push(params?.compaction as ContextCompactionRecord);
        checkpointEntered.resolve();
        if (holdCheckpoint) await checkpointReleased.promise;
        trace.push("checkpoint-persisted");
        return { ok: true };
      }
      if (method === "team.getTask") return { task: { taskId: task, subject: assignment,
        ownerMemberName: "researcher", revision: 1, status: "completed" } };
      if (method === "team.sendMessage") {
        trace.push("authenticated-report");
        return { message: { id: "report-1", targetMemberName: "Lead", status: "queued" } };
      }
      if (method.startsWith("session.")) return { ok: true };
      throw new Error(`Unexpected Host boundary: ${method}`);
    }),
    onNotification: vi.fn(() => () => {}),
  };
  const runtime = createRuntime({
    host, history: usageHistory(inputTokens), mode: "agent", executionProfile: "team",
    provider: { ...provider, modelConfig: { ...provider.modelConfig!, contextWindow: 1_000_000, maxTokens: 32_000 } },
    teamContext: { teamSessionId: "team-lead", callerSessionId: "session-1",
      isLead: false, memberName: "researcher", workPurpose: "execute" },
    onEvent: (envelope) => events.push((envelope as AgentEventEnvelope).event),
  });
  const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple" | "completeSimple"> };
  view.models = {
    completeSimple: async (_model, context) => {
      trace.push("summary-request");
      summaries.push(structuredClone(context));
      return { ...assistantMessage({ content: [{ type: "text", text: summary }] }), timestamp: Date.now() } as AssistantMessage;
    },
    streamSimple: (_model, context) => {
      requests.push(structuredClone(context));
      trace.push(`provider-${requests.length}`);
      const inspecting = inline && requests.length === 1;
      const sending = requests.length === (inline ? 2 : 1);
      const stopReason = inspecting || sending ? "toolUse" : "stop";
      const content = inspecting ? [{ type: "toolCall", id: "inspect-task", name: "task_get",
        arguments: { taskId: task } }]
        : sending ? [{ type: "toolCall", id: "send-report", name: "send_message",
          arguments: { targetMemberName: "Lead", content: report, callerSessionId: "forged-caller" } }]
          : [{ type: "text", text: "The owned task report was sent to Lead." }];
      const message = { ...assistantMessage({ content, stopReason }), timestamp: Date.now(),
        usage: { ...assistantMessage({ content: [] }).usage,
          input: inspecting ? 860_000 : 1_000, output: 16,
          totalTokens: inspecting ? 860_016 : 1_016 } } as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: stopReason, message });
        stream.end(message);
      });
      return stream;
    },
  };
  return { runtime, view, host, events, trace, requests, summaries, checkpoints,
    checkpointEntered, checkpointReleased };
}

function expectAuthenticatedReport(host: ReturnType<typeof fixture>["host"]) {
  const sends = host.call.mock.calls.filter(([method]) => method === "team.sendMessage");
  expect(sends).toEqual([["team.sendMessage", {
    teamSessionId: "team-lead", callerSessionId: "session-1", target: "Lead", content: report,
  }]]);
}

async function awaitCheckpoint(f: ReturnType<typeof fixture>, pending: Promise<unknown>) {
  await Promise.race([f.checkpointEntered.promise, pending.then(() => {
    const errors = f.events.flatMap(event => event.type === "error" ? [event.error.code] : []);
    throw new Error(`Turn ended before checkpoint: ${JSON.stringify({ trace: f.trace, errors })}`);
  })]);
}

describe("Team execution member model-window compaction", () => {
  it.each([600_000, 800_000])("does not compact %i current tokens merely because cumulative usage exceeds 1M", async (tokens) => {
    const limits = contextBudgetLimitsFor({ contextWindow: 1_000_000, maxTokens: 32_000 });
    expect(limits).toMatchObject({ requestHeadroom: 50_000, hardLimit: 950_000 });
    expect(automaticCompactionThresholdFor(limits)).toBe(855_000);
    expect(usageHistory(tokens).reduce((total, row) => total + (row.usage?.totalTokens ?? 0), 0)).toBeGreaterThan(1_000_000);
    const f = fixture(tokens);
    try {
      const estimate = estimateContextTokens(f.view.agent.state.messages);
      expect(estimate.usageTokens).toBe(tokens + 16);
      expect(estimate.tokens).toBeLessThan(855_000);
      await f.runtime.prompt(assignment, "assigned-task", "member-turn");
      expect(f.summaries).toEqual([]);
      expect(f.checkpoints).toEqual([]);
      expect(f.requests).toHaveLength(2);
      expectAuthenticatedReport(f.host);
      expect(f.events.some((event) => event.type === "error")).toBe(false);
      expect(f.events.some((event) => event.type === "compaction_start")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it.each([860_000, 960_000])("persists the real preflight summary at %i tokens before admitting a member provider request", async (tokens) => {
    const f = fixture(tokens, false, true);
    const pending = f.runtime.prompt(assignment, "assigned-task", "member-turn");
    try {
      await awaitCheckpoint(f, pending);
      expect(f.requests).toEqual([]);
      expect(f.trace).toEqual(["summary-request", "checkpoint-start"]);
      expect(JSON.stringify(f.summaries)).toContain(task);
      expect(f.checkpoints[0]).toMatchObject({ summary, throughMessageId: "old-assistant-2",
        details: { strategy: "summary", generation: 1, retainedTailMode: "completed_turn" } });
      expect(f.checkpoints[0]!.tokensBefore).toBeGreaterThanOrEqual(855_000);
      if (tokens < 950_000) expect(f.checkpoints[0]!.tokensBefore).toBeLessThan(950_000);
      else expect(f.checkpoints[0]!.tokensBefore).toBeGreaterThan(950_000);
      f.checkpointReleased.resolve();
      await pending;
      expect(f.trace.indexOf("checkpoint-persisted")).toBeLessThan(f.trace.indexOf("provider-1"));
      expect(JSON.stringify(f.requests[0])).toContain(summary);
      expect(JSON.stringify(f.requests[0])).toContain(assignment);
      expectAuthenticatedReport(f.host);
      expect(f.events).toContainEqual(expect.objectContaining({ type: "compaction_end", reason: "threshold", ok: true }));
      expect(f.events.some((event) => event.type === "error")).toBe(false);
    } finally {
      f.checkpointReleased.resolve();
      await pending;
      await f.runtime.dispose();
    }
  });

  it("compacts inline after a member tool step crosses the threshold and preserves the original assignment", async () => {
    const f = fixture(800_000, true, true);
    const pending = f.runtime.prompt(assignment, "assigned-task", "member-turn");
    try {
      await awaitCheckpoint(f, pending);
      expect(f.requests).toHaveLength(1);
      expect(f.trace).toEqual(["provider-1", "summary-request", "checkpoint-start"]);
      expect(f.checkpoints[0]).toMatchObject({ summary,
        details: { strategy: "summary", generation: 1, retainedTailMode: "active_turn" } });
      expect(JSON.stringify(f.checkpoints[0]!.retainedTail)).toContain(assignment);
      expect(f.checkpoints[0]!.tokensBefore).toBeGreaterThanOrEqual(855_000);
      f.checkpointReleased.resolve();
      await pending;
      expect(f.trace.indexOf("checkpoint-persisted")).toBeLessThan(f.trace.indexOf("provider-2"));
      expect(JSON.stringify(f.requests[1])).toContain(summary);
      expect(JSON.stringify(f.requests[1])).toContain(assignment);
      expectAuthenticatedReport(f.host);
      expect(f.events.some((event) => event.type === "error")).toBe(false);
      expect(f.events.some((event) => event.type === "message_end" && event.message.status === "complete")).toBe(true);
    } finally {
      f.checkpointReleased.resolve();
      await pending;
      await f.runtime.dispose();
    }
  });
});
