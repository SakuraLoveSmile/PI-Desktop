import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type Agent } from "@earendil-works/pi-agent-core";
import {
  estimateContextTokens as estimateTranscriptTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import { getCurrentTools, toToolDeclaration, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("system transcript reconstruction", () => {

  it("keeps provider usage valid when rebuilding an unchanged prefix", async () => {
    const runtime = createRuntime();
    const internals = runtime as any;
    const agent = internals.agent as Agent;
    const system = { ...agent.state.messages[0], timestamp: 1_000 };
    const assistant = { ...assistantMessage({ content: [{ type: "text", text: "done" }] }), timestamp: 2_000 };
    agent.state.messages = [system, assistant] as any;
    vi.spyOn(internals, "liveSessionContext").mockReturnValue({ messages: [assistant] });

    const rebuilt = internals.rebuiltAgentContext();

    expect(estimateTranscriptTokens(rebuilt.messages).usageTokens).toBe(2);
    expect(rebuilt.messages[0]).toBe(system);
    expect(getCurrentTools(rebuilt.messages)).toEqual(agent.state.tools.map(toToolDeclaration));
    expect(internals.rebuiltAgentContext().messages[0]).toBe(system);
    await runtime.dispose();
  });

  it("does not flatten sections or erase tool deltas when the prompt is unchanged", async () => {
    const runtime = createRuntime();
    const internals = runtime as any;
    const agent = internals.agent as Agent;
    const messages = [
      { ...agent.state.messages[0], timestamp: 1_000, sections: { rules: "Keep these rules." } },
      { role: "system", content: "", timestamp: 1_500, toolsRemoved: [{ name: agent.state.tools[0]!.name }] },
    ];
    agent.state.messages = messages as any;

    internals.setAgentSystemPrompt(agent.state.systemPrompt);

    expect(agent.state.messages).toEqual(messages);
    expect(agent.state.messages[0]).toBe(messages[0]);
    await runtime.dispose();
  });

  it("keeps a fresh restore prefix stable without claiming it predates history", async () => {
    const before = Date.now();
    const runtime = createRuntime({ history: [
      { id: "old-user", role: "user", content: "Earlier task", createdAt: new Date(before - 2_000).toISOString(), status: "complete" },
      { id: "old-assistant", role: "assistant", content: "Earlier answer", createdAt: new Date(before - 1_000).toISOString(), status: "complete" },
    ] });
    const internals = runtime as any;
    const prefix = internals.agent.state.messages.at(-1);
    expect(prefix.timestamp).toBeGreaterThanOrEqual(before);
    const rebuilt = internals.rebuiltAgentContext();
    expect(rebuilt.messages.at(-1)).toBe(prefix);
    expect(getCurrentTools(rebuilt.messages)).toEqual(rebuilt.tools.map(toToolDeclaration));
    await runtime.dispose();
  });

  it.each([
    ["pendingSilentTurnRerun", "rerunSilentTurn", "no_output_recovery"],
    ["pendingProgressTurnRerun", "rerunProgressOnlyTurn", "progress_only_recovery"],
  ])("preserves structured system state through %s and its cleanup", async (pending, method, marker) => {
    const runtime = createRuntime();
    const internals = runtime as any;
    const agent = internals.agent as Agent;
    agent.state.messages[0] = { ...agent.state.messages[0], sections: { rules: "SECTION_MARKER" } } as any;
    const before = agent.state.systemPrompt;
    const tools = getCurrentTools(agent.state.messages);
    agent.state.messages.push({ role: "user", content: "question", timestamp: Date.now() });
    agent.state.messages.push(assistantMessage({ content: [] }) as any);
    vi.spyOn(internals, "waitForIdleAndSteering").mockResolvedValue(undefined);
    const response = assistantMessage({ content: [{ type: "text", text: "Recovered answer" }] });
    vi.spyOn(agent, "continue").mockImplementation(async () => {
      expect(agent.state.systemPrompt).toContain(marker);
      expect(agent.state.systemPrompt.split("SECTION_MARKER")).toHaveLength(2);
      expect(getCurrentSystemMessage(agent.state.messages)?.sections).toMatchObject({ rules: "SECTION_MARKER" });
      expect(getCurrentTools(agent.state.messages)).toEqual(tools);
      response.timestamp = agent.state.messages[0]!.timestamp + 10;
      agent.state.messages.push(response as any);
    });
    internals[pending] = true;

    await internals[method]();

    expect(agent.continue).toHaveBeenCalledOnce();
    expect(agent.state.systemPrompt).toBe(before);
    expect(getCurrentSystemMessage(agent.state.messages)?.sections).toMatchObject({ rules: "SECTION_MARKER" });
    expect(getCurrentTools(agent.state.messages)).toEqual(tools);
    expect(agent.state.messages.at(-1)?.timestamp).toBeGreaterThan(response.timestamp);
    await runtime.dispose();
  });
});
