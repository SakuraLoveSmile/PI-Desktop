import { expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

it.each([
  ["team", true, "agent", 2],
  ["team", true, "plan", 2],
  ["team", false, "agent", 1],
  ["standard", true, "agent", 1],
] as const)("retries a pseudo call only once through real %s Lead=%s %s runtime events", async (executionProfile, isLead, mode, count) => {
  const events: AgentEventEnvelope["event"][] = [];
  const prompts: string[] = [];
  const host = { call: vi.fn(async (method: string) => method === "team.getLaunchReview"
    ? { review: null } : method === "team.authorizeLeadTool" ? { authorized: true } : undefined) };
  const runtime = createRuntime({ host, mode, executionProfile,
    teamContext: { teamSessionId: "session-1", callerSessionId: isLead ? "session-1" : "member", isLead },
    onEvent: envelope => events.push((envelope as AgentEventEnvelope).event),
  });
  const view = runtime as unknown as { models: Pick<Models, "streamSimple"> };
  const text = "...!call:default_api:ProjectHistory{action:search,query:只要有 remote_file_id}";
  view.models = { streamSimple: (_model, context) => {
    prompts.push(JSON.stringify(context.messages.filter(message => message.role === "system")));
    const message = assistantMessage({ content: [{ type: "text", text }] }) as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    });
    return stream;
  } };
  try {
    await runtime.prompt("Continue the approved expert work.", "user-1");
    expect(prompts).toHaveLength(count);
    expect(prompts[0]).not.toContain("<pseudo_tool_call_recovery>");
    if (count === 2) {
      expect(prompts[1]).toContain("<pseudo_tool_call_recovery>");
      expect(host.call.mock.calls.filter(([method]) => method === "team.authorizeLeadTool")).toHaveLength(1);
    }
    expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
    expect(events.filter(event => event.type === "message_end" && event.message.status === "complete"))
      .toEqual([expect.objectContaining({ message: expect.objectContaining({ content: text }) })]);
    expect(events.some(event => event.type === "error")).toBe(false);
  } finally { await runtime.dispose(); }
});
