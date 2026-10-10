import "./runtime-test-harness.js";
import { describe, vi, it, expect } from "vitest";
import {
  type GoalProgressSnapshot,
  type PlanExecution,
  type AgentEventEnvelope,
} from "@pi-desktop/shared";
import { type Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type Models,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("approved Goal report reconciliation", () => {

  function fixture() {
    let revision = 0;
    const host = { call: vi.fn(async (method: string, params: unknown) => {
      if (method === "goalProgress.issueToken") return { writeToken: "goal-report-test" };
      if (method === "tools.execute") return { ok: true, content: { todos: "recorded" } };
      if (method === "goalProgress.update") {
        const { items } = params as { items: GoalProgressSnapshot["items"] };
        return { progress: {
          schemaVersion: 1, sessionId: "session-1", executionId: "report-execution",
          proposalId: "report-proposal", revision: ++revision, updatedAt: revision, items,
        } };
      }
      return undefined;
    }) };
    const onEvent = vi.fn();
    const runtime = createRuntime({ host, onEvent });
    const internals = runtime as unknown as {
      agent: Agent;
      handleAgentEvent(event: AgentEvent): Promise<void>;
      goalReportDraftManager?: { isDraftValid(): boolean };
    };
    const agent = internals.agent;
    const handle = internals.handleAgentEvent.bind(runtime);
    agent.waitForIdle = vi.fn(async () => undefined);
    const execution: PlanExecution = {
      id: "report-execution", proposalId: "report-proposal", sessionId: "session-1",
      kind: "goal", plan: "# Approved goal\nVerify the change.", title: "Verified change",
      question: "Proceed?", artifact: { relativePath: ".pi/goal/report.md", sha256: "hash", sizeBytes: 34 },
      targetPermissionMode: "auto", state: "running",
    };
    const call = async (name: string, args: unknown = {}) => {
      const tool = agent.state.tools.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Missing Goal tool: ${name}`);
      await handle({ type: "tool_execution_start", toolName: name, toolCallId: name, args });
      const result = await tool.execute(name, args);
      await handle({ type: "tool_execution_end", toolName: name, toolCallId: name, result, isError: false });
      return result;
    };
    const respond = async (text = "Completed the approved goal.", stopReason = "stop") => {
      const message = assistantMessage({ content: [{ type: "text", text }], stopReason }) as AssistantMessage;
      if (stopReason === "error") message.errorMessage = "Invalid API key";
      agent.state.messages = [...agent.state.messages, message];
      await handle({ type: "agent_start" });
      await handle({ type: "turn_start" });
      await handle({ type: "message_start", message });
      await handle({ type: "message_end", message });
      await handle({ type: "turn_end", message, toolResults: [] });
      await handle({ type: "agent_end", messages: [] });
    };
    const events = () => onEvent.mock.calls.map(([envelope]) => (envelope as AgentEventEnvelope).event);
    return { runtime, internals, agent, handle, call, respond, execution, host, events };
  }

  it.each(["accounting", "missing", "stale-progress"] as const)(
    "runs the real Agent tool loop for %s report recovery", async (scenario) => {
      const f = fixture();
      const completed = { items: [{ id: "checks", label: "Run checks", status: "completed" }] };
      const failed = { items: [{ id: "checks", label: "Run checks", status: "failed" }] };
      const report = { summary: "Verified change", verdict: "met" };
      const steps: Array<{ name: string; arguments: unknown } | string> = scenario === "accounting" ? [
        { name: "ToolSearch", arguments: { query: "TodoWrite" } },
        { name: "UpdateGoalProgress", arguments: completed },
        { name: "SubmitGoalReport", arguments: report },
        { name: "TodoWrite", arguments: { todos: [{ content: "Run checks", status: "completed" }] } },
        "Completed the approved goal.",
      ] : scenario === "missing" ? [
        "Completed the approved goal.",
        { name: "SubmitGoalReport", arguments: report },
        "Completed the approved goal.",
      ] : [
        { name: "UpdateGoalProgress", arguments: completed },
        { name: "SubmitGoalReport", arguments: report },
        { name: "UpdateGoalProgress", arguments: failed },
        "Finished verification.",
        { name: "SubmitGoalReport", arguments: { summary: "Checks failed", verdict: "partial" } },
        "Finished verification with failed checks.",
      ];
      const requests: string[] = [];
      const view = f.runtime as unknown as { models: Pick<Models, "streamSimple"> };
      view.models = { streamSimple: () => {
        requests.push(String(f.agent.state.systemPrompt));
        const step = steps[requests.length - 1];
        if (!step) throw new Error("Unexpected extra provider request");
        const stopReason = typeof step === "string" ? "stop" : "toolUse";
        const message = assistantMessage({
          content: typeof step === "string" ? [{ type: "text", text: step }] : [
            { type: "toolCall", id: `goal-call-${requests.length}`, ...step },
          ], stopReason,
        }) as AssistantMessage;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: stopReason, message });
          stream.end(message);
        });
        return stream;
      } };
      try {
        await f.runtime.executeApprovedPlan(f.execution, "real-report-turn");
        expect(requests).toHaveLength(steps.length);
        expect(requests.filter((prompt) => prompt.includes("<goal_report_recovery>")).length)
          .toBe(scenario === "accounting" ? 0 : 2);
        expect(f.events().filter((event) => event.type === "agent_end")).toHaveLength(1);
        expect(f.events().filter((event) => event.type === "agent_start")).toHaveLength(1);
        expect(f.events().some((event) => event.type === "error")).toBe(false);
        expect(f.events().filter((event) => event.type === "tool_end").every((event) => !event.isError)).toBe(true);
        expect(f.host.call).not.toHaveBeenCalledWith("goalReports.invalidateDraft", expect.anything());
        expect(f.host.call).toHaveBeenCalledWith("goalReports.submitDraft", {
          executionId: f.execution.id,
          draft: expect.objectContaining({ verdict: scenario === "stale-progress" ? "partial" : "met" }),
        });
        expect(f.agent.state.tools.map((tool) => tool.name)).not.toContain("SubmitGoalReport");
        expect(f.agent.state.systemPrompt).not.toContain("<goal_report_recovery>");
        if (scenario === "accounting") expect(f.host.call).toHaveBeenCalledWith("tools.execute", expect.objectContaining({ toolName: "TodoWrite" }));
      } finally { await f.runtime.dispose(); }
    },
  );

  it.each(["TodoWrite", "UpdateGoalProgress", "ToolSearch", "Read", "Glob", "Grep"])(
    "retains the structured draft after %s", async (name) => {
      const f = fixture();
      f.agent.continue = vi.fn(async () => {
        await f.call("SubmitGoalReport", { summary: "Verified", verdict: "met" });
        await f.handle({ type: "tool_execution_start", toolName: name, toolCallId: "after-report", args: {} });
        if (name === "UpdateGoalProgress") {
          await f.call(name, { items: [{ id: "checks", label: "Run checks", status: "completed" }] });
        }
        expect(f.internals.goalReportDraftManager?.isDraftValid()).toBe(true);
        await f.respond();
      });
      try {
        await f.runtime.executeApprovedPlan(f.execution, "report-turn");
        expect(f.host.call).not.toHaveBeenCalledWith("goalReports.invalidateDraft", expect.anything());
        expect(f.agent.continue).toHaveBeenCalledOnce();
        expect(f.events().filter((event) => event.type === "agent_end")).toHaveLength(1);
      } finally { await f.runtime.dispose(); }
    },
  );

  it.each(["Write", "Edit", "Bash", "Subagent", "mcp_unknown"])(
    "requires a replacement report after %s changes evidence", async (name) => {
      const f = fixture();
      let attempt = 0;
      f.agent.continue = vi.fn(async () => {
        if (++attempt === 1) {
          await f.call("SubmitGoalReport", { summary: "Initial", verdict: "met" });
          await f.handle({ type: "tool_execution_start", toolName: name, toolCallId: "mutation", args: {} });
          expect(f.internals.goalReportDraftManager?.isDraftValid()).toBe(false);
        } else {
          expect(f.agent.state.systemPrompt).toContain("<goal_report_recovery>");
          expect(f.agent.state.messages.at(-1)?.role).not.toBe("assistant");
          await f.call("SubmitGoalReport", { summary: "Verified after mutation", verdict: "met" });
        }
        await f.respond();
      });
      try {
        await f.runtime.executeApprovedPlan(f.execution, "report-turn");
        expect(f.agent.continue).toHaveBeenCalledTimes(2);
        expect(f.host.call).toHaveBeenCalledWith("goalReports.invalidateDraft", { executionId: f.execution.id });
        expect(f.host.call).toHaveBeenLastCalledWith("goalReports.submitDraft", {
          executionId: f.execution.id, draft: expect.objectContaining({ summary: "Verified after mutation" }),
        });
        for (const type of ["agent_start", "turn_start", "turn_end", "agent_end"] as const) {
          expect(f.events().filter((event) => event.type === type)).toHaveLength(1);
        }
        expect(f.agent.state.systemPrompt).not.toContain("<goal_report_recovery>");
        expect(f.agent.state.tools.map((tool) => tool.name)).not.toContain("SubmitGoalReport");
      } finally { await f.runtime.dispose(); }
    },
  );

  it("reconciles the progress checklist through its real tools before accepting met", async () => {
    const f = fixture();
    f.agent.continue = vi.fn(async () => {
      expect(f.agent.state.messages.map((message) => JSON.stringify(message)).join("\n")).toContain("UpdateGoalProgress");
      await f.call("UpdateGoalProgress", { items: [{ id: "checks", label: "Run checks", status: "in_progress" }] });
      const rejected = await f.call("SubmitGoalReport", { summary: "Done", verdict: "met" });
      expect(rejected.details).toMatchObject({ ok: false });
      await f.call("UpdateGoalProgress", { items: [{ id: "checks", label: "Run checks", status: "completed" }] });
      const accepted = await f.call("SubmitGoalReport", { summary: "Verified", verdict: "met" });
      expect(accepted.details).toMatchObject({ ok: true });
      await f.respond();
    });
    try {
      await f.runtime.executeApprovedPlan(f.execution, "report-turn");
      expect(f.agent.continue).toHaveBeenCalledOnce();
      expect(f.host.call.mock.calls.filter(([method]) => method === "goalReports.submitDraft")).toHaveLength(1);
    } finally { await f.runtime.dispose(); }
  });

  it("recovers when a later progress update contradicts a met draft", async () => {
    const f = fixture();
    let attempt = 0;
    f.agent.continue = vi.fn(async () => {
      if (++attempt === 1) {
        await f.call("SubmitGoalReport", { summary: "Done", verdict: "met" });
        await f.call("UpdateGoalProgress", { items: [{ id: "checks", label: "Run checks", status: "failed" }] });
      } else {
        await f.call("SubmitGoalReport", { summary: "Checks failed", verdict: "partial" });
      }
      await f.respond("Finished verification.");
    });
    try {
      await f.runtime.executeApprovedPlan(f.execution, "report-turn");
      expect(f.agent.continue).toHaveBeenCalledTimes(2);
      expect(f.host.call).toHaveBeenLastCalledWith("goalReports.submitDraft", {
        executionId: f.execution.id, draft: expect.objectContaining({ verdict: "partial" }),
      });
    } finally { await f.runtime.dispose(); }
  });

  it.each(["stop", "error", "aborted"])("bounds missing-report recovery for %s completion", async (stopReason) => {
    const f = fixture();
    f.agent.continue = vi.fn(async () => { await f.respond("Completed work.", stopReason); });
    try {
      await f.runtime.executeApprovedPlan(f.execution, "report-turn");
      expect(f.agent.continue).toHaveBeenCalledTimes(stopReason === "stop" ? 2 : 1);
      expect(f.events().filter((event) => event.type === "agent_end")).toHaveLength(1);
      expect(f.events().filter((event) => event.type === "turn_end")).toHaveLength(1);
    } finally { await f.runtime.dispose(); }
  });

  it("closes an armed report recovery exactly once when aborted before continuation", async () => {
    const f = fixture();
    f.agent.continue = vi.fn(async () => { await f.respond(); });
    f.agent.waitForIdle = vi.fn(async () => { await f.runtime.abort(); });
    try {
      await f.runtime.executeApprovedPlan(f.execution, "report-turn");
      expect(f.agent.continue).toHaveBeenCalledOnce();
      expect(f.events().filter((event) => event.type === "agent_end")).toHaveLength(1);
      expect(f.events().filter((event) => event.type === "turn_end")).toHaveLength(1);
      expect(f.events()).toContainEqual(expect.objectContaining({
        type: "message_end", message: expect.objectContaining({ status: "aborted" }),
      }));
      expect(f.agent.state.tools.map((tool) => tool.name)).not.toContain("SubmitGoalReport");
      expect(f.runtime.getStatus().isRunning).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["Writing the remaining checks now.", ""])(
    "chains report recovery after the existing progress/silent recovery (%s)", async (firstText) => {
      const f = fixture();
      let attempt = 0;
      f.agent.continue = vi.fn(async () => {
        ++attempt;
        if (attempt === 3) await f.call("SubmitGoalReport", { summary: "Verified", verdict: "met" });
        await f.respond(attempt === 1 ? firstText : "Completed the approved goal.");
      });
      try {
        await f.runtime.executeApprovedPlan(f.execution, "report-turn");
        expect(f.agent.continue).toHaveBeenCalledTimes(3);
        expect(f.events().filter((event) => event.type === "agent_end")).toHaveLength(1);
        expect(f.events().filter((event) => event.type === "turn_end")).toHaveLength(1);
        expect(f.events().some((event) => event.type === "error")).toBe(false);
        expect(f.agent.state.systemPrompt).not.toContain("<goal_report_recovery>");
      } finally { await f.runtime.dispose(); }
    },
  );
});
