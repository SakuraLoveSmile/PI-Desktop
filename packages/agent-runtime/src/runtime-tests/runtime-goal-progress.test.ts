import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type GoalProgressSnapshot, type PlanExecution } from "@pi-desktop/shared";
import { type Agent } from "@earendil-works/pi-agent-core";
import { createRuntime } from "./runtime-test-harness.js";

describe("approved Goal progress tool lifecycle", () => {

  it.each(["normal", "abort", "dispose"] as const)(
    "exposes progress only during approved Goal execution and removes it on %s",
    async (cleanup) => {
      const snapshot: GoalProgressSnapshot = {
        schemaVersion: 1,
        sessionId: "session-1",
        proposalId: "goal-proposal-1",
        executionId: "goal-execution-1",
        revision: 1,
        items: [{ id: "check", label: "Run checks", status: "failed" }],
        updatedAt: 1,
      };
      const host = {
        call: vi.fn(async (method: string) => {
          if (method === "goalProgress.issueToken") return { writeToken: "gptk_test" };
          if (method === "goalProgress.update") return { progress: snapshot };
          return undefined;
        }),
      };
      const runtime = createRuntime({ host });
      const agent = (runtime as unknown as { agent: Agent }).agent;
      const goalToolNames = () => agent.state.tools.map((tool) => tool.name);
      const handleAgentEvent = (runtime as unknown as {
        handleAgentEvent: (event: { type: "agent_end"; messages: [] }) => Promise<void>;
      }).handleAgentEvent.bind(runtime);
      const approvedExecution: PlanExecution = {
        id: "goal-execution-1",
        proposalId: "goal-proposal-1",
        sessionId: "session-1",
        kind: "goal",
        plan: "# Approved goal",
        title: "Approved goal",
        question: "Proceed?",
        artifact: {
          relativePath: ".pi/goal/goal-proposal-1.md",
          sha256: "abc123",
          sizeBytes: 19,
        },
        targetPermissionMode: "auto",
        state: "running",
      };
      agent.continue = vi.fn(async () => undefined);
      agent.waitForIdle = vi.fn(async () => undefined);

      expect(goalToolNames()).not.toContain("UpdateGoalProgress");
      await runtime.executeApprovedPlan(
        { ...approvedExecution, id: "plan-execution-1", kind: "plan" },
        "plan-turn-1",
      );
      expect(goalToolNames()).not.toContain("UpdateGoalProgress");
      await handleAgentEvent({ type: "agent_end", messages: [] });
      await runtime.executeApprovedPlan(approvedExecution, "goal-turn-1");
      expect(goalToolNames()).toContain("UpdateGoalProgress");
      expect(host.call).toHaveBeenCalledWith("goalProgress.issueToken", {
        sessionId: "session-1",
        executionId: "goal-execution-1",
        turnId: "goal-turn-1",
      });

      const progressTool = agent.state.tools.find((tool) => tool.name === "UpdateGoalProgress");
      if (!progressTool) throw new Error("approved Goal did not register UpdateGoalProgress");
      const result = await progressTool.execute("progress-call-1", {
        items: [{ id: "check", label: "Run checks", status: "failed" }],
      });
      expect(result.details).toMatchObject({ ok: true, revision: 1 });
      expect(host.call).toHaveBeenCalledWith("goalProgress.update", {
        sessionId: "session-1",
        executionId: "goal-execution-1",
        writeToken: "gptk_test",
        items: [{ id: "check", label: "Run checks", status: "failed" }],
      });

      if (cleanup === "normal") {
        const reportTool = agent.state.tools.find((tool) => tool.name === "SubmitGoalReport");
        if (!reportTool) throw new Error("approved Goal did not register SubmitGoalReport");
        await reportTool.execute("partial-report", { summary: "Checks failed", verdict: "partial" });
        await handleAgentEvent({ type: "agent_end", messages: [] });
      } else if (cleanup === "abort") {
        await runtime.abort();
      } else {
        await runtime.dispose();
      }

      expect(goalToolNames()).not.toContain("UpdateGoalProgress");
      await runtime.dispose();
    },
  );

  it("keeps token issuance failures observable without exposing the tool", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = createRuntime({
      host: { call: vi.fn(async () => { throw new Error("token service unavailable"); }) },
    });
    const agent = (runtime as unknown as { agent: Agent }).agent;
    agent.continue = vi.fn(async () => undefined);
    agent.waitForIdle = vi.fn(async () => undefined);

    try {
      await runtime.executeApprovedPlan({
        id: "goal-execution-1",
        proposalId: "goal-proposal-1",
        sessionId: "session-1",
        kind: "goal",
        plan: "# Approved goal",
        title: "Approved goal",
        question: "Proceed?",
        artifact: {
          relativePath: ".pi/goal/goal-proposal-1.md",
          sha256: "abc123",
          sizeBytes: 19,
        },
        targetPermissionMode: "auto",
        state: "running",
      }, "goal-turn-1");

      expect(agent.state.tools.map((tool) => tool.name)).not.toContain("UpdateGoalProgress");
      expect(write).toHaveBeenCalledWith(
        expect.stringContaining("goal progress unavailable (session=session-1 execution=goal-execution-1)"),
      );
      expect(write).toHaveBeenCalledWith(expect.stringContaining("token service unavailable"));
    } finally {
      await runtime.dispose();
      write.mockRestore();
    }
  });

  it.each(["abort", "dispose"] as const)(
    "does not resume approved Goal startup when token issuance resolves after %s",
    async (cleanup) => {
      let resolveToken: ((value: unknown) => void) | undefined;
      const tokenPending = new Promise<unknown>((resolve) => {
        resolveToken = resolve;
      });
      const host = {
        call: vi.fn(async (method: string) =>
          method === "goalProgress.issueToken" ? tokenPending : undefined,
        ),
      };
      const runtime = createRuntime({ host });
      const agent = (runtime as unknown as { agent: Agent }).agent;
      const continueAgent = vi.fn(async () => undefined);
      agent.continue = continueAgent;
      agent.waitForIdle = vi.fn(async () => undefined);
      const execution: PlanExecution = {
        id: "goal-execution-pending-token",
        proposalId: "goal-proposal-pending-token",
        sessionId: "session-1",
        kind: "goal",
        plan: "# Approved goal",
        title: "Approved goal",
        question: "Proceed?",
        artifact: {
          relativePath: ".pi/goal/goal-proposal-pending-token.md",
          sha256: "abc123",
          sizeBytes: 19,
        },
        targetPermissionMode: "auto",
        state: "running",
      };

      const startup = runtime.executeApprovedPlan(execution, "goal-turn-pending-token");
      expect(host.call).toHaveBeenCalledWith("goalProgress.issueToken", {
        sessionId: "session-1",
        executionId: execution.id,
        turnId: "goal-turn-pending-token",
      });

      if (cleanup === "abort") await runtime.abort();
      else await runtime.dispose();
      resolveToken?.({ writeToken: "gptk_late" });

      await expect(startup).rejects.toMatchObject({ name: "AbortError" });
      expect(continueAgent).not.toHaveBeenCalled();
      expect(agent.state.tools.map((tool) => tool.name)).not.toContain("UpdateGoalProgress");
      await runtime.dispose();
    },
  );
});
