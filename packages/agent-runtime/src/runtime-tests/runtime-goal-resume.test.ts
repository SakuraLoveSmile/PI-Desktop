import "./runtime-test-harness.js";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, GoalProgressSnapshot, PlanExecution } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

const execution: PlanExecution = {
  id: "resume-goal", proposalId: "resume-proposal", sessionId: "session-1", kind: "goal",
  title: "Verify the approved contract", question: "Proceed?", plan: "# Contract\nRun every acceptance check.",
  artifact: { relativePath: ".pi/goal/resume.md", sha256: "hash", sizeBytes: 42 },
  targetPermissionMode: "auto", state: "running",
};
type Step = string | { name: string; arguments: unknown };

function fixture(steps: Step[], team = false) {
  let progress: GoalProgressSnapshot | null = null;
  let token = 0;
  const host = { call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method, params) => {
    if (method === "goalProgress.issueToken") return { writeToken: `token-${++token}` };
    if (method === "goalProgress.get") return { progress };
    if (method === "goalProgress.update") {
      progress = { schemaVersion: 1, sessionId: "session-1", executionId: execution.id,
        proposalId: execution.proposalId, revision: (progress?.revision ?? 0) + 1, updatedAt: 1,
        items: (params as { items: GoalProgressSnapshot["items"] }).items };
      return { progress };
    }
    if (method === "team.getLaunchReview") return { review: { teamSessionId: "session-1",
      leadTurnId: "team-turn", status: "confirmed", members: [{ name: "expert" }] } };
    if (method === "team.getLeadExecutionState") return { active: true, reviewStatus: "confirmed" };
    if (method === "team.authorizeLeadTool") throw Object.assign(new Error(
      "TEAM_APPROVAL_REQUIRED: open decision tasks expert(task-1); use wait_for_updates"), { code: "TEAM_APPROVAL_REQUIRED" });
    return undefined;
  }) };
  const onEvent = vi.fn();
  const runtime = createRuntime({ host, onEvent,
    history: [{ id: "planning", role: "assistant", content: "Unapproved planning discussion", createdAt: "2026-10-13T00:00:00Z" }],
    ...(team ? { executionProfile: "team" as const, teamContext: {
      teamSessionId: "session-1", callerSessionId: "session-1", isLead: true } } : {}),
  });
  const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple"> };
  const requests: Array<{ messages: string; prompt: string }> = [];
  view.models = { streamSimple: () => {
    requests.push({ messages: JSON.stringify(view.agent.state.messages), prompt: String(view.agent.state.systemPrompt) });
    const step = steps[requests.length - 1];
    if (!step) throw new Error("Unexpected extra provider request");
    const reason = typeof step === "string" ? "stop" : "toolUse";
    const message = assistantMessage({ content: typeof step === "string" ? [{ type: "text", text: step }]
      : [{ type: "toolCall", id: `resume-call-${requests.length}`, ...step }], stopReason: reason }) as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason, message }); stream.end(); });
    return stream;
  } };
  const events = () => onEvent.mock.calls.map(([envelope]) => (envelope as AgentEventEnvelope).event);
  return { runtime, host, requests, events };
}

describe("approved Goal continuation", () => {
  it("rejects resume for a Plan before issuing a token or requesting the provider", async () => {
    const f = fixture([]);
    try {
      await expect(f.runtime.executeApprovedPlan({ ...execution, kind: "plan" }, "plan-turn", {
        reasons: [{ code: "report_missing" }], segment: 2,
      })).rejects.toMatchObject({ errorCode: "INVALID_ARGUMENT" });
      expect(f.host.call).not.toHaveBeenCalled();
      expect(f.requests).toHaveLength(0);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["failed-token", "missing-token", "invalid-progress"] as const)("rejects %s resume startup before any provider request", async scenario => {
    const f = fixture([{ name: "SubmitGoalReport", arguments: { summary: "Done", verdict: "met" } }, "Completed work."]);
    const original = f.host.call.getMockImplementation();
    if (!original) throw new Error("Missing Host boundary fixture");
    f.host.call.mockImplementation(async (method, params) => {
      if (method === "goalProgress.issueToken" && scenario === "failed-token") throw new Error("Token service unavailable");
      if (method === "goalProgress.issueToken" && scenario === "missing-token") return undefined;
      if (method === "goalProgress.get" && scenario === "invalid-progress") return { progress: { executionId: "another-goal" } };
      return original(method, params);
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(f.runtime.executeApprovedPlan(execution, "resume-turn", {
        reasons: [{ code: "report_missing" }], segment: 2,
      })).rejects.toThrow();
      expect(f.requests).toHaveLength(0);
    } finally { await f.runtime.dispose(); stderr.mockRestore(); }
  });

  it("does not request the provider when progress restoration resolves after user Stop", async () => {
    const f = fixture([]);
    const original = f.host.call.getMockImplementation();
    if (!original) throw new Error("Missing Host boundary fixture");
    let releaseProgress: (result: { progress: null }) => void = () => { throw new Error("Progress read not started"); };
    let notifyRead: () => void = () => {};
    const reading = new Promise<void>(resolve => { notifyRead = resolve; });
    const progress = new Promise<{ progress: null }>(resolve => { releaseProgress = resolve; });
    f.host.call.mockImplementation(async (method, params) => {
      if (method === "goalProgress.get") { notifyRead(); return progress; }
      return original(method, params);
    });
    try {
      const startup = f.runtime.executeApprovedPlan(execution, "resume-turn", { reasons: [{ code: "report_missing" }], segment: 2 });
      await reading;
      await f.runtime.abort();
      releaseProgress({ progress: null });
      await expect(startup).rejects.toMatchObject({ name: "AbortError" });
      expect(f.requests).toHaveLength(0);
    } finally { releaseProgress({ progress: null }); await f.runtime.dispose(); }
  });

  it("resumes the same contract with prior work, user supplement, fresh token and existing progress", async () => {
    const f = fixture([
      { name: "UpdateGoalProgress", arguments: { items: [{ id: "checks", label: "Run checks", status: "failed" }] } },
      { name: "SubmitGoalReport", arguments: { summary: "Need the spelling table", verdict: "partial" } },
      "Prior work could not find the spelling table.",
      { name: "SubmitGoalReport", arguments: { summary: "Claim without updating progress", verdict: "met" } },
      { name: "UpdateGoalProgress", arguments: { items: [{ id: "checks", label: "Run checks", status: "completed" }] } },
      { name: "SubmitGoalReport", arguments: { summary: "Verified after the clarification", verdict: "met" } },
      "Verified the contract after the user clarification.",
    ]);
    try {
      await f.runtime.executeApprovedPlan(execution, "first-turn");
      await f.runtime.executeApprovedPlan(execution, "resume-turn", {
        reasons: [{ code: "verdict_partial" }], userMessage: "The spelling table does not exist; stop searching.", segment: 2,
      });
      expect(f.requests[3].messages).toContain("Prior work could not find the spelling table");
      expect(f.requests[3].messages).toContain("The spelling table does not exist; stop searching.");
      expect(f.requests[3].messages).toContain("verdict_partial");
      expect(f.requests[3].messages).toContain(execution.plan.replaceAll("\n", "\\n"));
      expect(f.requests[3].messages).not.toContain("Unapproved planning discussion");
      expect(f.requests[4].messages).toContain("progress still contains");
      expect(f.host.call.mock.calls.filter(([method]) => method === "goalReports.submitDraft")).toHaveLength(2);
      expect(f.host.call).toHaveBeenCalledWith("goalProgress.get", { sessionId: execution.sessionId, executionId: execution.id });
      expect(f.host.call).toHaveBeenCalledWith("goalProgress.update", expect.objectContaining({ writeToken: "token-2" }));
      expect(f.events().filter(event => event.type === "agent_end")).toHaveLength(2);
    } finally { await f.runtime.dispose(); }
  });

  it("replays the full contract after restart when its original context anchor is absent", async () => {
    const f = fixture([{ name: "SubmitGoalReport", arguments: { summary: "Blocked pending access", verdict: "blocked" } }, "Need user access."]);
    try {
      await f.runtime.executeApprovedPlan(execution, "restart-resume", { reasons: [{ code: "report_missing" }], segment: 2 });
      expect(f.requests[0].messages).toContain(execution.plan.replaceAll("\n", "\\n"));
      expect(f.requests[0].messages).toContain("report_missing");
      expect(f.requests[0].messages).toContain("SubmitGoalReport");
      expect(f.requests[0].messages).not.toContain("Unapproved planning discussion");
    } finally { await f.runtime.dispose(); }
  });

  it("grants each segment exactly one report recovery and explains the user decision needed", async () => {
    const f = fixture(Array(4).fill("Completed work."));
    try {
      await f.runtime.executeApprovedPlan(execution, "first-turn");
      await f.runtime.executeApprovedPlan(execution, "resume-turn", { reasons: [{ code: "report_missing" }], segment: 2 });
      expect(f.requests).toHaveLength(4);
      for (const request of [f.requests[1], f.requests[3]]) {
        expect(request.prompt).toContain("<goal_report_recovery>");
        expect(request.prompt).toContain("limitations");
        expect(request.prompt).toContain("nextSteps");
      }
      expect(f.events().filter(event => event.type === "agent_end")).toHaveLength(2);
      expect(f.events().filter(event => event.type === "turn_end")).toHaveLength(2);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["goal", "plan"] as const)("settles exhausted approved %s team participation with the correct terminal contract", async kind => {
    const f = fixture(Array(8).fill("Expert task remains pending."), true);
    try {
      await f.runtime.executeApprovedPlan({ ...execution, kind }, "team-turn");
      const ends = f.events().filter(event => event.type === "agent_end");
      expect(ends).toHaveLength(1);
      if (kind === "goal") {
        expect(ends[0]).toMatchObject({ stopHint: "team_unsettled" });
        expect(f.events().filter(event => event.type === "error")).toHaveLength(0);
        expect(f.events().filter(event => event.type === "turn_end")).toEqual([expect.objectContaining({ stopHint: "team_unsettled" })]);
      } else {
        expect(ends[0]).not.toHaveProperty("stopHint");
        expect(f.events()).toContainEqual(expect.objectContaining({ type: "error", error: expect.objectContaining({ code: "TEAM_APPROVAL_REQUIRED" }) }));
      }
      expect(f.requests).toHaveLength(4);
    } finally { await f.runtime.dispose(); }
  });
});
