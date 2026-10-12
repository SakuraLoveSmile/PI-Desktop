import "./runtime-test-harness.js";
import { describe, vi, expect, it } from "vitest";
import { DesktopAgentRuntime } from "../runtime.js";
import { type AgentMessage } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime loop context ownership (D620)", () => {

  /**
   * Rounds 1 and 2 answer with a tool call and round 3 closes the turn; with
   * `stopAfterFirstRound` the run ends on the tool round instead, the way a
   * user Stop does. Every round records the request view the provider saw.
   */
  function scriptCallRounds(
    runtime: DesktopAgentRuntime,
    requests: AgentMessage[][],
    options: { stopAfterRound?: number } = {},
  ): void {
    let round = 0;
    (runtime as any).models = {
      streamSimple: (_model: unknown, context: { messages: AgentMessage[] }) => {
        round += 1;
        const current = round;
        requests.push([...context.messages]);
        if (current === options.stopAfterRound) {
          runtime.requestGracefulStop();
        }
        const withCall = current <= 2;
        const message = assistantMessage({
          content: withCall
            ? [
                { type: "text", text: `round ${current}` },
                {
                  type: "toolCall",
                  id: `call-${current}`,
                  name: "plugin_demo_probe",
                  arguments: {},
                },
              ]
            : [{ type: "text", text: `round ${current}` }],
          stopReason: withCall ? "toolUse" : "stop",
        }) as unknown as AssistantMessage;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({
            type: "done",
            reason: withCall ? "toolUse" : "stop",
            message,
          });
          stream.end(message);
        });
        return stream;
      },
    };
  }

  function probeRuntime(
    requests: AgentMessage[][],
    options: { stopAfterRound?: number } = {},
  ): DesktopAgentRuntime {
    const runtime = createRuntime({
      host: {
        call: vi.fn(async (method: string) =>
          method === "tools.execute"
            ? {
                ok: true,
                content: {
                  content: [{ type: "text", text: "probe ok" }],
                  details: {},
                },
              }
            : undefined,
        ),
      } as never,
      pluginTools: [
        { name: "plugin_demo_probe", description: "probe", parameters: {} },
      ],
    });
    scriptCallRounds(runtime, requests, options);
    return runtime;
  }

  function textBlocks(messages: AgentMessage[]): string[] {
    return messages.flatMap((message) =>
      message.role === "assistant"
        ? ((message as { content: unknown[] }).content ?? [])
            .filter(
              (block): block is { type: string; text: string } =>
                typeof block === "object" &&
                block !== null &&
                (block as { type?: string }).type === "text",
            )
            .map((block) => block.text)
        : [],
    );
  }

  function toolCallIds(messages: AgentMessage[]): string[] {
    return messages.flatMap((message) =>
      message.role === "assistant"
        ? ((message as { content: unknown[] }).content ?? [])
            .filter(
              (block): block is { type: string; id: string } =>
                typeof block === "object" &&
                block !== null &&
                (block as { type?: string }).type === "toolCall",
            )
            .map((block) => block.id)
        : [],
    );
  }

  function resultIds(messages: AgentMessage[]): string[] {
    return messages
      .filter((message) => message.role === "toolResult")
      .map((message) => (message as { toolCallId?: string }).toolCallId ?? "");
  }

  /** Every result has to sit directly behind the assistant that carries its call. */
  function expectResultsFollowTheirCalls(messages: AgentMessage[]): void {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index] as { role?: string; toolCallId?: string };
      if (message.role !== "toolResult") continue;
      let previous = index - 1;
      while (
        previous >= 0 &&
        (messages[previous] as { role?: string }).role === "system"
      ) {
        previous -= 1;
      }
      const carrier = messages[previous] as { role?: string; content?: unknown[] };
      expect(carrier?.role).toBe("assistant");
      expect(
        (carrier?.content ?? []).some(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            (block as { type?: string }).type === "toolCall" &&
            (block as { id?: string }).id === message.toolCallId,
        ),
      ).toBe(true);
    }
  }

  it("stores one copy of every message the loop appends", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const requests: AgentMessage[][] = [];
      const runtime = probeRuntime(requests);

      await runtime.prompt("first task", "user-1", "turn-1");

      // The loop appends the streamed assistant message and the tool results to
      // the context it was handed; pi's `message_end` listener appends the same
      // object to the state. Sharing one array stored every message of the
      // later rounds twice (D620).
      const state = (runtime as any).agent.state.messages as AgentMessage[];
      expect(textBlocks(state)).toEqual(["round 1", "round 2", "round 3"]);
      expect(toolCallIds(state)).toEqual(["call-1", "call-2"]);
      expect(resultIds(state)).toEqual(["call-1", "call-2"]);
      // Nothing was duplicated, so the request guard had nothing to report.
      const log = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(log).not.toContain("duplicate tool call");

      await runtime.dispose();
    } finally {
      stderr.mockRestore();
    }
  });

  it("opens the next turn from a stopped tool round without guard repairs", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const requests: AgentMessage[][] = [];
      const runtime = probeRuntime(requests, { stopAfterRound: 2 });

      // A Stop ends the run on the second tool round, so those messages are the
      // ones the next turn's first request is built from — the request that
      // production rejected with `Duplicate tool output for call_id` (D620).
      await runtime.prompt("first task", "user-1", "turn-1");

      requests.length = 0;
      await runtime.prompt("second task", "user-2", "turn-2");

      // `streamSimple` sees the view `convertToLlm` produced, so this is the
      // request the guard let through unrepaired, not the adapter's output: the
      // second output pi-ai synthesizes for an unanswered call is pinned
      // directly in `tool-call-dedupe.test.ts` (request wire contract).
      const wire = requests[0]!;
      expect(toolCallIds(wire)).toEqual(["call-1", "call-2"]);
      expect(resultIds(wire)).toEqual(["call-1", "call-2"]);
      expectResultsFollowTheirCalls(wire);
      const log = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(log).not.toContain("duplicate tool call");

      await runtime.dispose();
    } finally {
      stderr.mockRestore();
    }
  });
});
