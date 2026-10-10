import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type UiMessage } from "@pi-desktop/shared";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime early context compaction", () => {
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
  const softBudget = {
    tokens: 205_000,
    hardLimit: 224_000,
    requestHeadroom: 32_000,
    keepRecentTokens: 44_800,
  };

  it("compacts a follow-up turn before the hard limit", async () => {
    const runtime = createRuntime({ history });
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue(softBudget);
    const compact = vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(true);

    await (runtime as any).prepareNextTurn({
      context: { systemPrompt: "base", messages: [], tools: [] },
      newMessages: [],
    });

    expect(softBudget.tokens).toBeLessThan(softBudget.hardLimit);
    expect(compact).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("preflights a new prompt at the same early trigger", async () => {
    const runtime = createRuntime({ history });
    const events: string[] = [];
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue(softBudget);
    const compact = vi.spyOn(runtime as any, "runCompaction").mockImplementation(async () => {
      events.push("compact");
      return true;
    });
    const prompt = vi.spyOn((runtime as any).agent, "prompt").mockImplementation(async () => {
      events.push("prompt");
    });

    await runtime.prompt("next user request");

    expect(compact).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledOnce();
    expect(events).toEqual(["compact", "prompt"]);
    await runtime.dispose();
  });
});

it("continues a soft-trigger preflight when compaction fails below the hard limit", async () => {
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
    const softBudget = {
      tokens: 205_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 44_800,
    };
    const runtime = createRuntime({ history });
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue(softBudget);
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(false);
    const prompt = vi.spyOn((runtime as any).agent, "prompt").mockResolvedValue(undefined);

    await runtime.prompt("next user request");

    expect(prompt).toHaveBeenCalledOnce();
    await runtime.dispose();
  });
