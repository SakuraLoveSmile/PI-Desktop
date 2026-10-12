import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { toolResultFromUi } from "../runtime.js";
import { createRuntime } from "./runtime-test-harness.js";

describe("toolResultFromUi image restoration (issue #1073)", () => {

  const timestamp = 1;

  it("restores a host Read image result as real image content blocks", () => {
    const row = {
      id: "call-1",
      role: "tool" as const,
      content: "",
      createdAt: new Date(timestamp).toISOString(),
      toolCallId: "call-1",
      toolName: "Read",
      // Host tool_read returns a top-level images array, not content blocks.
      toolResult: {
        path: "shot.png",
        text: "Image file shot.png (17 bytes, image/png); the image is attached to this result.",
        images: [{ data: "cG5nLWJ5dGVz", mimeType: "image/png" }],
      },
      toolStatus: "success" as const,
      isError: false,
    };
    const restored = toolResultFromUi(row, timestamp);
    expect(restored.content).toEqual([
      { type: "text", text: expect.stringContaining("shot.png") },
      { type: "image", data: "cG5nLWJ5dGVz", mimeType: "image/png" },
    ]);
  });

  it("drops malformed image entries instead of failing the restore", () => {
    const row = {
      id: "call-2",
      role: "tool" as const,
      content: "",
      createdAt: new Date(timestamp).toISOString(),
      toolCallId: "call-2",
      toolName: "Read",
      toolResult: {
        path: "broken.png",
        images: [{ data: 42 }, "not-an-object", { data: "ok", mimeType: 7 }],
      },
      toolStatus: "success" as const,
      isError: false,
    };
    const restored = toolResultFromUi(row, timestamp);
    expect(restored.content).toEqual([{ type: "text", text: expect.stringContaining("broken.png") }]);
  });

  it("restores a bare plugin content-block array without flattening it to JSON (#1360)", () => {
    const row = {
      id: "call-3",
      role: "tool" as const,
      content: "",
      createdAt: new Date(timestamp).toISOString(),
      toolCallId: "call-3",
      toolName: "plugin_shot",
      // A plugin tool returned a bare content-block array rather than an
      // object with `content` or a top-level `images` field.
      toolResult: [
        { type: "text", text: "here is the screenshot" },
        { type: "image", data: "cG5nLWJ5dGVz", mimeType: "image/png" },
      ],
      toolStatus: "success" as const,
      isError: false,
    };
    const restored = toolResultFromUi(row, timestamp);
    expect(restored.content).toEqual([
      { type: "text", text: "here is the screenshot" },
      { type: "image", data: "cG5nLWJ5dGVz", mimeType: "image/png" },
    ]);
  });

  it.each([
    [
      "MCP content property",
      {
        content: [
          { type: "text", text: "MCP returned a screenshot" },
          { type: "image", data: "cG5nLWJ5dGVz", mimeType: "image/png" },
        ],
        isError: false,
      },
    ],
    [
      "plugin bare content-block array",
      [
        { type: "text", text: "Plugin returned a screenshot" },
        { type: "image", data: "cG5nLWJ5dGVz", mimeType: "image/png" },
      ],
    ],
  ])("normalizes %s into model image blocks", async (_shape, rawContent) => {
    const host = {
      call: vi.fn().mockImplementation((method: string) =>
        Promise.resolve(
          method === "project.instructions.resolve"
            ? { entries: [] }
            : { ok: true, content: rawContent },
        ),
      ),
    };
    const runtime = createRuntime({ host });
    const read = (runtime as any).toolCatalog.get("Read");
    const result = await read.execute("image-result", { path: "screenshot.png" });
    const expectedText =
      _shape === "MCP content property"
        ? "MCP returned a screenshot"
        : "Plugin returned a screenshot";
    const expected = [
      { type: "text", text: expectedText },
      { type: "image", data: "cG5nLWJ5dGVz", mimeType: "image/png" },
    ];

    expect(result.content).toEqual(expected);
    expect(result.details).toMatchObject({ imageCount: 1 });

    const restored = toolResultFromUi(
      {
        id: "image-result",
        role: "tool",
        content: "",
        createdAt: new Date(timestamp).toISOString(),
        toolCallId: "image-result",
        toolName: "Read",
        toolResult: result,
        toolStatus: "success",
        isError: false,
      },
      timestamp,
    );
    expect(restored.content).toEqual(expected);
    await runtime.dispose();
  });
});
