import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  harvestRetainedReasoning,
  retainedReasoningFromDetails,
  retainedReasoningToMessages,
} from "./reasoning-replay.js";

function assistant(thinking: string, text = "ok"): AgentMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "local",
    model: "local",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
    content: [
      { type: "thinking", thinking, thinkingSignature: "reasoning_content" },
      { type: "text", text },
    ],
  } as AgentMessage;
}

describe("harvestRetainedReasoning", () => {
  it("keeps the newest thinking turns and skips thinking-less assistants", () => {
    // #296
    const turns = harvestRetainedReasoning(
      [
        { role: "user", content: "a", timestamp: 1 },
        assistant("plan one", "answer one"),
        { role: "user", content: "b", timestamp: 2 },
        {
          role: "assistant",
          api: "openai-completions",
          provider: "local",
          model: "local",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
          content: [{ type: "text", text: "no think" }],
        } as AgentMessage,
        { role: "user", content: "c", timestamp: 3 },
        assistant("plan two", "answer two"),
      ],
      3,
    );
    expect(turns).toEqual([
      { thinking: "plan one", text: "answer one" },
      { thinking: "plan two", text: "answer two" },
    ]);
  });
});

describe("retainedReasoning replay messages", () => {
  it("round-trips details into assistants stamped for Completions replay", () => {
    // #296
    const details = {
      retainedReasoning: [{ thinking: "kept plan", text: "kept answer" }],
    };
    const messages = retainedReasoningToMessages(
      retainedReasoningFromDetails(details),
      10,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toEqual([
      {
        type: "thinking",
        thinking: "kept plan",
        thinkingSignature: "reasoning_content",
      },
      { type: "text", text: "kept answer" },
    ]);
  });
});
