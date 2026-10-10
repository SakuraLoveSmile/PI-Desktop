import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { PROVIDER_RATE_LIMIT_MAX_RETRIES } from "../provider-retry.js";
import { subagentRuns, createRuntime } from "./runtime-test-harness.js";
import { explorer, taskTool } from "./subagent-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  it("keeps running delegates after the parent run ends", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);

    const started = await tool.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const delegationId = (started.details as any).delegationId as string;
    expect((runtime as any).runningDelegations()).toHaveLength(1);

    await (runtime as any).handleAgentEvent({ type: "agent_end" });
    expect((runtime as any).delegations.get(delegationId).status).toBe(
      "running",
    );
    expect((runtime as any).runningDelegations()).toHaveLength(1);

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("aborts running delegates on user abort or dispose, not on parent idle", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);

    const started = await tool.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const delegationId = (started.details as any).delegationId as string;

    await runtime.abort();
    await vi.waitFor(() => {
      expect((runtime as any).delegations.get(delegationId).status).toBe(
        "aborted",
      );
    });
    expect((runtime as any).runningDelegations()).toHaveLength(0);

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("aborts leftover delegates on parent rate-limit exhaustion so the session can continue", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ subagents: [explorer], onEvent });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    const started = await tool.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const delegationId = (started.details as any).delegationId as string;
    expect((runtime as any).runningDelegations()).toHaveLength(1);

    (runtime as any).providerRateLimitRetryAttempt =
      PROVIDER_RATE_LIMIT_MAX_RETRIES;
    const rateLimitedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "partial response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: '429: {"error":{"type":"rate_limit_error"}}',
      timestamp: 2,
    };

    await handleAgentEvent({ type: "message_start", message: rateLimitedMessage });
    await handleAgentEvent({ type: "message_end", message: rateLimitedMessage });
    await handleAgentEvent({ type: "turn_end" });
    await handleAgentEvent({ type: "agent_end", messages: [] });

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }),
      }),
    );
    expect(events.some((event) => event.type === "agent_end")).toBe(true);
    expect(runtime.getStatus().isRunning).toBe(false);

    await vi.waitFor(() => {
      expect((runtime as any).delegations.get(delegationId).status).toBe(
        "aborted",
      );
    });

    const prompt = vi.fn(async () => undefined);
    (runtime as any).agent.prompt = prompt;
    (runtime as any).agent.waitForIdle = vi.fn(async () => undefined);
    await (runtime as any).resumeAfterDelegations();
    expect(prompt).not.toHaveBeenCalled();

    subagentRuns.deferred = false;
    await runtime.dispose();
  });
});
