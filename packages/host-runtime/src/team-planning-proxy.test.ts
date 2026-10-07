import { afterEach, describe, expect, it } from "vitest";
import { AgentSidecar, type SidecarHostLink } from "./agent-sidecar.js";

const sidecars: AgentSidecar[] = [];
afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.dispose()));
});

// A real child uses the production parent proxy: both wire encoders and the
// Host-side allowlist participate, rather than calling private decoder methods.
function harness(authorize: (sessionId: string, toolName: string) => boolean = () => true) {
  const proxyUrl = new URL("../../agent-runtime/src/parent-host-proxy.ts", import.meta.url).href;
  const source = `
    import { createInterface } from 'node:readline';
    const { ParentHostProxy } = await import(${JSON.stringify(proxyUrl)});
    const proxy = new ParentHostProxy();
    createInterface({ input: process.stdin }).on('line', async line => {
      const message = JSON.parse(line);
      if (proxy.handleParentMessage(message)) return;
      try {
        const result = await proxy.call(message.params.method, message.params.params);
        console.log(JSON.stringify({ id: message.id, result }));
      } catch (error) {
        console.log(JSON.stringify({ id: message.id, error: {
          code: error.code, message: error.message, data: error.data
        } }));
      }
    });`;
  const sidecar = new AgentSidecar({
    launch: { command: process.execPath, args: ["--input-type=module", "-e", source] },
    onStderr: () => {},
  });
  sidecars.push(sidecar);
  const calls: Array<{ method: string; params: unknown }> = [];
  const host: SidecarHostLink = {
    async call<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      if (method === "tools.authorizeLocal") {
        const input = params as { sessionId: string; toolName: string };
        if (!authorize(input.sessionId, input.toolName)) {
          throw Object.assign(new Error("Host-owned research policy"), {
            code: 1002, data: { errorCode: "TEAM_RESEARCH_READ_ONLY" },
          });
        }
        return { mode: "agent" } as T;
      }
      return { method, params } as T;
    },
    onNotification: () => () => {},
    onExit: () => () => {},
  };
  sidecar.setHost(host);
  const call = <T>(method: string, params: unknown) =>
    sidecar.call<T>("probe", { method, params });
  return { sidecar, calls, call };
}

describe("Team planning production sidecar boundary", () => {
  it("forwards bounded research and question RPCs without dropping trusted round binding", async () => {
    const { call, calls } = harness();
    const context = {
      teamSessionId: "lead", callerSessionId: "researcher", planningId: "planning", roundId: "round",
    };
    const structuredResult = {
      summary: "Verified the existing entry point", findings: ["Read-only finding"],
      risks: ["Compatibility"], recommendations: ["Reuse the entry point"], verifiedSources: ["README.md"],
    };
    const input = { ...context, taskId: "task", expectedRevision: 2, structuredResult };
    expect(await call("team.submitResearchResult", input)).toEqual({ method: "team.submitResearchResult", params: input });
    for (const method of ["team.getPlanning", "team.openPlanningQuestion", "team.closePlanningQuestion"]) {
      const params = { ...context, callerSessionId: "lead", questionId: "question" };
      expect(await call(method, params)).toEqual({ method, params });
    }
    expect(calls).toHaveLength(4);
  });

  it("forwards the read-only Lead authorization check without exposing confirmation", async () => {
    const { call, calls } = harness();
    const input = { teamSessionId: "lead", callerSessionId: "lead", toolName: "Skill" };
    expect(await call("team.authorizeLeadTool", input)).toEqual({ method: "team.authorizeLeadTool", params: input });
    expect(calls).toEqual([{ method: "team.authorizeLeadTool", params: input }]);
    await expect(call("team.confirmLaunchReview", { teamSessionId: "lead", reviewId: "solo", expectedRevision: 1 }))
      .rejects.toMatchObject({ code: -32601 });
    expect(calls).toHaveLength(1);
  });

  it("keeps trusted launch review actions outside the model-directed reverse proxy", async () => {
    const { call, calls } = harness();
    for (const method of ["team.updateLaunchReview", "team.confirmLaunchReview", "team.cancelLaunchReview", "tools.authorizeLocal"]) {
      await expect(call(method, { teamSessionId: "lead", reviewId: "review", expectedRevision: 1 }))
        .rejects.toMatchObject({ code: -32601 });
    }
    expect(calls).toEqual([]);
  });

  it.each(["Write", "Bash", "Skill", "PluginMutation", "BrowserPreview"])(
    "denies intercepted %s for a Host-bound researcher despite forged agent mode",
    async (toolName) => {
      const { sidecar, call, calls } = harness((sessionId) => sessionId !== "researcher");
      let localExecutions = 0;
      sidecar.setLocalTool(toolName, async () => {
        localExecutions += 1;
        return { ok: true, content: "must not execute" };
      });
      await expect(call("tools.execute", {
        sessionId: "researcher", toolCallId: "attempt", toolName, mode: "agent",
        workPurpose: "execute", args: {},
      })).rejects.toMatchObject({ errorCode: "TEAM_RESEARCH_READ_ONLY" });
      expect(localExecutions).toBe(0);
      expect(calls).toEqual([{
        method: "tools.authorizeLocal", params: { sessionId: "researcher", toolName },
      }]);
    },
  );

  it("allows an approved execution Lead through the normal local-tool path", async () => {
    const { sidecar, call, calls } = harness((sessionId) => sessionId === "lead");
    sidecar.setLocalTool("LocalMarker", async () => {
      calls.push({ method: "local-marker", params: null });
      return { ok: true, content: "execution marker" };
    });
    expect(await call("tools.execute", {
      sessionId: "lead", toolCallId: "write", toolName: "LocalMarker", mode: "agent", args: {},
    })).toEqual({ ok: true, content: "execution marker" });
    expect(calls.map((entry) => entry.method)).toEqual(["tools.authorizeLocal", "local-marker"]);
  });
});
