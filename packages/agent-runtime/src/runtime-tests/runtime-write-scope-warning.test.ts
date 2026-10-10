import "./runtime-test-harness.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "./runtime-test-harness.js";

describe("advisory Host write scope results", () => {
  it("delivers the warning to the model while keeping the successful mutation successful", async () => {
    const scopeWarning = { code: "TEAM_WRITE_SCOPE_WARNING", taskIds: ["assigned"], message: "The file mutation succeeded outside declared writeScopes." };
    const host = { call: vi.fn(async (method: string) => method === "tools.execute"
      ? { ok: true, isError: false, content: { root: "workspace", path: "other.txt", scopeWarning } }
      : undefined) };
    const runtime = createRuntime({ host });
    try {
      const agent = (runtime as unknown as { agent: { state: { tools: AgentTool[] } } }).agent;
      for (const name of ["Write", "Edit"]) {
        const tool = agent.state.tools.find(tool => tool.name === name)!;
        const result = await tool.execute(name, name === "Write" ? { path: "other.txt", content: "written" } : { path: "other.txt", old_string: "written", new_string: "edited" });
        expect(result.isError).toBe(false);
        if (result.content[0].type !== "text") throw new Error("Missing mutation result text");
        expect(JSON.parse(result.content[0].text).scopeWarning).toEqual(scopeWarning);
        expect(result.details).toMatchObject({ scopeWarning });
        expect(result).not.toHaveProperty("terminate");
      }
    } finally { await runtime.dispose(); }
  });
});
