import "./runtime-test-harness.js";
import { describe, vi, it, expect } from "vitest";
import { DesktopAgentRuntime } from "../runtime.js";
import {
  type AgentEventEnvelope,
  type PlanExecution,
  type SessionMessageOrigin,
} from "@pi-desktop/shared";
import { type Agent } from "@earendil-works/pi-agent-core";
import {
  type Models,
  type AssistantMessage,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime forced Team completion", () => {

  const pendingReview = {
    schemaVersion: 1, reviewId: "review-1", teamSessionId: "session-1",
    leadTurnId: "team-turn", revision: 1, status: "pending", strategy: "delegate",
    members: [{ name: "researcher", selection: { providerId: "local", modelId: "local-model" } }],
  };

  function fixture(options: {
    mode?: "agent" | "plan" | "goal";
    silent?: boolean;
    executionProfile?: "team" | "standard";
    isLead?: boolean;
    initialReview?: unknown;
    expertStarted?: boolean;
    authorityError?: Error;
    afterAuthority?: (runtime: DesktopAgentRuntime) => Promise<void> | void;
    approvedActive?: boolean;
    recoverToReview?: boolean;
    confirmBeforeFinal?: boolean;
    recoverToDispatch?: boolean;
    recoverToResearch?: boolean;
    beforeReview?: (runtime: DesktopAgentRuntime) => Promise<void> | void;
    executionState?: (query: number) => Promise<void>;
    boardError?: Error;
  } = {}) {
    let review = options.initialReview ?? null;
    let expertStarted = options.expertStarted ?? false;
    let executionReviewStatus = "pending";
    let executionActive = options.approvedActive ?? false;
    let executionQueries = 0;
    const notifications = new Set<(method: string, params: unknown) => void>();
    const events: AgentEventEnvelope["event"][] = [];
    const requests: Array<{ turnId: string; prompt: string }> = [];
    let runtime: DesktopAgentRuntime;
    const host = { onNotification: vi.fn((listener: (method: string, params: unknown) => void) => { notifications.add(listener); return () => notifications.delete(listener); }), call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "team.getLeadExecutionState") { await options.executionState?.(++executionQueries); return { active: executionActive, turnId: "team-turn", reviewStatus: executionReviewStatus }; }
      if (method === "team.getLaunchReview") {
        await options.beforeReview?.(runtime);
        return { review };
      }
      if (method === "team.authorizeLeadTool") {
        if (params?.toolName === "TeamFinalAnswer") {
          await options.afterAuthority?.(runtime);
          if (options.authorityError) throw options.authorityError;
        }
        if (params?.toolName === "TeamFinalAnswer" && !expertStarted) {
          throw Object.assign(new Error("TEAM_APPROVAL_REQUIRED: no expert participated"), {
            code: "TEAM_APPROVAL_REQUIRED",
          });
        }
        return { authorized: true };
      }
      if (method === "team.declareStrategy") {
        review = options.recoverToResearch
          ? { ...pendingReview, status: "confirmed", launchPolicy: "automatic_plan" }
          : options.confirmBeforeFinal ? { ...pendingReview, status: "confirmed" } : pendingReview;
        return { decision: { strategy: "delegate", reason: "Required experts" }, review };
      }
      if (method === "team.createTask") return { task: { taskId: "research-task", ownerMemberName: "researcher", revision: 1 } };
      if (method === "team.sendMessage") {
        expertStarted = true;
        return { message: { id: "dispatch-1", status: "delivered" } };
      }
      if (method === "team.listMessages") return { messages: [] };
      if (method === "team.getPlanning") return { phase: "aggregating", isReadyForPlanSubmission: true,
        results: [{ taskId: "research-task", structuredResult: { summary: "Use CAS", findings: ["Revision checks exist"], risks: ["Stale edits"], recommendations: ["Preserve CAS"], verifiedSources: ["src/store.ts"] } }] };
      if (method === "team.getRoster") return { teamSessionId: "session-1", members: [{ name: "researcher", phase: "completed" }] };
      if (method === "team.getBoard" && options.boardError) throw options.boardError;
      if (method === "team.getBoard") return { revision: executionReviewStatus === "pending" && executionActive ? 2 : 3, tasks: [{ taskId: "research-task", status: "completed" }] };
      if (method === "plans.submit") return { status: "pending", proposal: { id: "implementation-plan", title: params?.title, markdown: params?.markdown, status: "pending", artifact: { relativePath: ".pi/plan/implementation-plan.md", sha256: "a".repeat(64), sizeBytes: 80 } } };
      return undefined;
    }) };
    runtime = createRuntime({
      mode: options.mode ?? "agent", executionProfile: options.executionProfile ?? "team", host,
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: options.isLead ?? true },
      onEvent: (envelope) => events.push((envelope as AgentEventEnvelope).event),
    });
    const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple">; turnId: string };
    view.models = {
      streamSimple: () => {
        requests.push({ turnId: view.turnId, prompt: String(view.agent.state.systemPrompt) });
        const researchSteps = [
          { name: "declare_team_strategy", arguments: { strategy: "delegate", reason: "Read-only architecture research", members: [{ name: "researcher" }] } },
          { name: "task_create", arguments: { subject: "Inspect state revision", ownerMemberName: "researcher" } },
          { name: "send_message", arguments: { targetMemberName: "researcher", content: "Research task research-task and return structured findings" } },
          { name: "team_status", arguments: {} },
          { name: "SubmitPlan", arguments: { title: "Preserve revisions", markdown: "# Plan\n\nPreserve CAS based on src/store.ts expert research.", question: "Approve implementation?" } },
        ];
        const researchStep = options.recoverToResearch ? researchSteps[requests.length - 2]
          : options.recoverToDispatch ? researchSteps.slice(1, 3)[requests.length - (options.initialReview ? 2 : 4)] : undefined;
        const declaration = options.recoverToReview && requests.length === 2;
        const stopReason = declaration || researchStep ? "toolUse" : "stop";
        const message = assistantMessage({
          content: researchStep ? [{ type: "toolCall", id: `research-${requests.length}`, ...researchStep }] : declaration ? [{
            type: "toolCall", id: "declare-recovery", name: "declare_team_strategy",
            arguments: { strategy: "delegate", reason: "Required experts", members: [{ name: "researcher" }] },
          }] : options.silent ? [] : [{ type: "text", text: review ? "Please confirm the experts." : "I completed everything alone." }],
          stopReason,
        }) as unknown as AssistantMessage;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: stopReason, message });
          stream.end(message);
        });
        return stream;
      },
    };
    return { runtime, host, events, requests, changeExecution: (status: string, active = true) => {
      executionReviewStatus = status; executionActive = active;
      for (const notify of notifications) notify("team.changed", { teamSessionId: "session-1", revision: 3 });
    } };
  }

  it.each(["abort", "dispose", "stop"] as const)("holds approved execution at pending review and %s interrupts it", async (action) => {
    const { runtime, events, requests } = fixture({ initialReview: pendingReview, approvedActive: true });
    const execution: PlanExecution = { id: "approved-1", proposalId: "proposal-1", sessionId: "session-1", kind: "plan", plan: "# Approved", title: "Approved", question: "Proceed?", artifact: { relativePath: ".pi/plan/approved.md", sha256: "abc", sizeBytes: 10 }, targetPermissionMode: "auto", state: "running" };
    const running = runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      await Promise.resolve();
      await Promise.resolve();
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(0);
      expect(runtime.getStatus().isRunning).toBe(true);
      if (action === "stop") expect(runtime.requestGracefulStop().requested).toBe(true);
      else await runtime[action]();
      await running;
      expect(events.filter(event => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
      expect(events.some(event => event.type === "message_end" && event.message.status === "aborted")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it.each(["cancelled", "interrupted"])("interrupts approved %s roster before the completion guard begins waiting", async status => {
    let change: ((status: string) => void) | undefined;
    const { runtime, events, requests, changeExecution } = fixture({ initialReview: pendingReview, approvedActive: true,
      executionState: async query => { if (query === 1) change!(status); } });
    change = changeExecution;
    const execution: PlanExecution = { id: "approved-1", proposalId: "proposal-1", sessionId: "session-1", kind: "plan", plan: "# Approved", title: "Approved", question: "Proceed?", artifact: { relativePath: ".pi/plan/approved.md", sha256: "abc", sizeBytes: 10 }, targetPermissionMode: "auto", state: "running" };
    try {
      await runtime.executeApprovedPlan(execution, "team-turn");
      expect(requests).toHaveLength(1);
      expect(runtime.getStatus().isRunning).toBe(false);
      expect(events.some(event => event.type === "error" && event.error.code === "TURN_ABORTED")).toBe(true);
      expect(events.filter(event => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it.each(["cancelled", "interrupted", "stale"])("interrupts approved pending review when Host reports %s", async status => {
    const { runtime, events, requests, host, changeExecution } = fixture({ initialReview: pendingReview, approvedActive: true });
    const execution: PlanExecution = { id: "approved-1", proposalId: "proposal-1", sessionId: "session-1", kind: "plan", plan: "# Approved", title: "Approved", question: "Proceed?", artifact: { relativePath: ".pi/plan/approved.md", sha256: "abc", sizeBytes: 10 }, targetPermissionMode: "auto", state: "running" };
    const running = runtime.executeApprovedPlan(execution, "team-turn");
    try {
      await vi.waitFor(() => expect(host.call.mock.calls.filter(([method]) => method === "team.getLeadExecutionState").length).toBeGreaterThanOrEqual(2));
      changeExecution(status, status !== "stale");
      await running;
      expect(requests).toHaveLength(1);
      expect(events.some(event => event.type === "error" && event.error.code === "TURN_ABORTED")).toBe(true);
      expect(events.filter(event => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it.each(["state", "wait"])("releases approved execution after a %s RPC failure", async failure => {
    const { runtime, events } = fixture({ initialReview: pendingReview, approvedActive: true,
      boardError: failure === "wait" ? new Error("Host unavailable") : undefined,
      executionState: async query => { if (failure === "state" && query === 2) throw new Error("Host unavailable"); } });
    const execution: PlanExecution = { id: "approved-1", proposalId: "proposal-1", sessionId: "session-1", kind: "plan", plan: "# Approved", title: "Approved", question: "Proceed?", artifact: { relativePath: ".pi/plan/approved.md", sha256: "abc", sizeBytes: 10 }, targetPermissionMode: "auto", state: "running" };
    try {
      await runtime.executeApprovedPlan(execution, "team-turn");
      expect(runtime.getStatus().isRunning).toBe(false);
      expect(events.some(event => event.type === "error" && event.error.message.includes("Host unavailable"))).toBe(true);
      await expect(runtime.prompt("Next request", "next-user", "next-turn")).resolves.toBeDefined();
    } finally { await runtime.dispose(); }
  });

  it("Stop releases a pending approval RPC and ignores its late rejection", async () => {
    let rejectQuery: ((cause: Error) => void) | undefined;
    const { runtime, events } = fixture({ initialReview: pendingReview, approvedActive: true,
      executionState: query => query === 2 ? new Promise((_resolve, reject) => { rejectQuery = reject; }) : Promise.resolve() });
    const execution: PlanExecution = { id: "approved-1", proposalId: "proposal-1", sessionId: "session-1", kind: "plan", plan: "# Approved", title: "Approved", question: "Proceed?", artifact: { relativePath: ".pi/plan/approved.md", sha256: "abc", sizeBytes: 10 }, targetPermissionMode: "auto", state: "running" };
    try {
      const running = runtime.executeApprovedPlan(execution, "team-turn");
      await vi.waitFor(() => expect(rejectQuery).toBeDefined());
      expect(runtime.requestGracefulStop().requested).toBe(true);
      await running;
      expect(runtime.getStatus().isRunning).toBe(false);
      const ends = events.filter(event => event.type === "agent_end").length;
      rejectQuery!(new Error("Late Host failure"));
      await Promise.resolve();
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(ends);
      await expect(runtime.prompt("Next request", "next-user", "next-turn")).resolves.toBeDefined();
    } finally { await runtime.dispose(); }
  });

  it("recovers a no-tool Agent answer into a real pending delegate review without dispatch", async () => {
    const { runtime, host, events, requests } = fixture({ recoverToReview: true });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(3);
      expect(requests.map((request) => request.turnId)).toEqual(["team-turn", "team-turn", "team-turn"]);
      expect(requests[1].prompt).toContain("<team_completion_recovery>");
      expect(host.call.mock.calls.filter(([method]) => method === "team.declareStrategy")).toHaveLength(1);
      expect(host.call.mock.calls.some(([method]) => method === "team.sendMessage")).toBe(false);
      const completed = events.filter((event) => event.type === "message_end" && event.message.status === "complete");
      expect(completed.some((event) => event.type === "message_end" && event.message.content.includes("completed everything"))).toBe(false);
      expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
      expect(events.some((event) => event.type === "error")).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it("dispatches after fast confirmation even when preapproval recovery was consumed", async () => {
    const { runtime, host, events, requests } = fixture({ recoverToReview: true,
      confirmBeforeFinal: true, recoverToDispatch: true });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(6);
      expect(requests.every(request => request.turnId === "team-turn")).toBe(true);
      expect(host.call.mock.calls.filter(([method]) => method === "team.declareStrategy")).toHaveLength(1);
      expect(host.call).toHaveBeenCalledWith("team.createTask", expect.objectContaining({ ownerMemberName: "researcher" }));
      expect(host.call).toHaveBeenCalledWith("team.sendMessage", expect.objectContaining({ target: "researcher" }));
      expect(events.some(event => event.type === "error")).toBe(false);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
      expect(events.some(event => event.type === "message_end" && event.message.status === "complete")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it("does not complete approved execution when confirmation commits between Host reads", async () => {
    let confirm: (status: string) => void;
    const { runtime, host, events, requests, changeExecution } = fixture({ initialReview: pendingReview,
      approvedActive: true, recoverToDispatch: true, executionState: async query => { if (query === 1) confirm("confirmed"); } });
    confirm = changeExecution;
    const execution: PlanExecution = { id: "approved-1", proposalId: "proposal-1", sessionId: "session-1", kind: "plan", plan: "# Approved", title: "Approved", question: "Proceed?", artifact: { relativePath: ".pi/plan/approved.md", sha256: "abc", sizeBytes: 10 }, targetPermissionMode: "auto", state: "running" };
    try {
      await runtime.executeApprovedPlan(execution, "team-turn");
      expect(requests).toHaveLength(4);
      expect(host.call).toHaveBeenCalledWith("team.sendMessage", expect.objectContaining({ target: "researcher" }));
      expect(events.some(event => event.type === "error")).toBe(false);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
    } finally { await runtime.dispose(); }
  });

  it("bounds confirmed-roster recovery when the Lead still refuses to dispatch", async () => {
    const { runtime, events, requests } = fixture({ recoverToReview: true, confirmBeforeFinal: true });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(6);
      expect(events.some(event => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
      expect(events.filter(event => event.type === "message_end" && event.message.status === "complete" && event.message.content)).toHaveLength(0);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
    } finally { await runtime.dispose(); }
  });

  it("recovers Plan into automatic research, actual dispatch, full findings and plan approval", async () => {
    const { runtime, host, events, requests } = fixture({ mode: "plan", recoverToResearch: true });
    try {
      await runtime.prompt("Plan using experts automatically", "user-1", "team-turn");
      expect(requests).toHaveLength(6);
      expect(requests.every(request => request.turnId === "team-turn")).toBe(true);
      expect(requests[1].prompt).toContain("Automatically declare");
      expect(requests[1].prompt).not.toContain("explain the pending review");
      expect(host.call).toHaveBeenCalledWith("team.createTask", expect.objectContaining({ ownerMemberName: "researcher" }));
      expect(host.call).toHaveBeenCalledWith("team.sendMessage", expect.objectContaining({ target: "researcher", content: expect.stringContaining("research-task") }));
      expect(host.call).toHaveBeenCalledWith("team.getPlanning", expect.objectContaining({ callerSessionId: "session-1" }));
      expect(host.call).toHaveBeenCalledWith("plans.submit", expect.objectContaining({ kind: "plan", markdown: expect.stringContaining("expert research") }));
      expect(host.call.mock.calls.some(([method]) => method === "team.confirmLaunchReview")).toBe(false);
      expect(runtime.getStatus().planningState).toBe("awaiting_approval");
      expect(events.some(event => event.type === "error")).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it("requires a fresh user-confirmed execution roster after Plan switches to Agent", async () => {
    const { runtime, events, requests } = fixture({ mode: "plan", initialReview: {
      ...pendingReview, status: "pending", launchPolicy: "automatic_plan",
    } });
    try {
      runtime.setMode("agent");
      await runtime.prompt("Execute the approved plan", "approval-user", "team-turn");
      expect(requests).toHaveLength(2);
      expect(requests[1].prompt).toContain("trusted user confirmation");
      expect(events.some(event => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
      expect(events.filter(event => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it("does not stop Plan research at a pending roster review", async () => {
    const { runtime, host, events, requests } = fixture({ mode: "plan", initialReview: pendingReview });
    try {
      await runtime.prompt("Plan using experts automatically", "user-1", "team-turn");
      expect(requests).toHaveLength(2);
      expect(requests[1].prompt).toContain("Automatically declare");
      expect(requests[1].prompt).not.toContain("explain the pending review");
      expect(host.call.mock.calls.filter(([method, params]) => method === "team.authorizeLeadTool" && params?.toolName === "TeamFinalAnswer")).toHaveLength(2);
      expect(events.some((event) => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
      expect(events.filter((event) => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it("fails observably after one recovery when the model persists in no-tool answers", async () => {
    const { runtime, events, requests } = fixture();
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(2);
      expect(events).toContainEqual(expect.objectContaining({ type: "error", error: expect.objectContaining({ code: "TEAM_APPROVAL_REQUIRED" }) }));
      expect(events.filter((event) => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
      expect(events).toContainEqual(expect.objectContaining({ type: "message_end", message: expect.objectContaining({ status: "error" }) }));
      expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { name: "approved but idle", review: { ...pendingReview, status: "confirmed" } },
    { name: "stale pending", review: { ...pendingReview, leadTurnId: "previous-turn" } },
    { name: "empty pending", review: { ...pendingReview, members: [] } },
    { name: "legacy solo pending", review: { ...pendingReview, strategy: "lead_only" } },
    { name: "other team pending", review: { ...pendingReview, teamSessionId: "other-team" } },
  ])("rejects a $name review as completion authority", async ({ review }) => {
    const { runtime, host, events, requests } = fixture({ initialReview: review });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      const attempts = review.status === "confirmed" && review.leadTurnId === "team-turn" ? 4 : 2;
      expect(requests).toHaveLength(attempts);
      expect(host.call.mock.calls.filter(([method, params]) => method === "team.authorizeLeadTool" && params?.toolName === "TeamFinalAnswer")).toHaveLength(attempts);
      expect(events.some((event) => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it.each(["agent", "plan"] as const)("allows normal %s final output only after Host verifies actual expert participation", async (mode) => {
    const { runtime, host, events, requests } = fixture({ mode, expertStarted: true });
    try {
      await runtime.prompt("Summarize the expert result", "mail-1", "mail-continuation-turn");
      expect(requests).toHaveLength(1);
      expect(host.call).toHaveBeenCalledWith("team.authorizeLeadTool", {
        teamSessionId: "session-1", callerSessionId: "session-1", toolName: "TeamFinalAnswer",
      });
      expect(events.some((event) => event.type === "message_end" && event.message.status === "complete")).toBe(true);
      expect(events.some((event) => event.type === "error")).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it("preserves silent trusted completion notices but enforces the next human turn", async () => {
    const { runtime, events, requests, host } = fixture({ silent: true });
    const completionOrigin: SessionMessageOrigin = {
      messageId: "completion-1", sourceSessionId: "sender", sourceTitle: "Worker",
      targetSessionId: "session-1", kind: "completion", replyToMessageId: "task-1",
    };
    try {
      await runtime.prompt({ text: "Task completed", sessionMessage: completionOrigin }, "notice-user", "notice-turn");
      expect(requests).toHaveLength(1);
      expect(host.call.mock.calls.some(([method]) => method === "team.getLaunchReview")).toBe(false);
      expect(events.some((event) => event.type === "error")).toBe(false);
      events.length = 0;
      await runtime.prompt("Use experts for this new task", "human-user", "team-turn");
      expect(requests).toHaveLength(3);
      expect(events.some((event) => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
      expect(events.filter((event) => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it("does not exempt a nonempty final answer to a trusted completion notice", async () => {
    const { runtime, events, requests } = fixture();
    try {
      await runtime.prompt({ text: "Task completed", sessionMessage: {
        messageId: "completion-1", sourceSessionId: "sender", sourceTitle: "Worker", targetSessionId: "session-1",
        kind: "completion", replyToMessageId: "task-1",
      } }, "notice-user", "notice-turn");
      expect(requests).toHaveLength(2);
      expect(events.some((event) => event.type === "error" && event.error.code === "TEAM_APPROVAL_REQUIRED")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it("surfaces a Host transport failure without model recovery or successful completion", async () => {
    const { runtime, events, requests } = fixture({ authorityError: new Error("ECONNRESET") });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({ type: "error", error: expect.objectContaining({ code: "NETWORK_ERROR", details: expect.objectContaining({ origin: "local" }) }) }));
      expect(events.filter((event) => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { mode: "agent" as const, change: "cancel" }, { mode: "agent" as const, change: "mode" },
    { mode: "plan" as const, change: "cancel" }, { mode: "plan" as const, change: "mode" },
  ])("rejects stale successful $mode expert authority after $change", async ({ mode, change }) => {
    const { runtime, events, requests } = fixture({ mode, expertStarted: true, afterAuthority: async (activeRuntime) => {
      if (change === "cancel") await activeRuntime.abort();
      else activeRuntime.setMode("goal");
    } });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(1);
      expect(events.some((event) => event.type === "message_end" && event.message.status === "aborted")).toBe(true);
      expect(events.filter((event) => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
    } finally { await runtime.dispose(); }
  });

  it.each(["cancel", "mode"] as const)("does not recover or complete a stale authority reply after %s", async (change) => {
    const { runtime, events, requests, host } = fixture({ beforeReview: async (activeRuntime) => {
      if (change === "cancel") await activeRuntime.abort();
      else activeRuntime.setMode("goal");
    } });
    try {
      await runtime.prompt("Use the expert team", "user-1", "team-turn");
      expect(requests).toHaveLength(1);
      expect(host.call.mock.calls.some(([method, params]) => method === "team.authorizeLeadTool" && params?.toolName === "TeamFinalAnswer")).toBe(false);
      expect(events.filter((event) => event.type === "message_end" && event.message.status === "complete")).toHaveLength(0);
      expect(events.some((event) => event.type === "message_end" && event.message.status === "aborted")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { mode: "goal" as const }, { executionProfile: "standard" as const }, { isLead: false },
  ])("preserves completion outside Team Agent/Plan lead (%j)", async (options) => {
    const { runtime, host, events, requests } = fixture(options);
    try {
      await runtime.prompt("Answer normally", "user-1", "team-turn");
      expect(requests).toHaveLength(1);
      expect(host.call.mock.calls.some(([method]) => method === "team.getLaunchReview")).toBe(false);
      expect(events.some((event) => event.type === "message_end" && event.message.status === "complete")).toBe(true);
    } finally { await runtime.dispose(); }
  });
});
