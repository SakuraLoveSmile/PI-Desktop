import "./runtime-test-harness.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { expect, it, vi } from "vitest";
import { createRuntime } from "./runtime-test-harness.js";
import { teamSystemPrompt } from "../team/team-prompt.js";

it("passes shell admission diagnostics and guidance through the actual Bash tool result", async () => {
  const capacity = {
    host: { inFlight: 4, queued: 12, shellInFlight: 4, shellQueued: 12 },
    session: { inFlight: 1, queued: 2, shellInFlight: 1, shellQueued: 2 },
    holders: [{ sessionId: "busy-session", tool: "Bash", inFlight: 1 }],
  };
  const message = "host tool capacity did not become available in time; background processes and long sleep hold a shell slot; use wait_for_updates for teammate replies";
  const host = { call: vi.fn().mockResolvedValue({
    ok: false, isError: true, errorCode: "HOST_OVERLOADED",
    content: { error: message, code: "HOST_OVERLOADED", capacity },
  }) };
  const runtime = createRuntime({ host });
  try {
    const agent = (runtime as unknown as { agent: { state: { tools: AgentTool[] } } }).agent;
    const bash = agent.state.tools.find((tool) => tool.name === "Bash");
    if (!bash) throw new Error("Bash tool missing");
    expect(bash.description).toContain("Do not poll with sleep");
    const result = await bash.execute("capacity-call", { command: "printf fixture" });
    expect(result).toMatchObject({ isError: true });
    const output = result.content.find((block) => block.type === "text");
    if (!output || output.type !== "text") throw new Error("Bash result text missing");
    expect(JSON.parse(output.text)).toEqual({ error: message, code: "HOST_OVERLOADED", capacity });
    expect(host.call).toHaveBeenCalledWith("tools.execute", expect.objectContaining({ toolName: "Bash" }));
  } finally {
    await runtime.dispose();
  }
});

it.each([{ isLead: true }, { isLead: false, memberName: "builder" }])(
  "execution Team prompts guide $isLead away from shell polling", (options) => {
    const prompt = teamSystemPrompt(options);
    expect(prompt).toContain("Do not poll with sleep");
    expect(prompt).toContain("wait_for_updates");
    expect(prompt).toContain("background");
  },
);

it("keeps shell guidance out of read-only researcher instructions", () => {
  const prompt = teamSystemPrompt({ isLead: false, workPurpose: "plan_research" });
  expect(prompt).toContain("Never run shell");
  expect(prompt).not.toContain("run long commands in the background");
});
