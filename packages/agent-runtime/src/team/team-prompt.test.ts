import { describe, expect, it } from "vitest";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, PlanExecution } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import type { RuntimeHost } from "../host-client.js";
import { teamSystemPrompt } from "./team-prompt.js";

describe("Expert Team reliability guidance", () => {
  it.each([
    { isLead: true, mode: "agent" },
    { isLead: false, mode: "agent", memberName: "builder", workPurpose: "execute" as const },
  ])("bounds verification and shell use for execution participants ($isLead)", (options) => {
    const prompt = teamSystemPrompt(options);
    expect(prompt).toContain("Do not poll with sleep");
    expect(prompt).toContain("Waiting with a foreground sleep also holds a shell slot");
    expect(prompt).toContain("Long-lived background services require an explicit timeout");
    expect(prompt).toContain("timed_out is a timeout, not proof of a crash");
    expect(prompt).toContain("Never use nohup");
    expect(prompt).toContain("Revalidate only tests relevant to the diff");
    expect(prompt).toContain("Assign any full test suite to one participant only");
    expect(prompt).toContain("two attempts based on different evidence");
    expect(prompt).toContain("stop blind retries and report");
    expect(prompt).toContain("Never run git add -A or git stash in a shared working tree");
  });

  it.each(["agent", "plan"])("uses Host activity and consumed reports before lead reassignment (%s)", (mode) => {
    const prompt = teamSystemPrompt({ isLead: true, mode });
    expect(prompt).toContain("Host-backed member phase in team_status and available Host turn/background-process records");
    expect(prompt).toContain("Git commits and file changes are not liveness evidence");
    expect(prompt).toContain("Do not interrupt or replace a member merely because no activity is visible");
    expect(prompt).toContain("Before replacing a member or redispatching work, consume unread expert messages");
    expect(prompt).toContain("A pending-message summary is not the report body");
  });

  it("preserves read-only research and trusted expert instructions", () => {
    const prompt = teamSystemPrompt({ isLead: false, workPurpose: "plan_research",
      expertConfig: { presetId: "researcher", instructions: "Record verified source locations." } });
    expect(prompt).toContain("Read, Glob and Grep only");
    expect(prompt).toContain("Never run shell");
    expect(prompt).not.toContain("Long-lived background services");
    expect(prompt).not.toContain("Revalidate only tests");
    expect(prompt).toContain("never override read-only modes");
    expect(prompt).toContain("Record verified source locations.");
  });

  it("limits queued-report turn-boundary instructions to ordinary Agent execution", () => {
    const prompt = teamSystemPrompt({ isLead: true, mode: "agent" });
    expect(prompt).toContain("In an ordinary Agent Lead turn outside approved Plan/Goal execution");
    expect(prompt).toContain("report bodies arrive in authenticated continuations after you finish the current turn");
    expect(prompt).toContain("pending_mailbox_messages");
    expect(prompt).toContain("During approved Plan/Goal execution");
    expect(prompt).toContain("do not end that execution turn merely to receive reports");
    expect(prompt).toContain("Do not redo delegated work already confirmed complete");
    expect(prompt).toContain("explain the specific reason for independent verification before starting it");
    expect(prompt).toContain("list commands you launched separately from commands experts launched");
    expect(prompt).toContain("Base retry and file-write claims on tool/Host records");
  });

  it("preserves ordinary Plan yield without Agent execution guidance", () => {
    const prompt = teamSystemPrompt({ isLead: true, mode: "plan", workPurpose: "plan_research" });
    expect(prompt).toContain("wait_for_updates normally ends this aggregation turn");
    expect(prompt).toContain("SubmitPlan defers normally until those messages are consumed");
    expect(prompt).not.toContain("In an ordinary Agent Lead turn");
    expect(prompt).not.toContain("do not end that execution turn");
  });

  it.each(["plan", "goal"] as const)("keeps same-turn inbox guidance in actual approved %s provider requests", async (kind) => {
    const requests: Context[] = [];
    const inboxReads: unknown[] = [];
    const events: AgentEventEnvelope["event"][] = [];
    const host: RuntimeHost = { call: async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === "team.readExecutionInbox") {
        inboxReads.push(params);
        return { turnId: "approved-turn", messages: [{ id: "expert-result", content: "Expert finished the assigned verification.",
          sourceSessionId: "expert", sourceMemberName: "tester" }] } as T;
      }
      if (method === "team.getLeadExecutionState") return { active: true, turnId: "approved-turn", reviewStatus: "confirmed" } as T;
      if (method === "team.getLaunchReview") return { review: null } as T;
      if (method === "team.authorizeLeadTool") return { authorized: true } as T;
      if (method === "goalProgress.issueToken") return { writeToken: "fixture-goal-token" } as T;
      if (method === "goalReports.submitDraft") return undefined as T;
      if (method === "session.appendMessage" || method === "session.updateCompaction") return undefined as T;
      throw new Error(`Unexpected Host method: ${method}`);
    } };
    const runtime = new DesktopAgentRuntime({ host, sessionId: "lead", mode: "plan", executionProfile: "team",
      teamContext: { teamSessionId: "lead", callerSessionId: "lead", isLead: true, workPurpose: "execute" },
      provider: { id: "fixture", name: "Fixture", baseUrl: "http://fixture.invalid/v1", modelId: "fixture-model",
        apiKey: "", authKind: "none", supportsReasoning: false, supportedThinkingLevels: ["off"] },
      commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
      thinkingLevel: "off", onEvent: ({ event }) => events.push(event) });
    const streamSimple = (_model: unknown, context: Context) => {
      requests.push({ ...context, messages: [...context.messages] });
      const first = requests.length === 1;
      const report = kind === "goal" && requests.length === 2;
      const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture-model",
        content: first ? [{ type: "toolCall", id: "receive-report", name: "wait_for_updates", arguments: {} }]
          : report ? [{ type: "toolCall", id: "submit-goal-report", name: "SubmitGoalReport",
            arguments: { summary: "Expert verification completed without Lead repetition.", verdict: "met" } }]
          : [{ type: "text", text: "The expert verification completed. Lead commands: none. Expert commands: none in this prompt-only fixture." }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: first || report ? "toolUse" : "stop", timestamp: requests.length };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: first || report ? "toolUse" : "stop", message }); stream.end(message); });
      return stream;
    };
    // Replace only the provider boundary; approved startup, mode switching,
    // prompt composition, Team tools and completion use the real runtime.
    (runtime as unknown as { models: { streamSimple: typeof streamSimple } }).models = { streamSimple };
    const execution: PlanExecution = { id: `approved-${kind}`, proposalId: "plan-proposal", sessionId: "lead", kind,
      plan: "# Approved\nConsume the expert verification without rerunning it.", title: "Verify expert result", question: "Proceed?",
      artifact: { relativePath: ".pi/plan/approved.md", sha256: "a".repeat(64), sizeBytes: 64 },
      targetPermissionMode: "auto", state: "running" };
    try {
      await runtime.executeApprovedPlan(execution, "approved-turn");
      expect(requests).toHaveLength(kind === "goal" ? 3 : 2);
      const prompt = getCurrentSystemPrompt(requests[0].messages);
      expect(prompt).toContain("During approved Plan/Goal execution");
      expect(prompt).toContain("either call wait_for_updates");
      expect(prompt).toContain("or end your message");
      expect(prompt).not.toContain("Explain the proposed experts and stop for trusted user roster confirmation");
      expect(prompt).toContain("do not end that execution turn merely to receive reports");
      expect(prompt).not.toContain("wait_for_updates normally ends this aggregation turn");
      expect(inboxReads).toEqual([{ teamSessionId: "lead", callerSessionId: "lead", expectedTurnId: "approved-turn" }]);
      expect(JSON.stringify(requests[1].messages)).toContain("Expert finished the assigned verification.");
      expect(events.filter(event => event.type === "error")).toEqual([]);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
      // Reuse the no-project/no-extension/no-subagent runtime: no incidental
      // prompt rebuild may mask a stale approved-execution prompt.
      await runtime.prompt("Explain an ordinary Team request", "ordinary-user", "ordinary-turn");
      const ordinaryPrompt = getCurrentSystemPrompt(requests.at(-1)!.messages);
      expect(ordinaryPrompt).toContain("Explain the proposed experts and stop for trusted user roster confirmation");
      expect(ordinaryPrompt).not.toContain("or end your message");
    } finally { await runtime.dispose(); }
  });
});
