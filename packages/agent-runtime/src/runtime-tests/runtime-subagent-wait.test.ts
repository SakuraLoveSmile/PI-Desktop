import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { type RuntimeProviderConfig } from "../runtime.js";
import {
  DEFAULT_SUBAGENT_IDLE_TIMEOUT_SECONDS,
  MAX_SUBAGENT_CONCURRENCY,
} from "@pi-desktop/shared";
import { subagentRuns, provider, createRuntime } from "./runtime-test-harness.js";
import { explorer, pinned, taskTool } from "./subagent-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  it("starts the delegate in the background and returns a delegation id", async () => {
    const remote: RuntimeProviderConfig = {
      ...provider,
      id: "remote",
      name: "Remote",
      modelId: "remote-model",
      modelConfig: undefined,
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    };
    const runtime = createRuntime({
      subagents: [pinned],
      subagentProviders: { "remote/remote-model": remote },
      thinkingLevel: "high",
    });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);

    const result = await tool.execute("task-1", {
      agent: "reviewer",
      task: "Review src/app.ts.",
      description: "review app",
    });

    expect(subagentRuns.calls).toHaveLength(1);
    const options = subagentRuns.calls[0];
    expect(options.parentToolCallId).toBe("task-1");
    expect(options.provider.modelId).toBe("remote-model");
    expect(options.task).toBe("Review src/app.ts.");
    expect(options.tools.map((entry: any) => entry.name)).toEqual([
      "Read",
      "Bash",
    ]);
    // The remote provider advertises no reasoning, so the session level is
    // clamped rather than passed through.
    expect(options.thinkingLevel).toBe("off");
    expect(options.systemPrompt).toContain('You are the "reviewer" subagent');
    expect(options.systemPrompt).toContain("Review the change.");
    // Task is non-blocking (ADR 0089): it returns a started notice, not the
    // report, and the delegate is still running.
    expect(result.content[0].text).toContain("Delegation");
    expect(result.content[0].text).toContain("in the background");
    expect(result.details).toMatchObject({
      agent: "reviewer",
      status: "running",
      modelId: "remote-model",
      thinkingLevel: "off",
    });
    const delegationId = (result.details as any).delegationId as string;
    expect(delegationId.length).toBeGreaterThan(0);
    expect((runtime as any).delegations.get(delegationId).status).toBe(
      "running",
    );
    // A started delegation is not a tool error.
    await expect(
      (runtime as any).agent.afterToolCall({ toolCall: { id: "task-1" } }),
    ).resolves.toBeUndefined();

    // Settle the delegate; the registry records the outcome for TaskWait.
    subagentRuns.resolveRun!({
      agentName: "reviewer",
      status: "completed",
      report: "src/app.ts:12 misses the null check.",
      turns: 2,
      toolCalls: 3,
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
    });
    await vi.waitFor(() => {
      expect((runtime as any).delegations.get(delegationId).status).toBe(
        "completed",
      );
    });
    subagentRuns.deferred = false;

    await runtime.dispose();
  });

  it.each([false, true])(
    "publishes a settled Task snapshot without polling (settles early: %s)",
    async (settlesEarly) => {
      const onEvent = vi.fn();
      const runtime = createRuntime({ subagents: [explorer], onEvent, turnId: "original-turn" });
      subagentRuns.instances.length = 0;
      subagentRuns.deferred = true;
      const task = taskTool(runtime);
      const args = { agent: "explorer", task: "Find it." };
      const started = await task.execute("task-live", args);
      const sibling = await task.execute("task-sibling", args);
      const internals = runtime as unknown as {
        handleAgentEvent: (event: unknown) => Promise<void>;
        delegations: Map<string, { status: string }>;
      };
      const handle = internals.handleAgentEvent.bind(runtime);
      const settle = async () => {
        subagentRuns.resolveRun!({
          agentName: "explorer", status: "completed", report: "Done", turns: 1, toolCalls: 0,
        });
        await vi.waitFor(() =>
          expect(internals.delegations.get(started.details.delegationId)?.status).toBe("completed"),
        );
      };
      try {
        await handle({ type: "tool_execution_start", toolName: "Task", toolCallId: "task-live", args });
        if (settlesEarly) await settle();
        await handle({
          type: "tool_execution_end", toolName: "Task", toolCallId: "task-live",
          result: started, isError: false,
        });
        if (!settlesEarly) await settle();
        const events = onEvent.mock.calls.map(([envelope]) => envelope);
        const snapshots = events.filter((envelope) =>
          envelope.event.type === "message_end" && envelope.event.message.role === "tool",
        );
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({
          turnId: "original-turn",
          event: { message: {
            id: "task-live", toolName: "Task", toolArgs: args, toolStatus: "success",
            toolResult: { details: {
              delegationId: started.details.delegationId,
              status: "completed", completedAt: expect.any(Number),
            } },
          } },
        });
        const initialStart = events.find((envelope) => envelope.event.type === "tool_start");
        const initialEnd = events.find((envelope) => envelope.event.type === "tool_end");
        expect(snapshots[0].event.message).toMatchObject({
          createdAt: new Date(initialStart.ts).toISOString(),
          toolCompletedAt: new Date(initialEnd.ts).toISOString(),
          toolDurationMs: initialEnd.ts - initialStart.ts,
          toolUsage: initialEnd.event.toolUsage,
        });
        expect(internals.delegations.get(sibling.details.delegationId)?.status).toBe("running");
        const types = events.map((envelope) => envelope.event.type);
        expect(types.indexOf("tool_end")).toBeLessThan(types.indexOf("message_end"));
      } finally {
        await runtime.dispose();
        subagentRuns.deferred = false;
      }
    },
  );

  it("converges through TaskWait with reports and statuses", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.result = {
      agentName: "explorer",
      status: "failed",
      report: "The explorer subagent failed after 1 turn(s): no route.",
      turns: 1,
      toolCalls: 0,
      scratchReportPath: "/tmp/session-scratch/delegations/task-1/report.md",
      error: { code: "NETWORK_ERROR", message: "no route" },
    };
    const task = taskTool(runtime);
    const wait = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "TaskWait",
    );
    expect(wait).toBeDefined();
    expect((runtime as any).deferredToolNames.has("TaskWait")).toBe(false);

    const started = await task.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const delegationId = (started.details as any).delegationId as string;
    // A failed delegate is no longer a failed Task call: the failure is
    // reported through TaskWait, which also carries the partial report.
    await expect(
      (runtime as any).agent.afterToolCall({ toolCall: { id: "task-1" } }),
    ).resolves.toBeUndefined();

    const converged = await wait.execute("wait-1", {
      delegationIds: [delegationId],
    });
    expect(converged.content[0].text).toContain("explorer");
    expect(converged.content[0].text).toContain("failed");
    expect(converged.content[0].text).toContain(
      "The explorer subagent failed after 1 turn(s): no route.",
    );
    expect(converged.details).toMatchObject({
      status: "completed",
      delegations: [
        {
          delegationId,
          agent: "explorer",
          status: "failed",
          startedAt: expect.any(Number),
          completedAt: expect.any(Number),
          scratchReportPath: "/tmp/session-scratch/delegations/task-1/report.md",
        },
      ],
    });

    subagentRuns.result = {
      agentName: "explorer",
      status: "aborted",
      report: "The explorer subagent was aborted after 6 turn(s).",
      turns: 6,
      toolCalls: 6,
    };
    const second = await task.execute("task-2", {
      agent: "explorer",
      task: "Find it.",
    });
    const secondId = (second.details as any).delegationId as string;
    const aborted = await wait.execute("wait-2", {
      delegationIds: [secondId],
    });
    // A settled run's own status reaches TaskWait unchanged; `truncated` went
    // with the turn limit (ADR 0253), so the partial-report status a stopped
    // delegate reports is `aborted`.
    expect(aborted.details).toMatchObject({
      delegations: [{ delegationId: secondId, status: "aborted" }],
    });

    subagentRuns.result = {
      agentName: "explorer",
      status: "timed_out",
      report: "The explorer subagent timed out after 2 turn(s).",
      turns: 2,
      toolCalls: 1,
      error: {
        code: "SUBAGENT_IDLE_TIMEOUT",
        message: `The subagent produced no activity for ${DEFAULT_SUBAGENT_IDLE_TIMEOUT_SECONDS} seconds.`,
      },
    };
    const third = await task.execute("task-3", {
      agent: "explorer",
      task: "Find it one more time.",
    });
    const thirdId = (third.details as any).delegationId as string;
    const timedOut = await wait.execute("wait-3", {
      delegationIds: [thirdId],
    });
    expect(timedOut.content[0].text).toContain("timed out");
    expect(timedOut.details).toMatchObject({
      delegations: [
        {
          delegationId: thirdId,
          status: "timed_out",
          error: { code: "SUBAGENT_IDLE_TIMEOUT" },
        },
      ],
    });

    await runtime.dispose();
  });

  it("waits for running delegates with mode all/any and stops them with TaskStop", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const task = taskTool(runtime);
    const wait = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "TaskWait",
    );
    const stop = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "TaskStop",
    );
    expect(stop).toBeDefined();

    const first = await task.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const second = await task.execute("task-2", {
      agent: "explorer",
      task: "Find it too.",
    });
    const firstId = (first.details as any).delegationId as string;
    const secondId = (second.details as any).delegationId as string;

    // mode "any" with minCompleted 1 converges as soon as one settles.
    const waiting = wait.execute("wait-1", {
      mode: "any",
      minCompleted: 1,
      timeoutSeconds: 5,
    });
    subagentRuns.resolveRun!({
      agentName: "explorer",
      status: "completed",
      report: "Found it in src/app.ts:12.",
      turns: 1,
      toolCalls: 2,
    });
    const converged = await waiting;
    expect(converged.details.status).toBe("completed");
    expect(converged.content[0].text).toContain("src/app.ts:12");

    const noOpStop = await stop.execute("stop-completed", {
      delegationIds: [firstId],
    });
    expect(noOpStop.content[0].text).toContain("No matching running");
    expect((runtime as any).delegations.get(firstId).status).toBe("completed");

    // TaskStop stops the still-running second delegate and reports "stopped".
    const stopped = await stop.execute("stop-1", { delegationIds: [secondId] });
    expect(stopped.details.stopped).toHaveLength(1);
    expect((stopped.details.stopped as Array<{ status: string }>)[0].status).toBe(
      "stopped",
    );
    expect((runtime as any).delegations.get(secondId).status).toBe("stopped");
    const afterStop = await wait.execute("wait-2", {
      delegationIds: [secondId],
    });
    expect(afterStop.content[0].text).toContain("stopped");
    expect(firstId).not.toBe(secondId);
    subagentRuns.deferred = false;

    await runtime.dispose();
  });

  it("returns a pending cancellation instead of hanging when a delegate ignores abort", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.ignoreAbort = true;
    subagentRuns.resolveRun = undefined;
    const task = taskTool(runtime);
    const stop = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "TaskStop",
    );
    const started = await task.execute("task-unresponsive", {
      agent: "explorer",
      task: "Keep working unless cancellation reaches you.",
    });
    const delegationId = (started.details as any).delegationId as string;

    vi.useFakeTimers();
    try {
      const stopping = stop.execute("stop-unresponsive", {
        delegationIds: [delegationId],
      });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await stopping;
      expect(result.content[0].text).toContain("remain running");
      expect(result.details.stopped).toEqual([]);
      expect(result.details.stopPending).toMatchObject([
        { delegationId, status: "running" },
      ]);
      expect((runtime as any).delegations.get(delegationId).status).toBe(
        "running",
      );
    } finally {
      vi.useRealTimers();
      subagentRuns.ignoreAbort = false;
      subagentRuns.deferred = false;
    }

    (subagentRuns as any).resolveRun?.({
      agentName: "explorer",
      status: "aborted",
      report: "The delegated task was aborted.",
      turns: 0,
      toolCalls: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    await runtime.dispose();
  });

  it("caps running delegates per session at MAX_SUBAGENT_CONCURRENCY", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);
    const MAX = MAX_SUBAGENT_CONCURRENCY;

    const ids: string[] = [];
    for (let index = 0; index < MAX; index += 1) {
      const result = await tool.execute(`task-${index}`, {
        agent: "explorer",
        task: "Find it.",
      });
      ids.push((result.details as any).delegationId as string);
    }
    const over = await tool.execute("task-over", {
      agent: "explorer",
      task: "Find it.",
    });
    expect(over.content[0].text).toContain(
      `${MAX} subagents are already running`,
    );
    await expect(
      (runtime as any).agent.afterToolCall({ toolCall: { id: "task-over" } }),
    ).resolves.toEqual({ isError: true });
    expect((runtime as any).runningDelegations()).toHaveLength(MAX);

    // Freeing one slot (via stop) makes room again.
    const stop = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "TaskStop",
    );
    await stop.execute("stop-1", { delegationIds: [ids[0]] });
    await vi.waitFor(() => {
      expect((runtime as any).runningDelegations()).toHaveLength(MAX - 1);
    });
    const again = await tool.execute("task-again", {
      agent: "explorer",
      task: "Find it.",
    });
    expect((again.details as any).delegationId).toBeDefined();
    subagentRuns.deferred = false;

    await runtime.dispose();
  });
});
