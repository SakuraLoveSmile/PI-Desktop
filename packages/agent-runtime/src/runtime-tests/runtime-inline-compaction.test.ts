import "./runtime-test-harness.js";
import { describe, vi, it, expect } from "vitest";
import { type UiMessage } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import { type Agent } from "@earendil-works/pi-agent-core";
import { getCurrentTools, toToolDeclaration, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { buildSessionContext } from "../session-context.js";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime inline context compaction", () => {

  const history: UiMessage[] = [
    {
      id: "old-user",
      role: "user",
      content: "older task context",
      createdAt: "2026-07-28T00:00:00Z",
      status: "complete",
    },
    {
      id: "recent-user",
      role: "user",
      content: "continue the task",
      createdAt: "2026-07-28T00:00:01Z",
      status: "complete",
    },
  ];

  const nextTurn = {
    context: { systemPrompt: "base", messages: [], tools: [] },
    newMessages: [],
  };

  const SUMMARY = "Older work was summarized.";

  /** Past the hard boundary, so the next turn cannot be issued as-is. */
  function overBudget(tokens = 240_000) {
    return {
      tokens,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 1,
    };
  }

  function summaryResult(summary = SUMMARY) {
    return {
      ok: true,
      value: { summary, tokensBefore: 240_000 },
    };
  }

  /** Over the boundary until the checkpoint's summary is part of the context. */
  function budgetSpy(runtime: DesktopAgentRuntime) {
    return vi.spyOn(runtime as any, "contextBudget").mockImplementation(
      ((messages: unknown) =>
        JSON.stringify(messages).includes(SUMMARY)
          ? { ...overBudget(), tokens: 40_000 }
          : overBudget()) as never,
    );
  }

  it("compacts at the turn boundary rather than ahead of it", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const onEvent = vi.fn();
    const runtime = createRuntime({ host, onEvent, history });
    budgetSpy(runtime);
    const generateCompaction = vi
      .spyOn(runtime as any, "generateCompaction")
      .mockResolvedValue(summaryResult());

    // A running tool is an idle provider connection, but compaction has no
    // off-critical-path variant: nothing may happen here.
    await (runtime as any).handleAgentEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "Read",
      args: {},
    });
    expect(generateCompaction).not.toHaveBeenCalled();
    expect(host.call).not.toHaveBeenCalled();

    await (runtime as any).prepareNextTurn(nextTurn);

    expect(generateCompaction).toHaveBeenCalledOnce();
    expect(host.call).toHaveBeenCalledWith(
      "session.appendCompaction",
      expect.objectContaining({
        compaction: expect.objectContaining({
          summary: SUMMARY,
          throughMessageId: "recent-user",
        }),
      }),
    );
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual({ type: "compaction_start", reason: "threshold" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        reason: "threshold",
        ok: true,
        mark: {
          id: expect.any(String),
          throughMessageId: "recent-user",
          generation: 1,
          summaryTokens: 7,
          summarized: true,
        },
      }),
    );
    await runtime.dispose();
  });

  it("counts checkpoint generations so the inspector can show how often a session compacted", async () => {
    const runtime = createRuntime({
      host: { call: vi.fn().mockResolvedValue(undefined), onNotification: vi.fn(() => () => {}) },
      history,
    });
    const preparation = {
      firstKeptEntryId: "recent-user",
      tokensBefore: 160_000,
      retainedTail: [],
    };

    const first = (runtime as any).createCheckpoint(
      preparation,
      "recent-user",
      "first summary",
    );
    expect((first.details as { generation: number }).generation).toBe(1);

    (runtime as any).activeCompaction = first;
    const second = (runtime as any).createCheckpoint(
      preparation,
      "recent-user",
      "second summary",
      undefined,
      { readFiles: ["a.ts"] },
    );
    expect(second.details).toEqual({ readFiles: ["a.ts"], generation: 2 });
    await runtime.dispose();
  });

  it("reports the session as running while it compacts", async () => {
    const runtime = createRuntime({
      host: { call: vi.fn().mockResolvedValue(undefined), onNotification: vi.fn(() => () => {}) },
      history,
    });
    budgetSpy(runtime);
    let release: (value: unknown) => void = () => {};
    vi.spyOn(runtime as any, "generateCompaction").mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const pending = (runtime as any).prepareNextTurn(nextTurn);
    await Promise.resolve();

    expect(runtime.getStatus().isRunning).toBe(true);

    release(summaryResult());
    await pending;
    expect(runtime.getStatus().isRunning).toBe(false);
    await runtime.dispose();
  });

  it("does not compact an in-budget turn when automatic protection is disabled", async () => {
    const runtime = createRuntime({
      host: { call: vi.fn().mockResolvedValue(undefined), onNotification: vi.fn(() => () => {}) },
      history,
      compactionSettings: {
        enabled: false,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
    });
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 100_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 20_000,
    });
    const generateCompaction = vi.spyOn(runtime as any, "generateCompaction");

    await (runtime as any).prepareNextTurn(nextTurn);

    expect(generateCompaction).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("rolls the context over without a summary request in the fresh-window family", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const onEvent = vi.fn();
    const runtime = createRuntime({
      host,
      onEvent,
      history,
      compactionStrategy: "fresh_window",
    });
    vi.spyOn(runtime as any, "contextBudget").mockImplementation(
      ((messages: unknown) =>
        JSON.stringify(messages).includes("context rollover")
          ? { ...overBudget(), tokens: 40_000 }
          : overBudget()) as never,
    );
    const generateCompaction = vi.spyOn(runtime as any, "generateCompaction");
    const agent = (runtime as any).agent as Agent;
    const index = agent.state.messages.findIndex((message) => message.role === "system");
    const prefix = { ...agent.state.messages[index], sections: { rules: "Keep checkpoint rules" } };
    agent.state.messages[index] = prefix as any;

    await (runtime as any).prepareNextTurn(nextTurn);

    // The point of this family: the window is bought back without paying for a
    // summary, so no provider request is made at all.
    expect(agent.state.messages[0]).toEqual(prefix);
    expect(getCurrentTools(agent.state.messages)).toEqual(agent.state.tools.map(toToolDeclaration));
    expect(getCurrentSystemMessage(agent.state.messages)?.sections).toEqual({ rules: "Keep checkpoint rules" });
    expect((runtime as any).rebuiltAgentContext().messages[0]).toEqual(prefix);
    expect(generateCompaction).not.toHaveBeenCalled();
    const compaction = host.call.mock.calls.find(
      ([method]) => method === "session.appendCompaction",
    )?.[1].compaction;
    expect(compaction.summary).toContain("[context rollover:");
    expect(compaction.retainedTail).toEqual([]);
    expect(compaction.usage).toBeUndefined();
    expect(compaction.details).toMatchObject({
      strategy: "fresh_window",
      generation: 1,
    });
    // Nothing but the rollover notice survives, matching Codex clearing history.
    expect(
      buildSessionContext((runtime as any).entriesWithCompaction()).messages.map(
        (message: any) => message.role,
      ),
    ).toEqual(["system", "compactionSummary"]);
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        reason: "threshold",
        ok: true,
      }),
    );
    await runtime.dispose();
  });

  it("stamps the summary family on its checkpoint too", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({ host, history });
    budgetSpy(runtime);
    vi.spyOn(runtime as any, "generateCompaction").mockResolvedValue(
      summaryResult(),
    );

    await (runtime as any).prepareNextTurn(nextTurn);

    expect(
      host.call.mock.calls.find(
        ([method]) => method === "session.appendCompaction",
      )?.[1].compaction.details,
    ).toMatchObject({ strategy: "summary" });
    await runtime.dispose();
  });
});
