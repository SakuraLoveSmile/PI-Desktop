import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { type UiMessage } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime deferred tool restore (#225)", () => {

  const now = () => new Date().toISOString();

  const searchRow = (overrides: Partial<UiMessage> = {}): UiMessage => ({
    id: "tool-search-1",
    role: "tool",
    content: "",
    createdAt: now(),
    status: "complete",
    toolName: "ToolSearch",
    toolCallId: "call-search-1",
    toolStatus: "success",
    toolArgs: { query: "BrowserPreview" },
    toolResult: {
      content: [{ type: "text", text: "Activated on-demand tools: BrowserPreview." }],
      details: {
        addedToolNames: ["BrowserPreview"],
      },
    },
    ...overrides,
  });

  const assistantRow: UiMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "Loading the preview tool.",
    createdAt: now(),
    status: "complete",
  };

  const hasTool = (runtime: DesktopAgentRuntime, name: string) =>
    (runtime as any).agent.state.tools.some((tool: any) => tool.name === name);

  it("keeps a tool active across prompts while its ToolSearch activation is in context", async () => {
    const runtime = createRuntime({ history: [assistantRow, searchRow()] });

    (runtime as any).resetDeferredToolsForPrompt();

    expect(hasTool(runtime, "BrowserPreview")).toBe(true);
    await runtime.dispose();
  });

  it("keeps an activated tool sticky across prompts after its activation rows leave the context (#1225)", async () => {
    // The tool was activated and used earlier in the session, but those rows
    // have since fallen out of the visible context (compaction, long turns).
    // The prompt-time restore finds nothing to reactivate, so sticky
    // activation is what keeps the tool in the schema and prevents the
    // intermittent "Tool BrowserPreview not found" 0 ms rejection.
    const runtime = createRuntime({ history: [] });
    (runtime as any).activeDeferredToolNames.add("BrowserPreview");

    (runtime as any).resetDeferredToolsForPrompt();

    expect(hasTool(runtime, "BrowserPreview")).toBe(true);
    await runtime.dispose();
  });

  it("does not resurrect a sticky activation after the catalog prunes the tool", async () => {
    // rebuildToolCatalog prunes both sets when a tool leaves the catalog
    // (mode switch, extension reload); the prompt-time restore must not
    // re-add a name the catalog no longer holds.
    const runtime = createRuntime({ history: [] });
    (runtime as any).activeDeferredToolNames.add("BrowserPreview");
    (runtime as any).deferredToolNames.delete("BrowserPreview");
    (runtime as any).activeDeferredToolNames.delete("BrowserPreview");

    (runtime as any).resetDeferredToolsForPrompt();

    expect(hasTool(runtime, "BrowserPreview")).toBe(false);
    await runtime.dispose();
  });

  it("restores legacy activation markers for an unused tool", async () => {
    const fixtures: Array<{ details: Record<string, unknown>; addedToolNames?: string[] }> = [
      { details: { activated: ["BrowserPreview"] } },
      { details: { activated: [] }, addedToolNames: ["BrowserPreview"] },
    ];

    for (const [index, fixture] of fixtures.entries()) {
      const runtime = createRuntime({
        history: [
          assistantRow,
          searchRow({
            id: `tool-search-legacy-${index}`,
            toolCallId: `call-search-legacy-${index}`,
            toolResult: {
              content: [{ type: "text", text: "Activated on-demand tools: BrowserPreview." }],
              details: fixture.details,
              ...(fixture.addedToolNames
                ? { addedToolNames: fixture.addedToolNames }
                : {}),
            },
          }),
        ],
      });

      (runtime as any).resetDeferredToolsForPrompt();
      expect(hasTool(runtime, "BrowserPreview")).toBe(true);
      await runtime.dispose();
    }
  });

  it("restores all activated tools when only some have been called", async () => {
    const runtime = createRuntime({
      history: [
        assistantRow,
        searchRow({
          toolResult: {
            content: [{ type: "text", text: "Activated on-demand tools: BrowserPreview, PluginCheck." }],
            details: {
              addedToolNames: ["BrowserPreview", "PluginCheck"],
            },
          },
        }),
        {
          id: "tool-preview-ok",
          role: "tool",
          content: "",
          createdAt: now(),
          status: "complete",
          toolName: "BrowserPreview",
          toolCallId: "call-preview-ok",
          toolStatus: "success",
          toolArgs: {},
          toolResult: { content: [{ type: "text", text: "opened" }] },
        },
      ],
    });

    (runtime as any).resetDeferredToolsForPrompt();
    expect(hasTool(runtime, "BrowserPreview")).toBe(true);
    expect(hasTool(runtime, "PluginCheck")).toBe(true);
    await runtime.dispose();
  });

  it("restores a tool from its own successful result, not from failed or empty rows", async () => {
    const runtime = createRuntime({
      history: [
        assistantRow,
        searchRow({ id: "tool-search-failed", toolCallId: "call-failed", toolStatus: "error" }),
        {
          id: "tool-preview-empty",
          role: "tool",
          content: "",
          createdAt: now(),
          status: "complete",
          toolName: "BrowserPreview",
          toolCallId: "call-preview-empty",
          toolStatus: "success",
          toolArgs: {},
        },
      ],
    });

    (runtime as any).resetDeferredToolsForPrompt();
    expect(hasTool(runtime, "BrowserPreview")).toBe(false);

    (runtime as any).fullEntries.push(
      ...(createRuntime({
        history: [
          assistantRow,
          {
            id: "tool-preview-ok",
            role: "tool",
            content: "",
            createdAt: now(),
            status: "complete",
            toolName: "BrowserPreview",
            toolCallId: "call-preview-ok",
            toolStatus: "success",
            toolArgs: {},
            toolResult: { content: [{ type: "text", text: "opened" }] },
          },
        ],
      }) as any).fullEntries,
    );
    (runtime as any).resetDeferredToolsForPrompt();
    expect(hasTool(runtime, "BrowserPreview")).toBe(true);
    await runtime.dispose();
  });

  it("restores the activation again after a mode round trip", async () => {
    const runtime = createRuntime({ history: [assistantRow, searchRow()] });
    (runtime as any).resetDeferredToolsForPrompt();
    expect(hasTool(runtime, "BrowserPreview")).toBe(true);

    runtime.setMode("plan");
    runtime.setMode("agent");

    expect(hasTool(runtime, "BrowserPreview")).toBe(true);
    await runtime.dispose();
  });
});
