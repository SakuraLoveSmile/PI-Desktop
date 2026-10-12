import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "./runtime.js";

it("captures the actual local provider body after extension request rewriting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-context-wire-"));
  const entry = join(dir, "extension.ts");
  await writeFile(entry, `export default function (pi) {
    pi.on("before_provider_request", ({ payload }) => ({ ...payload,
      messages: [...payload.messages, { role: "user", content: "After extension hook" }],
      api_key: "fixture-not-a-real-credential"
    }));
  }`);
  let body: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    let content = ""; for await (const chunk of request) content += String(chunk);
    body = JSON.parse(content) as Record<string, unknown>;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const events: AgentEventEnvelope[] = [];
  const runtime = new DesktopAgentRuntime({
    host: { call: async () => ({}), onNotification: () => () => {} } as never,
    sessionId: "wire-test", projectPath: dir, mode: "agent", thinkingLevel: "off",
    provider: { id: "fixture", name: "Fixture", apiKey: "", authKind: "none", baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId: "fixture", supportsReasoning: false, supportedThinkingLevels: ["off"] },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    trustedExtensions: [{ id: entry, entry, label: "Fixture", root: dir, source: "plugin" }],
    onEvent: event => events.push(event),
  });
  try {
    await runtime.loadTrustedExtensions();
    await runtime.prompt("Original prompt");
    const captured = events.filter(envelope => envelope.event.type === "context_insights").flatMap(envelope => envelope.event.type === "context_insights" && envelope.event.request ? [envelope.event.request] : []);
    expect(captured.map(request => request.captureSource)).toEqual(["pi-context", "provider-payload", "provider-payload"]);
    const completed = captured.at(-1)!;
    expect(completed.status).toBe("completed");
    expect(completed.providerStatus).toBe(200);
    expect(completed.usage?.operationId).toBe(completed.id);
    expect(completed.contentRevision).toBe(1);
    expect(JSON.stringify(body?.messages)).toContain("After extension hook");
    expect(JSON.parse(completed.providerPayload!.content).messages).toEqual(body?.messages);
    expect(completed.providerPayload!.content).not.toContain("fixture-not-a-real-credential");
    expect(completed.providerPayload!.redacted).toBe(true);
  } finally {
    await runtime.dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
