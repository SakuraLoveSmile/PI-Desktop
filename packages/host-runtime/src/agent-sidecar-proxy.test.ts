import { afterEach, describe, expect, it } from "vitest";
import { AgentSidecar, type SidecarHostLink } from "./agent-sidecar.js";
import { isHostProxyAllowed } from "./agent-sidecar.js";

const sidecars: AgentSidecar[] = [];
afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.dispose()));
});

describe("sidecar host proxy allowlist", () => {
  it("allows the Team RPCs used by the Team runtime", () => {
    expect([
      "team.createMember",
      "team.createTask",
      "team.declareStrategy",
      "team.getBoard",
      "team.getExecutionDecision",
      "team.getLaunchReview",
      "team.getRoster",
      "team.interruptMember",
      "team.listMessages",
      "team.sendMessage",
      "team.updateTask",
      "goalReports.submitDraft",
      "goalReports.invalidateDraft",
      "goalReports.markFailed",
      "goalProgress.issueToken",
      "goalProgress.update",
    ].every(isHostProxyAllowed)).toBe(true);
  });

  it("keeps unrelated state and arbitrary Team mutations outside the proxy", () => {
    expect(isHostProxyAllowed("settings.set")).toBe(false);
    expect(isHostProxyAllowed("session.delete")).toBe(false);
    expect(isHostProxyAllowed("team.pause")).toBe(false);
    expect(isHostProxyAllowed("team.ackMessage")).toBe(false);
    expect(isHostProxyAllowed("team.updateLaunchReview")).toBe(false);
    expect(isHostProxyAllowed("team.confirmLaunchReview")).toBe(false);
    expect(isHostProxyAllowed("team.cancelLaunchReview")).toBe(false);
    expect(isHostProxyAllowed("goalReports.get")).toBe(false);
    expect(isHostProxyAllowed("goalReports.retry")).toBe(false);
    expect(isHostProxyAllowed("goalProgress.get")).toBe(false);
  });

  it("routes approved progress token and update calls over the real sidecar transport", async () => {
    const proxyUrl = new URL("../../agent-runtime/src/parent-host-proxy.ts", import.meta.url).href;
    const source = `
      import { createInterface } from 'node:readline';
      const { ParentHostProxy } = await import(${JSON.stringify(proxyUrl)});
      const proxy = new ParentHostProxy();
      createInterface({ input: process.stdin }).on('line', async (line) => {
        const message = JSON.parse(line);
        if (proxy.handleParentMessage(message)) return;
        try {
          const result = await proxy.call(message.params.method, message.params.params);
          console.log(JSON.stringify({ id: message.id, result }));
        } catch (error) {
          console.log(JSON.stringify({ id: message.id, error: { code: error.code, message: error.message, data: error.data } }));
        }
      });`;
    const sidecar = new AgentSidecar({
      launch: { command: process.execPath, args: ["--input-type=module", "-e", source] },
      onStderr: () => undefined,
    });
    sidecars.push(sidecar);
    const calls: Array<{ method: string; params: unknown }> = [];
    const host: SidecarHostLink = {
      async call<T>(method: string, params?: unknown): Promise<T> {
        calls.push({ method, params });
        if (method === "goalProgress.issueToken") return { writeToken: "approved-token" } as T;
        if (method === "goalProgress.update") return { progress: { revision: 1 } } as T;
        throw new Error(`unexpected ${method}`);
      },
      onNotification: () => () => undefined,
      onExit: () => () => undefined,
    };
    sidecar.setHost(host);

    const issued = await sidecar.call<{ writeToken: string }>("probe", {
      method: "goalProgress.issueToken",
      params: { sessionId: "session-1", executionId: "execution-1", turnId: "turn-1" },
    });
    const updated = await sidecar.call<{ progress: { revision: number } }>("probe", {
      method: "goalProgress.update",
      params: { sessionId: "session-1", executionId: "execution-1", writeToken: issued.writeToken, items: [] },
    });

    expect(issued.writeToken).toBe("approved-token");
    expect(updated.progress.revision).toBe(1);
    expect(calls.map((call) => call.method)).toEqual(["goalProgress.issueToken", "goalProgress.update"]);
    await expect(sidecar.call("probe", { method: "goalProgress.get", params: { sessionId: "session-1", executionId: "execution-1" } })).rejects.toMatchObject({ code: -32601 });
    expect(calls).toHaveLength(2);
  });
});
