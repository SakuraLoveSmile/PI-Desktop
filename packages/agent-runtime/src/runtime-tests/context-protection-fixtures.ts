import "./runtime-test-harness.js";

export const toolResult = {
  role: "toolResult" as const,
  toolCallId: "tool-call-1",
  toolName: "Read",
  content: [{ type: "text" as const, text: "large result" }],
  isError: false,
  timestamp: 2,
};

export const assistant = {
  role: "assistant" as const,
  content: [],
  api: "openai-completions" as const,
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
  stopReason: "toolUse" as const,
  timestamp: 1,
};

export const nextTurn = {
  message: assistant,
  toolResults: [toolResult],
  context: { systemPrompt: "base", messages: [], tools: [] },
  newMessages: [assistant, toolResult],
};
