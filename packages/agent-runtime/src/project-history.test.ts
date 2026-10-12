import { describe, it, expect, vi } from "vitest";
import { createProjectHistoryTool } from "./project-history.js";
import type { RuntimeHost } from "./host-client.js";

describe("project historical recall", () => {
  it("searches then reads the returned source without changing the caller session", async () => {
    const call = vi.fn(async (method: string) => method.endsWith("search")
      ? { hits: [{ sessionId: "source", title: "Earlier decision", matches: [
        { messageId: "decision", snippet: "Use pnpm" }]}], hasMore: false }
      : { sessionId: "source", title: "Earlier decision", messages: [
        { id: "decision", role: "user", content: "Use pnpm" }], truncated: false });
    const host = { call } as unknown as RuntimeHost;
    const tool = createProjectHistoryTool(host, "caller");
    const search = await tool.execute("search-call", { action: "search", query: "pnpm" });
    expect(search.content[0]).toMatchObject({ type: "text" });
    const hits = JSON.parse((search.content[0] as { text: string }).text).hits;
    const read = await tool.execute("read-call", { action: "read",
      targetSessionId: hits[0].sessionId, messageId: hits[0].matches[0].messageId });
    expect(call.mock.calls[1]).toEqual(["project.history.context", expect.objectContaining({
      sessionId: "caller", targetSessionId: "source", messageId: "decision" })]);
    expect(JSON.parse((read.content[0] as { text: string }).text).messages[0].content).toBe("Use pnpm");
  });

  it("surfaces unavailable history and rejects invalid requests before host access", async () => {
    const call = vi.fn(async () => { throw new Error("history unavailable"); });
    const tool = createProjectHistoryTool({ call } as unknown as RuntimeHost, "caller");
    await expect(tool.execute("call", { action: "search", query: " " })).rejects.toThrow("query required");
    await expect(tool.execute("call", { action: "read", messageId: "m" })).rejects.toThrow("source session");
    expect(call).not.toHaveBeenCalled();
    await expect(tool.execute("call", { action: "search", query: "pnpm" })).rejects.toThrow("history unavailable");
  });

  it("does not publish a result after cancellation during host lookup", async () => {
    const controller = new AbortController();
    const host = { call: vi.fn(async () => { controller.abort(); return { hits: [] }; }) } as unknown as RuntimeHost;
    const tool = createProjectHistoryTool(host, "caller");
    await expect(tool.execute("call", { action: "search", query: "pnpm" }, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
