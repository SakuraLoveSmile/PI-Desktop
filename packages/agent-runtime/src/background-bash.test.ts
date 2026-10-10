import { createServer, type ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "./runtime.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
});

type InputItem = {
  type?: string;
  role?: string;
  name?: string;
  call_id?: string;
  output?: unknown;
  content?: unknown;
};
type ProviderRequest = {
  tools: Array<{
    name?: string;
    parameters?: { properties?: Record<string, { type?: string }>; required?: string[] };
  }>;
  input: InputItem[];
};
type HostCall = { method: string; params: unknown };

const command = "printf fixture";
const accepted = {
  backgroundProcessId: "process1",
  status: "starting",
  message: "Background process accepted. Read its output and terminal status through the background process manager.",
};
const finalText = "The command was accepted. Its eventual exit status is reported separately.";

function respond(res: ServerResponse, args?: Record<string, unknown>) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (data: { type: string; [key: string]: unknown }) => {
    res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send({ type: "response.created", response: { id: "resp_background_fixture" } });
  const item = args
    ? { id: "fc_bash", type: "function_call", call_id: "call_bash", name: "Bash", arguments: JSON.stringify(args), status: "completed" }
    : { id: "msg_final", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: finalText, annotations: [] }] };
  send({ type: "response.output_item.added", output_index: 0, item: args
    ? { ...item, arguments: "", status: "in_progress" }
    : { ...item, content: [], status: "in_progress" } });
  send(args
    ? { type: "response.function_call_arguments.delta", output_index: 0, delta: JSON.stringify(args) }
    : { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: finalText });
  send({ type: "response.output_item.done", output_index: 0, item });
  send({ type: "response.completed", response: {
    id: "resp_background_fixture", status: "completed", output: [item],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  } });
  res.end();
}

async function fixture(args: Record<string, unknown>) {
  const requests: ProviderRequest[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    requests.push(JSON.parse(raw) as ProviderRequest);
    respond(res, requests.length === 1 ? args : undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const provider: RuntimeProviderConfig = {
    id: "fixture", name: "Fixture", baseUrl, modelId: "fixture", apiKey: "fixture-not-real", apiStyle: "responses",
    supportsReasoning: false, supportedThinkingLevels: ["off"],
    modelConfig: { source: "generic", name: "Fixture", baseUrl, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 2000 },
  };
  const events: AgentEventEnvelope[] = [];
  const calls: HostCall[] = [];
  let outputSubscriptions = 0;
  const runtime = new DesktopAgentRuntime({
    sessionId: "background-fixture", mode: "agent", provider, history: [], thinkingLevel: "off",
    compactionSettings: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    host: {
      call: async <T>(method: string, params?: unknown): Promise<T> => {
        calls.push({ method, params });
        if (method === "session.appendMessage") return undefined as T;
        if (method !== "tools.execute") throw new Error(`Unexpected host action: ${method}`);
        const execution = params as { args: { run_in_background?: unknown } };
        const content = execution.args.run_in_background === true ? accepted : "fixture";
        return { toolCallId: "call_bash|fc_bash", ok: true, isError: false, content, durationMs: 0, denied: false,
          commandShellId: "bash" } as T;
      },
      onNotification: () => {
        outputSubscriptions++;
        return () => { outputSubscriptions--; };
      },
    },
    onEvent: (event) => { events.push(event); },
  });
  const pending = runtime.prompt("Run the fixture command, then report whether it was accepted.");
  void pending.catch(() => undefined);
  cleanups.push(async () => { await runtime.dispose(); await pending.catch(() => undefined); });
  await pending;
  return { requests, events, calls, runtime, outputSubscriptions: () => outputSubscriptions };
}

it.each([
  ["omitted", { command }, { command }],
  ["false", { command, run_in_background: false }, { command, run_in_background: false }],
  ["true", { command, run_in_background: true }, { command, run_in_background: true }],
  ["string true follows existing Pi boolean conversion", { command, run_in_background: "true" }, { command, run_in_background: true }],
] as const)("Bash background flag %s preserves the Host payload and paired provider result", async (_label, args, expectedArgs) => {
  const f = await fixture(args);
  expect(f.requests).toHaveLength(2);
  const bash = f.requests[0].tools.find((tool) => tool.name === "Bash");
  expect(bash?.parameters?.properties?.run_in_background).toMatchObject({ type: "boolean" });
  expect(bash?.parameters?.required ?? []).not.toContain("run_in_background");
  expect(f.calls.filter((call) => call.method === "tools.execute")).toEqual([{
    method: "tools.execute",
    params: {
      sessionId: "background-fixture", turnId: expect.any(String), toolCallId: "call_bash|fc_bash", toolName: "Bash",
      args: expectedArgs, mode: "agent", expectedCommandShellId: "bash", expectedCommandShellDialect: "posix", timeoutMs: 60000,
    },
  }]);
  expect(f.requests[1].input.filter((item) => item.type === "function_call" && item.call_id === "call_bash"))
    .toMatchObject([{ name: "Bash" }]);
  const outputs = f.requests[1].input.filter((item) => item.type === "function_call_output" && item.call_id === "call_bash");
  expect(outputs).toHaveLength(1);
  if ("run_in_background" in expectedArgs && expectedArgs.run_in_background === true) {
    expect(outputs[0].output).toEqual(JSON.stringify(accepted, null, 2));
    expect(outputs[0].output).not.toContain("exitCode");
  } else expect(outputs[0].output).toBe("fixture");
  expect(JSON.stringify(f.requests[1].input.filter((item) => item.role === "user")))
    .toBe(JSON.stringify(f.requests[0].input.filter((item) => item.role === "user")));
  expect(f.events.find((event) => event.event.type === "tool_end")?.event).toMatchObject({ type: "tool_end", isError: false });
  expect(f.events.some((event) => event.event.type === "error")).toBe(false);
  expect(f.events.some((event) => event.event.type === "agent_end")).toBe(true);
  expect(f.events.some(({ event }) => event.type === "message_end"
    && event.message.role === "assistant" && event.message.content === finalText)).toBe(true);
  expect(f.runtime.getStatus().isRunning).toBe(false);
  expect(f.outputSubscriptions()).toBe(0);
  // Once the Host accepts the start, ending or disposing the Agent turn must
  // not cancel the independent Host-owned background process.
  await f.runtime.abort();
  await f.runtime.dispose();
  expect(f.calls.filter((call) => call.method !== "session.appendMessage").map((call) => call.method))
    .toEqual(["tools.execute"]);
  expect(f.outputSubscriptions()).toBe(0);
});

it("rejects an unconvertible string background flag before Host execution and returns a paired tool error", async () => {
  const f = await fixture({ command, run_in_background: "yes" });
  expect(f.requests).toHaveLength(2);
  expect(f.calls.filter((call) => call.method !== "session.appendMessage")).toEqual([]);
  expect(f.requests[1].input.filter((item) => item.type === "function_call" && item.call_id === "call_bash"))
    .toMatchObject([{ name: "Bash" }]);
  const outputs = f.requests[1].input.filter((item) => item.type === "function_call_output" && item.call_id === "call_bash");
  expect(outputs).toHaveLength(1);
  expect(outputs[0].output).toContain("run_in_background");
  expect(outputs[0].output).toContain("boolean");
  expect(f.events.find((event) => event.event.type === "tool_end")?.event).toMatchObject({ type: "tool_end", isError: true });
  expect(f.events.some((event) => event.event.type === "error")).toBe(false);
  expect(f.events.some((event) => event.event.type === "agent_end")).toBe(true);
  expect(f.runtime.getStatus().isRunning).toBe(false);
  expect(f.outputSubscriptions()).toBe(0);
});
