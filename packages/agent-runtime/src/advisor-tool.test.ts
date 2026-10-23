import { describe, expect, it } from "vitest";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  ADVISOR_MAX_CALLS_PER_TURN,
  ADVISOR_SYSTEM_PROMPT,
  ADVISOR_TOOL_NAME,
  advisorTranscript,
  createAdvisorTool,
  type AdvisorRequest,
} from "./advisor-tool.js";

const model = {
  id: "advisor-model",
  name: "Advisor",
  api: "openai-completions",
  provider: "local",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
} as Model<Api>;

function user(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistant(
  content: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  >,
): AgentMessage {
  return {
    role: "assistant",
    content,
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
    stopReason: "stop",
    timestamp: 2,
  } as AgentMessage;
}

function toolResult(text: string, id: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "Read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 3,
  };
}

function run(tool: AgentTool, signal?: AbortSignal) {
  return tool.execute("advisor-call", {}, signal);
}

describe("advisorTranscript", () => {
  it("keeps the conversation and drops private reasoning and unanswered calls", () => {
    const transcript = advisorTranscript([
      user("Fix the parser"),
      assistant([
        { type: "thinking", thinking: "private plan" },
        { type: "text", text: "I will read the parser first." },
        { type: "toolCall", id: "read-1", name: "Read", arguments: { path: "parser.ts" } },
      ]),
      toolResult("export function parse() {}", "read-1"),
      assistant([
        { type: "text", text: "The parser is small." },
        { type: "toolCall", id: "advisor-1", name: ADVISOR_TOOL_NAME, arguments: {} },
      ]),
    ]);

    expect(transcript).toContain("[User]: Fix the parser");
    expect(transcript).toContain("[Assistant]: I will read the parser first.");
    expect(transcript).toContain('Read(path="parser.ts")');
    expect(transcript).toContain("[Tool result]: export function parse() {}");
    expect(transcript).toContain("[Assistant]: The parser is small.");
    expect(transcript).not.toContain("private plan");
    expect(transcript).not.toContain(`${ADVISOR_TOOL_NAME}(`);
  });
});

describe("createAdvisorTool", () => {
  it("sends the conversation with the advisor instructions and returns the advice", async () => {
    const requests: AdvisorRequest[] = [];
    const tool = createAdvisorTool({
      model,
      conversation: () => [user("Add retries to the client")],
      advise: async (request) => {
        requests.push(request);
        return "Check the retry limit before anything else.";
      },
      turnKey: () => 1,
    });

    const result = await run(tool);

    expect(tool.name).toBe(ADVISOR_TOOL_NAME);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.systemPrompt).toBe(ADVISOR_SYSTEM_PROMPT);
    expect(requests[0]?.userText).toContain("[User]: Add retries to the client");
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Check the retry limit") }]);
    expect(result.details).toEqual({ ok: true });
  });

  it("limits calls per turn and starts counting again on the next turn", async () => {
    let turn = 1;
    let calls = 0;
    const tool = createAdvisorTool({
      model,
      conversation: () => [user("Task")],
      advise: async () => {
        calls += 1;
        return "ok";
      },
      turnKey: () => turn,
    });

    for (let i = 0; i < ADVISOR_MAX_CALLS_PER_TURN; i += 1) await run(tool);
    const limited = await run(tool);

    expect(limited.details).toEqual({ ok: false, error: expect.stringContaining("limit") });
    expect(calls).toBe(ADVISOR_MAX_CALLS_PER_TURN);

    turn = 2;
    await run(tool);
    expect(calls).toBe(ADVISOR_MAX_CALLS_PER_TURN + 1);
  });

  it("reports an advisor failure as a tool result so the turn can continue", async () => {
    const tool = createAdvisorTool({
      model,
      conversation: () => [user("Task")],
      advise: async () => {
        throw new Error("provider returned 503");
      },
      turnKey: () => 1,
    });

    const result = await run(tool);

    expect(result.content).toEqual([{ type: "text", text: "Advisor failed: provider returned 503" }]);
    expect(result.details).toEqual({ ok: false, error: "provider returned 503" });
  });

  it("rethrows when the turn is stopped so the agent loop can end", async () => {
    const controller = new AbortController();
    const tool = createAdvisorTool({
      model,
      conversation: () => [user("Task")],
      advise: async () => {
        controller.abort();
        throw new Error("aborted");
      },
      turnKey: () => 1,
    });

    await expect(run(tool, controller.signal)).rejects.toThrow("aborted");
  });

  it("refuses without calling the advisor when even a shortened conversation exceeds its window", async () => {
    const small = { ...model, contextWindow: 2_000, maxTokens: 500 } as Model<Api>;
    let called = false;
    const tool = createAdvisorTool({
      model: small,
      conversation: () => [user("x".repeat(20_000))],
      advise: async () => {
        called = true;
        return "ok";
      },
      turnKey: () => 1,
    });

    const result = await run(tool);

    expect(called).toBe(false);
    expect(result.details).toEqual({ ok: false, error: expect.stringContaining("input window") });
  });

  it("shortens long tool results before it refuses a conversation that is too large", async () => {
    const output = "line of output ".repeat(140);
    const conversation: AgentMessage[] = [user("Summarize the logs")];
    for (let i = 0; i < 12; i += 1) {
      conversation.push(assistant([{ type: "toolCall", id: `read-${i}`, name: "Read", arguments: { path: `log-${i}.txt` } }]));
      conversation.push(toolResult(output, `read-${i}`));
    }
    const window = { ...model, contextWindow: 8_000, maxTokens: 1_000 } as Model<Api>;
    const requests: AdvisorRequest[] = [];
    const tool = createAdvisorTool({
      model: window,
      conversation: () => conversation,
      advise: async (request) => {
        requests.push(request);
        return "ok";
      },
      turnKey: () => 1,
    });

    const result = await run(tool);

    expect(result.details).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.userText).toContain("[User]: Summarize the logs");
    expect(requests[0]?.userText).toContain("[... tool output truncated for the summary request]");
  });
});
