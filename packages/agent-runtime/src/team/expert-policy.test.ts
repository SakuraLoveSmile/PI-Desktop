import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream, getCurrentTools, getCurrentSystemPrompt, type AssistantMessage, type Context, type JsonObject, type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExpertTeamConfigSnapshot, TeamRuntimeContextProjection, UiMessage } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import { expertToolDenial } from "./expert-policy.js";
import { teamSystemPrompt } from "./team-prompt.js";
import { createTeamTools } from "./team-tools.js";
import type { RuntimeHost } from "../host-client.js";

type RequestedCall = { name: string; arguments?: JsonObject };

function fixture(options: {
  config?: ExpertTeamConfigSnapshot;
  calls: RequestedCall[];
  purpose?: TeamRuntimeContextProjection["workPurpose"];
  history?: UiMessage[];
  permissionDenied?: boolean;
}) {
  const requests: Context[] = [];
  const executed: string[] = [];
  const rows = structuredClone(options.history ?? []);
  const host: RuntimeHost = { call: async <T>(method: string, params?: unknown): Promise<T> => {
    if (method === "tools.execute") {
      executed.push((params as { toolName: string }).toolName);
      return { ok: !options.permissionDenied, denied: options.permissionDenied,
        content: options.permissionDenied ? "Permission denied" : "Verified fixture source" } as T;
    }
    if (method === "team.sendMessage") return { message: { id: "result-message", status: "queued" } } as T;
    if (method === "session.appendMessage") rows.push((params as { message: UiMessage }).message);
    else if (method !== "session.updateCompaction") throw new Error(`Unexpected Host method: ${method}`);
    return undefined as T;
  } };
  const runtime = new DesktopAgentRuntime({
    host, sessionId: "expert", mode: "agent", executionProfile: "team",
    teamContext: { teamSessionId: "lead", callerSessionId: "expert", isLead: false,
      memberName: "QA", workPurpose: options.purpose ?? "execute", expertConfig: options.config },
    provider: { id: "fixture", name: "Fixture", baseUrl: "http://fixture.invalid/v1", modelId: "fixture-model",
      apiKey: "", authKind: "none", supportsReasoning: false, supportedThinkingLevels: ["off"] },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    thinkingLevel: "off", history: rows,
    pluginTools: [{ name: "plugin_probe", description: "External plugin fixture", risk: "low",
      parameters: { type: "object", properties: {}, required: [] } }],
    onEvent: ({ event }) => {
      if (event.type === "tool_start") rows.push({ id: event.toolCallId, role: "tool", content: "",
        toolCallId: event.toolCallId, toolName: event.toolName, toolArgs: event.args, createdAt: "2026-10-08T00:00:00.000Z" });
      if (event.type === "tool_end") {
        const row = rows.find(row => row.id === event.toolCallId);
        if (row) { row.toolResult = event.result; row.isError = event.isError; }
      }
      if (event.type === "message_end") {
        const index = rows.findIndex(row => row.id === event.message.id);
        if (index < 0) rows.push(event.message); else rows[index] = event.message;
      }
    },
  });
  let round = 0;
  const streamSimple = (_model: unknown, context: Context) => {
    requests.push({ ...context, messages: [...context.messages] });
    const requested = options.calls[round++];
    const call: ToolCall | undefined = requested
      ? { type: "toolCall", id: `${options.config?.presetId ?? "legacy"}-call-${round}`, name: requested.name, arguments: requested.arguments ?? {} }
      : undefined;
    const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture-model",
      content: call ? [call] : [{ type: "text", text: "Expert task finished." }],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: call ? "toolUse" : "stop", timestamp: round };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
      stream.end(message);
    });
    return stream;
  };
  // Only provider I/O is replaced: declarations, dispatch, policy, Host
  // forwarding and history recovery use the real runtime.
  (runtime as unknown as { models: { streamSimple: typeof streamSimple } }).models = { streamSimple };
  return { runtime, requests, executed, rows, prompt: () => runtime.prompt("Inspect the assigned source and report findings.", "request", "turn") };
}

describe("Host-snapshotted expert policy", () => {
  it("preserves legacy inheritance and treats an explicit empty subset as no work tools", () => {
    for (const name of ["Read", "Write", "plugin_probe", "mcp_probe"]) {
      expect(expertToolDenial(undefined, name)).toBeUndefined();
      expect(expertToolDenial({ presetId: "qa" }, name)).toBeUndefined();
      expect(expertToolDenial({ presetId: "qa", tools: [] }, name)).toContain("Host-approved");
    }
    expect(expertToolDenial({ presetId: "qa", tools: ["plugin_probe"] }, "plugin_probe")).toBeDefined();
    for (const name of ["send_message", "task_get", "submit_research_result", "SubmitGoalReport", "asktool"]) {
      expect(expertToolDenial({ presetId: "qa", tools: [] }, name)).toBeUndefined();
    }
    expect(expertToolDenial({ presetId: "qa", tools: [] }, "send_message_external")).toBeDefined();
  });

  it("appends member instructions without replacing Team and research constraints", () => {
    const config: ExpertTeamConfigSnapshot = { presetId: "fullstack", instructions: "Inspect repository invariants first." };
    const prompt = teamSystemPrompt({ isLead: false, workPurpose: "plan_research", expertConfig: config });
    expect(prompt).toContain("Read, Glob and Grep only");
    expect(prompt).toContain("submit_research_result");
    expect(prompt).toContain(config.instructions);
    expect(prompt).toContain("never override read-only modes");
    expect(teamSystemPrompt({ isLead: true, expertConfig: config })).not.toContain(config.instructions);
  });

  it("offers all six optional presets and forwards the choice through the real declaration tool", async () => {
    const received: unknown[] = [];
    const host: RuntimeHost = { call: async <T>(_method: string, params?: unknown): Promise<T> => {
      received.push(params); return { decision: { strategy: "delegate", memberSessionIds: [] }, review: null } as T;
    } };
    const tool = createTeamTools({ host, teamSessionId: "lead", callerSessionId: "lead", isLead: true,
      getTurnId: () => "lead-turn" }).find(tool => tool.name === "declare_team_strategy");
    if (!tool) throw new Error("Missing strategy tool");
    const schema = JSON.stringify(tool.parameters);
    for (const presetId of ["researcher", "fullstack", "qa", "reviewer", "ui", "debugger"]) expect(schema).toContain(`"const":"${presetId}"`);
    expect(schema).not.toContain('"expertConfig"');
    await tool.execute("declare", { strategy: "delegate", reason: "Independent verification", members: [{ name: "qa", presetId: "qa" }] });
    expect(received).toEqual([expect.objectContaining({ members: [{ name: "qa", presetId: "qa" }] })]);
    await tool.execute("legacy", { strategy: "delegate", reason: "Generic specialist", members: [{ name: "legacy" }] });
    expect(received[1]).toMatchObject({ members: [{ name: "legacy" }] });
  });

  it("runs configured inspection, refuses omitted work tools and reports through the Team mailbox", async () => {
    const f = fixture({ config: { presetId: "qa", tools: ["Read"], instructions: "Record verified source locations." }, calls: [
      { name: "Read", arguments: { path: "src/fixture.ts" } },
      { name: "Write", arguments: { path: "src/fixture.ts", content: "denied" } },
      { name: "send_message", arguments: { targetMemberName: "Lead", content: "Verified source findings" } },
    ] });
    try {
      await f.prompt();
      expect(f.executed).toEqual(["Read"]);
      expect(getCurrentTools(f.requests[0].messages).map(tool => tool.name)).toContain("Read");
      expect(getCurrentTools(f.requests[0].messages).map(tool => tool.name)).not.toContain("Write");
      expect(getCurrentSystemPrompt(f.requests[0].messages)).toContain("Record verified source locations.");
      const results = f.requests.at(-1)?.messages.filter(message => message.role === "toolResult");
      expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "Write", isError: true }),
        expect.objectContaining({ toolName: "send_message", isError: false })]));
    } finally { await f.runtime.dispose(); }
  });

  it("does not revive legacy plugin activation when restarted with an explicit snapshot", async () => {
    const legacy = fixture({ calls: [{ name: "ToolSearch", arguments: { query: "plugin_probe" } }, { name: "plugin_probe" }] });
    try { await legacy.prompt(); expect(legacy.executed).toEqual(["plugin_probe"]); }
    finally { await legacy.runtime.dispose(); }
    const resumed = fixture({ history: legacy.rows, config: { presetId: "reviewer", tools: ["Read"] }, calls: [
      { name: "ToolSearch", arguments: { query: "plugin_probe" } }, { name: "plugin_probe" },
    ] });
    try {
      await resumed.prompt();
      expect(resumed.executed).toEqual([]);
      expect(resumed.requests.every(request => !getCurrentTools(request.messages).some(tool => tool.name === "plugin_probe"))).toBe(true);
    } finally { await resumed.runtime.dispose(); }
  });

  it("keeps Plan research read-only even when the preset permits shell and writes", async () => {
    const f = fixture({ purpose: "plan_research", config: { presetId: "fullstack", tools: ["Read", "Bash", "Write"] }, calls: [
      { name: "Bash", arguments: { command: "echo blocked" } }, { name: "Read", arguments: { path: "src/fixture.ts" } },
    ] });
    try {
      await f.prompt(); expect(f.executed).toEqual(["Read"]);
      const names = getCurrentTools(f.requests[0].messages).map(tool => tool.name);
      expect(names).not.toContain("Bash"); expect(names).not.toContain("Write"); expect(names).toContain("submit_research_result");
    } finally { await f.runtime.dispose(); }
  });

  it("never turns configured tool inclusion into a Host permission grant", async () => {
    const f = fixture({ permissionDenied: true, config: { presetId: "qa", tools: ["Read"] }, calls: [{ name: "Read", arguments: { path: "private.ts" } }] });
    try {
      await f.prompt(); expect(f.executed).toEqual(["Read"]);
      expect(JSON.stringify(f.requests.at(-1)?.messages)).toContain("Permission denied");
    } finally { await f.runtime.dispose(); }
  });
});
