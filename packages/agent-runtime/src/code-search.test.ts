import { describe, expect, it, vi } from "vitest";
import { buildCodeSearchTool, validateCodeSearchResult } from "./code-search.js";
import type { RuntimeHost } from "./host-client.js";

const result = () => ({ hits: [{ path: "src/main.ts", line: 2, text: "const marker = 1;" }], truncated: false,
  index: { fileCount: 1, indexedBytes: 17, skippedFiles: 0, status: "fresh" } });
function setup(value: unknown = result()) {
  const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>().mockResolvedValue(value);
  const host: RuntimeHost = { call: async <T>(method: string, params?: unknown) => await call(method, params) as T };
  return { call, tool: buildCodeSearchTool({ host, sessionId: "session-a", boundPath: "/workspace/a" }) };
}

describe("CodeSearch", () => {
  it("searches through the session-bound host interface and returns visible line results", async () => {
    const { tool, call } = setup();
    const response = await tool.execute("tool-1", { query: "marker", limit: 2, sessionId: "injected", boundPath: "/outside" });
    expect(call).toHaveBeenCalledWith("project.codeSearch", { sessionId: "session-a", boundPath: "/workspace/a", action: "search", query: "marker", limit: 2 });
    expect(response.details).toMatchObject({ ok: true, hits: [{ path: "src/main.ts", line: 2 }] });
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(result()) }]);
  });

  it("supports explicit cache status and clear without a query or external calls", async () => {
    const missing = { hits: [], truncated: false, index: { fileCount: 0, indexedBytes: 0, skippedFiles: 0, status: "missing" } };
    const { tool, call } = setup(missing);
    for (const action of ["status", "clear"]) {
      expect((await tool.execute("tool", { action })).details).toMatchObject({ ok: true, index: { status: "missing" } });
      expect(call).toHaveBeenLastCalledWith("project.codeSearch", { sessionId: "session-a", boundPath: "/workspace/a", action });
    }
  });

  it("explains partial results and output truncation without claiming absent matches", async () => {
    const partial = { hits: [], truncated: true, index: { fileCount: 3, indexedBytes: 20, skippedFiles: 2, status: "partial" } };
    const response = await setup(partial).tool.execute("tool", { query: "missing" });
    expect(response.content).toEqual([{ type: "text", text: expect.stringContaining("Partial coverage") }]);
    const response2 = await setup({ ...result(), truncated: true }).tool.execute("tool", { query: "marker" });
    expect(response2.content).toEqual([{ type: "text", text: expect.stringContaining("Results truncated") }]);
  });

  it("rejects invalid queries, limits, and actions before reaching the host", async () => {
    const { tool, call } = setup();
    for (const params of [{}, { query: "" }, { query: "x".repeat(501) }, { query: "a\0b" }, { query: "x", limit: 0 },
      { query: "x", limit: 51 }, { query: "x", limit: 1.5 }, { action: "unknown" }]) {
      expect((await tool.execute("tool", params)).details).toMatchObject({ ok: false });
    }
    expect(call).not.toHaveBeenCalled();
    expect((await tool.execute("tool", { query: "中".repeat(500) })).details).toMatchObject({ ok: true });
  });

  it("keeps storage and binding errors observable", async () => {
    const { tool, call } = setup();
    call.mockRejectedValue(new Error("INDEX_STORE_FAILED: cannot open cache"));
    expect((await tool.execute("tool", { query: "x" })).details).toMatchObject({ ok: false, error: expect.stringContaining("INDEX_STORE_FAILED") });
  });

  it("rejects malformed or escaping host output at the boundary", async () => {
    for (const bad of [null, { ...result(), hits: [{ path: "../secret", line: 1, text: "x" }] },
      { ...result(), hits: [{ path: "/secret", line: 1, text: "x" }] },
      { ...result(), hits: [{ path: "x", line: 0, text: "x" }] },
      { ...result(), hits: [{ path: "x", line: 1, text: "x".repeat(241) }] },
      { ...result(), index: { ...result().index, status: ["fresh"] } },
      { ...result(), index: { ...result().index, status: "partial" } }]) {
      expect(validateCodeSearchResult(bad)).toBe(false);
      expect((await setup(bad).tool.execute("tool", { query: "x" })).details).toMatchObject({ ok: false });
    }
  });

  it("does not return successful stale output after cancellation", async () => {
    const { tool, call } = setup();
    const abort = new AbortController();
    call.mockImplementation(async () => { abort.abort(); return result(); });
    expect((await tool.execute("tool", { query: "x" }, abort.signal)).details).toMatchObject({ ok: false, error: "CodeSearch cancelled" });
  });
});
